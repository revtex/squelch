package audio

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"
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

// ErrTranscriptionOff is returned by Retry and Requeue when transcription is
// turned off, since nothing would pick the call up.
var ErrTranscriptionOff = errors.New("transcription is off")

// sidecarProbeInterval is how often the manager asks a go-whisper that has
// stopped answering whether it is back.
const sidecarProbeInterval = 30 * time.Second

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

	// retries carries calls handed back by Requeue. The dispatcher takes
	// one only when no submitted call is waiting, so recovery work never
	// holds up new calls.
	retries chan TranscriptionJob

	// answering is whether go-whisper answered when last asked. While it is
	// false the pool is kept but the dispatcher holds calls in the backlog
	// rather than sending them to fail, and a probe asks every probeEvery
	// whether it is back. Guarded by mu.
	answering  bool
	probeEvery time.Duration
	// wake is closed and replaced whenever answering or the pool changes,
	// to rouse a dispatcher waiting for go-whisper. Guarded by mu.
	wake chan struct{}
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

// NewTranscriberManager creates a manager. If pool is nil, transcription
// starts disabled; a pool passed here is taken to be answering. Results from
// every pool reach the shared Results channel.
func NewTranscriberManager(appCtx context.Context, pool *TranscriberPool, cancel context.CancelFunc) *TranscriberManager {
	return newTranscriberManager(appCtx, pool, cancel, transcriptionBacklogSize, sidecarProbeInterval)
}

func newTranscriberManager(appCtx context.Context, pool *TranscriberPool, cancel context.CancelFunc, backlogSize int, probeEvery time.Duration) *TranscriberManager {
	m := &TranscriberManager{
		pool:       pool,
		cancel:     cancel,
		results:    make(chan TranscriptionJobResult, 16),
		appCtx:     appCtx,
		backlog:    make(chan TranscriptionJob, backlogSize),
		retries:    make(chan TranscriptionJob),
		answering:  true,
		probeEvery: probeEvery,
		wake:       make(chan struct{}),
	}
	// Pump results from the initial pool (if any) into the shared channel.
	if pool != nil {
		go m.pumpResults(pool)
	}
	go m.dispatch()
	go m.probe()
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
		return ErrTranscriptionOff
	}
	job := TranscriptionJob{CallID: callID, AudioPath: audioPath, Force: true}
	p, _, ok := m.admit(ctx, job)
	if !ok {
		return ErrTranscriptionOff
	}
	return p.Submit(ctx, job)
}

