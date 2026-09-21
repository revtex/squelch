package auth_test

// Optimistic-concurrency contract for the talkgroup selection endpoints.
//
// A PUT that echoes the `version` it read may only replace that version;
// anything else is a stale write from a second tab or device and must be
// rejected rather than silently re-enabling every talkgroup. A PUT without a
// version keeps the legacy unconditional-overwrite behaviour.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

const tgSelectionPath = "/api/v1/listener/tg-selection"

type tgSelectionBody struct {
	DisabledTGs []int64 `json:"disabledTGs"`
	AvoidList   []struct {
		TalkgroupID int64 `json:"talkgroupId"`
		ExpiresAt   int64 `json:"expiresAt"`
	} `json:"avoidList"`
	Version string `json:"version"`
}

func getTGSelection(t *testing.T, engine http.Handler, bearer string) tgSelectionBody {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, tgSelectionPath, nil)
	req.Header.Set("Authorization", bearer)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET: status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var body tgSelectionBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("GET decode: %v\nbody: %s", err, w.Body.String())
	}
	return body
}

func putTGSelection(t *testing.T, engine http.Handler, bearer string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPut, tgSelectionPath, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", bearer)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	return w
}

func bearerAlice(t *testing.T, engine http.Handler) string {
	t.Helper()
	var l struct {
		Token string `json:"token"`
	}
	loginW := loginAlice(t, engine)
	_ = json.Unmarshal(loginW.Body.Bytes(), &l)
	if l.Token == "" {
		t.Fatalf("login returned no token: %s", loginW.Body.String())
	}
	return "Bearer " + l.Token
}

func TestPutTGSelection_RejectsStaleVersion(t *testing.T) {
	engine, _ := authFixture(t)
	bearer := bearerAlice(t, engine)

	initial := getTGSelection(t, engine, bearer)
	if initial.Version == "" {
		t.Fatal("GET must return a version even when nothing is stored")
	}

	// First write wins and reports the new version.
	w := putTGSelection(t, engine, bearer, map[string]any{
		"disabledTGs": []int64{1, 2, 3},
		"avoidList":   []any{},
		"version":     initial.Version,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("first PUT: status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var okBody struct {
		OK      bool   `json:"ok"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &okBody); err != nil {
		t.Fatalf("first PUT decode: %v", err)
	}
	if !okBody.OK || okBody.Version == "" || okBody.Version == initial.Version {
		t.Fatalf("first PUT body = %+v, want ok:true and a changed version", okBody)
	}

	// A second session still holding the original version must not clobber it.
	w = putTGSelection(t, engine, bearer, map[string]any{
		"disabledTGs": []int64{},
		"avoidList":   []any{},
		"version":     initial.Version,
	})
	if w.Code != http.StatusConflict {
		t.Fatalf("stale PUT: status = %d, want 409; body: %s", w.Code, w.Body.String())
	}
	var errBody struct {
		Error struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("stale PUT decode: %v\nbody: %s", err, w.Body.String())
	}
	if errBody.Error.Code != "conflict" {
		t.Errorf("error code = %q, want conflict", errBody.Error.Code)
	}
	if got, _ := errBody.Error.Details["currentVersion"].(string); got != okBody.Version {
		t.Errorf("details.currentVersion = %q, want %q", got, okBody.Version)
	}

	// The first write survived.
	final := getTGSelection(t, engine, bearer)
	if len(final.DisabledTGs) != 3 {
		t.Errorf("disabledTGs = %v, want [1 2 3] preserved", final.DisabledTGs)
	}
	if final.Version != okBody.Version {
		t.Errorf("version = %q, want %q", final.Version, okBody.Version)
	}

	// Re-reading the current version lets the same client write again.
	w = putTGSelection(t, engine, bearer, map[string]any{
		"disabledTGs": []int64{7},
		"avoidList":   []any{},
		"version":     final.Version,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("fresh PUT: status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

func TestPutTGSelection_NoVersionOverwrites(t *testing.T) {
	engine, _ := authFixture(t)
	bearer := bearerAlice(t, engine)

	if w := putTGSelection(t, engine, bearer, map[string]any{
		"disabledTGs": []int64{1, 2},
	}); w.Code != http.StatusOK {
		t.Fatalf("seed PUT: status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	// Legacy clients (rdio-scanner compatible) send no version at all.
	if w := putTGSelection(t, engine, bearer, map[string]any{
		"disabledTGs": []int64{5},
	}); w.Code != http.StatusOK {
		t.Fatalf("unversioned PUT: status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	final := getTGSelection(t, engine, bearer)
	if len(final.DisabledTGs) != 1 || final.DisabledTGs[0] != 5 {
		t.Errorf("disabledTGs = %v, want [5]", final.DisabledTGs)
	}
}

func TestGetTGSelection_VersionStableAcrossReads(t *testing.T) {
	engine, _ := authFixture(t)
	bearer := bearerAlice(t, engine)
	first := getTGSelection(t, engine, bearer)
	second := getTGSelection(t, engine, bearer)
	if first.Version != second.Version {
		t.Errorf("version changed without a write: %q then %q", first.Version, second.Version)
	}
}

// Oversized selections are refused rather than stored.
func TestPutTGSelection_RejectsOversizedSelections(t *testing.T) {
	engine, _ := authFixture(t)
	bearer := bearerAlice(t, engine)

	tooMany := make([]int64, 50001)
	for i := range tooMany {
		tooMany[i] = int64(i)
	}
	if w := putTGSelection(t, engine, bearer, map[string]any{"disabledTGs": tooMany}); w.Code != http.StatusBadRequest {
		t.Errorf("over-count selection: status = %d, want 400", w.Code)
	}

	huge := make([]int64, 200000)
	for i := range huge {
		huge[i] = 1_000_000_000 + int64(i)
	}
	if w := putTGSelection(t, engine, bearer, map[string]any{"disabledTGs": huge}); w.Code == http.StatusOK {
		t.Errorf("body over 1 MiB was accepted")
	}

	if got := getTGSelection(t, engine, bearer); len(got.DisabledTGs) != 0 {
		t.Errorf("rejected selections were stored: %d entries", len(got.DisabledTGs))
	}
	if w := putTGSelection(t, engine, bearer, map[string]any{"disabledTGs": []int64{1, 2}}); w.Code != http.StatusOK {
		t.Errorf("normal selection: status = %d, want 200", w.Code)
	}
}
