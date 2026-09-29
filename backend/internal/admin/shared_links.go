package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// sharedLinkMaxAge is the server-wide link lifetime in seconds from the
// sharedLinkExpiry setting (days), or 0 when links never expire on their
// own. Links made before the setting changed carry no expires_at and fall
// back to it, the same way the public page does.
func (o *Operations) sharedLinkMaxAge(ctx context.Context) int64 {
	raw, err := o.Queries.GetSetting(ctx, "sharedLinkExpiry")
	if err != nil {
		return 0
	}
	days, err := strconv.ParseInt(raw.Value, 10, 64)
	if err != nil || days <= 0 {
		return 0
	}
	return days * 86400
}

// effectiveExpiry is when a link stops working: its own expires_at, else
// created_at plus the server-wide lifetime, else never (0).
func effectiveExpiry(expiresAt sql.NullInt64, createdAt, maxAge int64) int64 {
	if expiresAt.Valid && expiresAt.Int64 > 0 {
		return expiresAt.Int64
	}
	if maxAge > 0 {
		return createdAt + maxAge
	}
	return 0
}

// SharedLinksList returns every shared link with whether it still works,
// how often it has been opened, and who made it.
func (o *Operations) SharedLinksList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	rows, err := o.Queries.ListSharedLinks(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list shared links: %w", err)
	}
	maxAge := o.sharedLinkMaxAge(ctx)
	now := time.Now().Unix()
	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		m := mapSharedLink(r)
		exp := effectiveExpiry(r.ExpiresAt, r.CreatedAt, maxAge)
		if exp > 0 {
			m["effectiveExpiresAt"] = exp
		} else {
			m["effectiveExpiresAt"] = nil
		}
		m["expired"] = exp > 0 && now > exp
		items = append(items, m)
	}
	return items, nil
}

// SharedLinksDelete revokes a shared link. The call stays; it just cannot
// be opened by its link any more.
func (o *Operations) SharedLinksDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	link, ok := o.findSharedLink(ctx, req.ID)
	if !ok {
		return nil, UserError("shared link not found; it may already be revoked")
	}
	if err := o.Queries.DeleteSharedLink(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete shared link: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: shared link for call %d (shared by %s) revoked by %s",
		link.CallID, link.SharedBy, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("shared-links.updated", nil)
	return map[string]bool{"deleted": true}, nil
}

// SharedLinksRestore puts back a link that was just revoked, with the same
// token, so an undo keeps the URL people already have.
func (o *Operations) SharedLinksRestore(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		CallID    int64  `json:"callId"`
		UserID    int64  `json:"userId"`
		Token     string `json:"token"`
		CreatedAt int64  `json:"createdAt"`
		ExpiresAt *int64 `json:"expiresAt"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.CallID <= 0 || req.UserID <= 0 || req.Token == "" || req.CreatedAt <= 0 {
		return nil, UserError("callId, userId, token and createdAt are required")
	}
	if len(req.Token) > 64 {
		return nil, UserError("token is too long")
	}
	err := o.Queries.RestoreSharedLink(ctx, db.RestoreSharedLinkParams{
		CallID:    req.CallID,
		UserID:    req.UserID,
		Token:     req.Token,
		CreatedAt: req.CreatedAt,
		ExpiresAt: ptrToNullInt(req.ExpiresAt),
	})
	if isUniqueViolation(err) {
		return nil, UserError("that call is already shared")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to restore shared link: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: shared link for call %d restored by %s", req.CallID, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("shared-links.updated", nil)
	return map[string]bool{"restored": true}, nil
}

// SharedLinksRevokeExpired deletes every link that no longer works and
// reports how many went.
func (o *Operations) SharedLinksRevokeExpired(ctx context.Context, _ json.RawMessage, callerID int64) (any, error) {
	rows, err := o.Queries.ListSharedLinks(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list shared links: %w", err)
	}
	maxAge := o.sharedLinkMaxAge(ctx)
	now := time.Now().Unix()
	var revoked int64
	for _, r := range rows {
		exp := effectiveExpiry(r.ExpiresAt, r.CreatedAt, maxAge)
		if exp == 0 || now <= exp {
			continue
		}
		if err := o.Queries.DeleteSharedLink(ctx, r.ID); err != nil {
			return nil, fmt.Errorf("failed to delete shared link %d: %w", r.ID, err)
		}
		revoked++
	}
	if revoked > 0 {
		o.audit(ctx, fmt.Sprintf("admin: %d expired shared links revoked by %s", revoked, o.callerName(ctx, callerID)))
		o.broadcastAdminEvent("shared-links.updated", nil)
	}
	return map[string]int64{"revoked": revoked}, nil
}

func (o *Operations) findSharedLink(ctx context.Context, id int64) (db.ListSharedLinksRow, bool) {
	rows, err := o.Queries.ListSharedLinks(ctx)
	if err != nil {
		return db.ListSharedLinksRow{}, false
	}
	for _, r := range rows {
		if r.ID == id {
			return r, true
		}
	}
	return db.ListSharedLinksRow{}, false
}
