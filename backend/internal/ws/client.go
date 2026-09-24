// Package ws — WebSocket client connection (listener + admin).
package ws

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/logging"
)

const (
	writeWait   = 10 * time.Second
	pingPeriod  = 30 * time.Second
	sendBufSize = 256
	authTimeout = 10 * time.Second
	// maxListenerMessageSize caps inbound frames from listener clients.
	// Listeners only ever send tiny control frames (auth token, LFM updates),
	// so the limit stays small to bound memory per untrusted connection.
	maxListenerMessageSize = 4096
	// maxAdminMessageSize caps inbound frames from authenticated admin
	// clients. Admin operations (notably import.config) carry full backup
	// payloads — settings, systems, talkgroups, downstreams, API keys —
	// which routinely exceed the listener cap. Admins are authenticated
	// and trusted, so a much larger limit is acceptable here.
	maxAdminMessageSize = 16 << 20 // 16 MiB
	revalidatePeriod    = 5 * time.Minute
)

// Protocol version markers attached to a Client at connect time. The hub
// fan-out uses this to pick the correct wire encoding (legacy 3-letter
// array frames vs. native JSON-object frames). The empty string defaults
// to legacy for back-compat with code paths that don't set the field.
const (
	protocolLegacy = ""
	protocolV1     = "v1"
)

// systemGrant represents a system-level grant with optional talkgroup filtering.
type systemGrant = auth.SystemGrant

// Client represents a single WebSocket connection.
type Client struct {
	hub     *Hub
	conn    *websocket.Conn
	send    chan []byte
	grants  []systemGrant // nil = receive all; empty non-nil = receive nothing
	isAdmin bool
	userID  int64
	jti     string      // JWT token ID, for single-session disconnect
	queries *db.Queries // for periodic account revalidation

	// connID, remote, username, role and familyID describe the connection
	// to the admin's connection list. All are set before hub.Register and
	// never change afterwards.
	connID   string
	remote   connections.Client
	username string
	role     string
	familyID string

	// protocolVersion selects the on-wire encoding for messages sent to
	// this client. Set once at connect time by the handler that accepted
	// the upgrade; never mutated afterwards.
	protocolVersion string

	// Drop counter for slow-client telemetry. Incremented whenever a
	// broadcast / send-site drops a message because the send buffer is full.
	dropCount atomic.Int64

	// closeOnce ensures c.send is closed exactly once even if multiple
	// shutdown paths race (hub unregister + closeAll, stale Register after
	// shutdown, etc.). See trySend for the panic-safe write counterpart.
	closeOnce sync.Once
}

// closeSend closes c.send at most once. Safe to call from any goroutine.
func (c *Client) closeSend() {
	c.closeOnce.Do(func() { close(c.send) })
}

// trySend enqueues data on c.send without blocking. If the buffer is full
// the message is dropped and the drop counter is incremented (with a periodic
// warning log). Writes to a closed channel are recovered so a racing
// shutdown path cannot crash the process.
func (c *Client) trySend(data []byte) {
	defer func() {
		// Recover silently from "send on closed channel" — the connection is
		// already shutting down and the message is discarded. Any other panic
		// type would bubble up normally since this is a deferred recover.
		_ = recover()
	}()
	select {
	case c.send <- data:
	default:
		n := c.dropCount.Add(1)
		if n%100 == 0 {
			slog.Warn("ws: slow client dropping messages",
				"client_ptr", fmt.Sprintf("%p", c),
				"user_id", c.userID,
				"is_admin", c.isAdmin,
				"drop_count", n,
			)
		}
	}
}

// adminRequest is the envelope for admin WS request messages.
type adminRequest struct {
	ReqID  string          `json:"reqId"`
	Op     string          `json:"op"`
	Params json.RawMessage `json:"params,omitempty"`
}

// isV1 reports whether this client negotiated the native v1 protocol.
func (c *Client) isV1() bool { return c.protocolVersion == protocolV1 }

