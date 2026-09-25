package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/netip"
)

// LockoutsList returns every address the sign-in limiter is keeping out, or
// counting failures for, locked-out ones first.
func (o *Operations) LockoutsList(_ context.Context, _ json.RawMessage, _ int64) (any, error) {
	items := []map[string]any{}
	if o.Deps.LoginLimiter != nil {
		for _, l := range o.Deps.LoginLimiter.List() {
			var until any
			if !l.LockedUntil.IsZero() {
				until = l.LockedUntil.Unix()
			}
			items = append(items, map[string]any{
				"ip":          l.IP,
				"failures":    l.Failures,
				"lockedUntil": until,
				"lastFailure": l.LastFailure.Unix(),
			})
		}
	}
	return map[string]any{"lockouts": items}, nil
}

// LockoutsClear forgets an address's failed sign-ins so it can try again.
func (o *Operations) LockoutsClear(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		IP string `json:"ip"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if _, err := netip.ParseAddr(req.IP); err != nil {
		return nil, UserError("ip is not a valid address")
	}
	if o.Deps.LoginLimiter == nil || !o.Deps.LoginLimiter.Clear(req.IP) {
		return nil, UserError("that address is not locked out")
	}
	o.audit(ctx, fmt.Sprintf("admin: sign-in lockout for %s cleared by %s", req.IP, o.callerName(ctx, callerID)))
	return nil, nil
}
