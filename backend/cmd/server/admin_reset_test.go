package main

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

func TestResetAdminPassword(t *testing.T) {
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	q := db.New(sqlDB)
	ctx := context.Background()

	if err := resetAdminPassword(ctx, q, "brand-new-pass"); err == nil {
		t.Error("reset with no admin user succeeded")
	}

	oldHash, err := auth.HashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	mk := func(name, role string) int64 {
		id, err := q.CreateUser(ctx, db.CreateUserParams{Username: name, PasswordHash: oldHash, Role: role, CreatedAt: now, UpdatedAt: now})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	mk("listener", auth.RoleListener)
	first := mk("first-admin", auth.RoleAdmin)
	second := mk("second-admin", auth.RoleAdmin)
	if err := q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		UserID: first, TokenHash: "h", FamilyID: "f", CreatedAt: now, ExpiresAt: now + 3600,
	}); err != nil {
		t.Fatal(err)
	}

	if err := resetAdminPassword(ctx, q, "short"); err == nil {
		t.Error("too-short password accepted")
	}
	if err := resetAdminPassword(ctx, q, "brand-new-pass"); err != nil {
		t.Fatalf("reset: %v", err)
	}

	u, err := q.GetUser(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if !auth.CheckPassword("brand-new-pass", u.PasswordHash) || auth.CheckPassword("old-password", u.PasswordHash) {
		t.Error("first admin's password was not replaced")
	}
	if u2, _ := q.GetUser(ctx, second); !auth.CheckPassword("old-password", u2.PasswordHash) {
		t.Error("second admin's password changed too")
	}
	rt, err := q.GetRefreshTokenByHash(ctx, "h")
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	if err == nil && rt.Revoked == 0 {
		t.Error("first admin's refresh token still active after reset")
	}
}