// connInfo describes this client for the connection registry.
func (c *Client) connInfo() connections.Conn {
	kind := connections.KindListener
	if c.isAdmin {
		kind = connections.KindAdmin
	}
	return connections.Conn{
		ID:       c.connID,
		Kind:     kind,
		UserID:   c.userID,
		Username: c.username,
		Role:     c.role,
		JTI:      c.jti,
		FamilyID: c.familyID,
		Client:   c.remote,
		Protocol: c.protocolVersion,
	}
}

// encodeSessionExpired returns the wire bytes for a session-expired
// notification in the protocol negotiated by this client.
func (c *Client) encodeSessionExpired() []byte {
	if c.isV1() {
		b, _ := NewSessionExpiredV1()
		return b
	}
	b, _ := NewXPRMessage()
	return b
}

// CanReceive reports whether this client is authorized to receive a call for
// the given system and talkgroup. Nil grants allow everything; an empty
// non-nil list (unparseable systems_json) allows nothing.
func (c *Client) CanReceive(systemID, talkgroupID int64) bool {
	return auth.HasSystemAccess(c.grants, systemID, talkgroupID)
}

// parseGrants parses systems_json into a slice of systemGrant.
func parseGrants(systemsJSON sql.NullString) []systemGrant {
	return auth.ParseSystemGrants(systemsJSON)
}

func wsAcceptOptions(r *http.Request) *websocket.AcceptOptions {
	patterns := []string{r.Host}

	// Allow localhost dev frontend origins (e.g. :5173) when backend runs on localhost.
	hostname := strings.ToLower(r.URL.Hostname())
	if hostname == "" {
		if u, err := url.Parse("http://" + r.Host); err == nil {
			hostname = strings.ToLower(u.Hostname())
		}
	}
	if hostname == "localhost" || hostname == "127.0.0.1" {
		patterns = append(patterns,
			"localhost:*",
			"127.0.0.1:*",
		)
	}

	return &websocket.AcceptOptions{
		OriginPatterns: patterns,
		// Compression stays off deliberately. With permessage-deflate and
		// context takeover, every message after the first depends on the
		// LZ77 window left by the previous one. A client whose inflater
		// does not carry that window across messages completes the
		// handshake, decodes the first (self-contained) scanner.config
		// frame, then fails on the first call.new and drops the TCP
		// connection with no close frame — reconnecting in a ~4s loop, so
		// calls and the listener count never appear. iOS Safari hit
		// exactly this. Context takeover also split one 117 KB config
		// into 209 continuation frames. See the library's own note: it
		// defaults to disabled and warns about Safari.
		CompressionMode: websocket.CompressionDisabled,
	}
}

// HandleListenerWS upgrades the HTTP connection for a legacy (3-letter
// array-framed) listener WebSocket. Used on /ws and /api/ws.
func HandleListenerWS(hub *Hub, queries *db.Queries) http.HandlerFunc {
	return handleListenerWS(hub, queries, false)
}

// HandleListenerWSv1 upgrades the HTTP connection for a native (JSON-object
// framed) listener WebSocket. Used on /api/v1/ws/listener. The auth
// handshake is identical to the legacy path; only the per-client encoder
// differs (selected via Client.protocolVersion).
func HandleListenerWSv1(hub *Hub, queries *db.Queries) http.HandlerFunc {
	return handleListenerWS(hub, queries, true)
}

