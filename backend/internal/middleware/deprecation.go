// Phase N-3 — RFC 8594 deprecation signalling for legacy /api/* routes.
//
// Deprecated() emits the Deprecation, Sunset, Link, and Cache-Control headers
// on every response of the route it wraps, records a per-request entry into a
// 24-hour ring buffer for the admin "legacy-usage" report, and emits a
// structured slog warn line for operators. Functional behaviour is unchanged.
//
// See docs/plans/native-api-design-plan.md §10 "Phase N-3".
package middleware

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// LegacyAPISunset is the date after which the legacy /api/* surface will be
// removed. Sent in the RFC 8594 Sunset header on every legacy response.
//
// One year out from Phase N-3 implementation. Bumped only when the project
// formally rescheduled Phase N-6 ("410 Gone").
var LegacyAPISunset = time.Date(2027, time.April, 26, 0, 0, 0, 0, time.UTC)

// LegacyUsageEntry is one row in the 24-hour aggregate report produced by
// LegacyUsageStore.Aggregate24h. JSON tags match the admin endpoint contract.
type LegacyUsageEntry struct {
	Path        string `json:"path"`
	Method      string `json:"method"`
	APIKeyIdent string `json:"apiKeyIdent"`
	// APIKeyID is the key's id when an API key authenticated the request.
	// The ident is cut to six characters, so two keys can share one; the
	// id tells them apart.
	APIKeyID int64     `json:"apiKeyId,omitempty"`
	Count    int       `json:"count"`
	LastSeen time.Time `json:"lastSeen"`
}

// legacyUsageRecord is one ring-buffer slot. Stored as a value type so the
// slice is contiguous and aggregation is cache-friendly.
type legacyUsageRecord struct {
	at          time.Time
	path        string
	method      string
	status      int
	apiKeyIdent string
	apiKeyID    int64
	used        bool
}

// LegacyUsageStore is a fixed-capacity, concurrency-safe ring buffer of
// recent legacy-route hits. A single instance is shared by every Deprecated
// middleware via DefaultLegacyUsageStore.
type LegacyUsageStore struct {
	mu     sync.Mutex
	buf    []legacyUsageRecord
	head   int  // next write slot
	full   bool // whether the buffer has wrapped at least once
	clock  func() time.Time
	maxAge time.Duration
}

const legacyUsageCapacity = 4096

// NewLegacyUsageStore returns a new ring buffer with capacity 4096 entries
// and a 24-hour retention window. clock may be nil to use time.Now.
func NewLegacyUsageStore(clock func() time.Time) *LegacyUsageStore {
	if clock == nil {
		clock = time.Now
	}
	return &LegacyUsageStore{
		buf:    make([]legacyUsageRecord, legacyUsageCapacity),
		clock:  clock,
		maxAge: 24 * time.Hour,
	}
}

// DefaultLegacyUsageStore is the package-level singleton used by Deprecated()
// and surfaced by the GET /api/v1/admin/legacy-usage handler. Tests that need
// isolation can construct their own instance via NewLegacyUsageStore.
var DefaultLegacyUsageStore = NewLegacyUsageStore(nil)

// Record appends one legacy-hit observation. Never blocks; never errors.
func (s *LegacyUsageStore) Record(path, method, apiKeyIdent string, status int) {
	s.RecordKey(path, method, apiKeyIdent, 0, status)
}

// RecordKey is Record with the id of the API key that made the request,
// or 0 when none did.
func (s *LegacyUsageStore) RecordKey(path, method, apiKeyIdent string, apiKeyID int64, status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buf[s.head] = legacyUsageRecord{
		at:          s.clock(),
		path:        path,
		method:      method,
		status:      status,
		apiKeyIdent: apiKeyIdent,
		apiKeyID:    apiKeyID,
		used:        true,
	}
	s.head = (s.head + 1) % len(s.buf)
	if s.head == 0 {
		s.full = true
	}
}

