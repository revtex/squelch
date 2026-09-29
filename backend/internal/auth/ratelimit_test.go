package auth_test

import (
	"context"
	"testing"

	"github.com/revtex/squelch/internal/auth"
)

func TestRateLimiter_NotLockedInitially(t *testing.T) {
	rl := auth.NewRateLimiter(context.Background())
	if rl.IsLockedOut("192.168.1.1") {
		t.Error("fresh IP should not be locked out")
	}
}

func TestRateLimiter_LockoutAfterThreeFailures(t *testing.T) {
	rl := auth.NewRateLimiter(context.Background())
	ip := "10.0.0.1"

	if locked := rl.RecordFailure(ip); locked {
		t.Error("1st failure should not trigger lockout")
	}
	if locked := rl.RecordFailure(ip); locked {
		t.Error("2nd failure should not trigger lockout")
	}
	if locked := rl.RecordFailure(ip); !locked {
		t.Error("3rd failure should trigger lockout")
	}
	if !rl.IsLockedOut(ip) {
		t.Error("IP should be locked out after 3 failures")
	}
}

func TestRateLimiter_Reset(t *testing.T) {
	rl := auth.NewRateLimiter(context.Background())
	ip := "10.0.0.2"

	rl.RecordFailure(ip)
	rl.RecordFailure(ip)
	rl.RecordFailure(ip)

	if !rl.IsLockedOut(ip) {
		t.Fatal("IP should be locked out before reset")
	}

	rl.Reset(ip)

	if rl.IsLockedOut(ip) {
		t.Error("IP should not be locked out after reset")
	}
}

func TestRateLimiter_NotLockedAfterTwoFailures(t *testing.T) {
	rl := auth.NewRateLimiter(context.Background())
	ip := "10.0.0.3"

	rl.RecordFailure(ip)
	rl.RecordFailure(ip)

	if rl.IsLockedOut(ip) {
		t.Error("IP should not be locked out after only 2 failures")
	}
}

// Attempts in progress count toward the threshold, so a parallel burst can
// only run as many password checks as the lockout allows.
func TestRateLimiter_TryBeginReservesAttempts(t *testing.T) {
	rl := auth.NewRateLimiter(context.Background())
	ip := "10.0.0.9"

	for i := 0; i < 3; i++ {
		if !rl.TryBegin(ip) {
			t.Fatalf("attempt %d refused, want admitted", i+1)
		}
	}
	if rl.TryBegin(ip) {
		t.Fatal("4th concurrent attempt admitted before any finished")
	}

	// One attempt succeeds: its slot frees, the others are still in flight.
	rl.Reset(ip)
	rl.End(ip)
	if !rl.TryBegin(ip) {
		t.Fatal("slot freed by a finished attempt was not reusable")
	}

	// The remaining attempts fail and lock the IP out.
	for i := 0; i < 3; i++ {
		rl.RecordFailure(ip)
		rl.End(ip)
	}
	if rl.TryBegin(ip) {
		t.Fatal("attempt admitted while locked out")
	}
}