func handleListenerWS(hub *Hub, queries *db.Queries, isV1 bool) http.HandlerFunc {
	protoVer := protocolLegacy
	if isV1 {
		protoVer = protocolV1
	}
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, wsAcceptOptions(r))
		if err != nil {
			slog.Error("ws: failed to accept listener connection",
				"error", err,
				"origin", r.Header.Get("Origin"),
				"host", r.Host,
				"v1", isV1,
			)
			return
		}

		slog.Debug("ws: listener connection accepted", "ip", connections.ClientFrom(r.Context()).IP, "peer", r.RemoteAddr, "v1", isV1)

		ctx := r.Context()

		// Check maxClients setting.
		if maxStr, err := queries.GetSetting(ctx, "maxClients"); err == nil {
			if maxClients, err := strconv.Atoi(maxStr.Value); err == nil && maxClients > 0 {
				if hub.ClientCount() >= maxClients {
					writeMaxAndClose(ctx, conn, isV1)
					return
				}
			}
		}

		// Check publicAccess setting.
		publicAccess := false
		if s, err := queries.GetSetting(ctx, "publicAccess"); err == nil {
			publicAccess = s.Value == "true"
		}

		client := &Client{
			hub:             hub,
			conn:            conn,
			send:            make(chan []byte, sendBufSize),
			queries:         queries,
			protocolVersion: protoVer,
			connID:          connections.NewID(),
			remote:          connections.ClientFrom(r.Context()),
		}

		if publicAccess {
			slog.Debug("ws: listener authenticated via public access")
			// Public access — no auth required, receive all.
			if err := sendWelcome(ctx, conn, hub, queries, nil, isV1); err != nil {
				slog.Error("ws: failed to send welcome", "error", err)
				conn.Close(websocket.StatusInternalError, "")
				return
			}
			hub.Register(client)
			go client.writePump(ctx)
			client.readPump(ctx)
			return
		}

		// Wait for auth message with timeout.
		authCtx, cancel := context.WithTimeout(ctx, authTimeout)
		defer cancel()

		typ, data, err := conn.Read(authCtx)
		if err != nil {
			slog.Info("ws: listener auth timeout or read error", "error", err)
			conn.Close(websocket.StatusPolicyViolation, "auth timeout")
			return
		}
		if typ != websocket.MessageText {
			conn.Close(websocket.StatusPolicyViolation, "expected text message")
			return
		}

		tokenStr, ok := extractAuthToken(data, isV1)
		if !ok {
			conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}

		claims, err := auth.ParseToken(tokenStr)
		if err != nil {
			slog.Info("ws: invalid JWT on listener WS")
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		if auth.Tokens.Rejects(claims) {
			slog.Info("ws: revoked JWT on listener WS", "jti", claims.ID)
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		if claims.Role != auth.RoleListener && claims.Role != auth.RoleAdmin {
			slog.Info("ws: invalid role on listener WS", "role", claims.Role)
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		// Load user grants.
		user, err := queries.GetUser(ctx, claims.UserID)
		if err != nil || user.Disabled != 0 {
			slog.Info("ws: user not found or disabled on listener WS", "user_id", claims.UserID)
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		// Enforce account expiration on WS connections.
		if user.Expiration.Valid && user.Expiration.Int64 > 0 {
			if time.Now().Unix() > user.Expiration.Int64 {
				slog.Info("ws: expired user on listener WS", "user_id", claims.UserID)
				sendExpiredAndClose(ctx, conn, isV1)
				return
			}
		}
		// Check user connection limit.
		if user.Limit.Valid && user.Limit.Int64 > 0 {
			if int64(hub.countByUser(user.ID)) >= user.Limit.Int64 {
				writeMaxAndClose(ctx, conn, isV1)
				return
			}
		}
		client.userID = user.ID
		client.jti = claims.ID
		client.username = user.Username
		client.role = user.Role
		client.familyID = claims.FamilyID
		client.grants = parseGrants(user.SystemsJson)
		slog.Debug("ws: listener authenticated via jwt", "user_id", user.ID, "grants", len(client.grants), "v1", isV1)

		if err := sendWelcome(ctx, conn, hub, queries, client.grants, isV1); err != nil {
			slog.Error("ws: failed to send welcome", "error", err)
			conn.Close(websocket.StatusInternalError, "")
			return
		}

		hub.Register(client)
		go client.writePump(ctx)
		client.readPump(ctx)
	}
}

// writeMaxAndClose emits the version-appropriate "rejected" frame and
// closes the connection cleanly.
func writeMaxAndClose(ctx context.Context, conn *websocket.Conn, isV1 bool) {
	var msg []byte
	if isV1 {
		msg, _ = NewRejectedV1("max_clients")
	} else {
		msg, _ = NewMAXMessage()
	}
	_ = conn.Write(ctx, websocket.MessageText, msg)
	conn.Close(websocket.StatusNormalClosure, "max clients reached")
}

// extractAuthToken pulls the JWT bearer token out of the first message in
// the auth handshake. Both legacy and v1 currently accept the same wire
// shape — a JSON array whose first element is the token string — keyed by
// ParseCommand. The isV1 flag is reserved for a future divergence (e.g.
// {"type":"auth","token":"..."}); today it is unused but kept on the
// signature to make the intent explicit.
func extractAuthToken(data []byte, _ bool) (string, bool) {
	cmd, _, err := ParseCommand(data)
	if err != nil {
		return "", false
	}
	return cmd, true
}

// HandleAdminWS upgrades the HTTP connection for a legacy admin WebSocket.
// Auth is performed via the first message (JWT token) after upgrade,
// matching the listener WS pattern — token never appears in the URL.
func HandleAdminWS(hub *Hub, queries *db.Queries) http.HandlerFunc {
	return handleAdminWS(hub, queries, false)
}

// HandleAdminWSv1 upgrades the HTTP connection for a native (JSON-object
// framed) admin WebSocket. Used on /api/v1/ws/admin.
func HandleAdminWSv1(hub *Hub, queries *db.Queries) http.HandlerFunc {
	return handleAdminWS(hub, queries, true)
}

func handleAdminWS(hub *Hub, queries *db.Queries, isV1 bool) http.HandlerFunc {
	protoVer := protocolLegacy
	if isV1 {
		protoVer = protocolV1
	}
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, wsAcceptOptions(r))
		if err != nil {
			slog.Error("ws: failed to accept admin connection",
				"error", err,
				"origin", r.Header.Get("Origin"),
				"host", r.Host,
				"v1", isV1,
			)
			return
		}

		ctx := r.Context()

		// Wait for auth message with timeout.
		authCtx, cancel := context.WithTimeout(ctx, authTimeout)
		defer cancel()

		typ, data, err := conn.Read(authCtx)
		if err != nil {
			slog.Info("ws: admin auth timeout or read error", "error", err)
			conn.Close(websocket.StatusPolicyViolation, "auth timeout")
			return
		}
		if typ != websocket.MessageText {
			conn.Close(websocket.StatusPolicyViolation, "expected text message")
			return
		}

		tokenStr, ok := extractAuthToken(data, isV1)
		if !ok {
			conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}

		claims, err := auth.ParseToken(tokenStr)
		if err != nil || auth.Tokens.Rejects(claims) {
			slog.Info("ws: invalid or revoked JWT on admin WS")
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		if claims.Role != auth.RoleAdmin {
			slog.Info("ws: non-admin JWT on admin WS", "role", claims.Role)
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}

		// Verify user is not disabled or expired (OWASP A01).
		user, err := queries.GetUser(ctx, claims.UserID)
		if err != nil || user.Disabled != 0 {
			slog.Info("ws: admin user not found or disabled", "user_id", claims.UserID)
			sendExpiredAndClose(ctx, conn, isV1)
			return
		}
		if user.Expiration.Valid && user.Expiration.Int64 > 0 {
			if time.Now().Unix() > user.Expiration.Int64 {
				slog.Info("ws: expired admin user", "user_id", claims.UserID)
				sendExpiredAndClose(ctx, conn, isV1)
				return
			}
		}

		slog.Debug("ws: admin authenticated via first-message JWT", "user_id", claims.UserID, "v1", isV1)

		client := &Client{
			hub:             hub,
			conn:            conn,
			send:            make(chan []byte, sendBufSize),
			isAdmin:         true,
			userID:          claims.UserID,
			jti:             claims.ID,
			queries:         queries,
			protocolVersion: protoVer,
			connID:          connections.NewID(),
			remote:          connections.ClientFrom(r.Context()),
			username:        user.Username,
			role:            user.Role,
			familyID:        claims.FamilyID,
		}

		hub.Register(client)
		go client.writePump(ctx)
		client.readPump(ctx)
	}
}

// readPump reads messages from the WebSocket connection.
func (c *Client) readPump(ctx context.Context) {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	if c.isAdmin {
		c.conn.SetReadLimit(maxAdminMessageSize)
	} else {
		c.conn.SetReadLimit(maxListenerMessageSize)
	}

	for {
		typ, data, err := c.conn.Read(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) || websocket.CloseStatus(err) != -1 {
				// Clean disconnect or normal close — nothing to log.
				return
			}
			// Anything else is an unexpected read failure (network drop,
			// oversized frame, malformed framing). Log at warn so it
			// surfaces in operator dashboards.
			slog.Warn("ws: read error", "error", err, "admin", c.isAdmin)
			return
		}
		if typ != websocket.MessageText {
			continue
		}

		if c.isV1() {
			c.dispatchV1(ctx, data)
			continue
		}

		cmd, payload, err := ParseCommand(data)
		if err != nil {
			continue
		}

		switch cmd {
		case CmdLFM:
			slog.Debug("ws: received command", "cmd", cmd)
			// Client updating live feed map — echo it back.
			if payload != nil {
				var fm map[string]any
				if err := json.Unmarshal(payload, &fm); err == nil {
					msg, err := NewLFMMessage(fm)
					if err == nil {
						c.trySend(msg)
					}
				}
			}
		case CmdADMREQ:
			if !c.isAdmin {
				slog.Warn("ws: non-admin client sent ADM_REQ")
				continue
			}
			if payload == nil {
				slog.Warn("ws: ADM_REQ with nil payload")
				continue
			}
			var req adminRequest
			if err := json.Unmarshal(payload, &req); err != nil {
				slog.Warn("ws: failed to parse ADM_REQ payload", "error", err)
				continue
			}
			if req.ReqID == "" {
				slog.Warn("ws: ADM_REQ missing reqId")
				continue
			}
			c.handleAdminRequest(ctx, req)
		default:
			slog.Warn("ws: received unknown command", "cmd", cmd)
		}
	}
}

