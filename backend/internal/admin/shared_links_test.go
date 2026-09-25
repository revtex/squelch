package admin

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

func seedSharedLink(t *testing.T, q *db.Queries, userID int64, token string, createdAt int64, expiresAt sql.NullInt64) db.SharedLink {
	t.Helper()
	ctx := context.Background()
	sysID, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 1, Label: "Test", AutoPopulateTalkgroups: 1})
	if err != nil {
		if s, gerr := q.GetSystemBySystemID(ctx, 1); gerr == nil {
			sysID = s.ID
		} else {
			t.Fatalf("CreateSystem: %v", err)
		}
	}
	callID, err := q.CreateCall(ctx, db.CreateCallParams{AudioPath: token, AudioName: token, AudioType: "audio/mpeg", DateTime: createdAt, SystemID: sysID})
	if err != nil {
		t.Fatalf("CreateCall: %v", err)
	}
	if err := q.RestoreSharedLink(ctx, db.RestoreSharedLinkParams{CallID: callID, UserID: userID, Token: token, CreatedAt: createdAt, ExpiresAt: expiresAt}); err != nil {
		t.Fatalf("RestoreSharedLink: %v", err)
	}
	sl, err := q.GetSharedLinkByCallID(ctx, callID)
	if err != nil {
		t.Fatalf("GetSharedLinkByCallID: %v", err)
	}
	return sl
}

func TestSharedLinksList_FlagsExpiryFromSettingOrOwnDate(t *testing.T) {
	ops, q := newTestOperations(t, "")
	uid := seedSessionUser(t, q, "alice")
	now := time.Now().Unix()
	if err := q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "sharedLinkExpiry", Value: "7"}); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}
	fresh := seedSharedLink(t, q, uid, "fresh", now-3600, sql.NullInt64{})
	stale := seedSharedLink(t, q, uid, "stale", now-10*86400, sql.NullInt64{})
	pinned := seedSharedLink(t, q, uid, "pinned", now-10*86400, sql.NullInt64{Int64: now + 3600, Valid: true})
	if err := q.TouchSharedLinkOpened(context.Background(), db.TouchSharedLinkOpenedParams{Now: sql.NullInt64{Int64: now, Valid: true}, ID: fresh.ID}); err != nil {
		t.Fatalf("TouchSharedLinkOpened: %v", err)
	}

	res, err := ops.SharedLinksList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("SharedLinksList: %v", err)
	}
	byID := map[int64]map[string]any{}
	for _, m := range res.([]map[string]any) {
		byID[m["id"].(int64)] = m
	}
	if byID[fresh.ID]["expired"].(bool) || byID[fresh.ID]["effectiveExpiresAt"].(int64) != now-3600+7*86400 {
		t.Fatalf("fresh link: %v", byID[fresh.ID])
	}
	if byID[fresh.ID]["opens"].(int64) != 1 {
		t.Fatalf("fresh link opens = %v, want 1", byID[fresh.ID]["opens"])
	}
	if !byID[stale.ID]["expired"].(bool) {
		t.Fatalf("stale link should be expired by the setting: %v", byID[stale.ID])
	}
	if byID[pinned.ID]["expired"].(bool) {
		t.Fatalf("a link with its own future expiry is not expired: %v", byID[pinned.ID])
	}

	out, err := ops.SharedLinksRevokeExpired(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("SharedLinksRevokeExpired: %v", err)
	}
	if n := out.(map[string]int64)["revoked"]; n != 1 {
		t.Fatalf("revoked = %d, want 1", n)
	}
	if _, err := q.GetSharedLinkByToken(context.Background(), "stale"); err == nil {
		t.Fatal("stale link still exists")
	}
	if _, err := q.GetSharedLinkByToken(context.Background(), "fresh"); err != nil {
		t.Fatal("fresh link was revoked")
	}
}

func TestSharedLinksDelete_ReportsMissingAndRestoreKeepsTheToken(t *testing.T) {
	ops, q := newTestOperations(t, "")
	uid := seedSessionUser(t, q, "alice")
	now := time.Now().Unix()
	sl := seedSharedLink(t, q, uid, "tok-1", now-60, sql.NullInt64{Int64: now + 60, Valid: true})

	if _, err := ops.SharedLinksDelete(context.Background(), params(t, map[string]any{"id": sl.ID}), 1); err != nil {
		t.Fatalf("SharedLinksDelete: %v", err)
	}
	_, err := ops.SharedLinksDelete(context.Background(), params(t, map[string]any{"id": sl.ID}), 1)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("second delete: err = %v, want a user error", err)
	}

	if _, err := ops.SharedLinksRestore(context.Background(), params(t, map[string]any{
		"callId": sl.CallID, "userId": uid, "token": "tok-1", "createdAt": now - 60, "expiresAt": now + 60,
	}), 1); err != nil {
		t.Fatalf("SharedLinksRestore: %v", err)
	}
	back, err := q.GetSharedLinkByToken(context.Background(), "tok-1")
	if err != nil {
		t.Fatalf("restored link not found: %v", err)
	}
	if back.CallID != sl.CallID || back.ExpiresAt.Int64 != now+60 {
		t.Fatalf("restored link differs: %+v", back)
	}
}
