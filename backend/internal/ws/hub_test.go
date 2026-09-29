package ws

import (
	"context"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

func newTestHub(t *testing.T) (*Hub, context.CancelFunc) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	queries := db.New(sqlDB)

	hub := NewHub(queries, "test")
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)
	t.Cleanup(cancel)
	return hub, cancel
}

// waitForClientCount waits until the hub reports the expected listener count
// (non-admin clients) or the timeout expires.
func waitForClientCount(t *testing.T, hub *Hub, want int, timeout time.Duration) {
	t.Helper()
	deadline := time.After(timeout)
	for {
		if hub.ClientCount() == want {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("timed out waiting for client count %d, got %d", want, hub.ClientCount())
		default:
			time.Sleep(5 * time.Millisecond)
		}
	}
}

func TestHub_RegisterUnregister(t *testing.T) {
	hub, _ := newTestHub(t)

	c := &Client{
		hub:  hub,
		send: make(chan []byte, sendBufSize),
	}

	hub.Register(c)
	waitForClientCount(t, hub, 1, 2*time.Second)

	if got := hub.ClientCount(); got != 1 {
		t.Fatalf("ClientCount after register = %d, want 1", got)
	}

	hub.Unregister(c)
	waitForClientCount(t, hub, 0, 2*time.Second)

	if got := hub.ClientCount(); got != 0 {
		t.Fatalf("ClientCount after unregister = %d, want 0", got)
	}
}

func TestHub_Broadcast(t *testing.T) {
	hub, _ := newTestHub(t)

	c1 := &Client{hub: hub, send: make(chan []byte, sendBufSize)}
	c2 := &Client{hub: hub, send: make(chan []byte, sendBufSize)}

	hub.Register(c1)
	hub.Register(c2)
	waitForClientCount(t, hub, 2, 2*time.Second)

	msg := []byte(`["TEST","hello"]`)
	hub.Broadcast(msg, nil)

	// Read from both channels with timeout.
	for i, c := range []*Client{c1, c2} {
		select {
		case got := <-c.send:
			if string(got) != string(msg) {
				t.Errorf("client %d: got %q, want %q", i, got, msg)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("client %d: timed out waiting for broadcast", i)
		}
	}
}

func TestHub_BroadcastWithFilter(t *testing.T) {
	hub, _ := newTestHub(t)

	cAdmin := &Client{hub: hub, send: make(chan []byte, sendBufSize), isAdmin: true}
	cListener := &Client{hub: hub, send: make(chan []byte, sendBufSize), isAdmin: false}

	hub.Register(cAdmin)
	hub.Register(cListener)
	// Admin doesn't count as listener, so expect 1.
	waitForClientCount(t, hub, 1, 2*time.Second)

	msg := []byte(`["LSC",1]`)
	// Filter to only non-admin clients.
	hub.Broadcast(msg, func(c *Client) bool {
		return !c.isAdmin
	})

	// Listener should receive the message.
	select {
	case got := <-cListener.send:
		if string(got) != string(msg) {
			t.Errorf("listener got %q, want %q", got, msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("listener timed out waiting for broadcast")
	}

	// Admin should NOT receive the message.
	select {
	case got := <-cAdmin.send:
		t.Errorf("admin should not have received message, got %q", got)
	case <-time.After(100 * time.Millisecond):
		// Expected — no message.
	}
}

func TestHub_NonBlockingSend(t *testing.T) {
	hub, _ := newTestHub(t)

	// Create a client with a buffer of 1 — fill it up.
	c := &Client{hub: hub, send: make(chan []byte, 1)}
	c.send <- []byte("filler")

	hub.Register(c)
	waitForClientCount(t, hub, 1, 2*time.Second)

	// Broadcast should not block even though the client's channel is full.
	done := make(chan struct{})
	go func() {
		hub.Broadcast([]byte(`["TEST"]`), nil)
		close(done)
	}()

	select {
	case <-done:
		// Broadcast returned without deadlock.
	case <-time.After(2 * time.Second):
		t.Fatal("Broadcast deadlocked on full send channel")
	}
}

func TestHub_GracefulShutdown(t *testing.T) {
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	defer sqlDB.Close()
	queries := db.New(sqlDB)

	hub := NewHub(queries, "test")
	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan struct{})
	go func() {
		hub.Run(ctx)
		close(done)
	}()

	cancel()

	select {
	case <-done:
		// Hub exited cleanly.
	case <-time.After(2 * time.Second):
		t.Fatal("Hub did not exit after context cancellation")
	}
}

type recordingRevoker struct {
	users []int64
	jtis  []string
}

func (r *recordingRevoker) DisconnectUser(id int64)  { r.users = append(r.users, id) }
func (r *recordingRevoker) DisconnectJTI(jti string) { r.jtis = append(r.jtis, jti) }

// Revoking a user or token through the hub must also end non-WebSocket
// sessions such as the audio stream.
func TestHub_DisconnectForwardsToSessionRevoker(t *testing.T) {
	h := NewHub(nil, "test")
	r := &recordingRevoker{}
	h.SetSessionRevoker(r)

	h.DisconnectByUser(42)
	h.DisconnectByJTI("jti-1")
	h.DisconnectByJTI("")

	if len(r.users) != 1 || r.users[0] != 42 {
		t.Errorf("DisconnectUser calls = %v, want [42]", r.users)
	}
	if len(r.jtis) != 1 || r.jtis[0] != "jti-1" {
		t.Errorf("DisconnectJTI calls = %v, want [jti-1]", r.jtis)
	}
}
