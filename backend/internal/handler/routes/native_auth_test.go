package routes_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/auth"
	authhandler "github.com/revtex/squelch/internal/handler/auth"
)

// nativeLogin logs in the way a phone does: no cookie jar, and the
// X-Squelch-Client header asking for the refresh token in the body.
func nativeLogin(t *testing.T, engine http.Handler, username, password string) (accessToken, refreshToken string, rec *httptest.ResponseRecorder) {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"username": username, "password": password})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(authhandler.NativeClientHeader, authhandler.NativeClientValue)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("native login status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	var body struct {
		Token        string `json:"token"`
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode login body: %v", err)
	}
	return body.Token, body.RefreshToken, w
}

// nativeRefresh posts the refresh token in the body, as a client with no
// cookie jar must.
func nativeRefresh(t *testing.T, engine http.Handler, refreshToken string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"refreshToken": refreshToken})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	return w, body.RefreshToken
}

func setCookieNames(rec *httptest.ResponseRecorder) []string {
	var names []string
	for _, c := range rec.Result().Cookies() {
		// A clearing cookie (MaxAge<0, empty value) carries no credential.
		if c.Value != "" {
			names = append(names, c.Name)
		}
	}
	return names
}

// A native login must hand back the refresh token in the body and set no
// credential cookies at all — the client has nowhere to keep them, and the
// access JWT rides an Authorization header instead.
func TestNativeLogin_ReturnsTokenInBodyAndNoCookies(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	_, refresh, rec := nativeLogin(t, engine, "alice", "password123")

	if refresh == "" {
		t.Error("refreshToken missing from native login body")
	}
	if names := setCookieNames(rec); len(names) != 0 {
		t.Errorf("native login set cookies %v, want none", names)
	}
}

// The browser path must be untouched: cookies set, and the raw refresh token
// never present in the body.
func TestBrowserLogin_StillUsesCookiesOnly(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	rec := login(t, engine, "alice", "password123")

	if strings.Contains(rec.Body.String(), "refreshToken") {
		t.Errorf("browser login leaked a refresh token into the body: %s", rec.Body.String())
	}
	names := setCookieNames(rec)
	var sawRefresh, sawSession bool
	for _, n := range names {
		switch n {
		case auth.RefreshCookieName:
			sawRefresh = true
		case auth.SessionCookieName:
			sawSession = true
		}
	}
	if !sawRefresh || !sawSession {
		t.Errorf("browser login cookies = %v, want both %s and %s", names, auth.RefreshCookieName, auth.SessionCookieName)
	}
}

// Rotation over the body: each refresh returns a new token, the old one stops
// working, and no cookies are involved in either direction.
func TestNativeRefresh_RotatesOverBody(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	_, first, _ := nativeLogin(t, engine, "alice", "password123")

	rec, second := nativeRefresh(t, engine, first)
	if rec.Code != http.StatusOK {
		t.Fatalf("native refresh status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	if second == "" {
		t.Fatal("rotated refreshToken missing from body")
	}
	if second == first {
		t.Error("refresh returned the same token; rotation did not happen")
	}
	if names := setCookieNames(rec); len(names) != 0 {
		t.Errorf("native refresh set cookies %v, want none", names)
	}

	// The rotated token works.
	if rec, _ := nativeRefresh(t, engine, second); rec.Code != http.StatusOK {
		t.Errorf("refresh with rotated token status = %d, want 200", rec.Code)
	}
}

// A body refresh presented twice inside the grace window must converge on the
// same successor rather than revoke the family — the same idempotency the
// cookie path has, since a phone retries on a flaky network.
func TestNativeRefresh_ReplayWithinGraceReturnsSameSuccessor(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	_, first, _ := nativeLogin(t, engine, "alice", "password123")

	recA, successorA := nativeRefresh(t, engine, first)
	if recA.Code != http.StatusOK {
		t.Fatalf("first refresh status = %d, want 200", recA.Code)
	}

	recB, successorB := nativeRefresh(t, engine, first)
	if recB.Code != http.StatusOK {
		t.Fatalf("replayed refresh status = %d, want 200 (grace window); body: %s", recB.Code, recB.Body.String())
	}
	if successorB != successorA {
		t.Errorf("replay returned a different successor: %q vs %q", successorB, successorA)
	}
}

// Possession of the httpOnly cookie must never be escalatable into a
// JS-readable token: when the cookie authenticates the request, the response
// body carries no raw refresh token.
func TestCookieRefresh_NeverEchoesRawToken(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	rec := login(t, engine, "alice", "password123")
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.RefreshCookieName {
			cookie = c
		}
	}
	if cookie == nil {
		t.Fatal("no refresh cookie from browser login")
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", nil)
	req.AddCookie(cookie)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("cookie refresh status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "refreshToken") {
		t.Errorf("cookie refresh echoed a raw token into the body: %s", w.Body.String())
	}
}

func TestNativeRefresh_RejectsUnknownToken(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	rec, _ := nativeRefresh(t, engine, "not-a-real-token")
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("refresh with bogus token status = %d, want 401", rec.Code)
	}
}

// Logout must revoke the refresh family for a native client too. Revoking the
// access JWT by jti says nothing about the family, and with no cookie to read
// the family would otherwise survive logout for the full 30 days.
func TestNativeLogout_RevokesRefreshFamily(t *testing.T) {
	engine, queries := newTestEngine(t)
	userID := seedAdminUser(t, queries, "alice", "password123")

	access, refresh, _ := nativeLogin(t, engine, "alice", "password123")

	if got := countActiveFamilies(t, queries, userID); got != 1 {
		t.Fatalf("active families after login = %d, want 1", got)
	}

	payload, _ := json.Marshal(map[string]string{"refreshToken": refresh})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+access)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("native logout status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	if got := countActiveFamilies(t, queries, userID); got != 0 {
		t.Errorf("active families after native logout = %d, want 0", got)
	}

	// And the token itself is dead.
	if rec, _ := nativeRefresh(t, engine, refresh); rec.Code == http.StatusOK {
		t.Error("refresh succeeded after logout; the family was not revoked")
	}
}

// The body cap applies to logout now that it reads one.
func TestLogout_RejectsOversizedBody(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	access, _, _ := nativeLogin(t, engine, "alice", "password123")

	huge := bytes.Repeat([]byte("a"), (1<<20)+1024)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", bytes.NewReader(huge))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+access)
	// Chunked: no Content-Length for a length check to short-circuit on.
	req.ContentLength = -1
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	// The handler must not have read a megabyte of garbage as a token; the
	// request either fails outright or logs out having found no token.
	if w.Code != http.StatusOK && w.Code != http.StatusBadRequest && w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized logout status = %d, want 200, 400 or 413", w.Code)
	}
}

// A native session must survive an access-token expiry the way a browser one
// does: refresh over the body, then use the new access token on a real
// endpoint.
func TestNativeSession_RefreshedTokenAuthenticatesRequests(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	_, refresh, _ := nativeLogin(t, engine, "alice", "password123")

	payload, _ := json.Marshal(map[string]string{"refreshToken": refresh})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Token == "" {
		t.Fatalf("no access token from native refresh: %v, body: %s", err, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+body.Token)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("GET /auth/me with refreshed native token = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}
