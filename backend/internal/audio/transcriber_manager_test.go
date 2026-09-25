package audio_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/audio"
)

// newFakeWhisper returns an httptest.Server that answers GET /api/whisper/model
// with the given status. Closed via t.Cleanup.
func newFakeWhisper(t *testing.T, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/whisper/model" {
			w.WriteHeader(status)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestTranscriberManager_Reload_DisabledToEnabled(t *testing.T) {
	srv := newFakeWhisper(t, http.StatusOK)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m := audio.NewTranscriberManager(ctx, nil, nil)

	if m.Enabled() {
		t.Fatal("manager should start disabled when pool is nil")
	}

	ok := m.Reload(true, srv.URL, "ggml-base", "", false)
	if !ok {
		t.Fatal("Reload(true) returned false; expected success")
	}
	if !m.Enabled() {
		t.Fatal("Enabled() = false after successful Reload")
	}
	if m.BaseURL() != srv.URL {
		t.Fatalf("BaseURL = %q, want %q", m.BaseURL(), srv.URL)
	}
}

func TestTranscriberManager_Reload_UnreachableServer_DisablesManager(t *testing.T) {
	srv := newFakeWhisper(t, http.StatusInternalServerError)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m := audio.NewTranscriberManager(ctx, nil, nil)

	ok := m.Reload(true, srv.URL, "ggml-base", "", false)
	if ok {
		t.Fatal("Reload against 500-returning server must return false")
	}
	if m.Enabled() {
		t.Fatal("Enabled() = true after failed Reload")
	}
}

func TestTranscriberManager_Reload_Disable(t *testing.T) {
	srv := newFakeWhisper(t, http.StatusOK)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m := audio.NewTranscriberManager(ctx, nil, nil)

	if ok := m.Reload(true, srv.URL, "ggml-base", "", false); !ok {
		t.Fatalf("Reload(true) = false, want true")
	}
	if !m.Enabled() {
		t.Fatal("Enabled() should be true after enable")
	}

	// Now disable.
	if ok := m.Reload(false, "", "", "", false); !ok {
		t.Fatalf("Reload(false) = false, want true")
	}
	if m.Enabled() {
		t.Fatal("Enabled() should be false after disable")
	}
	if m.BaseURL() != "" {
		t.Fatalf("BaseURL = %q, want empty after disable", m.BaseURL())
	}
}

// TestTranscriberManager_Reload_NoGoroutineLeak verifies that repeated
// enable/disable cycles do not leak pumpResults goroutines. The pool closes
// its results channel once all workers exit and reaps idle HTTP keep-alive
// connections, so pumpResults and the Transport's persistConn goroutines
// unwind cleanly when Reload cancels the pool context.
func TestTranscriberManager_Reload_NoGoroutineLeak(t *testing.T) {
	srv := newFakeWhisper(t, http.StatusOK)

	baseCtx, baseCancel := context.WithCancel(context.Background())
	t.Cleanup(baseCancel)
	m := audio.NewTranscriberManager(baseCtx, nil, nil)

	// Warm up: one cycle so any first-run initialisation (DNS, TLS setup,
	// httptest accept loops) is accounted for in the baseline.
	if ok := m.Reload(true, srv.URL, "ggml-base", "", false); !ok {
		t.Fatal("warm-up Reload(true) returned false")
	}
	if ok := m.Reload(false, "", "", "", false); !ok {
		t.Fatal("warm-up Reload(false) returned false")
	}
	waitForGoroutinesToSettle(2 * time.Second)
	base := runtime.NumGoroutine()

	for i := 0; i < 5; i++ {
		if ok := m.Reload(true, srv.URL, "ggml-base", "", false); !ok {
			t.Fatalf("Reload(true) #%d returned false", i)
		}
		if ok := m.Reload(false, "", "", "", false); !ok {
			t.Fatalf("Reload(false) #%d returned false", i)
		}
	}

	waitForGoroutinesToSettle(2 * time.Second)
	if final := runtime.NumGoroutine(); final > base+3 {
		t.Fatalf("goroutine leak: baseline=%d final=%d (tolerance=3)", base, final)
	}
}

// waitForGoroutinesToSettle yields to the scheduler and forces GC in a
// bounded loop to give cancelled goroutines time to exit, without sleeping.
func waitForGoroutinesToSettle(timeout time.Duration) {
	deadline, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	prev := -1
	stable := 0
	for {
		runtime.GC()
		n := runtime.NumGoroutine()
		if n == prev {
			stable++
			if stable >= 3 {
				return
			}
		} else {
			stable = 0
			prev = n
		}
		select {
		case <-deadline.Done():
			return
		default:
			runtime.Gosched()
		}
	}
}

type recordingJobs struct {
	queued  []int64
	skipped map[int64]string
}

func (r *recordingJobs) Queued(_ context.Context, id int64, _ string) {
	r.queued = append(r.queued, id)
}
func (r *recordingJobs) Skipped(_ context.Context, id int64, _, reason string) {
	if r.skipped == nil {
		r.skipped = map[int64]string{}
	}
	r.skipped[id] = reason
}

// Calls under the minimum length are recorded as skipped and never reach
// the pool; a forced retry goes through regardless.
func TestTranscriberManager_SkipsShortCallsUnlessForced(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// The pool's worker is stopped at once, so what is queued stays counted.
	poolCtx, stopPool := context.WithCancel(ctx)
	pool, err := audio.NewTranscriberPool(poolCtx, 1, "http://127.0.0.1:1", "ggml-base", "en", false)
	if err != nil {
		t.Fatal(err)
	}
	stopPool()
	time.Sleep(20 * time.Millisecond)
	m := audio.NewTranscriberManager(ctx, pool, stopPool)
	rec := &recordingJobs{}
	m.SetRecorder(rec)
	m.SetMinDurationMs(1500)

	if err := m.Submit(ctx, audio.TranscriptionJob{CallID: 1, DurationMs: 900}); err != nil {
		t.Fatal(err)
	}
	if err := m.Submit(ctx, audio.TranscriptionJob{CallID: 2, DurationMs: 3000}); err != nil {
		t.Fatal(err)
	}
	if err := m.Submit(ctx, audio.TranscriptionJob{CallID: 3}); err != nil { // unknown length: kept
		t.Fatal(err)
	}
	if err := m.Retry(ctx, 4, "/rec/short.m4a"); err != nil {
		t.Fatal(err)
	}
	if rec.skipped[1] != "shorter than 1.5 s" || len(rec.skipped) != 1 {
		t.Errorf("skipped = %v", rec.skipped)
	}
	if len(rec.queued) != 3 || m.QueueDepth() != 3 || m.Workers() != 1 {
		t.Errorf("queued = %v depth = %d workers = %d", rec.queued, m.QueueDepth(), m.Workers())
	}
}
