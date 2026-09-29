package admin

import (
	"context"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

func TestLogsAudit_FiltersAndPrunes(t *testing.T) {
	o, q := newTestOperations(t, "")
	ctx := context.Background()
	now := time.Now().Unix()
	for _, row := range []db.CreateLogParams{
		{DateTime: now - 10, Level: "info", Message: "admin: user \"bob\" created by admin"},
		{DateTime: now - 5, Level: "error", Message: "Webhook Ops: delivery failed after 3 attempts"},
		{DateTime: now - 200*24*3600, Level: "info", Message: "ancient line"},
	} {
		if err := q.CreateLog(ctx, row); err != nil {
			t.Fatalf("CreateLog: %v", err)
		}
	}

	rows := decodeList(t, must(o.LogsAudit(ctx, params(t, map[string]any{"from": now - 3600}), 1)))
	if len(rows) != 2 || rows[0]["message"] != "Webhook Ops: delivery failed after 3 attempts" {
		t.Fatalf("newest first within the range, got %v", rows)
	}
	rows = decodeList(t, must(o.LogsAudit(ctx, params(t, map[string]any{"level": "error"}), 1)))
	if len(rows) != 1 || rows[0]["level"] != "error" {
		t.Fatalf("level filter = %v", rows)
	}
	rows = decodeList(t, must(o.LogsAudit(ctx, params(t, map[string]any{"q": "%bob%"}), 1)))
	if len(rows) != 1 || rows[0]["message"] != "admin: user \"bob\" created by admin" {
		t.Fatalf("search should strip wildcards and still match, got %v", rows)
	}

	if _, err := o.ConfigUpdate(ctx, params(t, map[string]any{
		"settings": []map[string]string{{"key": "auditRetentionDays", "value": "0"}},
	}), 1); err == nil {
		t.Fatal("retention of 0 days should be refused")
	}
	if _, err := o.ConfigUpdate(ctx, params(t, map[string]any{
		"settings": []map[string]string{{"key": "auditRetentionDays", "value": "30"}},
	}), 1); err != nil {
		t.Fatalf("set retention: %v", err)
	}
	PruneAuditTrail(ctx, q)
	rows = decodeList(t, must(o.LogsAudit(ctx, nil, 1)))
	for _, r := range rows {
		if r["message"] == "ancient line" {
			t.Fatal("the old row should have been pruned")
		}
	}
	if AuditRetentionDays(ctx, q) != 30 {
		t.Fatalf("retention = %d", AuditRetentionDays(ctx, q))
	}
}
