package trmqtt

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// eventChannelCap is the buffer size for Manager.events. Drop-oldest semantics
// when full keep the WS hub from stalling slow consumers.
const eventChannelCap = 256

// Manager owns the map[tr_instances.id]*Client and reacts to admin lifecycle
// calls (Add / Update / Remove / Reconnect). It does NOT consult the
// `trMqttEnabled` setting — that gate lands in step 3.
type Manager struct {
	queries       Querier
	encryptionKey string
	enricher      Enricher

	mu      sync.Mutex
	clients map[int64]*Client

	events chan Event

	// subMu guards subscribed: when nil, events are dropped (no consumer). Step
	// 4 wires the WS hub via Subscribe().
	subMu      sync.Mutex
	subscribed bool

	startCtx    context.Context
	startCancel context.CancelFunc
	startedWG   sync.WaitGroup

	// Test hooks
	clientFactory func(ClientConfig, *Snapshot, eventEmitter, Enricher) *Client
	snapshots     map[int64]*Snapshot

	// lastTouch is when each instance's last_seen_at was last written, so a
	// busy feed costs one row update per touchInterval, not one per frame.
	touchMu   sync.Mutex
	lastTouch map[int64]time.Time
	now       func() time.Time
}

// touchInterval is how often a live feed writes tr_instances.last_seen_at.
const touchInterval = 30 * time.Second

// NewManager constructs a Manager. encryptionKey is the same passphrase used
// by other AES-256-GCM encrypted columns (downstreams API keys, VAPID, etc.).
func NewManager(queries Querier, encryptionKey string, enricher Enricher) *Manager {
	if enricher == nil {
		enricher = noopEnricher{}
	}
	return &Manager{
		queries:       queries,
		encryptionKey: encryptionKey,
		enricher:      enricher,
		clients:       make(map[int64]*Client),
		snapshots:     make(map[int64]*Snapshot),
		events:        make(chan Event, eventChannelCap),
		clientFactory: NewClient,
		lastTouch:     make(map[int64]time.Time),
		now:           time.Now,
	}
}

// Start loads all enabled tr_instances rows and connects a Client for each.
// It returns immediately; reconnects are supervised per-client by autopaho.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.startCancel != nil {
		m.mu.Unlock()
		return errors.New("trmqtt manager already started")
	}
	startCtx, cancel := context.WithCancel(ctx)
	m.startCtx = startCtx
	m.startCancel = cancel
	m.mu.Unlock()

	rows, err := m.queries.ListEnabledTRInstances(startCtx)
	if err != nil {
		return fmt.Errorf("list enabled tr instances: %w", err)
	}
	for _, row := range rows {
		if err := m.addInstance(startCtx, row); err != nil {
			slog.Error("trmqtt: failed to start client",
				"instance_id", row.ID, "label", row.Label, "error", err)
		}
	}
	return nil
}

// Stop disconnects every client and waits up to 5s.
func (m *Manager) Stop() {
	m.mu.Lock()
	cancel := m.startCancel
	m.startCancel = nil
	clients := make(map[int64]*Client, len(m.clients))
	for id, c := range m.clients {
		clients[id] = c
	}
	m.clients = make(map[int64]*Client)
	m.mu.Unlock()

	if cancel != nil {
		cancel()
	}

	stopCtx, cancelStop := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelStop()
	var wg sync.WaitGroup
	for id, c := range clients {
		wg.Add(1)
		go func(id int64, c *Client) {
			defer wg.Done()
			if err := c.Stop(stopCtx); err != nil {
				slog.Warn("trmqtt: client stop returned error", "instance_id", id, "error", err)
			}
		}(id, c)
	}
	wg.Wait()
	// We deliberately do NOT close m.events: emit() may still race with a
	// late client callback, and a closed-channel send panics. Subscribers
	// stop reading on their own context cancel.
}

// Add starts a Client for the row identified by id. Idempotent: a no-op when a
// client for that id already exists.
func (m *Manager) Add(ctx context.Context, id int64) error {
	m.mu.Lock()
	if _, ok := m.clients[id]; ok {
		m.mu.Unlock()
		return nil
	}
	startCtx := m.startCtx
	m.mu.Unlock()
	if startCtx == nil {
		return errors.New("trmqtt manager not started")
	}
	row, err := m.queries.GetTRInstance(ctx, id)
	if err != nil {
		return fmt.Errorf("get tr instance %d: %w", id, err)
	}
	return m.addInstance(startCtx, row)
}

// Update tears down the existing client (if any) and starts a fresh one with
// the latest DB state. Used by admin REST PATCH.
func (m *Manager) Update(ctx context.Context, id int64) error {
	if err := m.Remove(ctx, id); err != nil {
		return err
	}
	return m.Add(ctx, id)
}

// Remove disconnects the client for id (if any). Idempotent.
func (m *Manager) Remove(ctx context.Context, id int64) error {
	m.mu.Lock()
	c, ok := m.clients[id]
	delete(m.clients, id)
	delete(m.snapshots, id)
	m.mu.Unlock()
	if !ok {
		return nil
	}
	stopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return c.Stop(stopCtx)
}

// Reconnect tears down and re-creates a client for id.
func (m *Manager) Reconnect(ctx context.Context, id int64) error {
	return m.Update(ctx, id)
}

