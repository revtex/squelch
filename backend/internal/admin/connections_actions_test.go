package admin

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
)

// recordingSink is an EventSink that remembers what it was asked to do.
type recordingSink struct {
	mu           sync.Mutex
	topics       []string
	disconnected []int64
}

func (s *recordingSink) BroadcastAdminEvent(topic string, _ any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.topics = append(s.topics, topic)
}
func (s *recordingSink) BroadcastCFG(context.Context) {}
func (s *recordingSink) DisconnectByUser(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.disconnected = append(s.disconnected, id)
}
func (s *recordingSink) ClientCount() int { return 0 }

func (s *recordingSink) sawTopic(topic string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.topics {
		if t == topic {
			return true
		}
	}
	return false
}

// reasonLog is an Observer that records why each connection closed.
type reasonLog struct {
	mu      sync.Mutex
	reasons map[string]string
}

func (r *reasonLog) Opened(connections.Conn) {}
func (r *reasonLog) Closed(c connections.Conn, reason string, _ time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reasons[c.ID] = reason
}
func (r *reasonLog) get(id string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.reasons[id]
	return v, ok
}

// newRegistry returns a registry whose connections close the way a real
// transport's do: their close func removes them.
func newRegistry(ops *Operations) (*connections.Registry, *reasonLog) {
	reg := connections.New()
	log := &reasonLog{reasons: map[string]string{}}
	reg.SetObserver(log)
	ops.Deps.Connections = reg
	return reg, log
}

func addLive(reg *connections.Registry, c connections.Conn) {
	id := c.ID
	reg.Add(c, func() { reg.Remove(id) })
}

