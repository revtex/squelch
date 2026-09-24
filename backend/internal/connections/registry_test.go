package connections

import (
	"context"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRegistry_AddListRemove(t *testing.T) {
	r := New()
	t0 := time.Unix(1000, 0)
	r.Add(Conn{ID: "b", Kind: KindStream, ConnectedAt: t0.Add(time.Second)}, nil)
	r.Add(Conn{ID: "a", Kind: KindListener, ConnectedAt: t0}, nil)

	got := r.List()
	if len(got) != 2 || got[0].ID != "a" || got[1].ID != "b" {
		t.Fatalf("List = %+v, want a then b (oldest first)", got)
	}

	r.Remove("a")
	r.Remove("a") // second teardown path: must be harmless
	r.Remove("unknown")
	if r.Len() != 1 {
		t.Fatalf("Len = %d, want 1", r.Len())
	}
}

func TestRegistry_AddFillsIDAndTime(t *testing.T) {
	r := New()
	id := r.Add(Conn{Kind: KindAdmin}, nil)
	if id == "" {
		t.Fatal("Add returned empty ID")
	}
	c := r.List()[0]
	if c.ID != id || c.ConnectedAt.IsZero() {
		t.Fatalf("stored conn = %+v, want ID %q and a connect time", c, id)
	}
}

func TestRegistry_ListReturnsCopies(t *testing.T) {
	r := New()
	r.Add(Conn{ID: "a", Username: "alice"}, nil)
	r.List()[0].Username = "mallory"
	if got := r.List()[0].Username; got != "alice" {
		t.Fatalf("Username = %q after mutating a listed copy, want alice", got)
	}
}

func TestRegistry_CloseWhere(t *testing.T) {
	r := New()
	var closed []string
	add := func(id string, user int64) {
		r.Add(Conn{ID: id, UserID: user}, func() { closed = append(closed, id) })
	}
	add("a", 1)
	add("b", 2)
	add("c", 1)

	if n := r.CloseWhere(func(c Conn) bool { return c.UserID == 1 }); n != 2 {
		t.Fatalf("CloseWhere = %d, want 2", n)
	}
	if len(closed) != 2 || strings.Contains(strings.Join(closed, ","), "b") {
		t.Fatalf("closed = %v, want a and c only", closed)
	}
	if !r.Close("b") {
		t.Fatal("Close(b) = false, want true")
	}
	if r.Close("zzz") {
		t.Fatal("Close(unknown) = true, want false")
	}
}

// A transport's close func tears the connection down, and that teardown
// calls Remove. Running close under the registry lock would deadlock.
func TestRegistry_CloseFuncMayRemove(t *testing.T) {
	r := New()
	r.Add(Conn{ID: "a"}, func() { r.Remove("a") })

	done := make(chan struct{})
	go func() {
		r.Close("a")
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Close deadlocked when the close func called Remove")
	}
	if r.Len() != 0 {
		t.Fatalf("Len = %d, want 0", r.Len())
	}
}

func TestRegistry_OnChangeDebounced(t *testing.T) {
	r := New()
	r.debounce = 20 * time.Millisecond
	var fired atomic.Int32
	r.SetOnChange(func() { fired.Add(1) })

	for i := 0; i < 10; i++ {
		id := r.Add(Conn{}, nil)
		r.Remove(id)
	}
	time.Sleep(100 * time.Millisecond)
	if n := fired.Load(); n != 1 {
		t.Fatalf("onChange fired %d times for one burst, want 1", n)
	}

	r.Add(Conn{}, nil)
	time.Sleep(100 * time.Millisecond)
	if n := fired.Load(); n != 2 {
		t.Fatalf("onChange fired %d times after a second burst, want 2", n)
	}
}

func TestRegistry_NilIsNoop(t *testing.T) {
	var r *Registry
	r.SetOnChange(func() {})
	if id := r.Add(Conn{ID: "x"}, nil); id != "x" {
		t.Fatalf("nil Add = %q, want the given ID back", id)
	}
	r.Remove("x")
	if r.Len() != 0 || r.List() != nil || r.Close("x") || r.CloseWhere(func(Conn) bool { return true }) != 0 {
		t.Fatal("nil registry should report nothing")
	}
}

func TestClientFromRequest(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		resolved   string
		wantIP     string
		wantPeer   string
	}{
		{"direct", "198.51.100.4:5555", "198.51.100.4", "198.51.100.4", "198.51.100.4"},
		{"through proxy", "10.0.0.2:5555", "203.0.113.9", "203.0.113.9", "10.0.0.2"},
		{"unparseable resolved falls back to peer", "10.0.0.2:5555", "", "10.0.0.2", "10.0.0.2"},
		{"v4-mapped v6 is unmapped", "[::ffff:192.0.2.1]:80", "::ffff:192.0.2.1", "192.0.2.1", "192.0.2.1"},
		{"ipv6", "[2001:db8::1]:443", "2001:db8::1", "2001:db8::1", "2001:db8::1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tc.remoteAddr
			req.Header.Set("User-Agent", "test-agent")
			c := ClientFromRequest(req, tc.resolved)
			if c.IP != netip.MustParseAddr(tc.wantIP) {
				t.Errorf("IP = %v, want %s", c.IP, tc.wantIP)
			}
			if c.Peer != netip.MustParseAddr(tc.wantPeer) {
				t.Errorf("Peer = %v, want %s", c.Peer, tc.wantPeer)
			}
			if c.UserAgent != "test-agent" {
				t.Errorf("UserAgent = %q", c.UserAgent)
			}
		})
	}
}

