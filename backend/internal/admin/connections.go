package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/geoip"
)

const (
	historyDefaultPageSize = 100
	historyMaxPageSize     = 200
)

// ConnectionsList returns every live connection: listener and admin
// WebSockets and background audio streams, oldest first.
func (o *Operations) ConnectionsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	self := callerFrom(ctx).ConnID
	live := o.Deps.Connections.List()
	items := make([]map[string]any, 0, len(live))
	for _, c := range live {
		m := mapConnection(c)
		m["self"] = self != "" && c.ID == self
		m["trusted"] = o.Deps.IPBlocks.Trusted(c.IP, c.Peer)
		items = append(items, m)
	}
	return map[string]any{"connections": items, "geoip": o.geoipInfo()}, nil
}

// SessionsList returns every signed-in device — the refresh-token families
// that can still mint an access token — optionally for one account. Each
// carries how many live connections it has open right now.
func (o *Operations) SessionsList(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		UserID *int64 `json:"userId"`
	}
	if len(params) > 0 && string(params) != "null" {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, UserError("invalid request body")
		}
	}
	var userID any
	if req.UserID != nil {
		userID = *req.UserID
	}
	rows, err := o.Queries.ListActiveSessions(ctx, db.ListActiveSessionsParams{
		Now:    time.Now().Unix(),
		UserID: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %w", err)
	}

	current := callerFrom(ctx).FamilyID
	liveByFamily := map[string]int{}
	for _, c := range o.Deps.Connections.List() {
		if c.FamilyID != "" {
			liveByFamily[c.FamilyID]++
		}
	}

	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		items = append(items, map[string]any{
			"familyId":        r.FamilyID,
			"userId":          r.UserID,
			"username":        r.Username,
			"role":            r.Role,
			"ip":              nullStr(r.Ip),
			"userAgent":       nullStr(r.UserAgent),
			"native":          r.Native != 0,
			"signedInAt":      nullInt(r.SignedInAt),
			"lastUsedAt":      r.LastUsedAt,
			"expiresAt":       r.ExpiresAt,
			"liveConnections": liveByFamily[r.FamilyID],
			"current":         current != "" && r.FamilyID == current,
			"trusted":         r.Ip.Valid && o.trustedAddr(r.Ip.String),
			"country":         o.countryOf(r.Ip),
			"local":           r.Ip.Valid && isLocal(r.Ip.String),
		})
	}
	return map[string]any{"sessions": items, "geoip": o.geoipInfo()}, nil
}

// ConnectionsHistory pages through past and present connections, newest
// first, filtered by address, account, kind and time range.
func (o *Operations) ConnectionsHistory(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		IP       string `json:"ip"`
		UserID   *int64 `json:"userId"`
		Kind     string `json:"kind"`
		Since    *int64 `json:"since"`
		Until    *int64 `json:"until"`
		Page     int64  `json:"page"`
		PageSize int64  `json:"pageSize"`
	}
	if len(params) > 0 && string(params) != "null" {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, UserError("invalid request body")
		}
	}

	var ip, userID, kind, since, until any
	if req.IP != "" {
		addr, err := netip.ParseAddr(req.IP)
		if err != nil {
			return nil, UserError("ip is not a valid address")
		}
		// Stored the way the registry writes it.
		ip = addr.Unmap().String()
	}
	if req.UserID != nil {
		userID = *req.UserID
	}
	switch connections.Kind(req.Kind) {
	case "":
	case connections.KindListener, connections.KindAdmin, connections.KindStream:
		kind = req.Kind
	default:
		return nil, UserError("kind must be listener, admin or stream")
	}
	if req.Since != nil {
		since = *req.Since
	}
	if req.Until != nil {
		until = *req.Until
	}
	if req.Page < 1 {
		req.Page = 1
	}
	switch {
	case req.PageSize <= 0:
		req.PageSize = historyDefaultPageSize
	case req.PageSize > historyMaxPageSize:
		req.PageSize = historyMaxPageSize
	}

	rows, err := o.Queries.ListConnectionLog(ctx, db.ListConnectionLogParams{
		Ip: ip, UserID: userID, Kind: kind, Since: since, Until: until,
		Limit:  req.PageSize,
		Offset: (req.Page - 1) * req.PageSize,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list connection history: %w", err)
	}
	total, err := o.Queries.CountConnectionLog(ctx, db.CountConnectionLogParams{
		Ip: ip, UserID: userID, Kind: kind, Since: since, Until: until,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to count connection history: %w", err)
	}

	items := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		items = append(items, map[string]any{
			"id":               r.ID,
			"kind":             r.Kind,
			"userId":           nullInt(r.UserID),
			"username":         nullStr(r.Username),
			"ip":               r.Ip,
			"userAgent":        nullStr(r.UserAgent),
			"native":           r.Native != 0,
			"familyId":         nullStr(r.FamilyID),
			"connectedAt":      r.ConnectedAt,
			"disconnectedAt":   nullInt(r.DisconnectedAt),
			"disconnectReason": nullStr(r.DisconnectReason),
			"trusted":          o.trustedAddr(r.Ip),
			"country":          nullStr(r.CountryCode),
			"local":            isLocal(r.Ip),
		})
	}
	return map[string]any{
		"items":         items,
		"total":         total,
		"page":          req.Page,
		"pageSize":      req.PageSize,
		"retentionDays": connections.RetentionDays(ctx, o.Queries),
		"geoip":         o.geoipInfo(),
	}, nil
}

