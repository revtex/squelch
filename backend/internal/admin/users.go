package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// UsersList returns all users.
func (o *Operations) UsersList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	users, err := o.Queries.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	return mapUsers(users), nil
}

// UsersCreate creates a new user.
func (o *Operations) UsersCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		Username    string  `json:"username"`
		Password    string  `json:"password"`
		Role        string  `json:"role"`
		Disabled    int64   `json:"disabled"`
		SystemsJson *string `json:"systemsJson"`
		Expiration  *int64  `json:"expiration"`
		Limit       *int64  `json:"limit"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.Username == "" {
		return nil, UserError("username is required")
	}
	if len(req.Username) > 64 {
		return nil, UserError("username must be at most 64 characters")
	}
	if len(req.Password) < 8 {
		return nil, UserError("password must be at least 8 characters")
	}
	if len(req.Password) > 128 {
		return nil, UserError("password must be at most 128 characters")
	}
	if req.Role == "" {
		req.Role = "listener"
	}
	if !validRoles[req.Role] {
		return nil, UserError("role must be 'admin' or 'listener'")
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	now := time.Now().Unix()
	id, err := o.Queries.CreateUser(ctx, db.CreateUserParams{
		Username:           req.Username,
		PasswordHash:       hash,
		Role:               req.Role,
		Disabled:           req.Disabled,
		SystemsJson:        ptrToNullStr(req.SystemsJson),
		Expiration:         ptrToNullInt(req.Expiration),
		Limit:              ptrToNullInt(req.Limit),
		PasswordNeedChange: 1,
		CreatedAt:          now,
		UpdatedAt:          now,
	})
	if isUniqueViolation(err) {
		return nil, UserError("username already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	user, err := o.Queries.GetUser(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created user: %w", err)
	}
	slog.Info("admin: user created", "id", user.ID, "username", user.Username, "role", user.Role, "by", callerID)
	o.broadcastAdminEvent("users.updated", nil)
	return mapUser(user), nil
}

// UsersUpdate updates an existing user.
func (o *Operations) UsersUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID          int64   `json:"id"`
		Username    string  `json:"username"`
		Role        string  `json:"role"`
		Disabled    int64   `json:"disabled"`
		SystemsJson *string `json:"systemsJson"`
		Expiration  *int64  `json:"expiration"`
		Limit       *int64  `json:"limit"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if req.Username == "" {
		return nil, UserError("username is required")
	}
	if len(req.Username) > 64 {
		return nil, UserError("username must be at most 64 characters")
	}
	if req.Role == "" {
		return nil, UserError("role is required")
	}
	if !validRoles[req.Role] {
		return nil, UserError("role must be 'admin' or 'listener'")
	}

	if _, err := o.Queries.GetUser(ctx, req.ID); err != nil {
		return nil, UserError("user not found")
	}

	// Prevent disabling the bootstrap admin (id=1).
	if req.ID == 1 && req.Disabled != 0 {
		return nil, UserError("cannot disable the primary admin account")
	}
	// Protect bootstrap admin role/expiration/limit.
	if req.ID == 1 {
		req.Role = "admin"
		req.Expiration = nil
		req.Limit = nil
	}

	err := o.Queries.UpdateUser(ctx, db.UpdateUserParams{
		ID:          req.ID,
		Username:    req.Username,
		Role:        req.Role,
		Disabled:    req.Disabled,
		SystemsJson: ptrToNullStr(req.SystemsJson),
		Expiration:  ptrToNullInt(req.Expiration),
		Limit:       ptrToNullInt(req.Limit),
		UpdatedAt:   time.Now().Unix(),
	})
	if isUniqueViolation(err) {
		return nil, UserError("username already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update user: %w", err)
	}

	if req.Disabled != 0 {
		// A disabled account is signed out for good: its devices must not
		// come back if the account is enabled again later.
		if err := o.signOutEverywhere(ctx, req.ID); err != nil {
			return nil, err
		}
	} else {
		// Revoke all tokens so stale claims are not trusted after update.
		auth.Tokens.RevokeAllForUser(req.ID)

		// Immediately disconnect all active WS sessions for the updated user.
		o.disconnectByUser(req.ID)
	}

	user, err := o.Queries.GetUser(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated user: %w", err)
	}
	slog.Info("admin: user updated", "id", user.ID, "username", user.Username, "role", user.Role, "disabled", user.Disabled, "by", callerID)
	o.broadcastAdminEvent("users.updated", nil)
	return mapUser(user), nil
}

// UsersDelete deletes a user.
func (o *Operations) UsersDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	// Cannot delete your own account.
	if callerID == req.ID {
		return nil, UserError("cannot delete your own account")
	}
	// Cannot delete bootstrap admin.
	if req.ID == 1 {
		return nil, UserError("cannot delete the primary admin account")
	}

	if _, err := o.Queries.GetUser(ctx, req.ID); err != nil {
		return nil, UserError("user not found")
	}

	if err := o.Queries.DeleteUser(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete user: %w", err)
	}

	// Revoke tokens and disconnect active WS sessions for the deleted user.
	auth.Tokens.RevokeAllForUser(req.ID)
	o.disconnectByUser(req.ID)

	slog.Info("admin: user deleted", "id", req.ID, "by", callerID)
	o.broadcastAdminEvent("users.updated", nil)
	return map[string]bool{"ok": true}, nil
}
