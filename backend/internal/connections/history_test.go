package connections

import (
	"context"
	"net/netip"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

func newHistoryDB(t *testing.T) *db.Queries {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db.New(sqlDB)
}

func setHistoryDays(t *testing.T, q *db.Queries, v string) {
	t.Helper()
	if err := q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: HistoryDaysSetting, Value: v}); err != nil {
		t.Fatalf("set %s: %v", HistoryDaysSetting, err)
	}
}

func listAll(t *testing.T, q *db.Queries) []db.ConnectionLog {
	t.Helper()
	rows, err := q.ListConnectionLog(context.Background(), db.ListConnectionLogParams{Limit: 100})
	if err != nil {
		t.Fatalf("list history: %v", err)
	}
	return rows
}

// runHistory runs h until the test ends, draining on the way out.
func runHistory(t *testing.T, h *History) func() {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { h.Run(ctx); close(done) }()
	stop := func() { cancel(); <-done }
	t.Cleanup(stop)
	return stop
}

func TestHistory_RecordsOpenAndClose(t *testing.T) {
	q := newHistoryDB(t)
	h := NewHistory(q)
	stop := runHistory(t, h)

	at := time.Unix(1_700_000_000, 0)
	c := Conn{
		ID: "c1", Kind: KindStream, UserID: 4, Username: "dana", FamilyID: "fam", Native: true,
		Client:      Client{IP: netip.MustParseAddr("203.0.113.9"), UserAgent: "ua"},
		ConnectedAt: at,
	}
	h.Opened(c)
	h.Closed(c, ReasonSignout, at.Add(time.Minute))
	stop()

	rows := listAll(t, q)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.Kind != "stream" || r.UserID.Int64 != 4 || r.Username.String != "dana" || r.Ip != "203.0.113.9" ||
		r.Native != 1 || r.FamilyID.String != "fam" || r.ConnectedAt != at.Unix() {
		t.Errorf("row = %+v", r)
	}
	if !r.DisconnectedAt.Valid || r.DisconnectedAt.Int64 != at.Add(time.Minute).Unix() || r.DisconnectReason.String != ReasonSignout {
		t.Errorf("close = %v %v, want %d signout", r.DisconnectedAt, r.DisconnectReason, at.Add(time.Minute).Unix())
	}
}

func TestHistory_AnonymousHasNoUser(t *testing.T) {
	q := newHistoryDB(t)
	h := NewHistory(q)
	stop := runHistory(t, h)
	h.Opened(Conn{ID: "anon", Kind: KindListener, Client: Client{IP: netip.MustParseAddr("192.0.2.1")}, ConnectedAt: time.Now()})
	stop()
	r := listAll(t, q)[0]
	if r.UserID.Valid || r.Username.Valid || r.DisconnectedAt.Valid {
		t.Errorf("anonymous row = %+v, want no user and still open", r)
	}
}

func TestHistory_OffWritesNothing(t *testing.T) {
	q := newHistoryDB(t)
	setHistoryDays(t, q, "0")
	h := NewHistory(q)
	stop := runHistory(t, h)
	c := Conn{ID: "x", Kind: KindListener, ConnectedAt: time.Now()}
	h.Opened(c)
	h.Closed(c, ReasonClient, time.Now())
	stop()
	if n := len(listAll(t, q)); n != 0 {
		t.Fatalf("rows = %d with history off, want 0", n)
	}
}

// Transports call Opened and Closed on their connect and disconnect paths;
// a stalled database must never hold them up.
func TestHistory_FullQueueDropsInsteadOfBlocking(t *testing.T) {
	h := NewHistory(newHistoryDB(t)) // Run never started: nothing drains
	done := make(chan struct{})
	go func() {
		for i := 0; i < historyQueue+50; i++ {
			h.Opened(Conn{ID: "x"})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Opened blocked on a full queue")
	}
	if h.dropped.Load() != 50 {
		t.Errorf("dropped = %d, want 50", h.dropped.Load())
	}
}

func TestHistory_CloseStaleAndPrune(t *testing.T) {
	q := newHistoryDB(t)
	ctx := context.Background()
	old := time.Now().AddDate(0, 0, -40).Unix()
	recent := time.Now().Add(-time.Hour).Unix()
	for _, at := range []int64{old, recent} {
		if _, err := q.InsertConnectionLog(ctx, db.InsertConnectionLogParams{Kind: "listener", Ip: "192.0.2.1", ConnectedAt: at}); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	h := NewHistory(q)
	if err := h.CloseStale(ctx); err != nil {
		t.Fatalf("CloseStale: %v", err)
	}
	for _, r := range listAll(t, q) {
		if !r.DisconnectedAt.Valid || r.DisconnectReason.String != ReasonShutdown {
			t.Errorf("row %d left open after CloseStale: %+v", r.ID, r)
		}
	}

	h.Prune(ctx) // default 30 days
	rows := listAll(t, q)
	if len(rows) != 1 || rows[0].ConnectedAt != recent {
		t.Fatalf("after prune rows = %+v, want only the recent one", rows)
	}

	setHistoryDays(t, q, "0")
	h.Prune(ctx) // off: keeps what is there
	if len(listAll(t, q)) != 1 {
		t.Fatal("prune with history off deleted rows")
	}
}

// The registry resolves the country once, at connect, and the history row
// keeps it.
func TestHistory_RecordsTheCountryResolvedAtConnect(t *testing.T) {
	q := newHistoryDB(t)
	h := NewHistory(q)
	stop := runHistory(t, h)

	reg := New()
	reg.SetObserver(h)
	var looked []netip.Addr
	reg.SetCountryLookup(func(ip netip.Addr) string {
		looked = append(looked, ip)
		if ip == netip.MustParseAddr("81.2.69.160") {
			return "GB"
		}
		return ""
	})
	reg.Add(Conn{ID: "gb", Kind: KindListener, Client: Client{IP: netip.MustParseAddr("81.2.69.160")}}, nil)
	reg.Add(Conn{ID: "unknown", Kind: KindListener, Client: Client{IP: netip.MustParseAddr("8.8.8.8")}}, nil)
	if got, _ := func() (string, bool) {
		for _, c := range reg.List() {
			if c.ID == "gb" {
				return c.Country, true
			}
		}
		return "", false
	}(); got != "GB" {
		t.Fatalf("live Country = %q, want GB", got)
	}
	stop()

	byIP := map[string]db.ConnectionLog{}
	for _, r := range listAll(t, q) {
		byIP[r.Ip] = r
	}
	if r := byIP["81.2.69.160"]; r.CountryCode.String != "GB" {
		t.Errorf("gb row country = %v", r.CountryCode)
	}
	if r := byIP["8.8.8.8"]; r.CountryCode.Valid {
		t.Errorf("unknown row country = %v, want NULL", r.CountryCode)
	}
	if len(looked) != 2 {
		t.Errorf("lookups = %d, want one per connection", len(looked))
	}
}
