package routes_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// grantFixture seeds two systems, one call on system A with a transcript, a
// listener, and an admin-created share link for that call.
type grantFixture struct {
	engine    *gin.Engine
	q         *db.Queries
	sysA      int64
	sysB      int64
	callA     int64
	shareTok  string
	listener  int64
	listenerT string
}

const grantFixtureTranscript = "GRANT-FIXTURE-TRANSCRIPT"

func newGrantFixture(t *testing.T, listenerSystems string) grantFixture {
	t.Helper()
	engine, q, dir := newTestEngineWithAudio(t)
	ctx := context.Background()
	seedAdminUser(t, q, "admin", "adminpass123")

	// seedAudioCall creates system A (radio 100) with one call and audio.
	callA := seedAudioCall(t, q, dir)
	call, err := q.GetCall(ctx, callA)
	if err != nil {
		t.Fatal(err)
	}
	sysB, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 200, Label: "System B"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.CreateTranscription(ctx, db.CreateTranscriptionParams{
		CallID: callA, Text: grantFixtureTranscript, CreatedAt: time.Now().Unix(),
	}); err != nil {
		t.Fatal(err)
	}
	for k, v := range map[string]string{"shareableLinks": "true", "publicAccess": "false"} {
		if err := q.UpsertSetting(ctx, db.UpsertSettingParams{Key: k, Value: v}); err != nil {
			t.Fatal(err)
		}
	}
	sl, err := q.CreateSharedLink(ctx, db.CreateSharedLinkParams{CallID: callA, UserID: 1, Token: "share-token-for-call-a"})
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().Unix()
	systems := strings.ReplaceAll(listenerSystems, "{B}", strconv.FormatInt(sysB, 10))
	listener, err := q.CreateUser(ctx, db.CreateUserParams{
		Username: "listener", PasswordHash: "x", Role: auth.RoleListener,
		SystemsJson: sql.NullString{String: systems, Valid: systems != ""},
		CreatedAt:   now, UpdatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	tok, _, err := auth.GenerateToken(listener, "listener", auth.RoleListener, 0)
	if err != nil {
		t.Fatal(err)
	}
	return grantFixture{engine: engine, q: q, sysA: call.SystemID, sysB: sysB, callA: callA,
		shareTok: sl.Token, listener: listener, listenerT: tok}
}

func (f grantFixture) do(t *testing.T, method, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	f.engine.ServeHTTP(w, req)
	return w
}

// A listener restricted (in the admin UI's flat format) to system B must not
// reach anything belonging to a call on system A.
func TestGrantScope_RestrictedListenerCannotReachOtherSystem(t *testing.T) {
	for _, systems := range []string{"[{B}]", `[{"id":{B}}]`, "{corrupt"} {
		t.Run(systems, func(t *testing.T) {
			f := newGrantFixture(t, systems)
			id := strconv.FormatInt(f.callA, 10)
			for _, p := range []string{"/api/v1/calls/" + id + "/audio", "/api/v1/calls/" + id + "/transcript",
				"/api/calls/" + id + "/transcript", "/api/v1/calls/" + id + "/share", "/api/calls/" + id + "/share"} {
				w := f.do(t, http.MethodGet, p, f.listenerT)
				if w.Code != http.StatusNotFound {
					t.Errorf("GET %s = %d, want 404 (body %s)", p, w.Code, w.Body)
				}
				if strings.Contains(w.Body.String(), f.shareTok) || strings.Contains(w.Body.String(), grantFixtureTranscript) {
					t.Errorf("GET %s leaked call data: %s", p, w.Body)
				}
			}
			w := f.do(t, http.MethodPost, "/api/v1/calls/"+id+"/share", f.listenerT)
			if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), f.shareTok) {
				t.Errorf("POST share = %d %s, want 404 without the token", w.Code, w.Body)
			}
			for _, p := range []string{"/api/v1/calls", "/api/v1/calls?transcript=GRANT", "/api/calls"} {
				w := f.do(t, http.MethodGet, p, f.listenerT)
				if w.Code != http.StatusOK {
					t.Fatalf("GET %s = %d", p, w.Code)
				}
				if strings.Contains(w.Body.String(), "Fire Dispatch") {
					t.Errorf("GET %s listed the out-of-grant call: %s", p, w.Body)
				}
			}
		})
	}
}

// Bookmarks made while a call was in scope disappear once grants narrow.
func TestGrantScope_BookmarksFollowCurrentGrants(t *testing.T) {
	f := newGrantFixture(t, "")
	ctx := context.Background()
	if _, err := f.q.CreateBookmark(ctx, db.CreateBookmarkParams{
		CallID: f.callA, UserID: sql.NullInt64{Int64: f.listener, Valid: true}, CreatedAt: time.Now().Unix(),
	}); err != nil {
		t.Fatal(err)
	}
	listCalls := func() int {
		w := f.do(t, http.MethodGet, "/api/v1/bookmarks/calls", f.listenerT)
		if w.Code != http.StatusOK {
			t.Fatalf("bookmarks = %d %s", w.Code, w.Body)
		}
		var body struct {
			Calls []json.RawMessage `json:"calls"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return len(body.Calls)
	}
	if n := listCalls(); n != 1 {
		t.Fatalf("unrestricted listener sees %d bookmarks, want 1", n)
	}
	if err := f.q.UpdateUser(ctx, updateSystemsParams(t, f.q, f.listener, "["+strconv.FormatInt(f.sysB, 10)+"]")); err != nil {
		t.Fatal(err)
	}
	if n := listCalls(); n != 0 {
		t.Errorf("narrowed listener still sees %d out-of-grant bookmarks", n)
	}
}

// A still-valid token for a deleted user must not fall back to allow-all.
func TestGrantScope_DeletedUserTokenIsDenied(t *testing.T) {
	f := newGrantFixture(t, "[{B}]")
	if err := f.q.DeleteUser(context.Background(), f.listener); err != nil {
		t.Fatal(err)
	}
	w := f.do(t, http.MethodGet, "/api/v1/calls/"+strconv.FormatInt(f.callA, 10)+"/audio", f.listenerT)
	if w.Code == http.StatusOK {
		t.Fatalf("deleted user's token fetched audio (200)")
	}
}

// Anonymous search follows the same publicAccess rule as audio.
func TestGrantScope_AnonymousSearchNeedsPublicAccess(t *testing.T) {
	f := newGrantFixture(t, "")
	for _, p := range []string{"/api/v1/calls", "/api/calls"} {
		if w := f.do(t, http.MethodGet, p, ""); w.Code != http.StatusUnauthorized {
			t.Errorf("anonymous GET %s with publicAccess off = %d, want 401", p, w.Code)
		}
	}
	setPublicAccess(t, f.q, true)
	for _, p := range []string{"/api/v1/calls", "/api/calls"} {
		if w := f.do(t, http.MethodGet, p, ""); w.Code != http.StatusOK {
			t.Errorf("anonymous GET %s with publicAccess on = %d, want 200", p, w.Code)
		}
	}
}

// updateSystemsParams returns an UpdateUser payload that keeps the user's
// current fields and replaces only systems_json.
func updateSystemsParams(t *testing.T, q *db.Queries, id int64, systems string) db.UpdateUserParams {
	t.Helper()
	u, err := q.GetUser(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return db.UpdateUserParams{
		ID: u.ID, Username: u.Username, Role: u.Role, Disabled: u.Disabled,
		SystemsJson: sql.NullString{String: systems, Valid: true},
		Expiration:  u.Expiration, Limit: u.Limit, UpdatedAt: time.Now().Unix(),
	}
}
