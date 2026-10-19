package audio

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
)

// Transcriber is the interface used by call handlers to submit transcription jobs.
// It allows the underlying pool to be swapped at runtime without restarting.
// Submit must not wait on the transcription server: call ingest runs it on
// the upload request path, and a recorder waits for that reply before it
// sends its next call.
type Transcriber interface {
	Submit(ctx context.Context, job TranscriptionJob) error
}

// transcriptionBacklogSize is how many calls can wait for a pool slot. A job
// is a few dozen bytes, so this covers hours of traffic while go-whisper is
// slow or down without holding much memory.
const transcriptionBacklogSize = 10000

// ErrTranscriptionBacklogFull is returned by Submit when the backlog has no
// room; the call is recorded as skipped and stays retryable from the admin.
var ErrTranscriptionBacklogFull = errors.New("transcription queue full")

// JobRecorder is told about every call the manager takes or turns away, so
// the admin can show a job history. Nil means nobody is listening.
type JobRecorder interface {
	Queued(ctx context.Context, callID int64, model string)
	Skipped(ctx context.Context, callID int64, model, reason string)
}

// TranscriberManager wraps a TranscriberPool with thread-safe hot-reload.
// It implements Transcriber so callers can submit jobs without caring about
// the underlying pool lifecycle.
type TranscriberManager struct {
	mu      sync.RWMutex
	pool    *TranscriberPool
	cancel  context.CancelFunc // cancels the current pool's workers
	results chan TranscriptionJobResult
	appCtx  context.Context // root context (server lifetime)

	// minDurationMs drops calls shorter than this (0 keeps everything).
	minDurationMs atomic.Int64
	recorder      JobRecorder

	// backlog holds submitted calls until the dispatcher hands them to the
	// current pool, so Submit never waits on a full pool queue.
	backlog chan TranscriptionJob
	// backlogFull is set while Submit is turning calls away, so the warning
	// is logged once per episode rather than once per call.
	backlogFull atomic.Bool
}

// SetRecorder installs the job history sink.
func (m *TranscriberManager) SetRecorder(r JobRecorder) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.recorder = r
}

// SetMinDurationMs sets the shortest call worth transcribing.
func (m *TranscriberManager) SetMinDurationMs(ms int64) {
	if ms < 0 {
		ms = 0
	}
	m.minDurationMs.Store(ms)
}

// MinDurationMs returns the shortest call worth transcribing.
func (m *TranscriberManager) MinDurationMs() int64 {
	return m.minDurationMs.Load()
}

// NewTranscriberManager creates a manager. If pool is nil, transcription starts disabled.
// results is a shared channel that all pools write to; the consumer goroutine reads from it.
func NewTranscriberManager(appCtx context.Context, pool *TranscriberPool, cancel context.CancelFunc) *TranscriberManager {
	return newTranscriberManager(appCtx, pool, cancel, transcriptionBacklogSize)
}

func newTranscriberManager(appCtx context.Context, pool *TranscriberPool, cancel context.CancelFunc, backlogSize int) *TranscriberManager {
	m := &TranscriberManager{
		pool:    pool,
		cancel:  cancel,
		results: make(chan TranscriptionJobResult, 16),
		appCtx:  appCtx,
		backlog: make(chan TranscriptionJob, backlogSize),
	}
	// Pump results from the initial pool (if any) into the shared channel.
	if pool != nil {
		go m.pumpResults(pool)
	}
	go m.dispatch()
	return m
}

// Submit queues a transcription job and returns at once; it never waits on
// go-whisper. Returns nil (no-op) if transcription is disabled. Calls shorter
// than the minimum are recorded as skipped and not sent, unless the job is
// forced. When the backlog is full the call is recorded as skipped and
// ErrTranscriptionBacklogFull is returned.
func (m *TranscriberManager) Submit(ctx context.Context, job TranscriptionJob) error {
	p, rec, ok := m.admit(ctx, job)
	if !ok {
		return nil
	}
	select {
	case m.backlog <- job:
		if m.backlogFull.CompareAndSwap(true, false) {
			slog.Info("transcription: queue has room again")
		}
		return nil
	default:
	}
	if m.backlogFull.CompareAndSwap(false, true) {
		slog.Warn("transcription: queue full, skipping calls until it drains",
			"backlog", cap(m.backlog), "url", p.baseURL)
	}
	if rec != nil {
		rec.Skipped(ctx, job.CallID, p.Model(), ErrTranscriptionBacklogFull.Error())
	}
	return ErrTranscriptionBacklogFull
}

// Retry sends a call to the transcriber again, whatever its length.
// It fails when transcription is off, since nothing would pick the job up.
// Unlike Submit it waits for room in the pool, which paces a bulk retry
// instead of overflowing the backlog that live calls use.
func (m *TranscriberManager) Retry(ctx context.Context, callID int64, audioPath string) error {
	if !m.Enabled() {
		return fmt.Errorf("transcription is off")
	}
	job := TranscriptionJob{CallID: callID, AudioPath: audioPath, Force: true}
	p, _, ok := m.admit(ctx, job)
	if !ok {
		return fmt.Errorf("transcription is off")
	}
	return p.Submit(ctx, job)
}

