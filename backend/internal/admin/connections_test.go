package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
)

func toJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestConnectionsList_NeverExposesTheJTI(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	reg := connections.New()
	ops.Deps.Connections = reg
	reg.Add(connections.Conn{
		ID: "c1", Kind: connections.KindListener, UserID: 3, Username: "erin", Role: auth.RoleListener,
		JTI: "secret-jti", FamilyID: "fam-1", Native: true, Protocol: "v1",
		Client: connections.Client{IP: netip.MustParseAddr("203.0.113.9"), UserAgent: "ua"},
	}, nil)
	reg.Add(connections.Conn{ID: "anon", Kind: connections.KindListener}, nil)

	res, err := ops.ConnectionsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("ConnectionsList: %v", err)
	}
	out := toJSON(t, res)
	if strings.Contains(out, "secret-jti") {
		t.Fatalf("response carries the JTI: %s", out)
	}
	for _, want := range []string{`"id":"c1"`, `"kind":"listener"`, `"username":"erin"`, `"familyId":"fam-1"`, `"ip":"203.0.113.9"`, `"native":true`} {
		if !strings.Contains(out, want) {
			t.Errorf("response missing %s: %s", want, out)
		}
	}
	// Anonymous: no user, no family.
	if !strings.Contains(out, `"familyId":null,"id":"anon"`) || !strings.Contains(out, `"userId":null`) {
		t.Errorf("anonymous entry not null-filled: %s", out)
	}
}

func TestConnectionsList_NoRegistry(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	res, err := ops.ConnectionsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("ConnectionsList: %v", err)
	}
	if got := toJSON(t, res); got != `{"connections":[],"geoip":{"credit":null,"enabled":false}}` {
		t.Fatalf("got %s, want an empty list", got)
	}
}

func seedSessionUser(t *testing.T, q *db.Queries, name string) int64 {
	t.Helper()
	now := time.Now().Unix()
	id, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: name, PasswordHash: "x", Role: auth.RoleListener, CreatedAt: now, UpdatedAt: now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return id
}

func addRefresh(t *testing.T, q *db.Queries, userID int64, family, ip string, createdAt int64, revoked bool) {
	t.Helper()
	ctx := context.Background()
	hash := family + ip + time.Unix(createdAt, 0).String()
	if err := q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		UserID: userID, TokenHash: hash, FamilyID: family,
		ExpiresAt: time.Now().Add(time.Hour).Unix(), CreatedAt: createdAt,
		Ip: sql.NullString{String: ip, Valid: true}, SignedInAt: sql.NullInt64{Int64: 100, Valid: true},
	}); err != nil {
		t.Fatalf("create refresh token: %v", err)
	}
	if revoked {
		rt, err := q.GetRefreshTokenByHash(ctx, hash)
		if err != nil {
			t.Fatalf("get token: %v", err)
		}
		if err := q.RevokeRefreshToken(ctx, rt.ID); err != nil {
			t.Fatalf("revoke: %v", err)
		}
	}
}

