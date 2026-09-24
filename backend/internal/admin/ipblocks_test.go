package admin

import (
	"context"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/ipblock"
)

// blockingOps returns operations with blocking on, 198.51.100.7 trusted,
// and the calling admin connected from 192.0.2.10.
func blockingOps(t *testing.T) (*Operations, *connections.Registry, *reasonLog, context.Context) {
	t.Helper()
	ops, q := newTestOperations(t, "")
	seedSessionUser(t, q, "root") // id 1, the caller
	ops.Events = &recordingSink{}
	ops.Deps.IPBlocks = ipblock.New([]netip.Prefix{netip.MustParsePrefix("198.51.100.7/32")})
	reg, log := newRegistry(ops)
	addLive(reg, connections.Conn{
		ID: "me", Kind: connections.KindAdmin, UserID: 1, Username: "root",
		Client: connections.Client{IP: netip.MustParseAddr("192.0.2.10"), Peer: netip.MustParseAddr("192.0.2.10")},
	})
	ctx := WithCaller(context.Background(), Caller{ConnID: "me"})
	return ops, reg, log, ctx
}

func conn(id, ip string) connections.Conn {
	a := netip.MustParseAddr(ip)
	return connections.Conn{ID: id, Kind: connections.KindListener, Client: connections.Client{IP: a, Peer: a}}
}

func TestIPBlocksCreate_BlocksAndDropsLiveConnections(t *testing.T) {
	ops, reg, log, ctx := blockingOps(t)
	addLive(reg, conn("bad", "203.0.113.9"))
	addLive(reg, conn("good", "203.0.114.9"))

	res, err := ops.IPBlocksCreate(ctx, params(t, map[string]any{
		"address": "203.0.113.0/24", "reason": "scraping",
	}), 1)
	if err != nil {
		t.Fatalf("IPBlocksCreate: %v", err)
	}
	if out := toJSON(t, res); !strings.Contains(out, `"cidr":"203.0.113.0/24"`) || !strings.Contains(out, `"closed":1`) {
		t.Fatalf("result = %s", out)
	}
	if !ops.Deps.IPBlocks.Blocked(netip.MustParseAddr("203.0.113.50"), netip.MustParseAddr("203.0.113.50")) {
		t.Fatal("block is not in force")
	}
	if _, ok := reg.Get("bad"); ok {
		t.Fatal("connection from the blocked range is still live")
	}
	if _, ok := reg.Get("good"); !ok {
		t.Fatal("connection outside the range was dropped")
	}
	if got, _ := log.get("bad"); got != connections.ReasonBlocked {
		t.Fatalf("close reason = %q, want %q", got, connections.ReasonBlocked)
	}
	if msg := lastLogMessage(t, ops); msg != "admin: blocked 203.0.113.0/24 by root (scraping)" {
		t.Fatalf("audit line = %q", msg)
	}

	_, err = ops.IPBlocksCreate(ctx, params(t, map[string]any{"address": "203.0.113.0/24"}), 1)
	if msg, isUser := errorString(err); !isUser || !strings.Contains(msg, "already blocked") {
		t.Fatalf("duplicate err = %v", err)
	}
}

func TestIPBlocksCreate_GuardsReturnUserErrors(t *testing.T) {
	ops, _, _, ctx := blockingOps(t)
	past := time.Now().Add(-time.Minute).Unix()
	cases := []struct {
		params  map[string]any
		mention string
	}{
		{map[string]any{"address": "10.0.0.0/8"}, "too wide"},
		{map[string]any{"address": "203.0.113.9/24"}, "203.0.113.0/24"},
		{map[string]any{"address": "127.0.0.1"}, "loopback"},
		{map[string]any{"address": "198.51.100.0/24"}, "trusted address 198.51.100.7/32"},
		{map[string]any{"address": "203.0.113.9", "expiresAt": past}, "future"},
		{map[string]any{"address": "203.0.113.9", "reason": strings.Repeat("x", 201)}, "at most 200"},
	}
	for _, tc := range cases {
		_, err := ops.IPBlocksCreate(ctx, params(t, tc.params), 1)
		msg, isUser := errorString(err)
		if !isUser || !strings.Contains(msg, tc.mention) {
			t.Errorf("%v: err = %v, want a user error mentioning %q", tc.params, err, tc.mention)
		}
	}
}