// admit applies the checks every job goes through and records it as queued.
// ok is false when transcription is off or the call was skipped as too short.
func (m *TranscriberManager) admit(ctx context.Context, job TranscriptionJob) (p *TranscriberPool, rec JobRecorder, ok bool) {
	m.mu.RLock()
	p = m.pool
	rec = m.recorder
	m.mu.RUnlock()
	if p == nil {
		return nil, nil, false
	}
	if min := m.minDurationMs.Load(); !job.Force && min > 0 && job.DurationMs > 0 && job.DurationMs < min {
		if rec != nil {
			rec.Skipped(ctx, job.CallID, p.Model(), fmt.Sprintf("shorter than %.1f s", float64(min)/1000))
		}
		return nil, nil, false
	}
	if rec != nil {
		rec.Queued(ctx, job.CallID, p.Model())
	}
	return p, rec, true
}

// dispatch moves backlog jobs into the current pool, one at a time and in
// order, waiting for room as long as it takes. It runs for the server's
// lifetime.
func (m *TranscriberManager) dispatch() {
	for {
		select {
		case <-m.appCtx.Done():
			return
		case job := <-m.backlog:
			m.handOver(job)
		}
	}
}

// handOver submits one backlog job, following the pool across a reload. A
// job still waiting when transcription is turned off is recorded as skipped.
func (m *TranscriberManager) handOver(job TranscriptionJob) {
	var last *TranscriberPool
	for m.appCtx.Err() == nil {
		m.mu.RLock()
		p := m.pool
		rec := m.recorder
		m.mu.RUnlock()
		if p == nil || p == last {
			if rec != nil {
				rec.Skipped(m.appCtx, job.CallID, "", "transcription turned off")
			}
			return
		}
		err := p.Submit(m.appCtx, job)
		if !errors.Is(err, ErrTranscriberStopped) {
			return
		}
		// The pool was reloaded while the job waited; try the new one.
		last = p
	}
}

// Workers returns how many jobs run at once, or 0 when disabled.
func (m *TranscriberManager) Workers() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.pool == nil {
		return 0
	}
	return m.pool.Workers()
}

// Results returns the shared results channel that the consumer goroutine reads from.
func (m *TranscriberManager) Results() <-chan TranscriptionJobResult {
	return m.results
}

// Model returns the current pool's model name, or empty string if disabled.
func (m *TranscriberManager) Model() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.pool == nil {
		return ""
	}
	return m.pool.Model()
}

// Enabled returns whether transcription is currently active.
func (m *TranscriberManager) Enabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pool != nil
}

// BaseURL returns the current pool's base URL, or empty string if disabled.
func (m *TranscriberManager) BaseURL() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.pool == nil {
		return ""
	}
	return m.pool.baseURL
}

// QueueDepth returns the number of jobs waiting, in the backlog and the
// pool's own queue, or 0 if disabled.
func (m *TranscriberManager) QueueDepth() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.pool == nil {
		return 0
	}
	return len(m.backlog) + m.pool.QueueDepth()
}

// Reload stops the current pool (if any) and starts a new one with the given config.
// If enabled is false, the pool is stopped and transcription is disabled.
func (m *TranscriberManager) Reload(enabled bool, baseURL, model, language string, diarize bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop existing pool.
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.pool = nil

	if !enabled {
		slog.Info("transcription disabled")
		return true
	}

	if baseURL == "" {
		baseURL = "http://localhost:8081"
	}
	if model == "" {
		model = "ggml-base"
	}

	poolCtx, poolCancel := context.WithCancel(m.appCtx)

	tp, err := NewTranscriberPool(poolCtx, 2, baseURL, model, language, diarize)
	if err != nil {
		poolCancel()
		slog.Warn("transcription pool creation failed", "error", err)
		return false
	}
	if err := tp.Ping(poolCtx); err != nil {
		poolCancel()
		slog.Warn("go-whisper unreachable", "url", baseURL, "error", err)
		return false
	}

	m.pool = tp
	m.cancel = poolCancel
	slog.Info("transcription enabled", "url", baseURL, "model", model, "diarize", diarize)

	// Pump results from the new pool into the shared channel.
	go m.pumpResults(tp)

	return true
}

// pumpResults forwards results from a specific pool into the shared results channel.
// It stops when the pool's results channel is closed (pool context cancelled).
func (m *TranscriberManager) pumpResults(pool *TranscriberPool) {
	for res := range pool.Results() {
		select {
		case m.results <- res:
		case <-m.appCtx.Done():
			return
		}
	}
}
