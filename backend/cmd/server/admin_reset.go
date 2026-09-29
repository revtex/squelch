package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// resetAdminPassword implements --admin-password / SQUELCH_ADMIN_PASSWORD:
// it sets the password of the first admin user (lowest id) and signs that
// user out everywhere. It applies the same length policy as the password
// change endpoint.
func resetAdminPassword(ctx context.Context, queries *db.Queries, password string) error {
	if len(password) < 8 || len(password) > 128 {
		return errors.New("admin password must be 8 to 128 characters")
	}
	users, err := queries.ListUsers(ctx)
	if err != nil {
		return fmt.Errorf("list users: %w", err)
	}
	var admin *db.User
	for i := range users {
		if users[i].Role == auth.RoleAdmin {
			admin = &users[i]
			break
		}
	}
	if admin == nil {
		return errors.New("no admin user exists to reset; finish setup in the web UI first")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := queries.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{
		PasswordHash: hash,
		UpdatedAt:    time.Now().Unix(),
		ID:           admin.ID,
	}); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if err := queries.RevokeAllRefreshTokensForUser(ctx, admin.ID); err != nil {
		return fmt.Errorf("revoke sessions: %w", err)
	}
	auth.Tokens.RevokeAllForUser(admin.ID)
	slog.Warn("admin password reset from startup configuration; remove --admin-password / SQUELCH_ADMIN_PASSWORD now",
		"user_id", admin.ID, "username", admin.Username)
	return nil
}
