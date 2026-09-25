package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/revtex/squelch/internal/middleware"
)

// TestDeprecatedHeaders asserts the four RFC 8594 headers are set on every
// response, including aborted handler chains, and use the configured sunset.
func TestDeprecatedHeaders(t *testing.T) {
	sunset := time.Date(2027, time.April, 26, 0, 0, 0, 0, time.UTC)
	wantSunset := sunset.UTC().Format(http.TimeFormat)

	tests := []struct {
		name   string
		path   string
		handle gin.HandlerFunc
	}{
		{
			name: "200 ok handler",
			path: "/api/calls",
			handle: func(c *gin.Context) {
				c.JSON(http.StatusOK, gin.H{"ok": true})
			},
		},
		{
			name: "handler aborts with 401",
			path: "/api/calls",
			handle: func(c *gin.Context) {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "nope"})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			r := gin.New()
			r.GET(tt.path, middleware.Deprecated("/api/v1/calls", sunset), tt.handle)

			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if got := w.Header().Get("Deprecation"); got != "true" {
				t.Errorf("Deprecation header = %q, want %q", got, "true")
			}
			if got := w.Header().Get("Sunset"); got != wantSunset {
				t.Errorf("Sunset header = %q, want %q", got, wantSunset)
			}
			wantLink := `</api/v1/calls>; rel="successor-version"`
			if got := w.Header().Get("Link"); got != wantLink {
				t.Errorf("Link header = %q, want %q", got, wantLink)
			}
			if got := w.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control header = %q, want %q", got, "no-store")
			}
		})
	}
}

// TestDeprecatedRecordsToDefaultStore confirms the singleton ring buffer
// observes hits so the admin /legacy-usage endpoint sees real traffic.
func TestDeprecatedRecordsToDefaultStore(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// Reset the singleton so a parallel test run is deterministic.
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)

	r := gin.New()
	r.GET("/api/calls", middleware.Deprecated("/api/v1/calls", time.Now().Add(24*time.Hour)),
		func(c *gin.Context) { c.Status(http.StatusOK) })

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/calls", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
	}

	got := middleware.DefaultLegacyUsageStore.Aggregate24h()
	if len(got) != 1 {
		t.Fatalf("aggregate len = %d, want 1; got: %+v", len(got), got)
	}
	e := got[0]
	if e.Path != "/api/calls" || e.Method != http.MethodGet || e.Count != 3 {
		t.Errorf("unexpected entry: %+v", e)
	}
}

// TestLegacyUsageStoreRecordAndAggregate exercises the ring buffer directly:
// distinct tuples remain distinct, repeated tuples are counted, and stale
// records (>24h) are pruned at read time.
func TestLegacyUsageStoreRecordAndAggregate(t *testing.T) {
	now := time.Date(2026, time.April, 26, 12, 0, 0, 0, time.UTC)
	clock := now
	store := middleware.NewLegacyUsageStore(func() time.Time { return clock })

	// Five fresh hits, three of which share a tuple.
	store.Record("/api/calls", "GET", "k1", 200)
	clock = clock.Add(time.Second)
	store.Record("/api/calls", "GET", "k1", 200)
	clock = clock.Add(time.Second)
	store.Record("/api/calls", "GET", "k1", 200)
	clock = clock.Add(time.Second)
	store.Record("/api/calls", "POST", "k1", 200)
	clock = clock.Add(time.Second)
	store.Record("/api/health", "GET", "", 200)

	// One stale hit older than the 24h window — must be pruned.
	clock = now.Add(-25 * time.Hour)
	store.Record("/api/old", "GET", "k1", 200)
	clock = now.Add(time.Minute)

	entries := store.Aggregate24h()
	if len(entries) != 3 {
		t.Fatalf("aggregate len = %d, want 3; got: %+v", len(entries), entries)
	}

	byKey := map[string]middleware.LegacyUsageEntry{}
	for _, e := range entries {
		byKey[e.Method+" "+e.Path+" "+e.APIKeyIdent] = e
	}
	if got := byKey["GET /api/calls k1"].Count; got != 3 {
		t.Errorf("count for GET /api/calls k1 = %d, want 3", got)
	}
	if got := byKey["POST /api/calls k1"].Count; got != 1 {
		t.Errorf("count for POST /api/calls k1 = %d, want 1", got)
	}
	if got := byKey["GET /api/health "].Count; got != 1 {
		t.Errorf("count for GET /api/health (anon) = %d, want 1", got)
	}
	if _, present := byKey["GET /api/old k1"]; present {
		t.Errorf("expected stale /api/old entry to be pruned, but was present")
	}
}

