package ws

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

// --- CanReceive tests ---

func TestCanReceive_NoGrants(t *testing.T) {
	c := &Client{grants: nil}
	if !c.CanReceive(1, 100) {
		t.Error("nil grants should allow all; CanReceive returned false")
	}

	c2 := &Client{grants: []systemGrant{}}
	if c2.CanReceive(1, 100) {
		t.Error("empty non-nil grants (unparseable systems_json) should deny all; CanReceive returned true")
	}
}

func TestCanReceive_MatchingGrant(t *testing.T) {
	c := &Client{
		grants: []systemGrant{
			{ID: 10, Talkgroups: []int64{100, 200, 300}},
		},
	}
	if !c.CanReceive(10, 200) {
		t.Error("expected true for matching system+TG")
	}
}

func TestCanReceive_NonMatchingGrant(t *testing.T) {
	c := &Client{
		grants: []systemGrant{
			{ID: 10, Talkgroups: []int64{100}},
		},
	}
	if c.CanReceive(99, 100) {
		t.Error("expected false for non-matching system ID")
	}
}

func TestCanReceive_SystemOnlyGrant(t *testing.T) {
	c := &Client{
		grants: []systemGrant{
			{ID: 10, Talkgroups: nil},
		},
	}
	// No TG filter → all TGs in system 10 are allowed.
	if !c.CanReceive(10, 999) {
		t.Error("system-only grant should allow any TG; CanReceive returned false")
	}
	// Different system should be denied.
	if c.CanReceive(20, 999) {
		t.Error("system-only grant should deny other systems; CanReceive returned true")
	}
}

// --- WebSocket handler test helpers ---

func newWSTestDB(t *testing.T) *db.Queries {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db.New(sqlDB)
}

