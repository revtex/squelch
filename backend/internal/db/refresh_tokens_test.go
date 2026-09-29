package db_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

// A rotated (revoked) refresh token must outlive the cleanup until it
// expires, or a replay of it can no longer be recognised as reuse.
func TestDeleteExpiredRefreshTokens_KeepsRevokedUntilExpiry(t *testing.T) {
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	q := db.New(sqlDB)
	ctx := context.Background()
	now := time.Now().Unix()

	uid, err := q.CreateUser(ctx, db.CreateUserParams{Username: "u", PasswordHash: "x", Role: "listener", CreatedAt: now, UpdatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	add := func(hash string, created, expires int64) {
		t.Helper()
		if err := q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
			UserID: uid, TokenHash: hash, FamilyID: "fam", CreatedAt: created, ExpiresAt: expires,
		}); err != nil {
			t.Fatal(err)
		}
	}
	add("rotated", now-3600, now+86400)
	add("expired", now-90000, now-1)
	rotated, err := q.GetRefreshTokenByHash(ctx, "rotated")
	if err != nil {
		t.Fatal(err)
	}
	if err := q.RevokeRefreshToken(ctx, rotated.ID); err != nil {
		t.Fatal(err)
	}

	if err := q.DeleteExpiredRefreshTokens(ctx, now); err != nil {
		t.Fatal(err)
	}

	if _, err := q.GetRefreshTokenByHash(ctx, "rotated"); err != nil {
		t.Errorf("revoked, unexpired token was deleted: %v", err)
	}
	if _, err := q.GetRefreshTokenByHash(ctx, "expired"); !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("expired token survived cleanup: %v", err)
	}
}