func TestClientFromRequest_CapsUserAgent(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("User-Agent", strings.Repeat("é", maxUserAgentLen)) // 2 bytes each
	ua := ClientFromRequest(req, "").UserAgent
	if len(ua) > maxUserAgentLen {
		t.Fatalf("len(UserAgent) = %d, want <= %d", len(ua), maxUserAgentLen)
	}
	if !strings.HasPrefix(strings.Repeat("é", maxUserAgentLen), ua) {
		t.Fatal("capped User-Agent is not a clean prefix of the original")
	}
}

func TestClientContextRoundTrip(t *testing.T) {
	want := Client{IP: netip.MustParseAddr("192.0.2.7"), UserAgent: "x"}
	if got := ClientFrom(WithClient(context.Background(), want)); got != want {
		t.Fatalf("ClientFrom = %+v, want %+v", got, want)
	}
	if got := ClientFrom(context.Background()); got != (Client{}) {
		t.Fatalf("ClientFrom(empty) = %+v, want zero", got)
	}
}

type recordingObserver struct {
	mu     sync.Mutex
	r      *Registry
	opened []string
	closed []string // "id:reason"
}

func (o *recordingObserver) Opened(c Conn) {
	_ = o.r.Len() // must not deadlock: called outside the registry lock
	o.mu.Lock()
	o.opened = append(o.opened, c.ID)
	o.mu.Unlock()
}

func (o *recordingObserver) Closed(c Conn, reason string, _ time.Time) {
	_ = o.r.Len()
	o.mu.Lock()
	o.closed = append(o.closed, c.ID+":"+reason)
	o.mu.Unlock()
}

func TestRegistry_ObserverSeesOpenAndCloseWithReason(t *testing.T) {
	r := New()
	obs := &recordingObserver{r: r}
	r.SetObserver(obs)

	r.Add(Conn{ID: "a"}, nil)
	r.Add(Conn{ID: "b"}, nil)
	r.Remove("a")
	r.SetCloseReason("b", ReasonSignout)
	r.Remove("b")
	r.Remove("b") // already gone: no second close

	if got := strings.Join(obs.opened, ","); got != "a,b" {
		t.Errorf("opened = %s, want a,b", got)
	}
	if got := strings.Join(obs.closed, ","); got != "a:client,b:signout" {
		t.Errorf("closed = %s, want a:client,b:signout", got)
	}
}
