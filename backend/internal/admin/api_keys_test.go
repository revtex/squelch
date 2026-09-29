package admin

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/middleware"
)

func createAPIKey(t *testing.T, ops *Operations, label string) (int64, string) {
	t.Helper()
	res, err := ops.APIKeysCreate(context.Background(), params(t, map[string]any{"ident": label}), 1)
	if err != nil {
		t.Fatalf("APIKeysCreate(%q): %v", label, err)
	}
	m := res.(map[string]any)
	return m["id"].(int64), m["createdKey"].(string)
}

func TestAPIKeysCreate_NeedsALabelAndRecordsWhen(t *testing.T) {
	ops, q := newTestOperations(t, "")
	_, err := ops.APIKeysCreate(context.Background(), params(t, map[string]any{"ident": "  "}), 1)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("no label: err = %v, want a user error", err)
	}
	_, err = ops.APIKeysCreate(context.Background(), params(t, map[string]any{"ident": "x", "callRateLimit": 0}), 1)
	if !errors.As(err, &ue) {
		t.Fatalf("rate 0: err = %v, want a user error", err)
	}

	id, plain := createAPIKey(t, ops, " TR North ")
	k, err := q.GetAPIKey(context.Background(), id)
	if err != nil {
		t.Fatalf("GetAPIKey: %v", err)
	}
	if k.Ident.String != "TR North" {
		t.Fatalf("ident = %q, want trimmed", k.Ident.String)
	}
	if time.Since(time.Unix(k.CreatedAt, 0)) > time.Minute {
		t.Fatalf("createdAt = %d, want now", k.CreatedAt)
	}
	if k.Key != auth.HashAPIKey(plain) {
		t.Fatal("stored hash does not match the returned secret")
	}
}

func TestAPIKeysRotate_KeepsTheOldSecretForAWhile(t *testing.T) {
	ops, q := newTestOperations(t, "")
	id, oldPlain := createAPIKey(t, ops, "TR")
	before, _ := q.GetAPIKey(context.Background(), id)

	res, err := ops.APIKeysRotate(context.Background(), params(t, map[string]any{"id": id}), 1)
	if err != nil {
		t.Fatalf("APIKeysRotate: %v", err)
	}
	m := res.(map[string]any)
	newPlain := m["createdKey"].(string)
	if newPlain == oldPlain {
		t.Fatal("rotate returned the same secret")
	}
	after, _ := q.GetAPIKey(context.Background(), id)
	if after.Key != auth.HashAPIKey(newPlain) {
		t.Fatal("new secret is not the stored key")
	}
	if after.PreviousKey.String != before.Key {
		t.Fatal("old hash was not kept as the previous key")
	}
	grace := time.Until(time.Unix(after.PreviousKeyExpiresAt.Int64, 0))
	if grace < 23*time.Hour || grace > 25*time.Hour {
		t.Fatalf("grace = %v, want about 24h", grace)
	}
	exp := m["previousKeyExpiresAt"].(*int64)
	if exp == nil || *exp != after.PreviousKeyExpiresAt.Int64 {
		t.Fatalf("previousKeyExpiresAt = %v, want %d", exp, after.PreviousKeyExpiresAt.Int64)
	}

	// The old secret still authenticates through the grace lookup.
	if _, err := q.GetAPIKeyByPreviousKey(context.Background(), db.GetAPIKeyByPreviousKeyParams{
		PreviousKey:          sql.NullString{String: auth.HashAPIKey(oldPlain), Valid: true},
		PreviousKeyExpiresAt: sql.NullInt64{Int64: time.Now().Unix(), Valid: true},
	}); err != nil {
		t.Fatalf("old secret not found during grace: %v", err)
	}
}