// A device appears once, as it is now: the newest token of its family,
// with the address that token was issued to. Signed-out families vanish.
func TestSessionsList_OneRowPerDeviceAtItsLatestAddress(t *testing.T) {
	ops, q := newTestOperations(t, "")
	reg := connections.New()
	ops.Deps.Connections = reg
	alice := seedSessionUser(t, q, "alice")
	bob := seedSessionUser(t, q, "bob")

	addRefresh(t, q, alice, "phone", "198.51.100.1", 200, true) // rotated away
	addRefresh(t, q, alice, "phone", "198.51.100.2", 300, false)
	addRefresh(t, q, alice, "laptop", "198.51.100.3", 250, false)
	addRefresh(t, q, bob, "gone", "198.51.100.4", 260, true) // signed out
	if err := q.RevokeRefreshTokenFamily(context.Background(), "gone"); err != nil {
		t.Fatal(err)
	}
	reg.Add(connections.Conn{ID: "x", FamilyID: "phone"}, nil)
	reg.Add(connections.Conn{ID: "y", FamilyID: "phone"}, nil)

	res, err := ops.SessionsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("SessionsList: %v", err)
	}
	sessions := res.(map[string]any)["sessions"].([]map[string]any)
	if len(sessions) != 2 {
		t.Fatalf("sessions = %s, want phone and laptop", toJSON(t, sessions))
	}
	phone := sessions[0] // newest use first
	if phone["familyId"] != "phone" || *(phone["ip"].(*string)) != "198.51.100.2" || phone["liveConnections"] != 2 {
		t.Errorf("phone = %s", toJSON(t, phone))
	}
	if sessions[1]["familyId"] != "laptop" || sessions[1]["liveConnections"] != 0 {
		t.Errorf("laptop = %s", toJSON(t, sessions[1]))
	}

	res, err = ops.SessionsList(context.Background(), json.RawMessage(`{"userId":`+toJSON(t, bob)+`}`), 1)
	if err != nil {
		t.Fatalf("SessionsList(bob): %v", err)
	}
	if n := len(res.(map[string]any)["sessions"].([]map[string]any)); n != 0 {
		t.Errorf("bob sessions = %d, want 0", n)
	}
}

func TestConnectionsHistory_FiltersAndPages(t *testing.T) {
	ops, q := newTestOperations(t, "")
	ctx := context.Background()
	insert := func(kind, ip string, userID int64, at int64) {
		t.Helper()
		if _, err := q.InsertConnectionLog(ctx, db.InsertConnectionLogParams{
			Kind: kind, Ip: ip, UserID: sql.NullInt64{Int64: userID, Valid: userID != 0}, ConnectedAt: at,
		}); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	insert("listener", "203.0.113.9", 7, 1000)
	insert("stream", "203.0.113.9", 7, 1100)
	insert("listener", "198.51.100.1", 0, 1200)
	insert("admin", "198.51.100.2", 1, 1300)

	call := func(params string) map[string]any {
		t.Helper()
		res, err := ops.ConnectionsHistory(ctx, json.RawMessage(params), 1)
		if err != nil {
			t.Fatalf("ConnectionsHistory(%s): %v", params, err)
		}
		return res.(map[string]any)
	}
	count := func(m map[string]any) int { return len(m["items"].([]map[string]any)) }

	all := call(`{}`)
	if count(all) != 4 || all["total"] != int64(4) || all["retentionDays"] != 30 {
		t.Fatalf("all = %s", toJSON(t, all))
	}
	if first := all["items"].([]map[string]any)[0]; first["kind"] != "admin" {
		t.Errorf("first item = %v, want newest (admin)", first)
	}
	if m := call(`{"ip":"203.0.113.9"}`); count(m) != 2 {
		t.Errorf("by ip = %d, want 2", count(m))
	}
	if m := call(`{"ip":"::ffff:203.0.113.9"}`); count(m) != 2 {
		t.Errorf("by v4-mapped ip = %d, want 2", count(m))
	}
	if m := call(`{"userId":7,"kind":"stream"}`); count(m) != 1 {
		t.Errorf("by user+kind = %d, want 1", count(m))
	}
	if m := call(`{"since":1100,"until":1300}`); count(m) != 2 {
		t.Errorf("by range = %d, want 2", count(m))
	}
	page2 := call(`{"pageSize":3,"page":2}`)
	if count(page2) != 1 || page2["total"] != int64(4) {
		t.Errorf("page 2 = %s", toJSON(t, page2))
	}

	for _, bad := range []string{`{"ip":"nope"}`, `{"kind":"bogus"}`, `[`} {
		_, err := ops.ConnectionsHistory(ctx, json.RawMessage(bad), 1)
		var uerr UserError
		if !errors.As(err, &uerr) {
			t.Errorf("ConnectionsHistory(%s) err = %v, want a UserError", bad, err)
		}
	}
}
