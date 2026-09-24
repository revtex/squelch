// Package ws implements the Squelch WebSocket hub.
package ws

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
)

// Reloader triggers a service config reload (e.g. dirmonitor, downstream).
// Kept as a ws-local alias to admin.Reloader so external callers that
// reference ws.Reloader continue to compile.
type Reloader = admin.Reloader

// TranscriberReloader can hot-reload the transcription subsystem.
type TranscriberReloader = admin.TranscriberReloader

// HubDeps holds optional dependencies injected into the Hub for admin WS
// operations. It is an alias for admin.Deps so callers can keep using
// ws.HubDeps{...} while the underlying fields live in the admin package.
type HubDeps = admin.Deps

// StartTime is the process start time, used for uptime calculations.
var StartTime = time.Now()

// Hub manages all WebSocket client connections and broadcasts messages.
type Hub struct {
	queries *db.Queries
	version string
	admin   *admin.Operations // transport-agnostic admin ops

	mu      sync.RWMutex
	clients map[*Client]struct{}

	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMsg
	done       chan struct{}

	// lscTimer is the debounce timer for LSC broadcasts (max once per 3s).
	lscTimer *time.Timer
	lscMu    sync.Mutex

	// callNotifier, when set, is handed the id of every newly ingested
	// call. It exists so the continuous audio stream can pick calls up from
	// the same fan-out the WebSocket clients use, rather than each upload
	// path having to know about it. Never nil-checked by callers; see
	// notifyCall.
	callNotifier func(context.Context, int64)

	// sessionRevoker, when set, ends non-WebSocket sessions (the
	// continuous audio stream) whenever the hub disconnects a user or a
	// token, so every revocation path covers both transports.
	sessionRevoker SessionRevoker

	// conns is the admin's view of live connections. Clients are added and
	// removed on the Run goroutine alongside h.clients so the two never
	// disagree. Nil when unset; the registry's methods are nil-safe.
	conns *connections.Registry
}

// SessionRevoker ends live sessions that are not WebSocket clients.
type SessionRevoker interface {
	DisconnectUser(userID int64)
	DisconnectJTI(jti string)
}

const lscDebounceDuration = 3 * time.Second

type broadcastMsg struct {
	// data is the legacy 3-letter array-framed payload, sent to every
	// matching client whose protocolVersion is the legacy default.
	data []byte
	// v1 is the optional native JSON-object framed payload, sent to every
	// matching client whose protocolVersion == "v1". When nil, v1 clients
	// receive the legacy bytes (used by callers that have not been
	// migrated to dual-encoding yet).
	v1     []byte
	filter func(*Client) bool
}

// NewHub creates a new Hub. Pass the queries for settings lookups and the
// server version string for VER messages.
func NewHub(queries *db.Queries, version string, deps ...HubDeps) *Hub {
	var d HubDeps
	if len(deps) > 0 {
		d = deps[0]
	}
	h := &Hub{
		queries:    queries,
		version:    version,
		clients:    make(map[*Client]struct{}),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan broadcastMsg, 256),
		done:       make(chan struct{}),
	}
	h.admin = admin.New(queries, d, h)
	return h
}

