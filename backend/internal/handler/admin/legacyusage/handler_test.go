package legacyusage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/routes"
	"github.com/revtex/squelch/internal/logging"
	"github.com/revtex/squelch/internal/middleware"
	_ "modernc.org/sqlite"
)

func init() {
	gin.SetMode(gin.TestMode)
	logging.Configure(true, "")
}

func newEngine(t *testing.T) (*gin.Engine, *db.Queries) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	q := db.New(sqlDB)

	r := gin.New()
	rl := auth.NewRateLimiter(context.Background())
	routes.RegisterRoutes(r, routes.Deps{Queries: q, RateLimiter: rl, Version: "test"})
	return r, q
}

func makeUser(t *testing.T, q *db.Queries, role string) (int64, string) {
	t.Helper()
	hash, _ := auth.HashPassword("pw")
	now := time.Now().Unix()
	uid, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: "u-" + role, PasswordHash: hash, Role: role,
		CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	tok, _, err := auth.GenerateToken(uid, "u-"+role, role, 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}
	return uid, tok
}

// TestGetLegacyUsage_EmptyReturnsEmptyArray asserts the entries field
// serialises as `[]`, not `null`, when the ring buffer has no records.
func TestGetLegacyUsage_EmptyReturnsEmptyArray(t *testing.T) {
	// Reset the singleton so this test sees no leakage.
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)

	r, q := newEngine(t)
	_, tok := makeUser(t, q, auth.RoleAdmin)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/legacy-usage", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !contains(body, `"entries":[]`) {
		t.Errorf("expected entries:[] in body, got: %s", body)
	}
	if !contains(body, `"windowSeconds":86400`) {
		t.Errorf("expected windowSeconds:86400, got: %s", body)
	}
}

// TestGetLegacyUsage_PopulatedAfterLegacyHit ingests one hit on a legacy
// route and verifies it appears in the v1 aggregate report.
func TestGetLegacyUsage_PopulatedAfterLegacyHit(t *testing.T) {
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)

	r, q := newEngine(t)
	_, tok := makeUser(t, q, auth.RoleAdmin)

	// Hit a public legacy route — /api/health is unauthenticated.
	for i := 0; i < 2; i++ {
		hreq := httptest.NewRequest(http.MethodGet, "/api/health", nil)
		hw := httptest.NewRecorder()
		r.ServeHTTP(hw, hreq)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/legacy-usage", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp struct {
		WindowSeconds int `json:"windowSeconds"`
		Entries       []struct {
			Path        string `json:"path"`
			Method      string `json:"method"`
			APIKeyIdent string `json:"apiKeyIdent"`
			Count       int    `json:"count"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v; body=%s", err, w.Body.String())
	}
	if resp.WindowSeconds != 86400 {
		t.Errorf("windowSeconds = %d, want 86400", resp.WindowSeconds)
	}

	// Find the /api/health row.
	var found bool
	for _, e := range resp.Entries {
		if e.Path == "/api/health" && e.Method == http.MethodGet {
			found = true
			if e.Count != 2 {
				t.Errorf("count for /api/health = %d, want 2", e.Count)
			}
			if e.APIKeyIdent != "" {
				t.Errorf("apiKeyIdent for unauth /api/health = %q, want \"\"", e.APIKeyIdent)
			}
		}
	}
	if !found {
		t.Errorf("expected /api/health entry in aggregate, got: %+v", resp.Entries)
	}
}

// TestGetLegacyUsage_CarriesKeyID — the report keeps the id of the key that
// made each hit, so the admin can tell apart keys whose idents share a prefix.
func TestGetLegacyUsage_CarriesKeyID(t *testing.T) {
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)
	middleware.DefaultLegacyUsageStore.RecordKey("/api/call-upload", http.MethodPost, "TR-Lak", 7, http.StatusOK)
	middleware.DefaultLegacyUsageStore.RecordKey("/api/call-upload", http.MethodPost, "TR-Lak", 9, http.StatusOK)

	r, q := newEngine(t)
	_, tok := makeUser(t, q, auth.RoleAdmin)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/legacy-usage", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var resp struct {
		Entries []struct {
			APIKeyID int64 `json:"apiKeyId"`
			Count    int   `json:"count"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v; body=%s", err, w.Body.String())
	}
	got := map[int64]int{}
	for _, e := range resp.Entries {
		got[e.APIKeyID] += e.Count
	}
	if got[7] != 1 || got[9] != 1 || len(got) != 2 {
		t.Errorf("counts by key id = %v, want map[7:1 9:1]", got)
	}
}

// TestGetLegacyUsage_ListenerForbidden — JWT must have admin role.
func TestGetLegacyUsage_ListenerForbidden(t *testing.T) {
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)

	r, q := newEngine(t)
	_, tok := makeUser(t, q, auth.RoleListener)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/legacy-usage", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body = %s", w.Code, w.Body.String())
	}
}

// TestGetLegacyUsage_Unauthenticated — without a JWT, returns 401.
func TestGetLegacyUsage_Unauthenticated(t *testing.T) {
	middleware.DefaultLegacyUsageStore = middleware.NewLegacyUsageStore(nil)

	r, _ := newEngine(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/legacy-usage", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body = %s", w.Code, w.Body.String())
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
