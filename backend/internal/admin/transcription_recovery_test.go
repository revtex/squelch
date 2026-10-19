package admin

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
)

// fakeRequeuer stands in for the transcriber: like the real one it records
// a requeued call as queued, unless transcription is off.
type fakeRequeuer struct {
	enabled, answering bool
	rec                TranscriptionJobRecorder
	sent               []int64
	paths              []string
}

func (f *fakeRequeuer) Enabled() bool   { return f.enabled }
func (f *fakeRequeuer) Answering() bool { return f.enabled && f.answering }
func (f *fakeRequeuer) Requeue(ctx context.Context, callID int64, path string) error {
	if !f.enabled {
		return audio.ErrTranscriptionOff
	}
	f.rec.Queued(ctx, callID, "ggml-base")
	f.sent = append(f.sent, callID)
	f.paths = append(f.paths, path)
	return nil
}

// recoveryFixture makes calls named after their file and a recovery bound to
// a fake transcriber.
func recoveryFixture(t *testing.T) (r TranscriptionRecovery, fake *fakeRequeuer, call func(name string) int64, q *db.Queries) {
	t.Helper()
	o, q := newTestOperations(t, "")
	sysID := createSystem(t, o, 1, "Lake")
	tgID := createTalkgroup(t, o, sysID, 101, "LC FD Disp")
	call = func(name string) int64 {
		id, err := q.CreateCall(context.Background(), db.CreateCallParams{
			AudioPath: "x/" + name, AudioName: name, AudioType: "audio/mp4", DateTime: time.Now().Unix(),
			Duration: sql.NullInt64{Int64: 4000, Valid: true}, SystemID: sysID, TalkgroupID: sql.NullInt64{Int64: tgID, Valid: true},
		})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	rec := TranscriptionJobRecorder{Queries: q}
	fake = &fakeRequeuer{rec: rec}
	r = TranscriptionRecovery{Queries: q, Transcriber: fake, Recorder: rec, RecordingsDir: "/rec"}
	return r, fake, call, q
}

func jobStatus(t *testing.T, q *db.Queries, callID int64) db.TranscriptionJob {
	t.Helper()
	j, err := q.GetTranscriptionJob(context.Background(), callID)
	if err != nil {
		t.Fatal(err)
	}
	return j
}

// The backlog lives in memory, so calls a previous run queued but never
// transcribed are found at startup and queued again, or recorded as skipped
// when transcription is off, rather than left queued forever.
func TestTranscriptionRecovery_RequeuesCallsTheLastRunLeftQueued(t *testing.T) {
	ctx := context.Background()
	r, fake, call, q := recoveryFixture(t)
	a, b, done := call("a.m4a"), call("b.m4a"), call("c.m4a")
	r.Recorder.Queued(ctx, a, "ggml-base")
	r.Recorder.Queued(ctx, b, "ggml-base")
	r.Recorder.Queued(ctx, done, "ggml-base")
	r.Recorder.Finished(ctx, done, 150, nil)

	stale, err := r.Stale(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(stale) != 2 || stale[0].CallID != a || stale[1].CallID != b {
		t.Fatalf("stale = %+v, want calls %d and %d", stale, a, b)
	}

	fake.enabled = true
	r.requeueStale(ctx, stale)
	if len(fake.paths) != 2 || fake.paths[0] != "/rec/x/a.m4a" || fake.paths[1] != "/rec/x/b.m4a" {
		t.Fatalf("requeued %v", fake.paths)
	}

	fake.enabled = false
	r.requeueStale(ctx, stale)
	for _, id := range []int64{a, b} {
		if j := jobStatus(t, q, id); j.Status != "skipped" || j.Error.String != restartedReason {
			t.Errorf("call %d with transcription off: %s %q", id, j.Status, j.Error.String)
		}
	}
}

// Calls that failed because go-whisper could not be reached are retried on
// their own once it answers, newest first and at most autoRetryLimit times;
// calls that reached it and failed are left for an admin.
func TestTranscriptionRecovery_RetriesCallsGoWhisperNeverReached(t *testing.T) {
	ctx := context.Background()
	r, fake, call, q := recoveryFixture(t)
	refused := errors.New(`go-whisper request: Post "http://192.168.101.11:8081/api/whisper/transcribe": dial tcp 192.168.101.11:8081: connect: connection refused`)
	noRoute := errors.New(`go-whisper request: Post "http://192.168.101.11:8081/api/whisper/transcribe": dial tcp 192.168.101.11:8081: connect: no route to host`)
	dialTimeout := errors.New(`go-whisper request: Post "http://192.168.101.11:8081/api/whisper/transcribe": dial tcp 192.168.101.11:8081: i/o timeout`)
	slow := errors.New("go-whisper request: context deadline exceeded (Client.Timeout exceeded while awaiting headers)")
	fail := func(id int64, err error) {
		r.Recorder.Queued(ctx, id, "ggml-base")
		r.Recorder.Finished(ctx, id, 100, err)
	}
	a, b, c, d, e := call("a.m4a"), call("b.m4a"), call("c.m4a"), call("d.m4a"), call("e.m4a")
	fail(a, refused)
	fail(b, noRoute)
	fail(c, slow)
	fail(d, dialTimeout)
	r.Recorder.Queued(ctx, e, "ggml-base")
	r.Recorder.Finished(ctx, e, 100, nil)

	fake.enabled = true
	r.retryUnreachable(ctx)
	if len(fake.sent) != 0 {
		t.Fatalf("retried %v while go-whisper was not answering", fake.sent)
	}

	fake.answering = true
	for round := 1; round <= autoRetryLimit; round++ {
		fake.sent = nil
		r.retryUnreachable(ctx)
		if len(fake.sent) != 3 || fake.sent[0] != d || fake.sent[1] != b || fake.sent[2] != a {
			t.Fatalf("round %d retried %v, want %d, %d, %d", round, fake.sent, d, b, a)
		}
		for _, id := range fake.sent {
			if j := jobStatus(t, q, id); j.Status != "queued" || j.AutoRetries != int64(round) {
				t.Errorf("round %d call %d: %s, %d retries", round, id, j.Status, j.AutoRetries)
			}
		}
		// go-whisper goes away again before they are transcribed.
		fail(a, refused)
		fail(b, noRoute)
		fail(d, dialTimeout)
	}
	fake.sent = nil
	r.retryUnreachable(ctx)
	if len(fake.sent) != 0 {
		t.Errorf("retried %v past the limit of %d", fake.sent, autoRetryLimit)
	}
	if j := jobStatus(t, q, c); j.Status != "failed" || j.Error.String != "sidecar timed out" {
		t.Errorf("timed-out call: %s %q", j.Status, j.Error.String)
	}
}

// Releases before the job errors were put in words stored the raw dial
// error, and the outage backlog in production is all in that form; those
// calls are retried too.
func TestTranscriptionRecovery_RetriesRawDialErrorsFromOlderReleases(t *testing.T) {
	ctx := context.Background()
	r, fake, call, q := recoveryFixture(t)
	failRaw := func(id int64, text string) {
		r.Recorder.Queued(ctx, id, "ggml-base")
		if err := q.FinishTranscriptionJob(ctx, db.FinishTranscriptionJobParams{
			CallID: id, Status: "failed", Error: optStr(text),
			DurationMs: sql.NullInt64{Int64: 114000, Valid: true},
			FinishedAt: sql.NullInt64{Int64: time.Now().Unix(), Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}
	const post = `go-whisper request: Post "http://192.168.101.11:8081/api/whisper/transcribe": `
	noRoute, refused, netDown, dialTimeout, serverErr, slow :=
		call("a.m4a"), call("b.m4a"), call("c.m4a"), call("d.m4a"), call("e.m4a"), call("f.m4a")
	failRaw(noRoute, post+"dial tcp 192.168.101.11:8081: connect: no route to host")
	failRaw(refused, post+"dial tcp 192.168.101.11:8081: connect: connection refused")
	failRaw(netDown, post+"dial tcp 192.168.101.11:8081: connect: network is unreachable")
	failRaw(dialTimeout, post+"dial tcp 192.168.101.11:8081: i/o timeout")
	failRaw(serverErr, "go-whisper returned status 500: model not loaded")
	failRaw(slow, post+"context deadline exceeded (Client.Timeout exceeded while awaiting headers)")

	fake.enabled, fake.answering = true, true
	r.retryUnreachable(ctx)
	want := []int64{dialTimeout, netDown, refused, noRoute}
	if len(fake.sent) != len(want) {
		t.Fatalf("retried %v, want %v", fake.sent, want)
	}
	for i, id := range want {
		if fake.sent[i] != id {
			t.Fatalf("retried %v, want %v", fake.sent, want)
		}
	}
	for _, id := range []int64{serverErr, slow} {
		if j := jobStatus(t, q, id); j.Status != "failed" {
			t.Errorf("call %d that reached go-whisper was retried: %s", id, j.Status)
		}
	}
}
