package audio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/safehttp"
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
	m := newTranscriberManager(ctx, p, cancel, 1, time.Hour)
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
	m := newTranscriberManager(ctx, stuckPool(poolCtx), stopPool, 4, time.Hour)
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

// A go-whisper that is down when transcription starts leaves it on: calls
// wait in the backlog rather than being sent to fail, and they go out by
// themselves once the probe finds it answering.
func TestTranscriberManager_StaysOnAndResumesWhenGoWhisperComesBack(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var up atomic.Bool
	var pings, sent atomic.Int32
	sidecar := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/whisper/model":
			pings.Add(1)
		case "/api/whisper/transcribe":
			sent.Add(1)
		}
		if !up.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		if r.URL.Path == "/api/whisper/transcribe" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"language":"en","segments":[{"text":"engine 1 respond"}]}`)
		}
	}))
	defer sidecar.Close()
	clip := filepath.Join(t.TempDir(), "clip.m4a")
	if err := os.WriteFile(clip, []byte("audio"), 0o600); err != nil {
		t.Fatal(err)
	}

	m := newTranscriberManager(ctx, nil, nil, 16, 5*time.Millisecond)
	if !m.Reload(true, sidecar.URL, "ggml-base", "en", false) {
		t.Fatal("Reload turned transcription off because go-whisper did not answer")
	}
	if !m.Enabled() || m.Answering() || m.BaseURL() != sidecar.URL {
		t.Fatalf("enabled = %v answering = %v url = %q", m.Enabled(), m.Answering(), m.BaseURL())
	}
	if err := m.Submit(ctx, TranscriptionJob{CallID: 7, AudioPath: clip}); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "the probe has asked again", func() bool { return pings.Load() >= 3 })
	if n := sent.Load(); n != 0 {
		t.Fatalf("%d calls sent while go-whisper was down", n)
	}
	if got := m.QueueDepth(); got != 1 {
		t.Fatalf("queue depth = %d, want the call waiting", got)
	}

	up.Store(true)
	select {
	case res := <-m.Results():
		if res.CallID != 7 || res.Err != nil || res.Result.Text != "engine 1 respond" {
			t.Fatalf("result = %+v", res)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the waiting call was not sent once go-whisper answered")
	}
	if !m.Answering() {
		t.Error("Answering() = false after go-whisper came back")
	}
}

// A job that could not reach go-whisper at all marks it as not answering,
// so the calls behind it wait instead of failing too; a job that reached it
// and failed does not.
func TestTranscriberManager_UnreachableResultHoldsTheCallsBehindIt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	poolCtx, stopPool := context.WithCancel(ctx)
	p := stuckPool(poolCtx)
	p.results = make(chan TranscriptionJobResult)
	m := newTranscriberManager(ctx, p, stopPool, 4, time.Hour)

	p.results <- TranscriptionJobResult{CallID: 1, Err: errors.New("go-whisper returned status 500: model not loaded")}
	<-m.Results()
	if !m.Answering() {
		t.Fatal("a go-whisper that answered with an error was marked as not answering")
	}
	refused := fmt.Errorf("go-whisper request: %w", &net.OpError{
		Op: "dial", Net: "tcp", Err: &os.SyscallError{Syscall: "connect", Err: syscall.ECONNREFUSED},
	})
	p.results <- TranscriptionJobResult{CallID: 2, Err: refused}
	<-m.Results()
	if m.Answering() {
		t.Fatal("Answering() = true after a job could not reach go-whisper")
	}

	if err := m.Submit(ctx, TranscriptionJob{CallID: 3}); err != nil {
		t.Fatalf("Submit while go-whisper is down = %v", err)
	}
	select {
	case j := <-p.jobs:
		t.Fatalf("call %d sent while go-whisper is down", j.CallID)
	case <-time.After(50 * time.Millisecond):
	}
	m.setAnswering(p, true, nil) // what the probe does once it answers
	select {
	case j := <-p.jobs:
		if j.CallID != 3 {
			t.Fatalf("pool got call %d, want 3", j.CallID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the waiting call was not sent once go-whisper answered")
	}
}

// A requeued call goes to the pool only when no submitted call is waiting.
func TestTranscriberManager_RequeueWaitsBehindLiveCalls(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	poolCtx, stopPool := context.WithCancel(ctx)
	p := stuckPool(poolCtx)
	m := newTranscriberManager(ctx, p, stopPool, 8, time.Hour)

	if err := m.Submit(ctx, TranscriptionJob{CallID: 1}); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, "the dispatcher holds call 1", func() bool { return len(m.backlog) == 0 })
	requeued := make(chan error, 1)
	go func() { requeued <- m.Requeue(ctx, 100, "/rec/old.m4a") }()
	for id := int64(2); id <= 3; id++ {
		if err := m.Submit(ctx, TranscriptionJob{CallID: id}); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []int64{1, 2, 3, 100} {
		select {
		case j := <-p.jobs:
			if j.CallID != want {
				t.Fatalf("pool got call %d, want %d", j.CallID, want)
			}
			if want == 100 && (!j.Force || j.AudioPath != "/rec/old.m4a") {
				t.Errorf("requeued job = %+v", j)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("no call %d", want)
		}
	}
	if err := <-requeued; err != nil {
		t.Errorf("Requeue = %v", err)
	}

	off := newTranscriberManager(ctx, nil, nil, 1, time.Hour)
	if err := off.Requeue(ctx, 5, "/rec/x.m4a"); !errors.Is(err, ErrTranscriptionOff) {
		t.Errorf("Requeue while off = %v, want ErrTranscriptionOff", err)
	}
}

func TestSidecarUnreachable(t *testing.T) {
	dial := func(err error) error {
		return fmt.Errorf("go-whisper request: %w", &net.OpError{Op: "dial", Net: "tcp", Err: err})
	}
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"connection refused", dial(&os.SyscallError{Syscall: "connect", Err: syscall.ECONNREFUSED}), true},
		{"no route to host", dial(&os.SyscallError{Syscall: "connect", Err: syscall.EHOSTUNREACH}), true},
		{"dial timeout", dial(errors.New("i/o timeout")), true},
		{"no route to host, as text", errors.New("dial tcp 192.168.101.11:8081: connect: no route to host"), true},
		{"blocked address", dial(safehttp.ErrBlockedAddress), false},
		{"reset mid-request", fmt.Errorf("go-whisper request: %w", &net.OpError{Op: "read", Net: "tcp", Err: syscall.ECONNRESET}), false},
		{"server error", errors.New("go-whisper returned status 500: boom"), false},
		{"EOF", fmt.Errorf("go-whisper request: %w", io.EOF), false},
	} {
		if got := sidecarUnreachable(tc.err); got != tc.want {
			t.Errorf("%s: sidecarUnreachable = %v, want %v", tc.name, got, tc.want)
		}
	}
}
