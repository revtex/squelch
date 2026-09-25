package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// Audit trail defaults: how long rows in the logs table are kept, and how
// many one query returns.
const (
	DefaultAuditRetentionDays = 90
	maxAuditRows              = 5000
	defaultAuditRows          = 500
)

// LogsAudit reads the audit trail: sign-ins, admin changes, blocks and
// delivery failures the server wrote to the logs table.
func (o *Operations) LogsAudit(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		From  int64  `json:"from"`
		To    int64  `json:"to"`
		Level string `json:"level"`
		Query string `json:"q"`
		Limit int64  `json:"limit"`
	}
	if params != nil {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, UserError("invalid request body")
		}
	}
	if req.To <= 0 {
		req.To = time.Now().Unix() + 60
	}
	if req.Limit <= 0 || req.Limit > maxAuditRows {
		req.Limit = defaultAuditRows
	}
	level := "%"
	if l := strings.ToLower(strings.TrimSpace(req.Level)); l != "" {
		level = l
	}
	query := "%"
	if q := strings.TrimSpace(req.Query); q != "" {
		query = "%" + escapeLike(q) + "%"
	}
	rows, err := o.Queries.ListLogs(ctx, db.ListLogsParams{
		FromTime:     req.From,
		ToTime:       req.To,
		LevelPattern: level,
		QueryPattern: query,
		RowLimit:     req.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to read the audit trail: %w", err)
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]any{
			"id":       r.ID,
			"dateTime": r.DateTime,
			"level":    r.Level,
			"message":  r.Message,
		})
	}
	return out, nil
}

// escapeLike strips LIKE wildcards from user text so a search matches the
// characters typed rather than acting as a pattern.
func escapeLike(s string) string {
	return strings.NewReplacer("%", "", "_", " ").Replace(s)
}

// AuditRetentionDays reads the auditRetentionDays setting, or the default.
func AuditRetentionDays(ctx context.Context, q *db.Queries) int {
	v, err := q.GetSetting(ctx, "auditRetentionDays")
	if err != nil {
		return DefaultAuditRetentionDays
	}
	n, err := strconv.Atoi(strings.TrimSpace(v.Value))
	if err != nil || n <= 0 {
		return DefaultAuditRetentionDays
	}
	return n
}

// PruneAuditTrail deletes audit rows older than the retention setting.
// It is called at startup and then daily.
func PruneAuditTrail(ctx context.Context, q *db.Queries) {
	days := AuditRetentionDays(ctx, q)
	before := time.Now().Add(-time.Duration(days) * 24 * time.Hour).Unix()
	n, err := q.DeleteLogsBefore(ctx, before)
	if err != nil {
		slog.Warn("audit: failed to prune old rows", "error", err)
		return
	}
	if n > 0 {
		slog.Info("audit: pruned old rows", "rows", n, "older_than_days", days)
	}
}