// TestLegacyUsageStoreRingWrap asserts that once the buffer wraps, the
// oldest records are overwritten and not returned.
func TestLegacyUsageStoreRingWrap(t *testing.T) {
	store := middleware.NewLegacyUsageStore(nil)
	// 4096 + 10 hits with rotating idents — only the last 4096 may aggregate.
	const overflow = 10
	const cap = 4096
	for i := 0; i < cap+overflow; i++ {
		store.Record("/api/calls", "GET", "k0", 200)
	}
	got := store.Aggregate24h()
	if len(got) != 1 {
		t.Fatalf("aggregate len = %d, want 1", len(got))
	}
	if got[0].Count != cap {
		t.Errorf("aggregate count = %d, want %d (ring capacity)", got[0].Count, cap)
	}
}

// TestDeprecatedIdentResolution covers the priority chain:
// apiKeyIdent → apiKeyID → userID → "".
func TestDeprecatedIdentResolution(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name       string
		setup      func(c *gin.Context)
		wantIdent  string
		wantPrefix string
	}{
		{
			name:      "no auth → empty",
			setup:     func(*gin.Context) {},
			wantIdent: "",
		},
		{
			name: "apiKeyIdent truncates to 6",
			setup: func(c *gin.Context) {
				c.Set("apiKeyIdent", "abcdef-very-long-name")
				c.Set("apiKeyID", int64(7))
			},
			wantIdent: "abcdef",
		},
		{
			name: "apiKeyID fallback when no ident",
			setup: func(c *gin.Context) {
				c.Set("apiKeyID", int64(42))
			},
			wantIdent: "42",
		},
		{
			name: "userID fallback formatted u:N",
			setup: func(c *gin.Context) {
				c.Set("userID", int64(99))
			},
			wantPrefix: "u:99",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := middleware.NewLegacyUsageStore(nil)
			middleware.DefaultLegacyUsageStore = store

			r := gin.New()
			r.GET("/api/calls", func(c *gin.Context) { tt.setup(c) },
				middleware.Deprecated("/api/v1/calls", time.Now().Add(time.Hour)),
				func(c *gin.Context) { c.Status(http.StatusOK) },
			)
			req := httptest.NewRequest(http.MethodGet, "/api/calls", nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			got := store.Aggregate24h()
			if len(got) != 1 {
				t.Fatalf("aggregate len = %d, want 1", len(got))
			}
			if tt.wantPrefix != "" {
				if !strings.HasPrefix(got[0].APIKeyIdent, tt.wantPrefix) {
					t.Errorf("ident = %q, want prefix %q", got[0].APIKeyIdent, tt.wantPrefix)
				}
			} else if got[0].APIKeyIdent != tt.wantIdent {
				t.Errorf("ident = %q, want %q", got[0].APIKeyIdent, tt.wantIdent)
			}
		})
	}
}

func TestLegacyUsageStore_KeepsKeysApartThatShareAnIdent(t *testing.T) {
	store := middleware.NewLegacyUsageStore(nil)
	store.RecordKey("/api/call-upload", "POST", "TR-Lak", 1, 200)
	store.RecordKey("/api/call-upload", "POST", "TR-Lak", 1, 200)
	store.RecordKey("/api/call-upload", "POST", "TR-Lak", 2, 200)
	got := map[int64]int{}
	for _, e := range store.Aggregate24h() {
		got[e.APIKeyID] += e.Count
	}
	if got[1] != 2 || got[2] != 1 {
		t.Fatalf("counts by key id = %v, want 1:2 2:1", got)
	}
}