// Run starts the hub's event loop. It blocks until ctx is cancelled.
func (h *Hub) Run(ctx context.Context) {
	defer h.closeAll()
	for {
		select {
		case <-ctx.Done():
			return
		case c := <-h.register:
			slog.Debug("ws: client registered", "user_id", c.userID, "is_admin", c.isAdmin)
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()
			h.conns.Add(c.connInfo(), func() { h.endSession(c) })
			if !c.isAdmin {
				h.debounceLSC()
			}
		case c := <-h.unregister:
			slog.Debug("ws: client unregistered", "user_id", c.userID, "is_admin", c.isAdmin)
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				c.closeSend()
				h.conns.Remove(c.connID)
			}
			h.mu.Unlock()
			if !c.isAdmin {
				h.debounceLSC()
			}
		case msg := <-h.broadcast:
			slog.Debug("ws: broadcasting message", "size", len(msg.data), "has_filter", msg.filter != nil, "has_v1", msg.v1 != nil)
			h.mu.RLock()
			for c := range h.clients {
				if msg.filter != nil && !msg.filter(c) {
					continue
				}
				data := msg.data
				if c.protocolVersion == protocolV1 && msg.v1 != nil {
					data = msg.v1
				}
				c.trySend(data)
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a text message to all clients matching the filter.
// If filter is nil, sends to all clients. Non-blocking (drops if hub is busy).
func (h *Hub) Broadcast(data []byte, filter func(*Client) bool) {
	select {
	case h.broadcast <- broadcastMsg{data: data, filter: filter}:
	default:
		slog.Warn("ws: broadcast channel full, dropping message")
	}
}

// broadcastBoth enqueues a broadcast carrying both the legacy and the
// native (v1) encoding of the same logical event. Each client receives the
// frame matching its negotiated protocol version. Non-blocking.
func (h *Hub) broadcastBoth(legacy, v1 []byte, filter func(*Client) bool) {
	select {
	case h.broadcast <- broadcastMsg{data: legacy, v1: v1, filter: filter}:
	default:
		slog.Warn("ws: broadcast channel full, dropping message")
	}
}

// BroadcastCAL fans out a new-call event to matching clients in both the
// legacy and native (v1) wire formats. The payload map is the same one
// already produced by the upload and dirmonitor handlers — its camelCase
// fields (id, audioName, audioType, dateTime, systemId, talkgroupId,
// frequency, duration, source, sources, frequencies, errorCount,
// spikeCount, talkerAlias, site, channel, decoder) are reused verbatim
// inside the native call.new envelope. Also notifies admin clients so the
// activity dashboard can refresh.
func (h *Hub) BroadcastCAL(payload map[string]any, filter func(*Client) bool) {
	legacy, err := NewCALMessage(payload)
	if err != nil {
		slog.Error("ws: failed to build legacy CAL", "error", err)
		return
	}
	v1, err := NewCallNewV1(payload)
	if err != nil {
		slog.Error("ws: failed to build native call.new", "error", err)
		// Fall back to legacy-only — v1 clients will receive the legacy
		// bytes, which is wrong but fails closed rather than dropping the
		// call entirely.
		h.Broadcast(legacy, filter)
		h.BroadcastAdminEvent("activity.updated", nil)
		return
	}
	h.broadcastBoth(legacy, v1, filter)
	h.notifyCall(payload)
	h.BroadcastAdminEvent("activity.updated", nil)
}

// SendStreamCue delivers a stream-position cue to one user's native (v1)
// listener clients. The cue carries the sid of the stream it belongs to,
// so a user with several tabs open can tell which of their streams it
// describes; other tabs ignore it. Legacy clients are skipped — the cue
// has no legacy encoding and they have no stream to schedule against.
func (h *Hub) SendStreamCue(userID int64, sid string, callID int64, offset float64) {
	data, err := NewStreamCueV1(sid, callID, offset)
	if err != nil {
		slog.Error("ws: failed to build stream.cue", "error", err)
		return
	}
	h.Broadcast(data, func(c *Client) bool {
		return c.isV1() && c.userID == userID
	})
}

// SetSessionRevoker registers a revoker that DisconnectByUser and
// DisconnectByJTI also call. Set once at startup.
func (h *Hub) SetSessionRevoker(r SessionRevoker) {
	h.sessionRevoker = r
}

// SetConnections registers the connection registry the hub reports its
// clients to. Set once at startup, before Run.
func (h *Hub) SetConnections(r *connections.Registry) {
	h.conns = r
	if h.admin != nil {
		h.admin.Deps.Connections = r
	}
}

// endSession tells a client its session is over and drops it — the same
// thing a sign-out does. Must not be called from the Run goroutine:
// Unregister hands the client to Run over an unbuffered channel.
func (h *Hub) endSession(c *Client) {
	c.trySend(c.encodeSessionExpired())
	h.Unregister(c)
}

// SetCallNotifier registers a sink for newly ingested calls. Safe to leave
// unset, in which case new calls are only fanned out over WebSocket.
func (h *Hub) SetCallNotifier(fn func(context.Context, int64)) {
	h.callNotifier = fn
}

// notifyCall hands the call id to the registered sink, if any. Runs in its
// own goroutine because the sink transcodes audio, which must never block
// the WebSocket fan-out.
func (h *Hub) notifyCall(payload map[string]any) {
	if h.callNotifier == nil {
		return
	}
	var id int64
	switch v := payload["id"].(type) {
	case int64:
		id = v
	case int:
		id = int64(v)
	case float64:
		id = int64(v)
	default:
		return
	}
	if id <= 0 {
		return
	}
	go h.callNotifier(context.Background(), id)
}

// BroadcastCFG rebuilds the CFG message from the database and sends it to
// all connected clients. Call this when systems or talkgroups are added or
// modified so that connected scanners see updated names and labels.
// Safe to call on a nil hub (no-op).
func (h *Hub) BroadcastCFG(ctx context.Context) {
	if h == nil {
		return
	}
	slog.Debug("ws: rebuilding and broadcasting CFG")
	legacy, v1, err := buildCFGFrames(ctx, h.queries, nil)
	if err != nil {
		slog.Error("ws: failed to build CFG for broadcast", "error", err)
		return
	}
	h.broadcastBoth(legacy, v1, func(c *Client) bool { return c.grants == nil })

	// Grant-restricted clients get a config scoped to their grants, built
	// once per distinct grant set.
	h.mu.RLock()
	var restricted []*Client
	for c := range h.clients {
		if c.grants != nil {
			restricted = append(restricted, c)
		}
	}
	h.mu.RUnlock()
	type frames struct{ legacy, v1 []byte }
	built := make(map[string]frames)
	for _, c := range restricted {
		key := fmt.Sprint(c.grants)
		f, ok := built[key]
		if !ok {
			l, v, err := buildCFGFrames(ctx, h.queries, c.grants)
			if err != nil {
				slog.Error("ws: failed to build scoped CFG", "user_id", c.userID, "error", err)
				continue
			}
			f = frames{l, v}
			built[key] = f
		}
		if c.isV1() {
			c.trySend(f.v1)
		} else {
			c.trySend(f.legacy)
		}
	}
	slog.Debug("ws: cfg broadcast complete", "clients", h.ClientCount())
}

// BroadcastAdminEvent sends an admin event (legacy ADM_EVT / native
// admin.event) to all connected admin clients in both wire formats.
func (h *Hub) BroadcastAdminEvent(topic string, data any) {
	legacy, err := NewADMEVTMessage(topic, data)
	if err != nil {
		slog.Error("ws: failed to build admin event", "topic", topic, "error", err)
		return
	}
	v1, err := NewAdminEventV1(topic, data)
	if err != nil {
		slog.Error("ws: failed to build native admin.event", "topic", topic, "error", err)
		h.Broadcast(legacy, func(c *Client) bool { return c.isAdmin })
		return
	}
	h.broadcastBoth(legacy, v1, func(c *Client) bool { return c.isAdmin })
}

// BroadcastTRN sends a transcript-ready message (legacy TRN / native
// call.transcript) to the clients allowed to receive the call — the same
// grant rule as its call.new. systemID and talkgroupID are the call's
// database ids. segments may be nil when diarization is disabled.
func (h *Hub) BroadcastTRN(callID, systemID, talkgroupID int64, text string, segments any) {
	if h == nil {
		return
	}
	filter := func(c *Client) bool { return c.CanReceive(systemID, talkgroupID) }
	legacy, err := NewTRNMessage(callID, text, segments)
	if err != nil {
		slog.Error("ws: failed to build TRN message", "call_id", callID, "error", err)
		return
	}
	v1, err := NewCallTranscriptV1(callID, text, segments)
	if err != nil {
		slog.Error("ws: failed to build native call.transcript", "call_id", callID, "error", err)
		h.Broadcast(legacy, filter)
		return
	}
	h.broadcastBoth(legacy, v1, filter)
}

// ClientCount returns the number of non-admin (listener) clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.clients {
		if !c.isAdmin {
			count++
		}
	}
	return count
}

// Register adds a client to the hub. Safe to call after hub shutdown.
func (h *Hub) Register(c *Client) {
	select {
	case h.register <- c:
	case <-h.done:
		c.closeSend()
	}
}

// Unregister removes a client from the hub. Safe to call after hub shutdown.
func (h *Hub) Unregister(c *Client) {
	select {
	case h.unregister <- c:
	case <-h.done:
	}
}

// countByUser returns the number of active clients for the given user ID.
func (h *Hub) countByUser(userID int64) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	count := 0
	for c := range h.clients {
		if c.userID == userID {
			count++
		}
	}
	return count
}

