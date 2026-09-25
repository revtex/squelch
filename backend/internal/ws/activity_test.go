package ws

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/db"
)

func TestActivityCutoff_Ranges(t *testing.T) {
	now := time.Date(2026, 9, 25, 15, 0, 0, 0, time.UTC)
	cases := map[string]time.Duration{
		``:                24 * time.Hour,
		`null`:            24 * time.Hour,
		`{}`:              24 * time.Hour,
		`{"range":"24h"}`: 24 * time.Hour,
		`{"range":"7d"}`:  7 * 24 * time.Hour,
		`{"range":"30d"}`: 30 * 24 * time.Hour,
	}
	for in, want := range cases {
		got, err := activityCutoff(json.RawMessage(in), now)
		if err != nil {
			t.Fatalf("%q: %v", in, err)
		}
		if got != now.Add(-want).Unix() {
			t.Errorf("%q: cutoff %d, want %d", in, got, now.Add(-want).Unix())
		}
	}
	for _, in := range []string{`{"range":"1y"}`, `{"range":7}`, `nonsense`} {
		_, err := activityCutoff(json.RawMessage(in), now)
		var ue admin.UserError
		if !errors.As(err, &ue) {
			t.Errorf("%q: want a user error, got %v", in, err)
		}
	}
}

func TestSameTimeYesterday(t *testing.T) {
	now := time.Date(2026, 9, 25, 9, 30, 15, 0, time.UTC)
	start, until := sameTimeYesterday(now)
	if want := time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC).Unix(); start != want {
		t.Errorf("start %d, want %d", start, want)
	}
	if want := time.Date(2026, 9, 24, 9, 30, 15, 0, time.UTC).Unix(); until != want {
		t.Errorf("until %d, want %d", until, want)
	}
}

// seedActivity makes one system with two talkgroups and a call at each of
// the given times, alternating talkgroups.
func seedActivity(t *testing.T, q *db.Queries, times ...time.Time) (systemID, tgA int64) {
	t.Helper()
	ctx := context.Background()
	sys, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 7, Label: "MARCS"})
	if err != nil {
		t.Fatalf("system: %v", err)
	}
	a, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{SystemID: sys, TalkgroupID: 41011, Label: sql.NullString{String: "LC FD Disp", Valid: true}})
	if err != nil {
		t.Fatalf("talkgroup: %v", err)
	}
	b, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{SystemID: sys, TalkgroupID: 41025})
	if err != nil {
		t.Fatalf("talkgroup: %v", err)
	}
	for i, at := range times {
		tg := a
		if i%2 == 1 {
			tg = b
		}
		if _, err := q.CreateCall(ctx, db.CreateCallParams{
			AudioPath: "x", AudioName: "x.m4a", AudioType: "audio/mp4",
			DateTime: at.Unix(), SystemID: sys, TalkgroupID: sql.NullInt64{Int64: tg, Valid: true},
		}); err != nil {
			t.Fatalf("call: %v", err)
		}
	}
	return sys, a
}

func TestActivityOps_RangeStatsAndTalkgroupLinks(t *testing.T) {
	q := newWSTestDB(t)
	now := time.Now()
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	sys, tgA := seedActivity(t, q,
		now.Add(-10*time.Minute),                  // today (tg A), newest
		now.Add(-3*24*time.Hour),                  // inside 7 d (tg B)
		now.Add(-20*24*time.Hour),                 // inside 30 d (tg A)
		today.Add(-24*time.Hour).Add(time.Second), // yesterday just after midnight (tg B)
	)
	c := &Client{hub: NewHub(q, "v3.1.0-test")}
	ctx := context.Background()

	res, err := c.opActivityStats(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	stats := res.(map[string]any)
	if stats["version"] != "v3.1.0-test" {
		t.Errorf("version %v", stats["version"])
	}
	if got := stats["lastCallAt"].(int64); got != now.Add(-10*time.Minute).Unix() {
		t.Errorf("lastCallAt %d", got)
	}
	// Yesterday counts only up to this time of day; the call just after
	// midnight is inside it unless the test runs in the first second.
	if got := stats["callsYesterday"].(int64); got != 1 && now.Sub(today) > time.Second {
		t.Errorf("callsYesterday %d, want 1", got)
	}

	count := func(rng string) int64 {
		res, err := c.opActivityChart(ctx, json.RawMessage(`{"range":"`+rng+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		var n int64
		for _, b := range res.(map[string]any)["buckets"].([]map[string]int64) {
			n += b["count"]
		}
		return n
	}
	// 24 h: the newest call. 7 d adds 3 days ago and yesterday. 30 d adds 20 days ago.
	if n24, n7, n30 := count("24h"), count("7d"), count("30d"); n24 != 1 || n7 != 3 || n30 != 4 {
		t.Errorf("chart totals 24h=%d 7d=%d 30d=%d", n24, n7, n30)
	}

	res, err = c.opTopTalkgroups(ctx, json.RawMessage(`{"range":"30d"}`))
	if err != nil {
		t.Fatal(err)
	}
	tgs := res.(map[string]any)["talkgroups"].([]map[string]any)
	var found bool
	for _, tg := range tgs {
		if tg["talkgroupId"] == tgA {
			found = true
			if tg["systemId"] != sys || tg["talkgroupNumber"] != int64(41011) {
				t.Errorf("talkgroup row %v", tg)
			}
		}
	}
	if !found {
		t.Errorf("talkgroup %d missing from %v", tgA, tgs)
	}

	if _, err := c.opActivityChart(ctx, json.RawMessage(`{"range":"1y"}`)); err == nil {
		t.Error("an unknown range should be refused")
	}
}
