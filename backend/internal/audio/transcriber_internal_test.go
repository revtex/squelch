package audio

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
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