// handleAdminRequest dispatches an admin WS request to the appropriate handler.
func (c *Client) handleAdminRequest(ctx context.Context, req adminRequest) {
	slog.Debug("ws: handling admin request", "op", req.Op, "reqId", req.ReqID)

	handlers := c.adminOpHandlers()
	handler, ok := handlers[req.Op]
	if !ok {
		c.trySend(c.encodeAdminError(req.ReqID, NativeErrCodeUnknownOp, "unknown op: "+req.Op))
		return
	}

	data, err := handler(ctx, req.Params, c.userID)
	if err != nil {
		if errMsg, isUser := errorString(err); isUser {
			c.trySend(c.encodeAdminError(req.ReqID, NativeErrCodeValidation, errMsg))
		} else {
			slog.Error("ws: admin op failed", "op", req.Op, "reqId", req.ReqID, "error", err)
			c.trySend(c.encodeAdminError(req.ReqID, NativeErrCodeInternal, errMsg))
		}
		return
	}
	c.trySend(c.encodeAdminResponse(req.ReqID, data))
}

// encodeAdminResponse builds a successful admin response in the protocol
// version negotiated by this client.
func (c *Client) encodeAdminResponse(reqID string, data any) []byte {
	if c.isV1() {
		b, _ := NewAdminResponseV1(reqID, data)
		return b
	}
	b, _ := NewADMRESMessage(reqID, data)
	return b
}