// Snapshot returns the current per-instance view, or false when there is no
// client for id.
func (m *Manager) Snapshot(id int64) (SnapshotView, bool) {
	m.mu.Lock()
	snap, ok := m.snapshots[id]
	m.mu.Unlock()
	if !ok {
		return SnapshotView{}, false
	}
	return snap.Get(), true
}

// Subscribe registers the caller as the single event consumer. Returns the
// channel and an unsubscribe func. Only one subscriber is supported (matches
// the "WS hub fans out from here" model). Calling Subscribe twice replaces
// the previous registration.
func (m *Manager) Subscribe() (<-chan Event, func()) {
	m.subMu.Lock()
	m.subscribed = true
	m.subMu.Unlock()
	return m.events, func() {
		m.subMu.Lock()
		m.subscribed = false
		m.subMu.Unlock()
	}
}

// emit fans out to the events channel with drop-oldest semantics: if the
// channel is full, the oldest event is discarded and a one-shot lag warning
// is emitted (best-effort, also drop-oldest).
func (m *Manager) emit(ev Event) {
	if isDataEvent(ev.Type) {
		m.touchLastSeen(ev.InstanceID)
	}
	// When no consumer is registered, drop silently.
	m.subMu.Lock()
	subscribed := m.subscribed
	m.subMu.Unlock()
	if !subscribed {
		return
	}
	select {
	case m.events <- ev:
		return
	default:
	}
	// Full → drop oldest, retry once.
	select {
	case <-m.events:
	default:
	}
	select {
	case m.events <- ev:
	default:
	}
	pkgMetrics.lagWarnings.Add(1)
	// Best-effort lag warning; if it can't fit either, give up silently.
	select {
	case m.events <- Event{Type: EventWarnLag, InstanceID: ev.InstanceID, Label: ev.Label}:
	default:
	}
}

// addInstance constructs and starts a Client from a DB row. Caller holds no
// locks.
func (m *Manager) addInstance(ctx context.Context, row db.TrInstance) error {
	password, err := m.decryptPassword(row)
	if err != nil {
		return err
	}
	cfg := ClientConfig{
		InstanceID:       row.ID,
		Label:            row.Label,
		PluginInstanceID: row.InstanceID,
		BrokerURL:        row.BrokerUrl,
		BaseTopic:        row.BaseTopic,
		UnitTopic:        row.UnitTopic.String,
		MessageTopic:     row.MessageTopic.String,
		Username:         row.Username.String,
		Password:         password,
		TLSSkipVerify:    row.TlsSkipVerify == 1,
		QoS:              byte(row.Qos),
	}
	snap := NewSnapshot(row.ID, row.Label)
	c := m.clientFactory(cfg, snap, managerEmitter{m: m}, m.enricher)
	if err := c.Start(ctx); err != nil {
		return fmt.Errorf("start client %d: %w", row.ID, err)
	}
	m.mu.Lock()
	m.clients[row.ID] = c
	m.snapshots[row.ID] = snap
	m.mu.Unlock()
	return nil
}

// decryptPassword returns the plaintext broker password for row, or "" when
// none is set. Errors when the column is encrypted but no key is configured,
// or when decryption fails.
func (m *Manager) decryptPassword(row db.TrInstance) (string, error) {
	if !row.PasswordEnc.Valid || row.PasswordEnc.String == "" {
		return "", nil
	}
	val := row.PasswordEnc.String
	if !auth.IsEncrypted(val) {
		// Plaintext at rest is a security regression but we honor it for
		// backward compat; warn so operators see it. Never log the value.
		slog.Warn("trmqtt: broker password stored in plaintext; encrypt it",
			"instance_id", row.ID)
		return val, nil
	}
	if m.encryptionKey == "" {
		return "", fmt.Errorf("instance %d: password is encrypted but no encryption key configured", row.ID)
	}
	plain, err := auth.DecryptString(val, m.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("instance %d: decrypt password: %w", row.ID, err)
	}
	return plain, nil
}

// managerEmitter adapts Manager to the eventEmitter interface used by Client
// and subscriber, without exposing emit() publicly.
type managerEmitter struct{ m *Manager }

func (e managerEmitter) emit(ev Event) { e.m.emit(ev) }

// isDataEvent reports whether an event proves the recorder is publishing,
// as opposed to our own connection lifecycle and lag warnings.
func isDataEvent(t EventType) bool {
	switch t {
	case EventInstanceConnected, EventInstanceDisconnected, EventSnapshot, EventWarnLag, EventType(""):
		return false
	}
	return true
}

// touchLastSeen records that a frame arrived for id, at most once per
// touchInterval. The write is small and synchronous; a failure is logged
// and the next interval tries again.
func (m *Manager) touchLastSeen(id int64) {
	now := m.now()
	m.touchMu.Lock()
	if last, ok := m.lastTouch[id]; ok && now.Sub(last) < touchInterval {
		m.touchMu.Unlock()
		return
	}
	m.lastTouch[id] = now
	m.touchMu.Unlock()

	ctx := m.startCtx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := m.queries.TouchTRInstanceLastSeen(ctx, db.TouchTRInstanceLastSeenParams{
		LastSeenAt: sql.NullInt64{Int64: now.Unix(), Valid: true}, ID: id,
	}); err != nil {
		slog.Warn("trmqtt: failed to record last seen", "instance_id", id, "error", err)
	}
}
