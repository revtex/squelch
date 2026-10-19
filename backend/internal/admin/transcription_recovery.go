package admin

import (
	"context"
	"errors"
	"log/slog"
	"path/filepath"
	"time"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
)

// Job errors plainJobError writes when go-whisper could not be reached at
// all. ListAutoRetryTranscriptionJobs matches on these texts (and on the raw
// dial errors older releases stored), so they are what decides that a
// failed call is retried on its own.
const (
	jobErrSidecarDown     = "sidecar not reachable"
	jobErrSidecarHostDown = "sidecar host unreachable"
)

// autoRetryLimit is how many times the server retries a call on its own
// after go-whisper could not be reached. Past it, only an admin retry sends
// the call again, so a call that keeps failing is not sent forever.
const autoRetryLimit = 3

// autoRetryBatch is how many failed calls one query hands back.
const autoRetryBatch = 100

// restartedReason is why a call left queued by the last run is skipped when
// transcription is off now.
const restartedReason = "server restarted before it was transcribed"

// TranscriptionRequeuer is the transcriber as recovery uses it.
type TranscriptionRequeuer interface {
	Enabled() bool
	Answering() bool
	// Requeue hands a call back behind live calls, waiting until the
	// transcriber takes it.
	Requeue(ctx context.Context, callID int64, audioPath string) error
}

// TranscriptionRecovery hands calls back to the transcriber that a restart
// or a go-whisper outage left untranscribed.
type TranscriptionRecovery struct {
	Queries       *db.Queries
	Transcriber   TranscriptionRequeuer
	Recorder      TranscriptionJobRecorder
	RecordingsDir string
	// Every is how often to look for failed calls to retry; zero means
	// once a minute.
	Every time.Duration
}

// Stale returns the calls recorded as queued. Read at startup, before
// anything is queued, they are the calls a previous run took but never
// transcribed: the backlog lives in memory and did not survive it.
func (r TranscriptionRecovery) Stale(ctx context.Context) ([]db.ListQueuedTranscriptionJobsRow, error) {
	return r.Queries.ListQueuedTranscriptionJobs(ctx)
}

// Run hands the stale calls back to the transcriber, then, for the server's
// lifetime, retries calls that failed because go-whisper could not be
// reached. Both wait behind live calls and only go out while go-whisper
// answers, so recovery never delays a new call.
func (r TranscriptionRecovery) Run(ctx context.Context, stale []db.ListQueuedTranscriptionJobsRow) {
	r.requeueStale(ctx, stale)
	every := r.Every
	if every <= 0 {
		every = time.Minute
	}
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		r.retryUnreachable(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// requeueStale queues the calls the last run left behind, or records them as
// skipped when transcription is off now, so none stays queued forever.
func (r TranscriptionRecovery) requeueStale(ctx context.Context, stale []db.ListQueuedTranscriptionJobsRow) {
	if len(stale) == 0 {
		return
	}
	slog.Info("transcription: re-queuing calls the last run left queued", "calls", len(stale))
	for _, s := range stale {
		err := r.Transcriber.Requeue(ctx, s.CallID, filepath.Join(r.RecordingsDir, s.AudioPath))
		switch {
		case err == nil:
		case errors.Is(err, audio.ErrTranscriptionOff):
			r.Recorder.Skipped(ctx, s.CallID, "", restartedReason)
		default:
			// Shutting down: the rest stay queued for the next start.
			return
		}
	}
}

// retryUnreachable queues every failed call that never reached go-whisper
// and has automatic retries left, newest first, while go-whisper answers.
func (r TranscriptionRecovery) retryUnreachable(ctx context.Context) {
	sent := 0
	defer func() {
		if sent > 0 {
			slog.Info("transcription: retried calls go-whisper could not be reached for", "calls", sent)
		}
	}()
	for ctx.Err() == nil && r.Transcriber.Answering() {
		rows, err := r.Queries.ListAutoRetryTranscriptionJobs(ctx, db.ListAutoRetryTranscriptionJobsParams{
			MaxRetries: autoRetryLimit, Limit: autoRetryBatch,
		})
		if err != nil {
			slog.Warn("transcription: failed to list calls to retry", "error", err)
			return
		}
		if len(rows) == 0 {
			return
		}
		for _, j := range rows {
			if !r.Transcriber.Answering() {
				return
			}
			// Counted before the call is queued, so a call that fails
			// again is not retried past the limit.
			if err := r.Queries.AddTranscriptionJobAutoRetry(ctx, j.CallID); err != nil {
				slog.Warn("transcription: failed to count a retry", "call_id", j.CallID, "error", err)
				return
			}
			if err := r.Transcriber.Requeue(ctx, j.CallID, filepath.Join(r.RecordingsDir, j.AudioPath)); err != nil {
				return
			}
			sent++
		}
	}
}