// encodeAdminError builds an error admin response in the protocol version
// negotiated by this client. The legacy frame ignores the error code and
// only carries the message.
func (c *Client) encodeAdminError(reqID, code, message string) []byte {
	if c.isV1() {
		b, _ := NewAdminResponseErrorV1(reqID, code, message, nil)
		return b
	}
	b, _ := NewADMRESErrorMessage(reqID, message)
	return b
}

// dispatchV1 routes a single inbound v1 (JSON-object framed) message from
// this client. Mirrors the legacy switch in readPump but keys off the
// "type" discriminator instead of the array opcode.
func (c *Client) dispatchV1(ctx context.Context, data []byte) {
	var env nativeEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		slog.Warn("ws: failed to parse v1 envelope", "error", err)
		return
	}
	switch env.Type {
	case TypeFeedMapUpdate:
		var u nativeFeedMapUpdate
		if err := json.Unmarshal(data, &u); err != nil {
			slog.Warn("ws: failed to parse listener.feedMap.update", "error", err)
			return
		}
		// Echo back as a snapshot so the client confirms its own state.
		if msg, err := NewFeedMapSnapshotV1(u.FeedMap); err == nil {
			c.trySend(msg)
		}
	case TypeAdminRequest:
		if !c.isAdmin {
			slog.Warn("ws: non-admin client sent admin.request")
			return
		}
		var req nativeAdminRequest
		if err := json.Unmarshal(data, &req); err != nil {
			slog.Warn("ws: failed to parse admin.request", "error", err)
			return
		}
		if req.ReqID == "" {
			slog.Warn("ws: admin.request missing reqId")
			return
		}
		c.handleAdminRequest(ctx, adminRequest{
			ReqID:  req.ReqID,
			Op:     req.Op,
			Params: req.Params,
		})
	default:
		slog.Warn("ws: received unknown v1 message type", "type", env.Type)
	}
}

