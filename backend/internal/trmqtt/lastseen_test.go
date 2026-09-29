package trmqtt

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// touchQuerier records every last_seen_at write.
type touchQuerier struct {
	mu      sync.Mutex
	touches []db.TouchTRInstanceLastSeenParams
}

func (q *touchQuerier) ListEnabledTRInstances(context.Context) ([]db.TrInstance, error) {
	return nil, nil
}

func (q *touchQuerier) GetTRInstance(context.Context, int64) (db.TrInstance, error) {
	return db.TrInstance{}, nil
}

func (q *touchQuerier) TouchTRInstanceLastSeen(_ context.Context, arg db.TouchTRInstanceLastSeenParams) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.touches = append(q.touches, arg)
	return nil
}

func TestManager_TouchesLastSeenOncePerInterval(t *testing.T) {
	q := &touchQuerier{}
	m := NewManager(q, "", nil)
	clock := time.Unix(1_700_000_000, 0)
	m.now = func() time.Time { return clock }

	// Lifecycle events never count as the recorder talking.
	m.emit(Event{Type: EventInstanceConnected, InstanceID: 7})
	m.emit(Event{Type: EventWarnLag, InstanceID: 7})
	if len(q.touches) != 0 {
		t.Fatalf("expected no touch for lifecycle events, got %d", len(q.touches))
	}

	// A burst of frames inside one interval writes once.
	for i := 0; i < 5; i++ {
		m.emit(Event{Type: EventRates, InstanceID: 7})
		clock = clock.Add(time.Second)
	}
	if len(q.touches) != 1 {
		t.Fatalf("expected 1 touch for a burst, got %d", len(q.touches))
	}
	if got := q.touches[0]; got.ID != 7 || !got.LastSeenAt.Valid || got.LastSeenAt.Int64 != 1_700_000_000 {
		t.Fatalf("unexpected touch %+v", got)
	}

	// Another instance and a later interval each write again.
	m.emit(Event{Type: EventUnitOn, InstanceID: 8})
	clock = clock.Add(touchInterval)
	m.emit(Event{Type: EventMessage, InstanceID: 7})
	if len(q.touches) != 3 {
		t.Fatalf("expected 3 touches, got %d", len(q.touches))
	}
}

func TestSnapshot_KeepsPerSystemRateSamples(t *testing.T) {
	s := NewSnapshot(1, "lake")
	s.setRates(RatesFrame{Rates: []byte(`[{"sys_name":"lake","decoderate":20.5},{"sys_num":2,"decoderate":15}]`)})
	s.setRates(RatesFrame{Rates: []byte(`[{"sys_name":"lake","decoderate":21}]`)})
	got := s.Get().RateSamples
	if len(got) != 3 {
		t.Fatalf("expected 3 samples, got %d", len(got))
	}
	if got[0].System != "lake" || got[0].Rate != 20.5 || got[1].System != "2" || got[2].Rate != 21 {
		t.Fatalf("unexpected samples %+v", got)
	}
	// A frame that does not parse leaves the window alone.
	s.setRates(RatesFrame{Rates: []byte(`{"not":"a list"}`)})
	if n := len(s.Get().RateSamples); n != 3 {
		t.Fatalf("expected 3 samples after a bad frame, got %d", n)
	}
}
