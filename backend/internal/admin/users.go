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

// UsersList returns all users, each with how many live connections and
// signed-in devices it has and where it was last seen.
func (o *Operations) UsersList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	users, err := o.Queries.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	stats, err := o.Queries.ListUserSessionStats(ctx, time.Now().Unix())
	if err != nil {
		return nil, fmt.Errorf("failed to list session stats: %w", err)
	}
	byUser := make(map[int64]db.ListUserSessionStatsRow, len(stats))
	for _, st := range stats {
		byUser[st.UserID] = st
	}
	live := map[int64]int{}
	if o.Deps.Connections != nil {
		for _, c := range o.Deps.Connections.List() {
			if c.UserID != 0 {
				live[c.UserID]++
			}
		}
	}
	out := make([]map[string]any, len(users))
	for i, u := range users {
		m := mapUser(u)
		st, seen := byUser[u.ID]
		m["liveConnections"] = live[u.ID]
		m["devices"] = int64(0)
		m["lastSeenAt"] = nil
		m["lastSeenIp"] = nil
		if seen {
			m["devices"] = st.Devices
			m["lastSeenAt"] = st.LastSeenAt
			m["lastSeenIp"] = nullStr(st.LastSeenIp)
		}
		out[i] = m
	}
	return out, nil
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
		// PasswordNeedChange asks the user to pick their own password at
		// their first sign-in; nil means yes.
		PasswordNeedChange *int64 `json:"passwordNeedChange"`
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
	if err := checkPassword(req.Password); err != nil {
		return nil, err
	}
	if req.Role == "" {
		req.Role = "listener"
	}
	needChange := int64(1)
	if req.PasswordNeedChange != nil && *req.PasswordNeedChange == 0 {
		needChange = 0
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
		PasswordNeedChange: needChange,
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

// UsersUpdate updates an existing user. A password in the request resets
// it (an admin reset, so the user is asked to change it next time unless
// passwordNeedChange says otherwise); passwordNeedChange alone just sets the
// flag; signOut ends every device session as part of the same change.
func (o *Operations) UsersUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID                 int64   `json:"id"`
		Username           string  `json:"username"`
		Role               string  `json:"role"`
		Disabled           int64   `json:"disabled"`
		SystemsJson        *string `json:"systemsJson"`
		Expiration         *int64  `json:"expiration"`
		Limit              *int64  `json:"limit"`
		Password           *string `json:"password"`
		PasswordNeedChange *int64  `json:"passwordNeedChange"`
		SignOut            bool    `json:"signOut"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.Password != nil {
		if err := checkPassword(*req.Password); err != nil {
			return nil, err
		}
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

	by := o.callerName(ctx, callerID)
	switch {
	case req.Password != nil:
		hash, err := auth.HashPassword(*req.Password)
		if err != nil {
			return nil, fmt.Errorf("failed to hash password: %w", err)
		}
		needChange := int64(1)
		if req.PasswordNeedChange != nil && *req.PasswordNeedChange == 0 {
			needChange = 0
		}
		if err := o.Queries.AdminSetUserPassword(ctx, db.AdminSetUserPasswordParams{
			ID: req.ID, PasswordHash: hash, PasswordNeedChange: needChange, UpdatedAt: time.Now().Unix(),
		}); err != nil {
			return nil, fmt.Errorf("failed to set password: %w", err)
		}
		o.audit(ctx, fmt.Sprintf("admin: password of %s reset by %s", req.Username, by))
	case req.PasswordNeedChange != nil:
		if err := o.Queries.SetUserPasswordNeedChange(ctx, db.SetUserPasswordNeedChangeParams{
			ID: req.ID, PasswordNeedChange: *req.PasswordNeedChange, UpdatedAt: time.Now().Unix(),
		}); err != nil {
			return nil, fmt.Errorf("failed to set password flag: %w", err)
		}
	}

	if req.SignOut && req.Disabled == 0 {
		if err := o.signOutEverywhere(ctx, req.ID); err != nil {
			return nil, err
		}
		o.audit(ctx, fmt.Sprintf("admin: signed out %s on every device by %s", req.Username, by))
	}

	if req.Disabled != 0 {
		// A disabled account is signed out for good: its devices must not
		// come back if the account is enabled again later.
		if err := o.signOutEverywhere(ctx, req.ID); err != nil {
			return nil, err
		}
	} else if !req.SignOut {
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

// checkPassword is the one rule for a new password, on create and reset.
func checkPassword(password string) error {
	if len(password) < 8 {
		return UserError("password must be at least 8 characters")
	}
	if len(password) > 128 {
		return UserError("password must be at most 128 characters")
	}
	return nil
}