func (c *Client) opActivityStats(ctx context.Context, _ json.RawMessage) (any, error) {
	now := time.Now()
	y, m, d := now.Date()
	todayStart := time.Date(y, m, d, 0, 0, 0, 0, now.Location()).Unix()

	weekday := now.Weekday()
	if weekday == time.Sunday {
		weekday = 7
	}
	weekStart := time.Date(y, m, d-int(weekday-time.Monday), 0, 0, 0, 0, now.Location()).Unix()

	stats, err := c.hub.queries.GetActivityStats(ctx, db.GetActivityStatsParams{
		TodayStart: todayStart,
		WeekStart:  weekStart,
	})
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"callsToday":      stats.CallsToday,
		"callsThisWeek":   stats.CallsThisWeek,
		"callsTotal":      stats.CallsTotal,
		"activeListeners": c.hub.ClientCount(),
		"uptime":          int64(time.Since(StartTime).Seconds()),
	}, nil
}

func (c *Client) opActivityChart(ctx context.Context, _ json.RawMessage) (any, error) {
	cutoff := time.Now().Add(-24 * time.Hour).Unix()
	rows, err := c.hub.queries.GetCallsPerHour(ctx, cutoff)
	if err != nil {
		return nil, err
	}

	buckets := make([]map[string]int64, len(rows))
	for i, r := range rows {
		buckets[i] = map[string]int64{"hour": r.HourBucket, "count": r.CallCount}
	}
	return map[string]any{"buckets": buckets}, nil
}

func (c *Client) opTopTalkgroups(ctx context.Context, _ json.RawMessage) (any, error) {
	cutoff := time.Now().Add(-24 * time.Hour).Unix()
	rows, err := c.hub.queries.GetTopTalkgroups(ctx, db.GetTopTalkgroupsParams{
		DateTime: cutoff,
		Limit:    10,
	})
	if err != nil {
		return nil, err
	}

	tgs := make([]map[string]any, len(rows))
	for i, r := range rows {
		tgs[i] = map[string]any{
			"talkgroupId":    r.TalkgroupID.Int64,
			"talkgroupLabel": r.TalkgroupLabel.String,
			"talkgroupName":  r.TalkgroupName.String,
			"systemLabel":    r.SystemLabel.String,
			"callCount":      r.CallCount,
		}
	}
	return map[string]any{"talkgroups": tgs}, nil
}

func (c *Client) opLogsQuery(_ context.Context, params json.RawMessage) (any, error) {
	var p struct {
		Level string `json:"level"`
		From  int64  `json:"from"`
		To    int64  `json:"to"`
		Query string `json:"q"`
		Limit int    `json:"limit"`
	}
	if params != nil {
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
	}
	if p.Limit <= 0 || p.Limit > 10_000 {
		p.Limit = 500
	}

	entries := logging.QueryEntries(p.Level, p.From, p.To, p.Query, p.Limit)
	resp := make([]map[string]any, len(entries))
	for i, e := range entries {
		resp[i] = map[string]any{
			"dateTime": e.Time.Unix(),
			"level":    e.Level,
			"message":  e.Message,
			"attrs":    e.Attrs,
		}
	}
	return resp, nil
}

