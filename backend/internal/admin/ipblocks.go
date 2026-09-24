package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/ipblock"
)

const maxBlockReasonLen = 200

// IPBlocksList returns the blocks in force, the addresses that can never be
// blocked, and the caller's own address.
func (o *Operations) IPBlocksList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	rows, err := o.Queries.ListActiveIPBlocks(ctx, sql.NullInt64{Int64: time.Now().Unix(), Valid: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list ip blocks: %w", err)
	}
	blocks := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		blocks = append(blocks, map[string]any{
			"id":        r.ID,
			"cidr":      r.Cidr,
			"reason":    r.Reason,
			"createdBy": nullStr(r.CreatedByUsername),
			"createdAt": r.CreatedAt,
			"expiresAt": nullInt(r.ExpiresAt),
		})
	}
	trusted := []string{"127.0.0.0/8", "::1/128"}
	for _, p := range o.Deps.IPBlocks.TrustedList() {
		trusted = append(trusted, p.String())
	}
	var yours any
	if ip := o.callerAddr(ctx); ip.IsValid() {
		yours = ip.String()
	}
	return map[string]any{
		"enabled":     o.Deps.IPBlocks != nil,
		"blocks":      blocks,
		"trusted":     trusted,
		"yourAddress": yours,
	}, nil
}

// IPBlocksCreate blocks an address or range and drops every live connection
// from it. A range that holds the caller's own address is refused unless
// force is set; the response then asks for confirmation instead.
func (o *Operations) IPBlocksCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		Address   string `json:"address"`
		Reason    string `json:"reason"`
		ExpiresAt *int64 `json:"expiresAt"`
		Force     bool   `json:"force"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	m := o.Deps.IPBlocks
	if m == nil {
		return nil, UserError("address blocking is not available")
	}
	p, err := m.Check(req.Address)
	var gerr ipblock.GuardError
	if errors.As(err, &gerr) {
		return nil, UserError(string(gerr))
	}
	if err != nil {
		return nil, err
	}
	req.Reason = strings.TrimSpace(req.Reason)
	if utf8.RuneCountInString(req.Reason) > maxBlockReasonLen {
		return nil, UserError(fmt.Sprintf("reason must be at most %d characters", maxBlockReasonLen))
	}
	now := time.Now().Unix()
	var expires sql.NullInt64
	if req.ExpiresAt != nil {
		if *req.ExpiresAt <= now {
			return nil, UserError("expiry must be in the future")
		}
		expires = sql.NullInt64{Int64: *req.ExpiresAt, Valid: true}
	}
	if own := o.callerAddr(ctx); own.IsValid() && ipblock.Covers(p, own) && !req.Force {
		return map[string]any{
			"needsConfirm": true,
			"cidr":         p.String(),
			"message": fmt.Sprintf("%s includes your own address, %s. Blocking it will disconnect you, "+
				"and you will not be able to reach this server from here until the block is removed "+
				"from another address.", p, own),
		}, nil
	}

	id, err := o.Queries.CreateIPBlock(ctx, db.CreateIPBlockParams{
		Cidr:      p.String(),
		Reason:    req.Reason,
		CreatedBy: sql.NullInt64{Int64: callerID, Valid: callerID > 0},
		CreatedAt: now,
		ExpiresAt: expires,
	})
	if isUniqueViolation(err) {
		return nil, UserError(p.String() + " is already blocked")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create ip block: %w", err)
	}
	if err := m.Reload(ctx, o.Queries); err != nil {
		return nil, err
	}

	closed := o.Deps.Connections.CloseFor(connections.ReasonBlocked, func(c connections.Conn) bool {
		return ipblock.Covers(p, c.IP) && !m.Trusted(c.IP, c.Peer)
	})

	msg := fmt.Sprintf("admin: blocked %s by %s", p, o.callerName(ctx, callerID))
	if req.Reason != "" {
		msg += " (" + req.Reason + ")"
	}
	if expires.Valid {
		msg += " until " + time.Unix(expires.Int64, 0).UTC().Format(time.RFC3339)
	}
	o.audit(ctx, msg)
	slog.Info("admin: address blocked", "cidr", p.String(), "connections_closed", closed, "by", callerID)
	o.broadcastAdminEvent("ipblocks.updated", nil)
	return map[string]any{"ok": true, "id": id, "cidr": p.String(), "closed": closed}, nil
}

// IPBlocksDelete lifts a block.
func (o *Operations) IPBlocksDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	b, err := o.Queries.GetIPBlock(ctx, req.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, UserError("that block has already been removed")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to look up ip block: %w", err)
	}
	if err := o.Queries.DeleteIPBlock(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete ip block: %w", err)
	}
	if err := o.Deps.IPBlocks.Reload(ctx, o.Queries); err != nil {
		return nil, err
	}
	o.audit(ctx, fmt.Sprintf("admin: unblocked %s by %s", b.Cidr, o.callerName(ctx, callerID)))
	slog.Info("admin: address unblocked", "cidr", b.Cidr, "by", callerID)
	o.broadcastAdminEvent("ipblocks.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// callerAddr is the address the calling admin connection came from.
func (o *Operations) callerAddr(ctx context.Context) netip.Addr {
	c, ok := o.Deps.Connections.Get(callerFrom(ctx).ConnID)
	if !ok {
		return netip.Addr{}
	}
	return c.IP
}

// trustedAddr reports whether an address shown on a row can never be
// blocked, so the UI can leave "Block address" off it.
func (o *Operations) trustedAddr(ip string) bool {
	a, err := netip.ParseAddr(ip)
	return err == nil && o.Deps.IPBlocks.TrustedAddr(a)
}
