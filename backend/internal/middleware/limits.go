package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
)

// RateLimit returns middleware that rejects requests with 429 if the client IP
// is locked out by the given rate limiter.
func RateLimit(rl *auth.RateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if rl.IsLockedOut(c.ClientIP()) {
			c.AbortWithStatusJSON(429, gin.H{"error": "too many failed attempts, try again later"})
			return
		}
		c.Next()
	}
}

// MaxBodySize limits the size of request bodies to prevent memory exhaustion.
// Applies to non-multipart requests only (multipart is limited by
// router.MaxMultipartMemory).
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

// ipBucket is a per-IP sliding-window counter.
type ipBucket struct {
	windowStart time.Time
	count       int
}

// maxIPBuckets caps how many client IPs RateLimitByIP tracks at once.
const maxIPBuckets = 10000

// RateLimitByIP returns middleware that limits requests per IP per minute.
// Designed for unauthenticated, public endpoints (e.g. shared call access).
func RateLimitByIP(rpm int) gin.HandlerFunc {
	return rateLimitByIP(rpm, maxIPBuckets)
}

// rateLimitByIP tracks at most maxBuckets IPs. Stale buckets are swept at
// most once per window, so a request never pays for a full scan; when the
// table is still full, requests from untracked IPs are refused rather than
// letting the table grow.
func rateLimitByIP(rpm, maxBuckets int) gin.HandlerFunc {
	var mu sync.Mutex
	buckets := make(map[string]*ipBucket)
	window := time.Minute
	var lastSweep time.Time

	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		mu.Lock()

		if now.Sub(lastSweep) >= window {
			for k, b := range buckets {
				if now.Sub(b.windowStart) >= window {
					delete(buckets, k)
				}
			}
			lastSweep = now
		}

		b, ok := buckets[ip]
		if !ok {
			if len(buckets) >= maxBuckets {
				mu.Unlock()
				c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
				return
			}
			b = &ipBucket{windowStart: now}
			buckets[ip] = b
		}
		if now.Sub(b.windowStart) >= window {
			b.windowStart = now
			b.count = 0
		}
		if b.count >= rpm {
			mu.Unlock()
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded"})
			return
		}
		b.count++
		mu.Unlock()

		c.Next()
	}
}