// Aggregate24h returns one entry per (path, method, apiKeyIdent) tuple seen
// in the last 24 hours, with the count and most recent timestamp. Older
// records are pruned at read time. Result is sorted by lastSeen descending.
func (s *LegacyUsageStore) Aggregate24h() []LegacyUsageEntry {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := s.clock().Add(-s.maxAge)
	type aggKey struct {
		path, method, ident string
		keyID               int64
	}
	agg := make(map[aggKey]*LegacyUsageEntry)

	walk := func(rec legacyUsageRecord) {
		if !rec.used || rec.at.Before(cutoff) {
			return
		}
		k := aggKey{rec.path, rec.method, rec.apiKeyIdent, rec.apiKeyID}
		e, ok := agg[k]
		if !ok {
			agg[k] = &LegacyUsageEntry{
				Path:        rec.path,
				Method:      rec.method,
				APIKeyIdent: rec.apiKeyIdent,
				APIKeyID:    rec.apiKeyID,
				Count:       1,
				LastSeen:    rec.at,
			}
			return
		}
		e.Count++
		if rec.at.After(e.LastSeen) {
			e.LastSeen = rec.at
		}
	}
	for _, rec := range s.buf {
		walk(rec)
	}

	out := make([]LegacyUsageEntry, 0, len(agg))
	for _, e := range agg {
		out = append(out, *e)
	}
	// Sort by lastSeen desc, then path asc for deterministic output.
	for i := 1; i < len(out); i++ {
		for j := i; j > 0; j-- {
			a, b := out[j-1], out[j]
			if a.LastSeen.Before(b.LastSeen) ||
				(a.LastSeen.Equal(b.LastSeen) && a.Path > b.Path) {
				out[j-1], out[j] = out[j], out[j-1]
				continue
			}
			break
		}
	}
	return out
}

// Deprecated returns a Gin middleware that:
//
//  1. Adds the RFC 8594 deprecation headers (Deprecation, Sunset, Link) and
//     Cache-Control: no-store BEFORE the handler runs, so the headers are
//     present even when the downstream handler aborts.
//
//  2. After the handler completes, records the request into the
//     DefaultLegacyUsageStore ring buffer and emits a structured slog warn
//     line so operators can drive the migration.
//
//     successor — the v1 path that replaces this legacy route
//     (e.g. "/api/v1/calls"). Sent verbatim in the Link header.
//     sunset    — the date after which the legacy route will be removed.
//     Sent in RFC 1123 form (Sunset header).
func Deprecated(successor string, sunset time.Time) gin.HandlerFunc {
	sunsetHeader := sunset.UTC().Format(http.TimeFormat)
	linkHeader := fmt.Sprintf(`<%s>; rel="successor-version"`, successor)
	return func(c *gin.Context) {
		c.Header("Deprecation", "true")
		c.Header("Sunset", sunsetHeader)
		c.Header("Link", linkHeader)
		c.Header("Cache-Control", "no-store")

		c.Next()

		ident := resolveLegacyUsageIdent(c)
		path := c.FullPath()
		if path == "" {
			path = c.Request.URL.Path
		}
		status := c.Writer.Status()
		var keyID int64
		if v, ok := c.Get("apiKeyID"); ok {
			if id, ok := v.(int64); ok {
				keyID = id
			}
		}
		DefaultLegacyUsageStore.RecordKey(path, c.Request.Method, ident, keyID, status)
		slog.WarnContext(c.Request.Context(), "legacy endpoint hit",
			"path", path,
			"method", c.Request.Method,
			"apiKeyIdent", ident,
			"status", status,
		)
	}
}

// resolveLegacyUsageIdent returns a short identifier for the caller without
// ever exposing a raw API key. Lookup priority:
//
//  1. apiKeyIdent set by APIKeyAuth (truncated to 6 chars).
//  2. apiKeyID set by APIKeyAuth (decimal string).
//  3. userID set by JWTAuth (formatted as "u:<id>").
//  4. empty string for unauthenticated public requests.
func resolveLegacyUsageIdent(c *gin.Context) string {
	if v, ok := c.Get("apiKeyIdent"); ok {
		if s, ok := v.(string); ok && s != "" {
			return truncateIdent(s, 6)
		}
	}
	if v, ok := c.Get("apiKeyID"); ok {
		switch id := v.(type) {
		case int64:
			if id != 0 {
				return fmt.Sprintf("%d", id)
			}
		case int:
			if id != 0 {
				return fmt.Sprintf("%d", id)
			}
		}
	}
	if v, ok := c.Get("userID"); ok {
		switch id := v.(type) {
		case int64:
			if id != 0 {
				return fmt.Sprintf("u:%d", id)
			}
		case int:
			if id != 0 {
				return fmt.Sprintf("u:%d", id)
			}
		}
	}
	return ""
}

// truncateIdent returns the first n runes of s. Used to keep API-key idents
// from leaking sensitive length information into log lines and the admin
// usage report.
func truncateIdent(s string, n int) string {
	if n <= 0 || len(s) <= n {
		return s
	}
	// Byte-truncate is fine here — idents are ASCII in practice.
	return s[:n]
}
