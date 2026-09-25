package admin

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
)

func createUser(t *testing.T, ops *Operations, name string, extra map[string]any) int64 {
	t.Helper()
	p := map[string]any{"username": name, "password": "first-pass-1", "role": auth.RoleListener}
	for k, v := range extra {
		p[k] = v
	}
	res, err := ops.UsersCreate(context.Background(), params(t, p), 1)
	if err != nil {
		t.Fatalf("UsersCreate: %v", err)
	}
	return res.(map[string]any)["id"].(int64)
}

func getUser(t *testing.T, q *db.Queries, id int64) db.User {
	t.Helper()
	u, err := q.GetUser(context.Background(), id)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	return u
}

func TestUsersCreate_AsksForAPasswordChangeUnlessToldNotTo(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedSessionUser(t, q, "primary")

	tests := []struct {
		name  string
		extra map[string]any
		want  int64
	}{
		{"default", nil, 1},
		{"explicitly on", map[string]any{"passwordNeedChange": 1}, 1},
		{"off", map[string]any{"passwordNeedChange": 0}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			id := createUser(t, ops, "user-"+tc.name, tc.extra)
			if got := getUser(t, q, id).PasswordNeedChange; got != tc.want {
				t.Fatalf("passwordNeedChange = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestUsersUpdate_ResetsThePassword(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedSessionUser(t, q, "primary")
	sink := &recordingSink{}
	ops.Events = sink
	newRegistry(ops)
	uid := createUser(t, ops, "erin", map[string]any{"passwordNeedChange": 0})
	addRefresh(t, q, uid, "fam-a", "203.0.113.9", time.Now().Unix(), false)

	update := func(t *testing.T, extra map[string]any) error {
		t.Helper()
		p := map[string]any{"id": uid, "username": "erin", "role": auth.RoleListener}
		for k, v := range extra {
			p[k] = v
		}
		_, err := ops.UsersUpdate(context.Background(), params(t, p), 1)
		return err
	}

	t.Run("a new password is stored and must be changed next time", func(t *testing.T) {
		if err := update(t, map[string]any{"password": "temporary-9"}); err != nil {
			t.Fatalf("UsersUpdate: %v", err)
		}
		u := getUser(t, q, uid)
		if !auth.CheckPassword("temporary-9", u.PasswordHash) {
			t.Fatal("new password does not verify")
		}
		if u.PasswordNeedChange != 1 {
			t.Fatalf("passwordNeedChange = %d, want 1", u.PasswordNeedChange)
		}
		if msg := lastLogMessage(t, ops); !strings.Contains(msg, "password of erin reset by") {
			t.Fatalf("audit line = %q", msg)
		}
		// A reset alone keeps the devices; the admin decides about that.
		if got := activeFamilies(t, q, uid); len(got) != 1 {
			t.Fatalf("devices after reset = %v, want fam-a kept", got)
		}
	})

	t.Run("the change can be waived", func(t *testing.T) {
		if err := update(t, map[string]any{"password": "permanent-9", "passwordNeedChange": 0}); err != nil {
			t.Fatalf("UsersUpdate: %v", err)
		}
		u := getUser(t, q, uid)
		if !auth.CheckPassword("permanent-9", u.PasswordHash) || u.PasswordNeedChange != 0 {
			t.Fatalf("password not stored as permanent: needChange=%d", u.PasswordNeedChange)
		}
	})

	t.Run("the flag can be set on its own without touching the password", func(t *testing.T) {
		before := getUser(t, q, uid).PasswordHash
		if err := update(t, map[string]any{"passwordNeedChange": 1}); err != nil {
			t.Fatalf("UsersUpdate: %v", err)
		}
		u := getUser(t, q, uid)
		if u.PasswordHash != before || u.PasswordNeedChange != 1 {
			t.Fatalf("flag-only update changed the hash or missed the flag (needChange=%d)", u.PasswordNeedChange)
		}
	})

	t.Run("too short is refused", func(t *testing.T) {
		err := update(t, map[string]any{"password": "short"})
		var ue UserError
		if err == nil || !errors.As(err, &ue) {
			t.Fatalf("err = %v, want a UserError", err)
		}
	})

	t.Run("signOut ends every device", func(t *testing.T) {
		if err := update(t, map[string]any{"password": "another-99", "signOut": true}); err != nil {
			t.Fatalf("UsersUpdate: %v", err)
		}
		if got := activeFamilies(t, q, uid); len(got) != 0 {
			t.Fatalf("devices after signOut = %v, want none", got)
		}
		if len(sink.disconnected) == 0 || sink.disconnected[len(sink.disconnected)-1] != uid {
			t.Fatalf("disconnected = %v, want %d last", sink.disconnected, uid)
		}
	})
}

func TestUsersList_CountsDevicesAndLiveConnections(t *testing.T) {
	ops, q := newTestOperations(t, "")
	reg, _ := newRegistry(ops)
	seedSessionUser(t, q, "primary")
	uid := seedSessionUser(t, q, "erin")
	quiet := seedSessionUser(t, q, "frank")
	now := time.Now().Unix()
	addRefresh(t, q, uid, "fam-a", "203.0.113.9", now-100, false)
	addRefresh(t, q, uid, "fam-c", "203.0.113.9", now-50, true) // signed out: not a device
	addRefresh(t, q, uid, "fam-b", "198.51.100.4", now, false)
	addLive(reg, connections.Conn{ID: "c1", Kind: connections.KindListener, UserID: uid, Username: "erin"})
	addLive(reg, connections.Conn{ID: "c2", Kind: connections.KindStream, UserID: uid, Username: "erin"})

	res, err := ops.UsersList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("UsersList: %v", err)
	}
	byName := map[string]map[string]any{}
	for _, m := range res.([]map[string]any) {
		byName[m["username"].(string)] = m
	}
	erin := byName["erin"]
	if erin["devices"] != int64(2) || erin["liveConnections"] != 2 {
		t.Fatalf("erin devices=%v live=%v, want 2 and 2", erin["devices"], erin["liveConnections"])
	}
	if ip := erin["lastSeenIp"].(*string); ip == nil || *ip != "198.51.100.4" || erin["lastSeenAt"] != now {
		t.Fatalf("erin last seen = %v at %v, want 198.51.100.4 at %d", ip, erin["lastSeenAt"], now)
	}
	if erin["passwordNeedChange"] != int64(0) {
		t.Fatalf("passwordNeedChange missing or wrong: %v", erin["passwordNeedChange"])
	}
	frank := byName["frank"]
	if frank["devices"] != int64(0) || frank["liveConnections"] != 0 || frank["lastSeenAt"] != nil {
		t.Fatalf("frank should have nothing: %v", frank)
	}
	_ = quiet
}

func TestLockouts_ListAndClear(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	limiter := auth.NewRateLimiter(ctx)
	ops.Deps.LoginLimiter = limiter
	for range 3 {
		limiter.RecordFailure("203.0.113.9")
	}
	limiter.RecordFailure("198.51.100.4")

	res, err := ops.LockoutsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("LockoutsList: %v", err)
	}
	items := res.(map[string]any)["lockouts"].([]map[string]any)
	if len(items) != 2 || items[0]["ip"] != "203.0.113.9" || items[0]["lockedUntil"] == nil {
		t.Fatalf("lockouts = %v, want the locked address first with an end time", items)
	}
	if items[1]["lockedUntil"] != nil || items[1]["failures"] != 1 {
		t.Fatalf("second entry = %v, want one failure and no lockout", items[1])
	}

	if _, err := ops.LockoutsClear(context.Background(), params(t, map[string]string{"ip": "203.0.113.9"}), 1); err != nil {
		t.Fatalf("LockoutsClear: %v", err)
	}
	if limiter.IsLockedOut("203.0.113.9") {
		t.Fatal("still locked out after clear")
	}
	if msg := lastLogMessage(t, ops); !strings.Contains(msg, "lockout for 203.0.113.9 cleared by") {
		t.Fatalf("audit line = %q", msg)
	}
	_, err = ops.LockoutsClear(context.Background(), params(t, map[string]string{"ip": "203.0.113.9"}), 1)
	var ue UserError
	if err == nil || !errors.As(err, &ue) {
		t.Fatalf("clearing again: err = %v, want a UserError", err)
	}
	_, err = ops.LockoutsClear(context.Background(), params(t, map[string]string{"ip": "not-an-ip"}), 1)
	if err == nil || !errors.As(err, &ue) {
		t.Fatalf("bad address: err = %v, want a UserError", err)
	}
}