func TestIPBlocksCreate_OwnAddressNeedsConfirmation(t *testing.T) {
	ops, reg, _, ctx := blockingOps(t)

	res, err := ops.IPBlocksCreate(ctx, params(t, map[string]any{"address": "192.0.2.0/24"}), 1)
	if err != nil {
		t.Fatalf("IPBlocksCreate: %v", err)
	}
	out := toJSON(t, res)
	if !strings.Contains(out, `"needsConfirm":true`) || !strings.Contains(out, "192.0.2.10") {
		t.Fatalf("result = %s, want a confirmation naming the caller's address", out)
	}
	if ops.Deps.IPBlocks.Blocked(netip.MustParseAddr("192.0.2.10"), netip.MustParseAddr("192.0.2.10")) {
		t.Fatal("block created without confirmation")
	}

	if _, err := ops.IPBlocksCreate(ctx, params(t, map[string]any{"address": "192.0.2.0/24", "force": true}), 1); err != nil {
		t.Fatalf("forced IPBlocksCreate: %v", err)
	}
	if _, ok := reg.Get("me"); ok {
		t.Fatal("the caller's own connection survived a block of its address")
	}
}

func TestIPBlocksListAndDelete(t *testing.T) {
	ops, _, _, ctx := blockingOps(t)
	res, err := ops.IPBlocksCreate(ctx, params(t, map[string]any{"address": "203.0.113.9"}), 1)
	if err != nil {
		t.Fatalf("IPBlocksCreate: %v", err)
	}
	id := res.(map[string]any)["id"]

	list, err := ops.IPBlocksList(ctx, nil, 1)
	if err != nil {
		t.Fatalf("IPBlocksList: %v", err)
	}
	out := toJSON(t, list)
	for _, want := range []string{`"cidr":"203.0.113.9/32"`, `"trusted":["127.0.0.0/8","::1/128","198.51.100.7/32"]`, `"yourAddress":"192.0.2.10"`, `"enabled":true`} {
		if !strings.Contains(out, want) {
			t.Errorf("list missing %s: %s", want, out)
		}
	}

	if _, err := ops.IPBlocksDelete(ctx, params(t, map[string]any{"id": id}), 1); err != nil {
		t.Fatalf("IPBlocksDelete: %v", err)
	}
	if ops.Deps.IPBlocks.Blocked(netip.MustParseAddr("203.0.113.9"), netip.MustParseAddr("203.0.113.9")) {
		t.Fatal("block still in force after delete")
	}
	if msg := lastLogMessage(t, ops); msg != "admin: unblocked 203.0.113.9/32 by root" {
		t.Fatalf("audit line = %q", msg)
	}
	_, err = ops.IPBlocksDelete(ctx, params(t, map[string]any{"id": id}), 1)
	if _, isUser := errorString(err); !isUser {
		t.Fatalf("second delete err = %v, want a user error", err)
	}
}

func TestConnectionRows_CarryTheTrustedFlag(t *testing.T) {
	ops, reg, _, ctx := blockingOps(t)
	addLive(reg, conn("trusted", "198.51.100.7"))
	addLive(reg, conn("loop", "127.0.0.1"))
	forgedLoop := connections.Conn{ID: "forged", Kind: connections.KindListener, Client: connections.Client{
		IP: netip.MustParseAddr("127.0.0.1"), Peer: netip.MustParseAddr("192.168.1.50"),
	}}
	addLive(reg, forgedLoop)

	res, err := ops.ConnectionsList(ctx, nil, 1)
	if err != nil {
		t.Fatalf("ConnectionsList: %v", err)
	}
	want := map[string]bool{"me": false, "trusted": true, "loop": true, "forged": false}
	for _, c := range res.(map[string]any)["connections"].([]map[string]any) {
		id := c["id"].(string)
		if got := c["trusted"].(bool); got != want[id] {
			t.Errorf("%s trusted = %v, want %v", id, got, want[id])
		}
	}
}
