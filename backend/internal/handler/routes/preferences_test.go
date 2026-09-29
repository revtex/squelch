package routes_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/revtex/squelch/internal/auth"
)

// prefsRequest issues an authenticated call against the preferences endpoint.
func prefsRequest(t *testing.T, engine http.Handler, method, body string) *httptest.ResponseRecorder {
	t.Helper()

	token, _, err := auth.GenerateToken(1, "alice", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, "/api/v1/listener/preferences", reader)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

func decodePrefs(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return body
}

func TestGetPreferences_UnsetIsAbsent(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	w := prefsRequest(t, engine, http.MethodGet, "")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}

	// Absent, not "off": an account that has never chosen leaves the
	// instance-wide default in force.
	if _, ok := decodePrefs(t, w)["keypadBeeps"]; ok {
		t.Error("keypadBeeps should be absent before anything is chosen")
	}
}

func TestPutPreferences_RoundTrips(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	w := prefsRequest(t, engine, http.MethodPut, `{"keypadBeeps":"whistler"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	if got := decodePrefs(t, w)["keypadBeeps"]; got != "whistler" {
		t.Errorf("PUT returned keypadBeeps = %v, want whistler", got)
	}

	// The point of the account storing it: the next device to ask gets it.
	w = prefsRequest(t, engine, http.MethodGet, "")
	if got := decodePrefs(t, w)["keypadBeeps"]; got != "whistler" {
		t.Errorf("GET keypadBeeps = %v, want whistler", got)
	}
}

func TestPutPreferences_OffIsStored(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	prefsRequest(t, engine, http.MethodPut, `{"keypadBeeps":"disabled"}`)

	// Silence is a choice and has to survive, or the instance default
	// would turn the beeps back on at the next sign-in.
	w := prefsRequest(t, engine, http.MethodGet, "")
	if got := decodePrefs(t, w)["keypadBeeps"]; got != "disabled" {
		t.Errorf("GET keypadBeeps = %v, want disabled", got)
	}
}

func TestPutPreferences_RejectsUnknownStyle(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	w := prefsRequest(t, engine, http.MethodPut, `{"keypadBeeps":"airhorn"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", w.Code, w.Body.String())
	}

	// Nothing the client cannot play may be stored, or every device the
	// listener signs in on would be served a style it does not know.
	w = prefsRequest(t, engine, http.MethodGet, "")
	if _, ok := decodePrefs(t, w)["keypadBeeps"]; ok {
		t.Error("a rejected style should not have been stored")
	}
}

func TestPutPreferences_OmittedFieldKeepsStoredValue(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	prefsRequest(t, engine, http.MethodPut, `{"keypadBeeps":"uniden"}`)
	// A client that knows about no preference at all must not wipe one it
	// has never heard of.
	prefsRequest(t, engine, http.MethodPut, `{}`)

	w := prefsRequest(t, engine, http.MethodGet, "")
	if got := decodePrefs(t, w)["keypadBeeps"]; got != "uniden" {
		t.Errorf("GET keypadBeeps = %v, want uniden", got)
	}
}

func TestPreferences_RequiresAuth(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/listener/preferences", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", w.Code)
	}
}