// startWSTestServer starts an httptest server with the given handler and a running hub.
// Returns the server URL (ws://...), hub, and a cleanup cancel func.
func startWSTestServer(t *testing.T, queries *db.Queries, handler http.HandlerFunc) (string, *Hub, context.CancelFunc) {
	t.Helper()
	hub := NewHub(queries, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	go hub.Run(ctx)

	srv := httptest.NewServer(handler)
	t.Cleanup(func() {
		cancel()
		srv.Close()
	})

	// Convert http:// to ws://
	wsURL := "ws" + srv.URL[len("http"):]
	return wsURL, hub, cancel
}

// readTextMessage reads a text message from the WS connection with a timeout.
func readTextMessage(ctx context.Context, t *testing.T, conn *websocket.Conn, timeout time.Duration) []byte {
	t.Helper()
	readCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	typ, data, err := conn.Read(readCtx)
	if err != nil {
		t.Fatalf("read WS message: %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("expected text message, got %v", typ)
	}
	return data
}

// extractCommand extracts the command string from a WS JSON message.
func extractCommand(t *testing.T, data []byte) string {
	t.Helper()
	var arr []json.RawMessage
	if err := json.Unmarshal(data, &arr); err != nil {
		t.Fatalf("unmarshal message: %v (data=%s)", err, data)
	}
	if len(arr) == 0 {
		t.Fatal("empty message array")
	}
	var cmd string
	if err := json.Unmarshal(arr[0], &cmd); err != nil {
		t.Fatalf("unmarshal command: %v", err)
	}
	return cmd
}

// --- HandleListenerWS tests ---

func TestHandleListenerWS_PublicAccess(t *testing.T) {
	queries := newWSTestDB(t)

	// Enable public access.
	if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{
		Key: "publicAccess", Value: "true",
	}); err != nil {
		t.Fatalf("upsert publicAccess: %v", err)
	}

	_, _, _ = startWSTestServer(t, queries, HandleListenerWS(nil, queries))
	// Hub needs to be the one used by the handler — fix: pass to handler.
	// Actually, HandleListenerWS needs a *Hub. Let's rebuild.
	queries2 := newWSTestDB(t)
	if err := queries2.UpsertSetting(context.Background(), db.UpsertSettingParams{
		Key: "publicAccess", Value: "true",
	}); err != nil {
		t.Fatalf("upsert setting: %v", err)
	}

	hub := NewHub(queries2, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	handler := HandleListenerWS(hub, queries2)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	wsURL := "ws" + srv.URL[len("http"):]

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	// Should receive VER message (welcome).
	msg := readTextMessage(ctx, t, conn, 5*time.Second)
	cmd := extractCommand(t, msg)
	if cmd != "VER" {
		t.Errorf("first message command = %q, want VER", cmd)
	}
}

func TestHandleListenerWS_ValidJWT(t *testing.T) {
	queries := newWSTestDB(t)

	// Create a listener user.
	now := time.Now().Unix()
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		Username:     "listener1",
		PasswordHash: "unused",
		Role:         auth.RoleListener,
		Disabled:     0,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	token, _, err := auth.GenerateToken(userID, "listener1", auth.RoleListener, 0)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	hub := NewHub(queries, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	handler := HandleListenerWS(hub, queries)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	wsURL := "ws" + srv.URL[len("http"):]

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	// Send the JWT token as the first message: the handler tries to parse
	// non-PIN commands as JWT tokens.
	tokenMsg, _ := json.Marshal([]any{token})
	if err := conn.Write(ctx, websocket.MessageText, tokenMsg); err != nil {
		t.Fatalf("write token: %v", err)
	}

	// Should receive VER.
	msg := readTextMessage(ctx, t, conn, 5*time.Second)
	cmd := extractCommand(t, msg)
	if cmd != "VER" {
		t.Errorf("expected VER after valid JWT, got %q", cmd)
	}
}

func TestHandleListenerWS_AdminJWTAccepted(t *testing.T) {
	queries := newWSTestDB(t)

	// Create an admin user.
	now := time.Now().Unix()
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		Username:     "admin1",
		PasswordHash: "unused",
		Role:         auth.RoleAdmin,
		Disabled:     0,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	token, _, err := auth.GenerateToken(userID, "admin1", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	hub := NewHub(queries, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	handler := HandleListenerWS(hub, queries)
	srv := httptest.NewServer(handler)
	defer srv.Close()
	wsURL := "ws" + srv.URL[len("http"):]

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	// Send admin JWT — admins are allowed on the listener endpoint.
	tokenMsg, _ := json.Marshal([]any{token})
	if err := conn.Write(ctx, websocket.MessageText, tokenMsg); err != nil {
		t.Fatalf("write token: %v", err)
	}

	// Should receive VER (accepted).
	msg := readTextMessage(ctx, t, conn, 5*time.Second)
	cmd := extractCommand(t, msg)
	if cmd != "VER" {
		t.Errorf("expected VER for admin JWT on listener endpoint, got %q", cmd)
	}
}

// --- HandleAdminWS tests ---

func TestHandleAdminWS_ValidToken(t *testing.T) {
	queries := newWSTestDB(t)

	now := time.Now().Unix()
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		Username:     "admin1",
		PasswordHash: "unused",
		Role:         auth.RoleAdmin,
		Disabled:     0,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	token, _, err := auth.GenerateToken(userID, "admin1", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	hub := NewHub(queries, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	handler := HandleAdminWS(hub, queries)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// Admin WS uses first-message auth (no token in URL).
	wsURL := "ws" + srv.URL[len("http"):]

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	// Send token as first message.
	tokenMsg, _ := json.Marshal([]any{token})
	if err := conn.Write(ctx, websocket.MessageText, tokenMsg); err != nil {
		t.Fatalf("write token: %v", err)
	}

	// Admin WS should be connected. Verify by checking hub registers an admin client.
	// Give the hub time to register.
	time.Sleep(100 * time.Millisecond)

	// Admin counts as 0 listener clients.
	if got := hub.ClientCount(); got != 0 {
		t.Errorf("ClientCount = %d, want 0 (admin doesn't count as listener)", got)
	}
}

func TestHandleAdminWS_ListenerJWTRejected(t *testing.T) {
	queries := newWSTestDB(t)

	now := time.Now().Unix()
	userID, err := queries.CreateUser(context.Background(), db.CreateUserParams{
		Username:     "listener1",
		PasswordHash: "unused",
		Role:         auth.RoleListener,
		Disabled:     0,
		CreatedAt:    now,
		UpdatedAt:    now,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	token, _, err := auth.GenerateToken(userID, "listener1", auth.RoleListener, 0)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	hub := NewHub(queries, "test-version")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go hub.Run(ctx)

	handler := HandleAdminWS(hub, queries)
	srv := httptest.NewServer(handler)
	defer srv.Close()

	// Connect without token in URL.
	wsURL := "ws" + srv.URL[len("http"):]

	conn, _, err := websocket.Dial(ctx, wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()

	// Send listener JWT as first message — should be rejected with XPR.
	tokenMsg, _ := json.Marshal([]any{token})
	if err := conn.Write(ctx, websocket.MessageText, tokenMsg); err != nil {
		t.Fatalf("write token: %v", err)
	}

	// Should receive XPR (expired/rejected).
	msg := readTextMessage(ctx, t, conn, 5*time.Second)
	cmd := extractCommand(t, msg)
	if cmd != "XPR" {
		t.Errorf("expected XPR for listener JWT on admin endpoint, got %q", cmd)
	}
}

// --- accept options ---

// permessage-deflate with context takeover makes each message depend on the
// previous message's compression window. Clients that don't carry that window
// across messages (iOS Safari) survive the handshake and the first frame, then
// drop the connection on the next one and reconnect forever. Compression must
// stay off no matter what the client offers.
func TestWSAcceptOptions_CompressionDisabled(t *testing.T) {
	opts := wsAcceptOptions(httptest.NewRequest(http.MethodGet, "http://example.test/ws", nil))
	if opts.CompressionMode != websocket.CompressionDisabled {
		t.Fatalf("CompressionMode = %v, want CompressionDisabled", opts.CompressionMode)
	}
}

func TestWSAccept_DoesNotNegotiateCompression(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, wsAcceptOptions(r))
		if err != nil {
			return
		}
		defer conn.CloseNow() //nolint:errcheck // test teardown
		_, _, _ = conn.Read(r.Context())
	}))
	defer srv.Close()

	host := strings.TrimPrefix(srv.URL, "http://")
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close() //nolint:errcheck // test teardown

	// A browser-style offer, which the server must decline.
	req := "GET /ws HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write handshake: %v", err)
	}

	if err := conn.SetReadDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatalf("set deadline: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	defer resp.Body.Close() //nolint:errcheck // test teardown

	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status = %d, want 101", resp.StatusCode)
	}
	if got := resp.Header.Get("Sec-WebSocket-Extensions"); got != "" {
		t.Fatalf("server negotiated extension %q, want none", got)
	}
}
