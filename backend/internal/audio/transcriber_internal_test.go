package audio

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"runtime"
	"sync"
	"syscall"
	"testing"
	"time"
)

// A host that is off the network fails every dial, often only after a few
// seconds, so retrying it only holds a worker longer. A sidecar restarting
// refuses or drops connections instead, and that is worth a retry.
func TestIsTransientError_UnreachableHostIsNotRetried(t *testing.T) {
	dial := func(errno syscall.Errno) error {
		return fmt.Errorf("go-whisper request: %w", &net.OpError{
			Op: "dial", Net: "tcp",
			Err: &os.SyscallError{Syscall: "connect", Err: errno},
		})
	}
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"no route to host", dial(syscall.EHOSTUNREACH), false},
		{"network unreachable", dial(syscall.ENETUNREACH), false},
		{"no route to host, as text", errors.New("dial tcp 192.168.101.11:8081: connect: no route to host"), false},
		{"connection refused", dial(syscall.ECONNREFUSED), true},
		{"connection reset", dial(syscall.ECONNRESET), true},
	} {
		if got := isTransientError(tc.err); got != tc.want {
			t.Errorf("%s: isTransientError = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// A Submit waiting on a full queue gives up when the pool stops, rather than
// waiting forever on workers that have gone.
func TestTranscriberPool_SubmitGivesUpWhenThePoolStops(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	p := &TranscriberPool{jobs: make(chan TranscriptionJob), stopped: ctx.Done()} // no workers, no room

	errc := make(chan error, 1)
	go func() { errc <- p.Submit(context.Background(), TranscriptionJob{CallID: 1}) }()
	select {
	case err := <-errc:
		t.Fatalf("Submit returned before the pool stopped: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	cancel()
	select {
	case err := <-errc:
		if !errors.Is(err, ErrTranscriberStopped) {
			t.Errorf("Submit = %v, want ErrTranscriberStopped", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Submit still blocked after the pool stopped")
	}
}

// jobLog is a JobRecorder that is safe to call from the dispatcher goroutine.
type jobLog struct {
	mu      sync.Mutex
	skipped map[int64]string
}

func (l *jobLog) Queued(context.Context, int64, string) {}
func (l *jobLog) Skipped(_ context.Context, id int64, _, reason string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.skipped == nil {
		l.skipped = map[int64]string{}
	}
	l.skipped[id] = reason
}
func (l *jobLog) reason(id int64) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.skipped[id]
}

// waitUntil polls cond without sleeping until it holds or the deadline passes.
func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for !cond() {
		select {
		case <-deadline:
			t.Fatalf("timed out waiting until %s", what)
		default:
			runtime.Gosched()
		}
	}
}

// A pool with no workers and no room: the dispatcher's hand-over blocks on
// the first job, and everything after it waits in the backlog.
func stuckPool(ctx context.Context) *TranscriberPool {
	return &TranscriberPool{jobs: make(chan TranscriptionJob), stopped: ctx.Done(), model: "ggml-base"}
}

// When go-whisper cannot keep up, Submit turns calls away at once instead of
// waiting for room, records them as skipped, and takes calls again as soon
// as the backlog drains.
func TestTranscriberManager_SubmitSkipsWhenTheBacklogIsFull(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p := stuckPool(ctx)
	m := newTranscriberManager(ctx, p, cancel, 1)
	rec := &jobLog{}
	m.SetRecorder(rec)

	if err := m.Submit(ctx, TranscriptionJob{CallID: 1}); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "the dispatcher holds call 1", func() bool { return len(m.backlog) == 0 })
	if err := m.Submit(ctx, TranscriptionJob{CallID: 2}); err != nil {
		t.Fatal(err)
	}
	if err := m.Submit(ctx, TranscriptionJob{CallID: 3}); !errors.Is(err, ErrTranscriptionBacklogFull) {
		t.Fatalf("Submit with a full backlog = %v, want ErrTranscriptionBacklogFull", err)
	}
	if got := rec.reason(3); got != "transcription queue full" {
		t.Errorf("call 3 skipped reason = %q", got)
	}

	if got := (<-p.jobs).CallID; got != 1 {
		t.Fatalf("pool got call %d first, want 1", got)
	}
	waitUntil(t, "call 2 leaves the backlog", func() bool { return len(m.backlog) == 0 })
	if err := m.Submit(ctx, TranscriptionJob{CallID: 4}); err != nil {
		t.Fatalf("Submit after the backlog drained = %v", err)
	}
	if got := (<-p.jobs).CallID; got != 2 {
		t.Errorf("pool got call %d second, want 2", got)
	}
}

// Calls still waiting when transcription is turned off are recorded as
// skipped rather than lost silently, and the dispatcher keeps running.
func TestTranscriberManager_WaitingCallsAreSkippedWhenTurnedOff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	poolCtx, stopPool := context.WithCancel(ctx)
	m := newTranscriberManager(ctx, stuckPool(poolCtx), stopPool, 4)
	rec := &jobLog{}
	m.SetRecorder(rec)

	for id := int64(1); id <= 2; id++ {
		if err := m.Submit(ctx, TranscriptionJob{CallID: id}); err != nil {
			t.Fatal(err)
		}
	}
	m.Reload(false, "", "", "", false)

	for id := int64(1); id <= 2; id++ {
		waitUntil(t, fmt.Sprintf("call %d is skipped", id), func() bool { return rec.reason(id) == "transcription turned off" })
	}
	if err := m.Submit(ctx, TranscriptionJob{CallID: 3}); err != nil {
		t.Errorf("Submit while off = %v, want nil", err)
	}
}
