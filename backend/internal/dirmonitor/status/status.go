// Package status keeps what each folder monitor is doing right now, for the
// admin: whether it is watching, why it stopped, the last file it saw and
// how many calls it has ingested lately. It is a leaf package so the admin
// can read it without importing the watcher.
package status

import (
	"sync"
	"time"
)

// States a monitor can be in. A disabled monitor never starts, so the
// admin reports that from the row rather than from here.
const (
	Watching = "watching" // kernel file events
	Polling  = "polling"  // scanning the folder on a timer
	Stopped  = "stopped"  // not running; Error says why when it failed
)

// Snapshot is one monitor's state at a moment.
type Snapshot struct {
	State string
	// Error is the last problem: why it stopped, or a read error while it
	// keeps trying.
	Error string
	// Since is when the current state began.
	Since int64
	// LastFile is the last file the monitor looked at, with what came of it.
	LastFile   string
	LastFileAt int64
	LastResult string
	LastCallID int64
	// Ingested24h counts calls this monitor created in the last day.
	Ingested24h int
}

type entry struct {
	Snapshot
	ingested []int64
}

// Tracker holds a snapshot per monitor id. Safe for concurrent use, and a
// nil Tracker records nothing, so a service built without one still runs.
type Tracker struct {
	mu  sync.Mutex
	m   map[int64]*entry
	now func() time.Time
}

// New creates an empty tracker.
func New() *Tracker {
	return &Tracker{m: map[int64]*entry{}, now: time.Now}
}

func (t *Tracker) get(id int64) *entry {
	e, ok := t.m[id]
	if !ok {
		e = &entry{}
		t.m[id] = e
	}
	return e
}

// Running records that the monitor is up, in the given state.
func (t *Tracker) Running(id int64, state string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.get(id)
	e.State = state
	e.Error = ""
	e.Since = t.now().Unix()
}

// Stopped records that the monitor is no longer running; errText says why
// when it failed rather than being asked to stop.
func (t *Tracker) Stopped(id int64, errText string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.get(id)
	e.State = Stopped
	e.Error = errText
	e.Since = t.now().Unix()
}

// Trouble records a problem the monitor keeps running through, such as a
// folder that could not be read this time. Blank clears it.
func (t *Tracker) Trouble(id int64, errText string) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.get(id).Error = errText
}

// Seen records the last file a monitor handled and what came of it. callID
// is non-zero when the file became a call.
func (t *Tracker) Seen(id int64, file, result string, callID int64) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.get(id)
	now := t.now().Unix()
	e.LastFile = file
	e.LastFileAt = now
	e.LastResult = result
	e.LastCallID = callID
	if callID != 0 {
		e.ingested = append(e.ingested, now)
	}
}

// Forget drops a deleted monitor.
func (t *Tracker) Forget(id int64) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.m, id)
}

// Get returns a monitor's snapshot, or false when it has never run.
func (t *Tracker) Get(id int64) (Snapshot, bool) {
	if t == nil {
		return Snapshot{}, false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.m[id]
	if !ok {
		return Snapshot{}, false
	}
	cutoff := t.now().Add(-24 * time.Hour).Unix()
	i := 0
	for i < len(e.ingested) && e.ingested[i] < cutoff {
		i++
	}
	e.ingested = e.ingested[i:]
	s := e.Snapshot
	s.Ingested24h = len(e.ingested)
	return s, true
}
