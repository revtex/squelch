package ws

import (
	"bytes"
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// drainFor collects every frame a client receives within d.
func drainFor(c *Client, d time.Duration) [][]byte {
	var got [][]byte
	deadline := time.After(d)
	for {
		select {
		case m := <-c.send:
			got = append(got, m)
		case <-deadline:
			return got
		}
	}
}

func anyContains(frames [][]byte, s string) bool {
	for _, f := range frames {
		if bytes.Contains(f, []byte(s)) {
			return true
		}
	}
	return false
}

// A transcript must reach only the clients allowed to receive its call.
func TestBroadcastTRN_RespectsGrants(t *testing.T) {
	hub, _ := newTestHub(t)

	open := &Client{hub: hub, send: make(chan []byte, sendBufSize)}
	tgRestricted := &Client{hub: hub, send: make(chan []byte, sendBufSize),
		grants: []systemGrant{{ID: 1, Talkgroups: []int64{10}}}}
	otherSystem := &Client{hub: hub, send: make(chan []byte, sendBufSize), protocolVersion: protocolV1,
		grants: []systemGrant{{ID: 2}}}
	for _, c := range []*Client{open, tgRestricted, otherSystem} {
		hub.Register(c)
	}
	waitForClientCount(t, hub, 3, 2*time.Second)

	hub.BroadcastTRN(900, 1, 99, "TRN-SECRET-TEXT", nil)

	if !anyContains(drainFor(open, 300*time.Millisecond), "TRN-SECRET-TEXT") {
		t.Error("unrestricted client did not receive the transcript")
	}
	if anyContains(drainFor(tgRestricted, 100*time.Millisecond), "TRN-SECRET-TEXT") {
		t.Error("client restricted to another talkgroup received the transcript")
	}
	if anyContains(drainFor(otherSystem, 100*time.Millisecond), "TRN-SECRET-TEXT") {
		t.Error("v1 client restricted to another system received the transcript")
	}
}

// scanner.config must list only the systems and talkgroups a restricted
// listener is granted, both in the welcome payload and on rebroadcast.
func TestCFG_ScopedToGrants(t *testing.T) {
	hub, _ := newTestHub(t)
	ctx := context.Background()
	q := hub.queries

	sysA, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 11, Label: "SYS-A-VISIBLE"})
	if err != nil {
		t.Fatal(err)
	}
	sysB, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 22, Label: "SYS-B-HIDDEN"})
	if err != nil {
		t.Fatal(err)
	}
	tgVisible, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{SystemID: sysA, TalkgroupID: 7001,
		Label: sql.NullString{String: "TG-VISIBLE", Valid: true}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tg := range []struct {
		sys   int64
		label string
	}{{sysA, "TG-SAME-SYS-HIDDEN"}, {sysB, "TG-OTHER-SYS-HIDDEN"}} {
		if _, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{SystemID: tg.sys, TalkgroupID: 7002,
			Label: sql.NullString{String: tg.label, Valid: true}}); err != nil {
			t.Fatal(err)
		}
	}
	grants := []systemGrant{{ID: sysA, Talkgroups: []int64{tgVisible}}}
	hidden := []string{"SYS-B-HIDDEN", "TG-SAME-SYS-HIDDEN", "TG-OTHER-SYS-HIDDEN"}

	legacy, v1, err := buildCFGFrames(ctx, q, grants)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range [][]byte{legacy, v1} {
		if !bytes.Contains(f, []byte("TG-VISIBLE")) {
			t.Errorf("scoped config is missing the granted talkgroup: %s", f)
		}
		for _, h := range hidden {
			if bytes.Contains(f, []byte(h)) {
				t.Errorf("scoped config leaks %s", h)
			}
		}
	}

	restricted := &Client{hub: hub, send: make(chan []byte, sendBufSize), protocolVersion: protocolV1, grants: grants}
	open := &Client{hub: hub, send: make(chan []byte, sendBufSize)}
	hub.Register(restricted)
	hub.Register(open)
	waitForClientCount(t, hub, 2, 2*time.Second)

	hub.BroadcastCFG(ctx)

	got := drainFor(restricted, 300*time.Millisecond)
	if !anyContains(got, "TG-VISIBLE") {
		t.Fatal("restricted client received no scoped config on rebroadcast")
	}
	for _, h := range hidden {
		if anyContains(got, h) {
			t.Errorf("rebroadcast config to restricted client leaks %s", h)
		}
	}
	if !anyContains(drainFor(open, 300*time.Millisecond), "SYS-B-HIDDEN") {
		t.Error("unrestricted client did not receive the full config")
	}
}

func TestHub_DisconnectAnonymous_LeavesAuthenticated(t *testing.T) {
	hub, _ := newTestHub(t)
	anon := &Client{hub: hub, send: make(chan []byte, sendBufSize)}
	user := &Client{hub: hub, send: make(chan []byte, sendBufSize), userID: 7}
	hub.Register(anon)
	hub.Register(user)
	waitForClientCount(t, hub, 2, 2*time.Second)

	hub.DisconnectAnonymous()
	waitForClientCount(t, hub, 1, 2*time.Second)

	hub.mu.RLock()
	_, userStill := hub.clients[user]
	hub.mu.RUnlock()
	if !userStill {
		t.Error("authenticated listener was disconnected")
	}
}
