package connections

import (
	"context"
	"database/sql"
	"log/slog"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// HistoryDaysSetting is the settings key holding how many days of
// connection history to keep. 0 turns history off.
const HistoryDaysSetting = "connectionHistoryDays"

// DefaultHistoryDays applies when the setting is missing or unreadable.
const DefaultHistoryDays = 30

const (
	// historyQueue bounds the events waiting to be written. A connect storm
	// that outruns the database drops history rather than stall a transport.
	historyQueue = 1024
	// settingTTL is how long the writer trusts its copy of the retention
	// setting, so turning history off takes effect within a minute.
	settingTTL = time.Minute
)

type historyEvent struct {
	open   bool
	conn   Conn
	reason string
	at     time.Time
}

// History records connections in the connection_log table. It implements
// Observer: events are queued without blocking and written by Run on its own
// goroutine, in order, so a connection's close always follows its open.
type History struct {
	q       *db.Queries
	events  chan historyEvent
	dropped atomic.Int64

	// Owned by the Run goroutine.
	rows      map[string]int64 // connection ID → connection_log row
	days      int
	checkedAt time.Time
}

// NewHistory returns a writer over q. Call Run to start writing.
func NewHistory(q *db.Queries) *History {
	return &History{q: q, events: make(chan historyEvent, historyQueue), rows: make(map[string]int64)}
}

// Opened queues a connection's start.
func (h *History) Opened(c Conn) { h.enqueue(historyEvent{open: true, conn: c, at: c.ConnectedAt}) }

// Closed queues a connection's end.
func (h *History) Closed(c Conn, reason string, at time.Time) {
	h.enqueue(historyEvent{conn: c, reason: reason, at: at})
}

func (h *History) enqueue(ev historyEvent) {
	select {
	case h.events <- ev:
	default:
		if n := h.dropped.Add(1); n%100 == 1 {
			slog.Warn("connections: history queue full, dropping events", "dropped", n)
		}
	}
}

// CloseStale closes every row a previous run left open. Rows are only left
// open when the process did not get to write their end, so the end time is
// unknown; now is recorded instead. Call once at startup, before any
// connection is accepted, or it would close rows for live connections.
func (h *History) CloseStale(ctx context.Context) error {
	return h.q.CloseOpenConnectionLogs(ctx, db.CloseOpenConnectionLogsParams{
		DisconnectedAt:   sql.NullInt64{Int64: time.Now().Unix(), Valid: true},
		DisconnectReason: sql.NullString{String: ReasonShutdown, Valid: true},
	})
}

// Prune deletes history older than the retention setting. With history
// turned off it deletes nothing — the rows age out once it is back on.
func (h *History) Prune(ctx context.Context) {
	days := RetentionDays(ctx, h.q)
	if days <= 0 {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -days).Unix()
	if err := h.q.DeleteConnectionLogBefore(ctx, cutoff); err != nil {
		slog.Error("connections: failed to prune history", "error", err)
	}
}

// RetentionDays reads the retention setting, falling back to the default.
func RetentionDays(ctx context.Context, q *db.Queries) int {
	s, err := q.GetSetting(ctx, HistoryDaysSetting)
	if err != nil {
		return DefaultHistoryDays
	}
	n, err := strconv.Atoi(s.Value)
	if err != nil || n < 0 {
		return DefaultHistoryDays
	}
	return n
}

// Run writes queued events until ctx ends, then writes whatever is still
// queued so connections closed during shutdown are recorded. Writes never
// use ctx itself: shutdown cancels it while the final closes are still
// queued, and those are the ones worth keeping.
func (h *History) Run(ctx context.Context) {
	wctx := context.WithoutCancel(ctx)
	for {
		select {
		case ev := <-h.events:
			h.write(wctx, ev)
		case <-ctx.Done():
			for {
				select {
				case ev := <-h.events:
					h.write(wctx, ev)
				default:
					return
				}
			}
		}
	}
}

func (h *History) write(ctx context.Context, ev historyEvent) {
	if ev.open {
		if !h.enabled(ctx) {
			return
		}
		c := ev.conn
		id, err := h.q.InsertConnectionLog(ctx, db.InsertConnectionLogParams{
			Kind:        string(c.Kind),
			UserID:      sql.NullInt64{Int64: c.UserID, Valid: c.UserID != 0},
			Username:    sql.NullString{String: c.Username, Valid: c.Username != ""},
			Ip:          c.IP.String(),
			CountryCode: sql.NullString{String: c.Country, Valid: c.Country != ""},
			UserAgent:   sql.NullString{String: c.UserAgent, Valid: c.UserAgent != ""},
			Native:      boolInt(c.Native),
			FamilyID:    sql.NullString{String: c.FamilyID, Valid: c.FamilyID != ""},
			ConnectedAt: ev.at.Unix(),
		})
		if err != nil {
			slog.Error("connections: failed to record connection", "error", err)
			return
		}
		h.rows[c.ID] = id
		return
	}

	// A close with no row: history was off when it opened, or the open
	// was dropped. Nothing to update.
	id, ok := h.rows[ev.conn.ID]
	if !ok {
		return
	}
	delete(h.rows, ev.conn.ID)
	if err := h.q.CloseConnectionLog(ctx, db.CloseConnectionLogParams{
		DisconnectedAt:   sql.NullInt64{Int64: ev.at.Unix(), Valid: true},
		DisconnectReason: sql.NullString{String: ev.reason, Valid: true},
		ID:               id,
	}); err != nil {
		slog.Error("connections: failed to record disconnect", "error", err)
	}
}

// enabled reports whether history is on, rereading the setting at most once
// a minute.
func (h *History) enabled(ctx context.Context) bool {
	if h.checkedAt.IsZero() || time.Since(h.checkedAt) > settingTTL {
		h.days = RetentionDays(ctx, h.q)
		h.checkedAt = time.Now()
	}
	return h.days > 0
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
