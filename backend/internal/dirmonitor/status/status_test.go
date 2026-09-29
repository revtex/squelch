package status

import (
	"testing"
	"time"
)

func TestTracker_StatesAndCounts(t *testing.T) {
	tr := New()
	now := time.Unix(1_000_000, 0)
	tr.now = func() time.Time { return now }

	if _, ok := tr.Get(1); ok {
		t.Fatal("unknown monitor should not be found")
	}
	tr.Running(1, Watching)
	tr.Seen(1, "/rec/a.wav", "ingested call 7", 7)
	tr.Seen(1, "/rec/b.wav", "skipped: too small", 0)
	s, ok := tr.Get(1)
	if !ok || s.State != Watching || s.LastFile != "/rec/b.wav" || s.LastCallID != 0 || s.Ingested24h != 1 {
		t.Fatalf("snapshot = %+v", s)
	}

	tr.Trouble(1, "permission denied")
	if s, _ := tr.Get(1); s.Error != "permission denied" || s.State != Watching {
		t.Fatalf("trouble should keep the state: %+v", s)
	}
	tr.Stopped(1, "folder is gone")
	if s, _ := tr.Get(1); s.State != Stopped || s.Error != "folder is gone" {
		t.Fatalf("stopped = %+v", s)
	}

	now = now.Add(25 * time.Hour)
	if s, _ := tr.Get(1); s.Ingested24h != 0 || s.LastCallID != 0 || s.LastFile == "" {
		t.Fatalf("old ingests should age out but the last file stay: %+v", s)
	}
	tr.Forget(1)
	if _, ok := tr.Get(1); ok {
		t.Fatal("forgotten monitor should be gone")
	}
}