func params(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

func lastLogMessage(t *testing.T, ops *Operations) string {
	t.Helper()
	var msg string
	if err := ops.Deps.SQLDB.QueryRow(`SELECT message FROM logs ORDER BY id DESC LIMIT 1`).Scan(&msg); err != nil {
		t.Fatalf("read logs: %v", err)
	}
	return msg
}

func activeFamilies(t *testing.T, q *db.Queries, userID int64) []string {
	t.Helper()
	rows, err := q.ListActiveSessions(context.Background(), db.ListActiveSessionsParams{
		Now: time.Now().Unix(), UserID: userID,
	})
	if err != nil {
		t.Fatalf("list sessions: %v", err)
	}
	var out []string
	for _, r := range rows {
		out = append(out, r.FamilyID)
	}
	return out
}

func claimsFor(userID int64, family string) *auth.Claims {
	return &auth.Claims{
		UserID:   userID,
		FamilyID: family,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:       "jti-" + family,
			IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
}

func TestConnectionsDisconnect_EndsOnlyThatConnection(t *testing.T) {
	ops, q := newTestOperations(t, "")
	reg, log := newRegistry(ops)
	uid := seedSessionUser(t, q, "erin")
	addLive(reg, connections.Conn{ID: "live", Kind: connections.KindListener, UserID: uid, Username: "erin", FamilyID: "fam-1"})
	addLive(reg, connections.Conn{ID: "bkgnd", Kind: connections.KindStream, UserID: uid, Username: "erin", FamilyID: "fam-1"})

	if _, err := ops.ConnectionsDisconnect(context.Background(), params(t, map[string]string{"id": "live"}), 1); err != nil {
		t.Fatalf("ConnectionsDisconnect: %v", err)
	}
	if _, ok := reg.Get("live"); ok {
		t.Fatal("disconnected connection is still live")
	}
	if _, ok := reg.Get("bkgnd"); !ok {
		t.Fatal("the same user's other connection was closed too")
	}
	if got, _ := log.get("live"); got != connections.ReasonAdmin {
		t.Fatalf("close reason = %q, want %q", got, connections.ReasonAdmin)
	}
	if msg := lastLogMessage(t, ops); !strings.Contains(msg, "disconnected LIVE erin@unknown by") {
		t.Fatalf("audit line = %q", msg)
	}
}

func TestConnectionsDisconnect_UnknownIsAUserError(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	newRegistry(ops)
	_, err := ops.ConnectionsDisconnect(context.Background(), params(t, map[string]string{"id": "gone"}), 1)
	if msg, isUser := errorString(err); !isUser || !strings.Contains(msg, "already ended") {
		t.Fatalf("err = %v, want a user error", err)
	}
}

func TestSessionsRevoke_SignsOutOnlyThatDevice(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sink := &recordingSink{}
	ops.Events = sink
	reg, log := newRegistry(ops)
	uid := seedSessionUser(t, q, "erin")
	now := time.Now().Unix()
	addRefresh(t, q, uid, "fam-phone", "203.0.113.9", now, false)
	addRefresh(t, q, uid, "fam-laptop", "198.51.100.4", now, false)
	addLive(reg, connections.Conn{ID: "phone", Kind: connections.KindListener, UserID: uid, FamilyID: "fam-phone"})
	addLive(reg, connections.Conn{ID: "laptop", Kind: connections.KindListener, UserID: uid, FamilyID: "fam-laptop"})

	if _, err := ops.SessionsRevoke(context.Background(), params(t, map[string]string{"familyId": "fam-phone"}), 1); err != nil {
		t.Fatalf("SessionsRevoke: %v", err)
	}

	if got := activeFamilies(t, q, uid); len(got) != 1 || got[0] != "fam-laptop" {
		t.Fatalf("active families = %v, want only fam-laptop", got)
	}
	if !auth.Tokens.Rejects(claimsFor(uid, "fam-phone")) {
		t.Fatal("an access token from the signed-out device is still accepted")
	}
	if auth.Tokens.Rejects(claimsFor(uid, "fam-laptop")) {
		t.Fatal("an access token from the other device is refused")
	}
	if _, ok := reg.Get("phone"); ok {
		t.Fatal("the signed-out device's connection is still live")
	}
	if _, ok := reg.Get("laptop"); !ok {
		t.Fatal("the other device's connection was closed")
	}
	if got, _ := log.get("phone"); got != connections.ReasonSignout {
		t.Fatalf("close reason = %q, want %q", got, connections.ReasonSignout)
	}
	if !sink.sawTopic("connections.updated") {
		t.Fatal("no connections.updated event")
	}
	if msg := lastLogMessage(t, ops); !strings.Contains(msg, "signed out a device of erin by") {
		t.Fatalf("audit line = %q", msg)
	}

	// A second revoke of the same device is a user error, not a silent success.
	_, err := ops.SessionsRevoke(context.Background(), params(t, map[string]string{"familyId": "fam-phone"}), 1)
	if _, isUser := errorString(err); !isUser {
		t.Fatalf("second revoke err = %v, want a user error", err)
	}
}

func TestUsersSignout_RevokesEveryDevice(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sink := &recordingSink{}
	ops.Events = sink
	newRegistry(ops)
	uid := seedSessionUser(t, q, "erin")
	other := seedSessionUser(t, q, "frank")
	now := time.Now().Unix()
	addRefresh(t, q, uid, "fam-a", "203.0.113.9", now, false)
	addRefresh(t, q, uid, "fam-b", "203.0.113.9", now, false)
	addRefresh(t, q, other, "fam-c", "203.0.113.9", now, false)

	if _, err := ops.UsersSignout(context.Background(), params(t, map[string]int64{"id": uid}), 1); err != nil {
		t.Fatalf("UsersSignout: %v", err)
	}
	if got := activeFamilies(t, q, uid); len(got) != 0 {
		t.Fatalf("erin still has devices %v", got)
	}
	if got := activeFamilies(t, q, other); len(got) != 1 {
		t.Fatalf("frank's devices = %v, want untouched", got)
	}
	if len(sink.disconnected) != 1 || sink.disconnected[0] != uid {
		t.Fatalf("disconnected = %v, want [%d]", sink.disconnected, uid)
	}
	if msg := lastLogMessage(t, ops); !strings.Contains(msg, "signed out erin on every device by") {
		t.Fatalf("audit line = %q", msg)
	}
}

func TestUsersUpdate_DisablingRevokesDevicesForGood(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedSessionUser(t, q, "primary") // id 1 cannot be disabled
	uid := seedSessionUser(t, q, "erin")
	addRefresh(t, q, uid, "fam-a", "203.0.113.9", time.Now().Unix(), false)

	update := func(disabled int64) {
		t.Helper()
		p := params(t, map[string]any{"id": uid, "username": "erin", "role": auth.RoleListener, "disabled": disabled})
		if _, err := ops.UsersUpdate(context.Background(), p, 1); err != nil {
			t.Fatalf("UsersUpdate: %v", err)
		}
	}

	// An ordinary edit leaves the device signed in.
	update(0)
	if got := activeFamilies(t, q, uid); len(got) != 1 {
		t.Fatalf("after an edit, devices = %v, want fam-a kept", got)
	}
	// Disabling revokes it, so enabling the account later does not bring it back.
	update(1)
	update(0)
	if got := activeFamilies(t, q, uid); len(got) != 0 {
		t.Fatalf("after disable and re-enable, devices = %v, want none", got)
	}
}

func TestConnectionsAndSessions_MarkTheCaller(t *testing.T) {
	ops, q := newTestOperations(t, "")
	reg, _ := newRegistry(ops)
	uid := seedSessionUser(t, q, "erin")
	now := time.Now().Unix()
	addRefresh(t, q, uid, "fam-mine", "203.0.113.9", now, false)
	addRefresh(t, q, uid, "fam-other", "203.0.113.9", now, false)
	addLive(reg, connections.Conn{ID: "mine", Kind: connections.KindAdmin, UserID: uid, FamilyID: "fam-mine"})
	addLive(reg, connections.Conn{ID: "other", Kind: connections.KindAdmin, UserID: uid, FamilyID: "fam-other"})

	ctx := WithCaller(context.Background(), Caller{ConnID: "mine", FamilyID: "fam-mine"})
	conns, err := ops.ConnectionsList(ctx, nil, uid)
	if err != nil {
		t.Fatalf("ConnectionsList: %v", err)
	}
	self := map[string]bool{}
	for _, c := range conns.(map[string]any)["connections"].([]map[string]any) {
		self[c["id"].(string)] = c["self"].(bool)
	}
	if !self["mine"] || self["other"] {
		t.Fatalf("self flags = %v, want only mine", self)
	}
	var out string

	sessions, err := ops.SessionsList(ctx, nil, uid)
	if err != nil {
		t.Fatalf("SessionsList: %v", err)
	}
	out = toJSON(t, sessions)
	if strings.Count(out, `"current":true`) != 1 || !strings.Contains(out, `"current":true,"expiresAt"`) {
		t.Fatalf("current flag wrong: %s", out)
	}
	if !strings.Contains(out, `"current":false`) {
		t.Fatalf("other device not marked false: %s", out)
	}
}

// errorString reports err's message and whether it is a UserError.
func errorString(err error) (string, bool) {
	var uerr UserError
	if errors.As(err, &uerr) {
		return string(uerr), true
	}
	if err == nil {
		return "", false
	}
	return err.Error(), false
}