// DisconnectByUser closes all WS connections for the given user ID.
// Sends an XPR message before closing so the client knows to re-authenticate.
func (h *Hub) DisconnectByUser(userID int64) {
	if h.sessionRevoker != nil {
		h.sessionRevoker.DisconnectUser(userID)
	}
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		if c.userID == userID {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		slog.Info("ws: disconnecting user session", "user_id", userID, "is_admin", c.isAdmin)
		h.conns.SetCloseReason(c.connID, connections.ReasonSignout)
		h.endSession(c)
	}
}

// DisconnectAnonymous closes every unauthenticated listener connection. It is
// called when public access is turned off: those clients were admitted only
// because of it and are otherwise never re-checked.
func (h *Hub) DisconnectAnonymous() {
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		if c.userID == 0 && !c.isAdmin {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		h.conns.SetCloseReason(c.connID, connections.ReasonSignout)
		h.endSession(c)
	}
	if len(targets) > 0 {
		slog.Info("ws: disconnected anonymous listeners after public access was disabled", "count", len(targets))
	}
}

// DisconnectByJTI closes every WS connection opened with the given JWT ID.
// One token can hold several: a listener socket and an admin socket from
// the same tab, or two tabs that authenticated before the next refresh.
func (h *Hub) DisconnectByJTI(jti string) {
	if jti == "" {
		return
	}
	if h.sessionRevoker != nil {
		h.sessionRevoker.DisconnectJTI(jti)
	}
	h.mu.RLock()
	var targets []*Client
	for c := range h.clients {
		if c.jti == jti {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		slog.Info("ws: disconnecting session by JTI", "user_id", c.userID, "is_admin", c.isAdmin)
		h.conns.SetCloseReason(c.connID, connections.ReasonSignout)
		h.endSession(c)
	}
}

// SetDirMonitorReloader sets the DirMonitor reloader after hub creation.
// This handles the circular dependency where dwService needs hub but hub
// needs dwService's Reloader.
func (h *Hub) SetDirMonitorReloader(r Reloader) {
	if h.admin != nil {
		h.admin.Deps.DirMonitorReload = r
	}
}

// debounceLSC schedules an LSC broadcast, resetting the timer if one is already
// pending. Ensures at most one LSC broadcast per lscDebounceDuration.
func (h *Hub) debounceLSC() {
	h.lscMu.Lock()
	defer h.lscMu.Unlock()
	if h.lscTimer != nil {
		h.lscTimer.Stop()
	}
	h.lscTimer = time.AfterFunc(lscDebounceDuration, func() {
		count := h.ClientCount()
		legacy, err := NewLSCMessage(count)
		if err != nil {
			slog.Error("ws: failed to build LSC message", "error", err)
			return
		}
		v1, err := NewListenerCountV1(count)
		if err != nil {
			slog.Error("ws: failed to build native listener.count", "error", err)
			h.Broadcast(legacy, nil)
			return
		}
		h.broadcastBoth(legacy, v1, nil)
	})
}

// closeAll closes all connected clients during shutdown.
func (h *Hub) closeAll() {
	close(h.done)
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		c.closeSend()
		delete(h.clients, c)
		h.conns.SetCloseReason(c.connID, connections.ReasonShutdown)
		h.conns.Remove(c.connID)
	}
	h.lscMu.Lock()
	if h.lscTimer != nil {
		h.lscTimer.Stop()
	}
	h.lscMu.Unlock()
}
