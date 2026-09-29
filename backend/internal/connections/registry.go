// Package connections keeps the admin's view of every live connection to the
// server: listener and admin WebSockets and background audio streams. The
// transports register here as connections open and close; the registry never
// reaches back into them except through the close func each one supplies.
package connections

import (
	"net/netip"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Kind is the transport a connection arrived on.
type Kind string

const (
	// KindListener is a listener WebSocket (/api/v1/ws/listener): LIVE
	// playback, and the cue channel alongside a BKGND stream.
	KindListener Kind = "listener"
	// KindAdmin is an admin WebSocket (/api/v1/ws/admin).
	KindAdmin Kind = "admin"
	// KindStream is a BKGND audio stream (/api/v1/listener/stream).
	KindStream Kind = "stream"
)

// Why a connection ended, as recorded in its history.
const (
	// ReasonClient: the client went away (closed the page, lost the network).
	ReasonClient = "client"
	// ReasonSignout: the session was revoked — logout, password change, the
	// account disabled, deleted or edited, or public access turned off.
	ReasonSignout = "signout"
	// ReasonRevalidation: the periodic account check found the account
	// disabled or expired.
	ReasonRevalidation = "revalidation"
	// ReasonShutdown: the server stopped.
	ReasonShutdown = "shutdown"
	// ReasonAdmin: an admin disconnected it from Admin → Connections.
	ReasonAdmin = "admin"
	// ReasonBlocked: an admin blocked the address it came from.
	ReasonBlocked = "blocked"
)

// Observer is told as connections open and close. Calls are made outside
// the registry lock and must not block: they sit on the connect and
// disconnect paths of every transport.
type Observer interface {
	Opened(c Conn)
	Closed(c Conn, reason string, at time.Time)
}

// changeDebounce bounds how often the change callback fires. Connections
// churn in bursts (a reconnect storm after a restart, a page reload opening
// a socket and a stream together), and one refresh covers the whole burst.
const changeDebounce = time.Second

// Conn describes one live connection. It is a value: List hands out copies,
// so nothing outside the registry can mutate an entry.
type Conn struct {
	ID       string
	Kind     Kind
	UserID   int64 // 0 = anonymous (public access)
	Username string
	Role     string
	JTI      string
	// FamilyID is the refresh-token family the access token was minted
	// from — the device session. Empty for anonymous listeners and for
	// tokens issued before the claim existed.
	FamilyID string
	Client
	// Native is true for the Squelch app, learned from the device session.
	Native bool
	// Country is the ISO 3166-1 alpha-2 code for IP, resolved once when the
	// connection opens; "" without a GeoIP database, for local addresses,
	// and for addresses the database does not place.
	Country string
	// Protocol is the WebSocket framing ("v1" or legacy ""); empty for streams.
	Protocol    string
	ConnectedAt time.Time
}

type entry struct {
	conn   Conn
	close  func()
	reason string // set by SetCloseReason; ReasonClient when empty
}

// Registry is safe for concurrent use. A nil *Registry is valid and does
// nothing, so transports and tests that never wire one keep working.
type Registry struct {
	mu       sync.Mutex
	conns    map[string]*entry
	onChange func()
	observer Observer
	country  func(netip.Addr) string
	timer    *time.Timer
	debounce time.Duration
}

// New returns an empty registry.
func New() *Registry {
	return &Registry{conns: make(map[string]*entry), debounce: changeDebounce}
}

// NewID mints a connection ID. Transports mint it before registering so the
// ID is set on their own connection struct before any other goroutine can
// read it.
func NewID() string { return uuid.NewString() }

// SetOnChange registers the callback fired, debounced, after connections are
// added or removed. It runs on its own goroutine, never under the registry
// lock.
func (r *Registry) SetOnChange(fn func()) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.onChange = fn
	r.mu.Unlock()
}

// SetObserver registers the connection history observer. Set once at
// startup, before any connection is added.
func (r *Registry) SetObserver(o Observer) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.observer = o
	r.mu.Unlock()
}

// SetCountryLookup registers how a connection's country is found. Set once
// at startup, before any connection is added.
func (r *Registry) SetCountryLookup(fn func(netip.Addr) string) {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.country = fn
	r.mu.Unlock()
}