func TestAPIKeysList_ShowsUsage(t *testing.T) {
	ops, q := newTestOperations(t, "")
	store := middleware.NewLegacyUsageStore(nil)
	ops.Deps.LegacyUsage = store
	id, _ := createAPIKey(t, ops, "TR-Lake-North")
	// Shares the six characters the legacy report keeps ("TR-Lak").
	quiet, _ := createAPIKey(t, ops, "TR-Lake-South")

	sysID, err := q.CreateSystem(context.Background(), db.CreateSystemParams{SystemID: 1, Label: "Test", AutoPopulateTalkgroups: 1})
	if err != nil {
		t.Fatalf("CreateSystem: %v", err)
	}
	now := time.Now().Unix()
	for _, at := range []int64{now - 60, now - 3600, now - 48*3600} {
		if _, err := q.CreateCall(context.Background(), db.CreateCallParams{
			AudioPath: "a", AudioName: "a", AudioType: "audio/mpeg", DateTime: at, SystemID: sysID,
			ApiKeyID: sql.NullInt64{Int64: id, Valid: true},
		}); err != nil {
			t.Fatalf("CreateCall: %v", err)
		}
	}
	if err := q.TouchAPIKeyUsed(context.Background(), db.TouchAPIKeyUsedParams{
		LastUsedAt: sql.NullInt64{Int64: now - 60, Valid: true},
		LastUsedIp: sql.NullString{String: "198.51.100.7", Valid: true},
		ID:         id,
	}); err != nil {
		t.Fatalf("TouchAPIKeyUsed: %v", err)
	}
	store.RecordKey("/api/call-upload", "POST", "TR-Lak", id, 200)
	store.RecordKey("/api/call-upload", "POST", "TR-Lak", id, 200)
	store.Record("/api/call-upload", "POST", "", 200) // no key: nobody's

	res, err := ops.APIKeysList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("APIKeysList: %v", err)
	}
	byID := map[int64]map[string]any{}
	for _, k := range res.([]map[string]any) {
		byID[k["id"].(int64)] = k
	}
	lake := byID[id]
	if lake["calls24h"].(int64) != 2 {
		t.Fatalf("calls24h = %v, want 2 (the 48h-old call is out of the window)", lake["calls24h"])
	}
	if lake["legacy24h"].(int64) != 2 {
		t.Fatalf("legacy24h = %v, want 2", lake["legacy24h"])
	}
	if ip := lake["lastUsedIp"].(*string); ip == nil || *ip != "198.51.100.7" {
		t.Fatalf("lastUsedIp = %v, want 198.51.100.7", ip)
	}
	if lake["previousKeyExpiresAt"].(*int64) != nil {
		t.Fatal("a fresh key should not be rotating")
	}
	spare := byID[quiet]
	if spare["calls24h"].(int64) != 0 || spare["legacy24h"].(int64) != 0 || spare["lastUsedAt"].(*int64) != nil {
		t.Fatalf("spare key shows usage: %v", spare)
	}
}

func TestAPIKeysDelete_ClearsTheCallsKey(t *testing.T) {
	ops, q := newTestOperations(t, "")
	id, _ := createAPIKey(t, ops, "TR")
	sysID, _ := q.CreateSystem(context.Background(), db.CreateSystemParams{SystemID: 1, Label: "Test", AutoPopulateTalkgroups: 1})
	callID, err := q.CreateCall(context.Background(), db.CreateCallParams{
		AudioPath: "a", AudioName: "a", AudioType: "audio/mpeg", DateTime: time.Now().Unix(), SystemID: sysID,
		ApiKeyID: sql.NullInt64{Int64: id, Valid: true},
	})
	if err != nil {
		t.Fatalf("CreateCall: %v", err)
	}
	if _, err := ops.APIKeysDelete(context.Background(), params(t, map[string]any{"id": id}), 1); err != nil {
		t.Fatalf("APIKeysDelete: %v", err)
	}
	call, err := q.GetCall(context.Background(), callID)
	if err != nil {
		t.Fatalf("GetCall: %v", err)
	}
	if call.ApiKeyID.Valid {
		t.Fatal("call still points at the deleted key")
	}
}
