// Package connections keeps the admin's view of every live connection to the
// server: listener and admin WebSockets and background audio streams. The
// transports register here as connections open and close; the registry never
// reaches back into them except through the close func each one supplies.
package connections

import (
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
	// Protocol is the WebSocket framing ("v1" or legacy ""); empty for streams.
	Protocol    string
	ConnectedAt time.Time
}

type entry struct {
	conn  Conn
	close func()
}

// Registry is safe for concurrent use. A nil *Registry is valid and does
// nothing, so transports and tests that never wire one keep working.
type Registry struct {
	mu       sync.Mutex
	conns    map[string]*entry
	onChange func()
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
	r.conns[c.ID] = &entry{conn: c, close: close}
	r.changedLocked()
	r.mu.Unlock()
	return c.ID
}

// Remove forgets a connection. Removing an unknown ID is a no-op, so the
// several teardown paths a connection can take need not coordinate.
func (r *Registry) Remove(id string) {
	if r == nil || id == "" {
		return
	}
	r.mu.Lock()
	if _, ok := r.conns[id]; ok {
		delete(r.conns, id)
		r.changedLocked()
	}
	r.mu.Unlock()
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

// Close ends one connection. It reports whether the ID was live.
func (r *Registry) Close(id string) bool {
	return r.CloseWhere(func(c Conn) bool { return c.ID == id }) > 0
}

// CloseWhere ends every connection the predicate selects and returns how
// many it asked to close. The close funcs run after the lock is released:
// a transport's teardown calls Remove, which takes the same lock.
func (r *Registry) CloseWhere(pred func(Conn) bool) int {
	if r == nil {
		return 0
	}
	r.mu.Lock()
	var closers []func()
	for _, e := range r.conns {
		if pred(e.conn) && e.close != nil {
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