// writePump sends messages from the send channel to the WebSocket connection
// and sends periodic pings for keepalive.
func (c *Client) writePump(ctx context.Context) {
	pingTicker := time.NewTicker(pingPeriod)
	// Periodic account revalidation: check disabled/expired every 5 min.
	// Only for authenticated (non-public) clients with a DB reference.
	var revalidateTicker *time.Ticker
	var revalidateCh <-chan time.Time
	if c.userID != 0 && c.queries != nil {
		revalidateTicker = time.NewTicker(revalidatePeriod)
		revalidateCh = revalidateTicker.C
	}
	defer func() {
		pingTicker.Stop()
		if revalidateTicker != nil {
			revalidateTicker.Stop()
		}
		c.conn.Close(websocket.StatusNormalClosure, "")
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-c.send:
			if !ok {
				// Hub closed the channel.
				return
			}
			writeCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Write(writeCtx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-pingTicker.C:
			pingCtx, cancel := context.WithTimeout(ctx, writeWait)
			err := c.conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		case <-revalidateCh:
			user, err := c.queries.GetUser(ctx, c.userID)
			if err != nil || user.Disabled != 0 {
				slog.Info("ws: revalidation failed, disconnecting", "user_id", c.userID, "reason", "disabled or not found")
				sendExpiredAndClose(ctx, c.conn, c.isV1())
				return
			}
			if user.Expiration.Valid && user.Expiration.Int64 > 0 {
				if time.Now().Unix() > user.Expiration.Int64 {
					slog.Info("ws: revalidation failed, disconnecting", "user_id", c.userID, "reason", "expired")
					sendExpiredAndClose(ctx, c.conn, c.isV1())
					return
				}
			}
		}
	}
}

// sendExpiredAndClose sends a session-expired frame in the protocol
// version negotiated by the handler and closes the connection. It runs
// before a Client struct exists (during the auth handshake), so the
// caller passes isV1 explicitly.
func sendExpiredAndClose(ctx context.Context, conn *websocket.Conn, isV1 bool) {
	var msg []byte
	if isV1 {
		msg, _ = NewSessionExpiredV1()
	} else {
		msg, _ = NewXPRMessage()
	}
	_ = conn.Write(ctx, websocket.MessageText, msg)
	conn.Close(websocket.StatusPolicyViolation, "auth failed")
}

// sendWelcome sends the post-auth welcome frames (legacy VER+CFG, native
// connection.welcome + scanner.config) on the given connection.
// grants scopes the systems and talkgroups in the config; nil sends all.
func sendWelcome(ctx context.Context, conn *websocket.Conn, hub *Hub, queries *db.Queries, grants []systemGrant, isV1 bool) error {
	slog.Debug("ws: sending welcome", "v1", isV1)
	branding := ""
	if s, err := queries.GetSetting(ctx, "branding"); err == nil {
		branding = s.Value
	}
	email := ""
	if s, err := queries.GetSetting(ctx, "email"); err == nil {
		email = s.Value
	}

	var welcome []byte
	var err error
	if isV1 {
		welcome, err = NewWelcomeV1(hub.version, branding, email)
	} else {
		welcome, err = NewVERMessage(hub.version, branding, email)
	}
	if err != nil {
		return err
	}
	if err := conn.Write(ctx, websocket.MessageText, welcome); err != nil {
		return err
	}

	legacyCFG, v1CFG, err := buildCFGFrames(ctx, queries, grants)
	if err != nil {
		return err
	}
	if isV1 {
		return conn.Write(ctx, websocket.MessageText, v1CFG)
	}
	return conn.Write(ctx, websocket.MessageText, legacyCFG)
}

// systemInGrants reports whether any grant covers systemID. Nil grants cover
// every system.
func systemInGrants(grants []systemGrant, systemID int64) bool {
	if grants == nil {
		return true
	}
	for _, g := range grants {
		if g.ID == systemID {
			return true
		}
	}
	return false
}

// buildCFGFrames returns the legacy and native (v1) CFG frames for the
// current database state. Both frames carry the same config payload, only
// the wire envelope differs.
func buildCFGFrames(ctx context.Context, queries *db.Queries, grants []systemGrant) (legacy, v1 []byte, err error) {
	payload, err := buildCFGPayload(ctx, queries, grants)
	if err != nil {
		return nil, nil, err
	}
	legacy, err = NewCFGMessage(payload)
	if err != nil {
		return nil, nil, err
	}
	v1, err = NewScannerConfigV1(payload)
	if err != nil {
		return nil, nil, err
	}
	return legacy, v1, nil
}

