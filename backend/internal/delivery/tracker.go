// Package delivery keeps track of how deliveries to a remote target
// (a downstream Squelch, a webhook) have been going: the last outcome and
// how many went well or badly in the last day. It is the one place the
// admin's "is forwarding working?" answer comes from.
package delivery

import (
	"sync"
	"time"
)

// Result is the outcome of one delivery attempt to a target.
type Result struct {
	At int64 // unix seconds
	OK bool
	// Status is the HTTP status, or 0 when the request never got an answer.
	Status int
	// Error says why it failed, in one line; empty when it worked.
	Error string
	// Millis is how long the request took.
	Millis int64
}

// Stats summarises a target's recent deliveries.
type Stats struct {
	// Last is the most recent result; At is 0 when nothing was ever sent.
	Last Result
	// LastOKAt is when a delivery last worked, or 0.
	LastOKAt int64
	// Sent24h and Failed24h count deliveries in the last 24 hours since the
	// server started.
	Sent24h   int
	Failed24h int
}

// Persister stores a result somewhere durable, e.g. the target's row, so
// the last outcome survives a restart.
type Persister func(id int64, r Result)

const window = 24 * time.Hour

// persistEvery is how often a run of successes is written through; every
// failure and every change of outcome is written at once.
const persistEvery = time.Minute

type entry struct {
	last        Result
	lastOKAt    int64
	recent      []recentResult // within the window, oldest first
	lastPersist int64
}

type recentResult struct {
	at int64
	ok bool
}

// Tracker records results per target id.
type Tracker struct {
	mu      sync.Mutex
	entries map[int64]*entry
	persist Persister
	now     func() time.Time
}

// New returns a Tracker; persist may be nil.
func New(persist Persister) *Tracker {
	return &Tracker{entries: map[int64]*entry{}, persist: persist, now: time.Now}
}

// Seed sets what is known about a target from durable storage, before any
// delivery this run. Later results replace it.
func (t *Tracker) Seed(id int64, last Result, lastOKAt int64) {
	t.mu.Lock()
	defer t.mu.Unlock()
	e := t.entry(id)
	if e.last.At == 0 {
		e.last = last
		e.lastOKAt = lastOKAt
	}
}

// Record notes one delivery outcome.
func (t *Tracker) Record(id int64, r Result) {
	if r.At == 0 {
		r.At = t.now().Unix()
	}
	t.mu.Lock()
	e := t.entry(id)
	changed := e.last.OK != r.OK || e.last.Status != r.Status
	e.last = r
	if r.OK {
		e.lastOKAt = r.At
	}
	e.recent = append(e.recent, recentResult{at: r.At, ok: r.OK})
	t.trim(e, r.At)
	persist := t.persist != nil && (!r.OK || changed || r.At-e.lastPersist >= int64(persistEvery.Seconds()))
	if persist {
		e.lastPersist = r.At
	}
	t.mu.Unlock()
	if persist {
		t.persist(id, r)
	}
}

// Stats returns the target's stats; a zero Stats for an unknown target.
func (t *Tracker) Stats(id int64) Stats {
	t.mu.Lock()
	defer t.mu.Unlock()
	e, ok := t.entries[id]
	if !ok {
		return Stats{}
	}
	t.trim(e, t.now().Unix())
	s := Stats{Last: e.last, LastOKAt: e.lastOKAt}
	for _, r := range e.recent {
		s.Sent24h++
		if !r.ok {
			s.Failed24h++
		}
	}
	return s
}

// Forget drops a target, e.g. when it is deleted.
func (t *Tracker) Forget(id int64) {
	t.mu.Lock()
	delete(t.entries, id)
	t.mu.Unlock()
}

func (t *Tracker) entry(id int64) *entry {
	e, ok := t.entries[id]
	if !ok {
		e = &entry{}
		t.entries[id] = e
	}
	return e
}

func (t *Tracker) trim(e *entry, now int64) {
	cutoff := now - int64(window.Seconds())
	i := 0
	for i < len(e.recent) && e.recent[i].at < cutoff {
		i++
	}
	if i > 0 {
		e.recent = append([]recentResult(nil), e.recent[i:]...)
	}
}
