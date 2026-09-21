// Package auth — login rate limiter (3 failed attempts → 10-minute lockout).
package auth

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

const (
	maxFailures     = 3
	lockoutDuration = 10 * time.Minute
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
	mu      sync.Mutex
	entries map[string]*loginEntry
}

// NewRateLimiter creates a new RateLimiter and starts its background cleanup goroutine.
// The goroutine is bound to ctx and exits when ctx is cancelled, preventing goroutine leaks.
func NewRateLimiter(ctx context.Context) *RateLimiter {
	rl := &RateLimiter{
		entries: make(map[string]*loginEntry),
	}
	go rl.cleanup(ctx)
	return rl
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
	if e.failures >= maxFailures && now.After(e.lockedUntil) {
		e.failures = 0
	}

	e.failures++
	e.lastFailure = now
	if e.failures >= maxFailures {
		e.lockedUntil = now.Add(lockoutDuration)
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
	if failures >= maxFailures {
		failures = 0 // lockout expired; RecordFailure resets the counter too
	}
	if failures+e.inFlight >= maxFailures {
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
				if e.failures >= maxFailures {
					// Remove once lockout has expired.
					if now.After(e.lockedUntil) {
						delete(r.entries, ip)
					}
				} else {
					// Remove partial-failure entries older than the lockout window.
					if now.Sub(e.lastFailure) > lockoutDuration {
						delete(r.entries, ip)
					}
				}
			}
			r.mu.Unlock()
		}
	}
}