// Add records a connection. close must end it through its own transport's
// normal teardown, which is expected to call Remove. A zero ConnectedAt is
// set to now and an empty ID is minted.
func (r *Registry) Add(c Conn, close func()) string {
	if r == nil {
		return c.ID
	}
	if c.ID == "" {
		c.ID = NewID()
	}
	if c.ConnectedAt.IsZero() {
		c.ConnectedAt = time.Now()
	}
	r.mu.Lock()
	lookup := r.country
	r.mu.Unlock()
	if lookup != nil && c.Country == "" && c.IP.IsValid() {
		c.Country = lookup(c.IP)
	}
	r.mu.Lock()
	r.conns[c.ID] = &entry{conn: c, close: close}
	r.changedLocked()
	obs := r.observer
	r.mu.Unlock()
	if obs != nil {
		obs.Opened(c)
	}
	return c.ID
}

// SetCloseReason records why a connection is about to end. Transports call
// it just before tearing a connection down for a reason of their own; a
// connection removed without one ended because the client went away.
func (r *Registry) SetCloseReason(id, reason string) {
	if r == nil || id == "" {
		return
	}
	r.mu.Lock()
	if e, ok := r.conns[id]; ok {
		e.reason = reason
	}
	r.mu.Unlock()
}

// Remove forgets a connection. Removing an unknown ID is a no-op, so the
// several teardown paths a connection can take need not coordinate.
func (r *Registry) Remove(id string) {
	if r == nil || id == "" {
		return
	}
	r.mu.Lock()
	e, ok := r.conns[id]
	if ok {
		delete(r.conns, id)
		r.changedLocked()
	}
	obs := r.observer
	r.mu.Unlock()
	if ok && obs != nil {
		reason := e.reason
		if reason == "" {
			reason = ReasonClient
		}
		obs.Closed(e.conn, reason, time.Now())
	}
}

// Len returns the number of live connections.
func (r *Registry) Len() int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.conns)
}

// List returns a copy of every live connection, oldest first.
func (r *Registry) List() []Conn {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	out := make([]Conn, 0, len(r.conns))
	for _, e := range r.conns {
		out = append(out, e.conn)
	}
	r.mu.Unlock()
	sort.Slice(out, func(i, j int) bool {
		if !out[i].ConnectedAt.Equal(out[j].ConnectedAt) {
			return out[i].ConnectedAt.Before(out[j].ConnectedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Get returns one live connection.
func (r *Registry) Get(id string) (Conn, bool) {
	if r == nil {
		return Conn{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	e, ok := r.conns[id]
	if !ok {
		return Conn{}, false
	}
	return e.conn, true
}

// Close ends one connection. It reports whether the ID was live.
func (r *Registry) Close(id string) bool {
	return r.CloseWhere(func(c Conn) bool { return c.ID == id }) > 0
}

// CloseFor ends every connection the predicate selects, recording reason
// in each one's history, and returns how many it asked to close.
func (r *Registry) CloseFor(reason string, pred func(Conn) bool) int {
	return r.closeWhere(reason, pred)
}

// CloseWhere ends every connection the predicate selects and returns how
// many it asked to close. Each keeps whatever close reason was already set.
func (r *Registry) CloseWhere(pred func(Conn) bool) int {
	return r.closeWhere("", pred)
}

// closeWhere runs the close funcs after the lock is released: a transport's
// teardown calls Remove, which takes the same lock.
func (r *Registry) closeWhere(reason string, pred func(Conn) bool) int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	var closers []func()
	for _, e := range r.conns {
		if pred(e.conn) && e.close != nil {
			if reason != "" {
				e.reason = reason
			}
			closers = append(closers, e.close)
		}
	}
	r.mu.Unlock()
	for _, fn := range closers {
		fn()
	}
	return len(closers)
}

// changedLocked schedules the change callback unless one is already pending.
// Callers hold r.mu.
func (r *Registry) changedLocked() {
	if r.onChange == nil || r.timer != nil {
		return
	}
	r.timer = time.AfterFunc(r.debounce, r.fire)
}

func (r *Registry) fire() {
	r.mu.Lock()
	r.timer = nil
	fn := r.onChange
	r.mu.Unlock()
	if fn != nil {
		fn()
	}
}
