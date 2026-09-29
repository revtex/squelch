package logging

import (
	"testing"
	"time"
)

// The level chips count the whole range, not the page of rows the list
// loaded: with 600 info lines and 3 warnings, a 500-row list of every level
// holds no warning at all, yet Warn is 3.
func TestCountEntries_CountsTheRangeNotThePage(t *testing.T) {
	saved := ring
	ring = newRingBuffer(defaultRingSize)
	t.Cleanup(func() { ring = saved })

	now := time.Now()
	ring.push(LogEntry{Time: now.Add(-2 * time.Hour), Level: "warn", Message: "old warning"})
	for i := 0; i < 3; i++ {
		ring.push(LogEntry{Time: now.Add(-time.Minute), Level: "warn", Message: "upload slow", Attrs: map[string]string{"system": "lake"}})
	}
	for i := 0; i < 600; i++ {
		ring.push(LogEntry{Time: now, Level: "info", Message: "request"})
	}
	from := now.Add(-time.Hour).Unix()

	page := QueryEntries("", from, 0, "", 500)
	for _, e := range page {
		if e.Level == "warn" {
			t.Fatal("the newest 500 lines were expected to hold no warning")
		}
	}
	got := CountEntries(from, 0, "")
	if got["warn"] != 3 || got["info"] != 600 {
		t.Errorf("counts = %v, want 3 warn and 600 info in the last hour", got)
	}
	if got := CountEntries(from, 0, " LAKE "); got["warn"] != 3 || got["info"] != 0 {
		t.Errorf("search counts = %v, want the 3 warnings that mention lake", got)
	}
}