// ConnectionsDisconnect ends one live connection. Nothing is revoked: a
// signed-in listener's app reconnects on its own, so this is for a stuck or
// unwanted connection, not for keeping someone out.
func (o *Operations) ConnectionsDisconnect(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID == "" {
		return nil, UserError("id is required")
	}
	conn, ok := o.Deps.Connections.Get(req.ID)
	if !ok {
		return nil, UserError("that connection has already ended")
	}
	o.Deps.Connections.CloseFor(connections.ReasonAdmin, func(c connections.Conn) bool {
		return c.ID == req.ID
	})

	o.audit(ctx, fmt.Sprintf("admin: disconnected %s %s by %s",
		kindLabel(conn.Kind), describeConn(conn), o.callerName(ctx, callerID)))
	slog.Info("admin: connection disconnected", "kind", conn.Kind, "user_id", conn.UserID,
		"ip", conn.IP.String(), "by", callerID)
	return map[string]bool{"ok": true}, nil
}

// SessionsRevoke signs one device out: its refresh tokens are revoked, the
// access tokens it already holds are refused, and its live connections end.
func (o *Operations) SessionsRevoke(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		FamilyID string `json:"familyId"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.FamilyID == "" {
		return nil, UserError("familyId is required")
	}
	owner, err := o.Queries.GetActiveSessionOwner(ctx, db.GetActiveSessionOwnerParams{
		FamilyID: req.FamilyID,
		Now:      time.Now().Unix(),
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, UserError("that device is already signed out")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to look up session: %w", err)
	}

	if err := o.Queries.RevokeRefreshTokenFamily(ctx, req.FamilyID); err != nil {
		return nil, fmt.Errorf("failed to revoke session: %w", err)
	}
	auth.Tokens.RevokeFamily(req.FamilyID)
	closed := o.Deps.Connections.CloseFor(connections.ReasonSignout, func(c connections.Conn) bool {
		return c.FamilyID == req.FamilyID
	})

	o.audit(ctx, fmt.Sprintf("admin: signed out a device of %s by %s",
		owner.Username, o.callerName(ctx, callerID)))
	slog.Info("admin: device signed out", "user_id", owner.UserID, "connections_closed", closed, "by", callerID)
	// The device list changes even when no connection closed.
	o.broadcastAdminEvent("connections.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// UsersSignout signs an account out on every device.
func (o *Operations) UsersSignout(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	user, err := o.Queries.GetUser(ctx, req.ID)
	if err != nil {
		return nil, UserError("user not found")
	}

	if err := o.signOutEverywhere(ctx, req.ID); err != nil {
		return nil, err
	}

	o.audit(ctx, fmt.Sprintf("admin: signed out %s on every device by %s",
		user.Username, o.callerName(ctx, callerID)))
	slog.Info("admin: user signed out everywhere", "user_id", req.ID, "by", callerID)
	o.broadcastAdminEvent("connections.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// signOutEverywhere revokes every device session of an account, refuses the
// access tokens it holds, and ends its live connections.
func (o *Operations) signOutEverywhere(ctx context.Context, userID int64) error {
	if err := o.Queries.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return fmt.Errorf("failed to revoke sessions: %w", err)
	}
	auth.Tokens.RevokeAllForUser(userID)
	o.disconnectByUser(userID)
	return nil
}

// audit writes a line to Admin → Logs.
func (o *Operations) audit(ctx context.Context, message string) {
	if err := o.Queries.CreateLog(ctx, db.CreateLogParams{
		DateTime: time.Now().Unix(),
		Level:    "info",
		Message:  message,
	}); err != nil {
		slog.Warn("admin: failed to write audit log", "error", err)
	}
}

// callerName is the acting admin's username, for audit lines.
func (o *Operations) callerName(ctx context.Context, callerID int64) string {
	if u, err := o.Queries.GetUser(ctx, callerID); err == nil {
		return u.Username
	}
	return fmt.Sprintf("user #%d", callerID)
}

// kindLabel is the word the admin UI shows for a connection kind.
func kindLabel(k connections.Kind) string {
	switch k {
	case connections.KindListener:
		return "LIVE"
	case connections.KindStream:
		return "BKGND"
	case connections.KindAdmin:
		return "Admin"
	}
	return string(k)
}

// describeConn is "alice@203.0.113.9", or "anonymous@…" for public access.
func describeConn(c connections.Conn) string {
	who := c.Username
	if who == "" {
		who = "anonymous"
	}
	ip := "unknown"
	if c.IP.IsValid() {
		ip = c.IP.String()
	}
	return who + "@" + ip
}

// mapConnection is the admin's view of a live connection. The JTI stays
// server-side: it is a bearer-token identifier, and the connection ID is
// all an admin needs to act on one.
func mapConnection(c connections.Conn) map[string]any {
	var userID any
	if c.UserID != 0 {
		userID = c.UserID
	}
	var ip any
	if c.IP.IsValid() {
		ip = c.IP.String()
	}
	var familyID any
	if c.FamilyID != "" {
		familyID = c.FamilyID
	}
	var country any
	if c.Country != "" {
		country = c.Country
	}
	return map[string]any{
		"id":          c.ID,
		"kind":        c.Kind,
		"userId":      userID,
		"username":    c.Username,
		"role":        c.Role,
		"familyId":    familyID,
		"ip":          ip,
		"userAgent":   c.UserAgent,
		"native":      c.Native,
		"protocol":    c.Protocol,
		"connectedAt": c.ConnectedAt.Unix(),
		"country":     country,
		"local":       c.IP.IsValid() && geoip.IsLocal(c.IP),
	}
}

// geoipInfo tells the admin UI whether to show a country column, and the
// credit the database's licence asks for when it does.
func (o *Operations) geoipInfo() map[string]any {
	if o.Deps.GeoIP == nil {
		return map[string]any{"enabled": false, "credit": nil}
	}
	var credit any
	if c := o.Deps.GeoIP.Credit(); c != nil {
		credit = c
	}
	return map[string]any{"enabled": true, "credit": credit}
}

// countryOf resolves a device's last address now: unlike a connection, a
// device has no moment of connecting to resolve it at.
func (o *Operations) countryOf(ip sql.NullString) any {
	if !ip.Valid {
		return nil
	}
	a, err := netip.ParseAddr(ip.String)
	if err != nil {
		return nil
	}
	if code := o.Deps.GeoIP.Country(a); code != "" {
		return code
	}
	return nil
}

// isLocal reports a private, loopback or link-local address, shown as
// "Local network" instead of a country.
func isLocal(ip string) bool {
	a, err := netip.ParseAddr(ip)
	return err == nil && geoip.IsLocal(a)
}
