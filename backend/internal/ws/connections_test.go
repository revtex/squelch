package ws

import (
	"context"
	"net/netip"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
)

// newRegistryHub is newTestHub with a connection registry attached. The
// registry must be set before Run starts, so it cannot reuse newTestHub.
func newRegistryHub(t *testing.T) (*Hub, *connections.Registry) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	hub := NewHub(db.New(sqlDB), "test")
	reg := connections.New()
	hub.SetConnections(reg)
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)
	t.Cleanup(cancel)
	return hub, reg
}

func waitForRegistryLen(t *testing.T, reg *connections.Registry, want int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for reg.Len() != want {
		if time.Now().After(deadline) {
			t.Fatalf("registry Len = %d, want %d", reg.Len(), want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestHub_ReportsClientsToRegistry(t *testing.T) {
	hub, reg := newRegistryHub(t)
	ip := netip.MustParseAddr("203.0.113.9")
	listener := &Client{
		hub: hub, send: make(chan []byte, sendBufSize),
		connID: "conn-l", userID: 7, username: "alice", role: "listener",
		jti: "jti-l", familyID: "fam-1", protocolVersion: protocolV1,
		remote: connections.Client{IP: ip, Peer: netip.MustParseAddr("10.0.0.2"), UserAgent: "ua"},
	}
	admin := &Client{
		hub: hub, send: make(chan []byte, sendBufSize), isAdmin: true,
		connID: "conn-a", userID: 1, username: "root", role: "admin",
	}
	hub.Register(listener)
	hub.Register(admin)
	waitForRegistryLen(t, reg, 2)

	byID := map[string]connections.Conn{}
	for _, c := range reg.List() {
		byID[c.ID] = c
	}
	l := byID["conn-l"]
	if l.Kind != connections.KindListener || l.UserID != 7 || l.Username != "alice" ||
		l.FamilyID != "fam-1" || l.JTI != "jti-l" || l.IP != ip || l.Protocol != protocolV1 {
		t.Errorf("listener entry = %+v", l)
	}
	if byID["conn-a"].Kind != connections.KindAdmin {
		t.Errorf("admin entry kind = %q, want admin", byID["conn-a"].Kind)
	}

	hub.Unregister(listener)
	waitForRegistryLen(t, reg, 1)
	if reg.List()[0].ID != "conn-a" {
		t.Errorf("remaining entry = %q, want conn-a", reg.List()[0].ID)
	}
}

// Closing through the registry is how the admin will end one connection:
// that client must get the session-expired frame and leave the hub, and
// nobody else may be touched.
func TestHub_RegistryCloseEndsOnlyThatClient(t *testing.T) {
	hub, reg := newRegistryHub(t)
	target := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "t", userID: 3, protocolVersion: protocolV1}
	other := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "o", userID: 3, protocolVersion: protocolV1}
	hub.Register(target)
	hub.Register(other)
	waitForRegistryLen(t, reg, 2)

	if !reg.Close("t") {
		t.Fatal("Close(t) = false, want true")
	}
	waitForClientCount(t, hub, 1, 2*time.Second)
	waitForRegistryLen(t, reg, 1)

	want, _ := NewSessionExpiredV1()
	select {
	case got := <-target.send:
		if string(got) != string(want) {
			t.Errorf("target got %s, want session-expired", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("target got no session-expired frame")
	}
	select {
	case got := <-other.send:
		t.Fatalf("other client received %s", got)
	case <-time.After(50 * time.Millisecond):
	}
}

// One access token can hold several sockets; logging out must end them all.
func TestHub_DisconnectByJTI_ClosesEveryMatchingSession(t *testing.T) {
	hub, reg := newRegistryHub(t)
	a := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "a", userID: 4, jti: "shared"}
	b := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "b", userID: 4, jti: "shared", isAdmin: true}
	c := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "c", userID: 4, jti: "other"}
	for _, cl := range []*Client{a, b, c} {
		hub.Register(cl)
	}
	// ClientCount counts listeners only, and b is an admin socket.
	waitForRegistryLen(t, reg, 3)

	hub.DisconnectByJTI("shared")
	waitForRegistryLen(t, reg, 1)
	if reg.List()[0].ID != "c" {
		t.Errorf("survivor = %q, want c", reg.List()[0].ID)
	}
}

// An empty JTI names no session. Before, it matched the first anonymous
// listener, whose jti is also empty.
func TestHub_DisconnectByJTI_EmptyIsNoop(t *testing.T) {
	hub, _ := newRegistryHub(t)
	anon := &Client{hub: hub, send: make(chan []byte, sendBufSize), connID: "anon"}
	hub.Register(anon)
	waitForClientCount(t, hub, 1, 2*time.Second)

	hub.DisconnectByJTI("")
	time.Sleep(50 * time.Millisecond)
	if n := hub.ClientCount(); n != 1 {
		t.Fatalf("ClientCount = %d, want 1: empty JTI disconnected an anonymous listener", n)
	}
}