// Requeue hands a call back to the transcriber behind live calls, whatever
// its length. The call is recorded as queued at once; Requeue then waits
// until go-whisper answers and no submitted call is waiting before the
// dispatcher takes it, so recovering calls in bulk never delays new ones.
// It fails when transcription is off, and when ctx ends first (the call
// then stays recorded as queued, for the next start to pick up).
func (m *TranscriberManager) Requeue(ctx context.Context, callID int64, audioPath string) error {
	job := TranscriptionJob{CallID: callID, AudioPath: audioPath, Force: true}
	if _, _, ok := m.admit(ctx, job); !ok {
		return ErrTranscriptionOff
	}
	select {
	case m.retries <- job:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-m.appCtx.Done():
		return m.appCtx.Err()
	}
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

// dispatch moves jobs into the current pool, one at a time, waiting for room
// as long as it takes. Submitted calls go first and in order; a requeued
// call is taken only when none is waiting. While go-whisper is not answering
// it takes nothing, so calls wait in the backlog instead of failing. It runs
// for the server's lifetime.
func (m *TranscriberManager) dispatch() {
	for {
		wake, ok := m.waitForSidecar()
		if !ok {
			return
		}
		var job TranscriptionJob
		select {
		case <-m.appCtx.Done():
			return
		case job = <-m.backlog:
		default:
			select {
			case <-m.appCtx.Done():
				return
			case job = <-m.backlog:
			case job = <-m.retries:
			case <-wake:
				// go-whisper or the pool changed while idle; check again.
				continue
			}
		}
		m.handOver(job)
	}
}

// waitForSidecar returns once go-whisper is answering or transcription is
// off (the dispatcher then records waiting calls as skipped), with the
// channel that closes on the next change. ok is false when the server is
// shutting down.
func (m *TranscriberManager) waitForSidecar() (wake <-chan struct{}, ok bool) {
	for {
		m.mu.RLock()
		ready := m.pool == nil || m.answering
		w := m.wake
		m.mu.RUnlock()
		if ready {
			return w, m.appCtx.Err() == nil
		}
		select {
		case <-w:
		case <-m.appCtx.Done():
			return nil, false
		}
	}
}

// setAnswering records whether pool's go-whisper answers, and wakes the
// dispatcher. Results from a pool that has since been replaced are ignored.
func (m *TranscriberManager) setAnswering(pool *TranscriberPool, answering bool, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.pool != pool || m.answering == answering {
		return
	}
	m.answering = answering
	m.wakeLocked()
	if answering {
		slog.Info("transcription: go-whisper is answering again; sending the calls that waited",
			"url", pool.baseURL, "waiting", len(m.backlog))
	} else {
		slog.Warn("transcription: go-whisper is not answering; holding calls until it does",
			"url", pool.baseURL, "error", err)
	}
}

// wakeLocked wakes anything waiting on wake. The caller holds mu.
func (m *TranscriberManager) wakeLocked() {
	close(m.wake)
	m.wake = make(chan struct{})
}

// probe asks a go-whisper that has stopped answering whether it is back, every
// probeEvery, for the server's lifetime.
func (m *TranscriberManager) probe() {
	t := time.NewTicker(m.probeEvery)
	defer t.Stop()
	for {
		select {
		case <-m.appCtx.Done():
			return
		case <-t.C:
		}
		m.mu.RLock()
		p, answering := m.pool, m.answering
		m.mu.RUnlock()
		if p == nil || answering {
			continue
		}
		if err := p.Ping(m.appCtx); err == nil {
			m.setAnswering(p, true, nil)
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
		// The pool was reloaded while the job waited; try the new one once
		// its go-whisper answers.
		last = p
		if _, ok := m.waitForSidecar(); !ok {
			return
		}
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

// Enabled returns whether transcription is turned on, whether or not
// go-whisper is answering.
func (m *TranscriberManager) Enabled() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pool != nil
}

// Answering returns whether transcription is on and go-whisper answered when
// last asked; calls wait in the backlog while it is false.
func (m *TranscriberManager) Answering() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.pool != nil && m.answering
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
//
// A go-whisper that does not answer does not turn transcription off: the
// pool is kept, calls wait in the backlog, and they go out by themselves
// once a probe finds it answering. Reload returns false only when the
// settings cannot make a pool at all, such as a URL that is not http(s).
func (m *TranscriberManager) Reload(enabled bool, baseURL, model, language string, diarize bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Stop existing pool.
	if m.cancel != nil {
		m.cancel()
		m.cancel = nil
	}
	m.pool = nil
	m.answering = true
	m.wakeLocked()

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
	pingErr := tp.Ping(poolCtx)

	m.pool = tp
	m.cancel = poolCancel
	m.answering = pingErr == nil
	m.wakeLocked()
	if pingErr != nil {
		slog.Warn("transcription enabled, but go-whisper is not answering; calls wait until it does",
			"url", baseURL, "model", model, "error", pingErr)
	} else {
		slog.Info("transcription enabled", "url", baseURL, "model", model, "diarize", diarize)
	}

	// Pump results from the new pool into the shared channel.
	go m.pumpResults(tp)

	return true
}

// pumpResults forwards results from a specific pool into the shared results channel.
// It stops when the pool's results channel is closed (pool context cancelled).
// A job that could not reach go-whisper at all marks it as not answering, so
// the calls behind it wait instead of failing too.
func (m *TranscriberManager) pumpResults(pool *TranscriberPool) {
	for res := range pool.Results() {
		if sidecarUnreachable(res.Err) {
			m.setAnswering(pool, false, res.Err)
		}
		select {
		case m.results <- res:
		case <-m.appCtx.Done():
			return
		}
	}
}
