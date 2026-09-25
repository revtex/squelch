// Tests for the WS admin request router — specifically the framing /
// dispatch layer (unknown op → error envelope, known op → delegated to
// admin.Operations). Business logic for each op is covered in
// internal/admin's own test files.
package ws

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

func TestAdminOpHandlers_CoversEveryWireOp(t *testing.T) {
	// If a new admin op is added to admin.Operations but not wired into
	// adminOpHandlers, the WS layer silently drops it. This sanity check
	// catches that before it hits production.
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	queries := db.New(sqlDB)

	hub := NewHub(queries, "test")
	c := &Client{hub: hub, userID: 1, isAdmin: true}

	handlers := c.adminOpHandlers()

	// The ops expected on the wire. Keep this list sorted so diffs are
	// readable when an op is intentionally added.
	want := []string{
		"activity.chart", "activity.stats", "activity.top-talkgroups",
		"apikeys.create", "apikeys.delete",
		"apikeys.list", "apikeys.rotate", "apikeys.update",
		"config.get", "config.update",
		"connections.disconnect", "connections.history", "connections.list",
		"dirmonitors.create", "dirmonitors.delete", "dirmonitors.list", "dirmonitors.restart", "dirmonitors.test-mask", "dirmonitors.update",
		"downstreams.create", "downstreams.delete", "downstreams.list", "downstreams.test", "downstreams.update",
		"export.config", "export.groups", "export.tags", "export.talkgroups", "export.units",
		"fs.directories",
		"groups.create", "groups.delete", "groups.list", "groups.update",
		"import.config",
		"logs.audit", "logs.level", "logs.query",
		"radioreference.apply",
		"ipblocks.create", "ipblocks.delete", "ipblocks.list",
		"lockouts.clear", "lockouts.list",
		"sessions.list", "sessions.revoke",
		"shared-links.delete", "shared-links.list",
		"shared-links.restore", "shared-links.revoke-expired",
		"systems.block", "systems.create", "systems.delete", "systems.list",
		"systems.reorder", "systems.unblock", "systems.update",
		"tags.create", "tags.delete", "tags.list", "tags.update",
		"talkgroups.bulk", "talkgroups.create", "talkgroups.delete", "talkgroups.import",
		"talkgroups.list", "talkgroups.update",
		"transcription.delete", "transcription.download", "transcription.models",
		"transcription.stats", "transcription.status",
		"units.create", "units.delete", "units.list", "units.update",
		"users.create", "users.delete", "users.list", "users.signout", "users.update",
		"webhooks.create", "webhooks.delete", "webhooks.list", "webhooks.sample", "webhooks.test", "webhooks.update",
	}
	for _, op := range want {
		if _, ok := handlers[op]; !ok {
			t.Errorf("adminOpHandlers missing wire op %q", op)
		}
	}
	if got := len(handlers); got != len(want) {
		t.Errorf("adminOpHandlers has %d entries, want %d", got, len(want))
	}
}

func TestHandleAdminRequest_UnknownOp_ReturnsErrorEnvelope(t *testing.T) {
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	queries := db.New(sqlDB)
	hub := NewHub(queries, "test")

	// Capture anything the router tries to send.
	sendCh := make(chan []byte, 1)
	c := &Client{
		hub:     hub,
		userID:  1,
		isAdmin: true,
		send:    sendCh,
	}

	c.handleAdminRequest(context.Background(), adminRequest{ReqID: "r1", Op: "does.not.exist"})

	select {
	case msg := <-sendCh:
		// Must be a valid ADM_RES error envelope referencing reqId "r1".
		var frame []json.RawMessage
		if err := json.Unmarshal(msg, &frame); err != nil {
			t.Fatalf("response is not JSON array: %v", err)
		}
		var cmd string
		if err := json.Unmarshal(frame[0], &cmd); err != nil || cmd != "ADM_RES" {
			t.Fatalf("cmd = %q (err %v), want ADM_RES", cmd, err)
		}
		if !containsSub(string(msg), `"ok":false`) {
			t.Errorf("expected error envelope ok:false; got %s", msg)
		}
		if !containsSub(string(msg), "unknown op") {
			t.Errorf("expected 'unknown op' in error; got %s", msg)
		}
	default:
		t.Fatal("no ADM_RES frame was sent")
	}
}

func TestErrorString_DistinguishesUserAndInternal(t *testing.T) {
	uerr := admin.UserError("bad input")
	msg, isUser := errorString(uerr)
	if !isUser || msg != "bad input" {
		t.Errorf("UserError path: got (%q, %v), want (\"bad input\", true)", msg, isUser)
	}

	other := errors.New("boom")
	msg, isUser = errorString(other)
	if isUser || msg != "internal error" {
		t.Errorf("internal path: got (%q, %v), want (\"internal error\", false)", msg, isUser)
	}
}

func containsSub(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