// buildCFGPayload constructs the CFG payload (without any framing) from
// the current database state (systems, talkgroups, groups, tags, settings).
// Systems and talkgroups outside grants are left out; nil grants include all.
func buildCFGPayload(ctx context.Context, queries *db.Queries, grants []systemGrant) (map[string]any, error) {
	// Resolve group and tag labels first so talkgroups carry string labels,
	// matching the TalkgroupConfig type expected by the frontend.
	groups, _ := queries.ListGroups(ctx)
	tags, _ := queries.ListTags(ctx)

	groupLabels := make(map[int64]string, len(groups))
	for _, g := range groups {
		groupLabels[g.ID] = g.Label
	}
	tagLabels := make(map[int64]string, len(tags))
	for _, t := range tags {
		tagLabels[t.ID] = t.Label
	}

	systems, err := queries.ListSystems(ctx)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	type tgCfg struct {
		ID          int64  `json:"id"`
		TalkgroupID int64  `json:"talkgroupId"`
		Label       string `json:"label,omitempty"`
		Name        string `json:"name,omitempty"`
		Group       string `json:"group,omitempty"`
		Tag         string `json:"tag,omitempty"`
		LedColor    string `json:"ledColor,omitempty"`
		Frequency   *int64 `json:"frequency,omitempty"`
	}
	type sysCfg struct {
		ID         int64   `json:"id"`
		SystemID   int64   `json:"systemId"`
		Label      string  `json:"label"`
		LedColor   string  `json:"ledColor,omitempty"`
		Talkgroups []tgCfg `json:"talkgroups"`
	}
	sysCfgs := []sysCfg{} // never nil — serialises as [] not null
	for _, s := range systems {
		if !systemInGrants(grants, s.ID) {
			continue
		}
		sc := sysCfg{ID: s.ID, SystemID: s.SystemID, Label: s.Label, Talkgroups: []tgCfg{}}
		if s.Led.Valid {
			sc.LedColor = s.Led.String
		}
		tgs, err := queries.ListTalkgroupsBySystem(ctx, s.ID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		for _, tg := range tgs {
			if !auth.HasSystemAccess(grants, s.ID, tg.ID) {
				continue
			}
			t := tgCfg{ID: tg.ID, TalkgroupID: tg.TalkgroupID}
			if tg.Label.Valid {
				t.Label = tg.Label.String
			}
			if tg.Name.Valid {
				t.Name = tg.Name.String
			}
			if tg.GroupID.Valid {
				t.Group = groupLabels[tg.GroupID.Int64]
			}
			if tg.TagID.Valid {
				t.Tag = tagLabels[tg.TagID.Int64]
			}
			if tg.Led.Valid {
				t.LedColor = tg.Led.String
			}
			if tg.Frequency.Valid {
				freq := tg.Frequency.Int64
				t.Frequency = &freq
			}
			sc.Talkgroups = append(sc.Talkgroups, t)
		}
		sysCfgs = append(sysCfgs, sc)
	}

	cfgPayload := map[string]any{
		"systems": sysCfgs,
	}

	// Include scanner display settings in the config payload.
	if s, err := queries.GetSetting(ctx, "time12hFormat"); err == nil {
		cfgPayload["time12hFormat"] = s.Value == "true"
	}
	if s, err := queries.GetSetting(ctx, "showListenersCount"); err == nil {
		cfgPayload["showListenersCount"] = s.Value == "true"
	}
	if s, err := queries.GetSetting(ctx, "keypadBeeps"); err == nil {
		cfgPayload["keypadBeeps"] = s.Value
	}
	if s, err := queries.GetSetting(ctx, "shareableLinks"); err == nil {
		cfgPayload["shareableLinks"] = s.Value == "true"
	}
	if s, err := queries.GetSetting(ctx, "transcriptionEnabled"); err == nil {
		cfgPayload["transcriptionEnabled"] = s.Value == "true"
	}
	if s, err := queries.GetSetting(ctx, "liveTranscriptDisplay"); err == nil {
		cfgPayload["liveTranscriptDisplay"] = s.Value == "true"
	}

	return cfgPayload, nil
}
