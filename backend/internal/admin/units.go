package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/revtex/squelch/internal/db"
)

// UnitsList returns units filtered by optional systemId + unitIdPattern.
func (o *Operations) UnitsList(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID      *int64  `json:"systemId"`
		UnitIDPattern *string `json:"unitIdPattern"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req) // ignore parse errors — treat as no filter
	}

	var units []db.Unit
	var err error
	if req.SystemID != nil {
		units, err = o.Queries.ListUnitsBySystem(ctx, *req.SystemID)
	} else {
		units, err = o.Queries.ListAllUnits(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list units: %w", err)
	}

	// Apply unit_id pattern filter if provided (prefix matching).
	if req.UnitIDPattern != nil && *req.UnitIDPattern != "" {
		filtered := make([]db.Unit, 0, len(units))
		for _, u := range units {
			if strings.HasPrefix(strconv.FormatInt(u.UnitID, 10), *req.UnitIDPattern) {
				filtered = append(filtered, u)
			}
		}
		units = filtered
	}

	out := mapUnits(units)
	// One system's units carry when each was last heard.
	if req.SystemID != nil {
		last := map[int64]int64{}
		if rows, err := o.Queries.UnitCallStats(ctx, *req.SystemID); err == nil {
			for _, r := range rows {
				if r.Source.Valid {
					last[r.Source.Int64] = r.LastCall
				}
			}
		}
		for i, u := range units {
			out[i]["lastHeard"] = nil
			if at, ok := last[u.UnitID]; ok && at > 0 {
				out[i]["lastHeard"] = at
			}
		}
	}
	return out, nil
}

// UnitsCreate creates a new unit.
func (o *Operations) UnitsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		SystemID int64   `json:"systemId"`
		UnitID   int64   `json:"unitId"`
		Label    *string `json:"label"`
		Order    int64   `json:"order"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}

	id, err := o.Queries.CreateUnit(ctx, db.CreateUnitParams{
		SystemID: req.SystemID,
		UnitID:   req.UnitID,
		Label:    ptrToNullStr(req.Label),
		Order:    req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError("unit already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create unit: %w", err)
	}

	unit, err := o.Queries.GetUnit(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created unit: %w", err)
	}
	slog.Info("admin: unit created", "id", unit.ID, "unit_id", unit.UnitID, "by", callerID)
	o.broadcastAdminEvent("units.updated", nil)
	return mapUnit(unit), nil
}

// UnitsUpdate updates an existing unit.
func (o *Operations) UnitsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID     int64   `json:"id"`
		UnitID int64   `json:"unitId"`
		Label  *string `json:"label"`
		Order  int64   `json:"order"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	if _, err := o.Queries.GetUnit(ctx, req.ID); err != nil {
		return nil, UserError("unit not found")
	}

	err := o.Queries.UpdateUnit(ctx, db.UpdateUnitParams{
		ID:     req.ID,
		UnitID: req.UnitID,
		Label:  ptrToNullStr(req.Label),
		Order:  req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError("unit already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update unit: %w", err)
	}

	unit, err := o.Queries.GetUnit(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated unit: %w", err)
	}
	slog.Info("admin: unit updated", "id", unit.ID, "unit_id", unit.UnitID, "by", callerID)
	o.broadcastAdminEvent("units.updated", nil)
	return mapUnit(unit), nil
}

// UnitsDelete deletes a unit.
func (o *Operations) UnitsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	if _, err := o.Queries.GetUnit(ctx, req.ID); err != nil {
		return nil, UserError("unit not found")
	}

	if err := o.Queries.DeleteUnit(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete unit: %w", err)
	}
	slog.Info("admin: unit deleted", "id", req.ID, "by", callerID)
	o.broadcastAdminEvent("units.updated", nil)
	return map[string]bool{"ok": true}, nil
}
