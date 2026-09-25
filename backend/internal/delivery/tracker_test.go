package delivery

import (
	"testing"
	"time"
)

func TestTracker_CountsTheLastDayAndPersistsChanges(t *testing.T) {
	var persisted []Result
	tr := New(func(_ int64, r Result) { persisted = append(persisted, r) })
	base := time.Unix(1_800_000_000, 0)
	now := base
	tr.now = func() time.Time { return now }

	tr.Record(1, Result{OK: true, Status: 200})
	tr.Record(1, Result{OK: true, Status: 200}) // same outcome within a minute: not written
	now = now.Add(2 * time.Minute)
	tr.Record(1, Result{OK: true, Status: 200}) // a minute passed: written
	tr.Record(1, Result{OK: false, Status: 502, Error: "bad gateway"})

	s := tr.Stats(1)
	if s.Sent24h != 4 || s.Failed24h != 1 {
		t.Fatalf("sent/failed = %d/%d, want 4/1", s.Sent24h, s.Failed24h)
	}
	if s.Last.Status != 502 || s.LastOKAt != base.Add(2*time.Minute).Unix() {
		t.Fatalf("last = %+v, lastOKAt = %d", s.Last, s.LastOKAt)
	}
	if len(persisted) != 3 {
		t.Fatalf("persisted %d results, want 3 (first, a minute later, the failure)", len(persisted))
	}

	now = now.Add(25 * time.Hour)
	s = tr.Stats(1)
	if s.Sent24h != 0 || s.Last.Status != 502 {
		t.Fatalf("after a day: %+v", s)
	}
	if got := tr.Stats(2); got.Last.At != 0 {
		t.Fatalf("unknown target should be zero: %+v", got)
	}
}

func TestTracker_SeedIsReplacedByRealResults(t *testing.T) {
	tr := New(nil)
	tr.Seed(1, Result{At: 100, OK: false, Status: 500, Error: "old"}, 50)
	if s := tr.Stats(1); s.Last.Error != "old" || s.LastOKAt != 50 || s.Sent24h != 0 {
		t.Fatalf("seeded stats: %+v", s)
	}
	tr.Record(1, Result{OK: true, Status: 200})
	if s := tr.Stats(1); !s.Last.OK || s.Sent24h != 1 {
		t.Fatalf("after record: %+v", s)
	}
}
