// Package auth — login rate limiter (by default 3 failed attempts → 10-minute lockout).
package auth

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"
)

const (
	// DefaultMaxFailures is how many failed sign-ins an address gets before
	// it is locked out, until the admin sets otherwise.
	DefaultMaxFailures = 3
	// DefaultLockout is how long a locked-out address waits by default.
	DefaultLockout = 10 * time.Minute

	cleanupInterval = 15 * time.Minute
)

type loginEntry struct {
	failures    int
	inFlight    int // attempts admitted by TryBegin that have not yet ended
	lockedUntil time.Time
	lastFailure time.Time
}

// RateLimiter is an in-memory per-IP login rate limiter.
// After maxFailures failures the IP is locked out for lockoutDuration.
type RateLimiter struct {
	mu              sync.Mutex
	entries         map[string]*loginEntry
	maxFailures     int
	lockoutDuration time.Duration
}

// NewRateLimiter creates a new RateLimiter and starts its background cleanup goroutine.
// The goroutine is bound to ctx and exits when ctx is cancelled, preventing goroutine leaks.
func NewRateLimiter(ctx context.Context) *RateLimiter {
	rl := &RateLimiter{
		entries:         make(map[string]*loginEntry),
		maxFailures:     DefaultMaxFailures,
		lockoutDuration: DefaultLockout,
	}
	go rl.cleanup(ctx)
	return rl
}

// SetLimits changes the lockout threshold and duration for failures from
// now on. Values that make no sense (zero or negative) keep the defaults.
func (r *RateLimiter) SetLimits(maxFailures int, lockout time.Duration) {
	if maxFailures <= 0 {
		maxFailures = DefaultMaxFailures
	}
	if lockout <= 0 {
		lockout = DefaultLockout
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.maxFailures = maxFailures
	r.lockoutDuration = lockout
}

// Limits reports the current lockout threshold and duration.
func (r *RateLimiter) Limits() (maxFailures int, lockout time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.maxFailures, r.lockoutDuration
}

// RecordFailure records a failed login attempt for the given IP.
// Returns true if the IP is now locked out.
func (r *RateLimiter) RecordFailure(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	e, ok := r.entries[ip]
	if !ok {
		e = &loginEntry{}
		r.entries[ip] = e
	}

	now := time.Now()

	// If already locked out, just reconfirm.
	if now.Before(e.lockedUntil) {
		return true
	}

	// If lockout has expired, reset the counter to give fresh attempts.
	if e.failures >= r.maxFailures && now.After(e.lockedUntil) {
		e.failures = 0
	}

	e.failures++
	e.lastFailure = now
	if e.failures >= r.maxFailures {
		e.lockedUntil = now.Add(r.lockoutDuration)
		slog.Debug("auth: ip locked out", "ip", ip, "failures", e.failures)
		return true
	}
	slog.Debug("auth: login failure recorded", "ip", ip, "failures", e.failures)
	return false
}

// IsLockedOut returns true if the IP is currently in lockout.
func (r *RateLimiter) IsLockedOut(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	e, ok := r.entries[ip]
	if !ok {
		return false
	}
	locked := time.Now().Before(e.lockedUntil)
	slog.Debug("auth: lockout check", "ip", ip, "locked", locked)
	return locked
}

// TryBegin reserves a login attempt for ip. It refuses when the IP is locked
// out or when recorded failures plus attempts still in progress already reach
// the lockout threshold, so concurrent requests cannot all run the password
// check before the first failures are recorded. Every true result must be
// paired with a call to End.
func (r *RateLimiter) TryBegin(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	e, ok := r.entries[ip]
	if !ok {
		e = &loginEntry{}
		r.entries[ip] = e
	}
	now := time.Now()
	if now.Before(e.lockedUntil) {
		return false
	}
	failures := e.failures
	if failures >= r.maxFailures {
		failures = 0 // lockout expired; RecordFailure resets the counter too
	}
	if failures+e.inFlight >= r.maxFailures {
		return false
	}
	e.inFlight++
	return true
}

// End releases an attempt reserved by TryBegin.
func (r *RateLimiter) End(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.entries[ip]; ok && e.inFlight > 0 {
		e.inFlight--
	}
}

// Reset clears the failure record for an IP (call on successful login).
// Attempts still in progress stay reserved.
func (r *RateLimiter) Reset(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[ip]
	if !ok {
		return
	}
	if e.inFlight > 0 {
		*e = loginEntry{inFlight: e.inFlight}
		return
	}
	delete(r.entries, ip)
}

// Lockout is an address that is refused sign-in, or on its way there.
type Lockout struct {
	IP       string
	Failures int
	// LockedUntil is zero while the address still has attempts left.
	LockedUntil time.Time
	LastFailure time.Time
}

// List returns every address with a recorded failure, locked-out ones
// first, so an admin can see who is being kept out and let them back in.
func (r *RateLimiter) List() []Lockout {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	out := make([]Lockout, 0, len(r.entries))
	for ip, e := range r.entries {
		if e.failures == 0 {
			continue
		}
		l := Lockout{IP: ip, Failures: e.failures, LastFailure: e.lastFailure}
		if now.Before(e.lockedUntil) {
			l.LockedUntil = e.lockedUntil
		}
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool {
		li, lj := !out[i].LockedUntil.IsZero(), !out[j].LockedUntil.IsZero()
		if li != lj {
			return li
		}
		return out[i].LastFailure.After(out[j].LastFailure)
	})
	return out
}

// Clear forgets an address's failures, ending its lockout. It reports
// whether there was anything to clear.
func (r *RateLimiter) Clear(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.entries[ip]
	if !ok || e.failures == 0 {
		return false
	}
	if e.inFlight > 0 {
		*e = loginEntry{inFlight: e.inFlight}
		return true
	}
	delete(r.entries, ip)
	return true
}

// cleanup periodically removes stale entries to bound memory usage.
func (r *RateLimiter) cleanup(ctx context.Context) {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.mu.Lock()
			now := time.Now()
			for ip, e := range r.entries {
				if e.inFlight > 0 {
					continue
				}
				if e.failures >= r.maxFailures {
					// Remove once lockout has expired.
					if now.After(e.lockedUntil) {
						delete(r.entries, ip)
					}
				} else {
					// Remove partial-failure entries older than the lockout window.
					if now.Sub(e.lastFailure) > r.lockoutDuration {
						delete(r.entries, ip)
					}
				}
			}
			r.mu.Unlock()
		}
	}
}
