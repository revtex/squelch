package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// ledColors are the LED colours the scanner can show.
var ledColors = map[string]bool{
	"": true, "blue": true, "cyan": true, "green": true, "magenta": true,
	"red": true, "white": true, "yellow": true, "orange": true,
}

func checkLed(led *string) error {
	if led == nil {
		return nil
	}
	if !ledColors[strings.ToLower(strings.TrimSpace(*led))] {
		return UserError("led must be one of blue, cyan, green, magenta, red, white, yellow or orange")
	}
	return nil
}

// blockedTalkgroups parses a system's blacklist JSON into sorted ids.
func blockedTalkgroups(raw *string) []int64 {
	out := []int64{}
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return out
	}
	if err := json.Unmarshal([]byte(*raw), &out); err != nil {
		return []int64{}
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func blockedJSON(ids []int64) *string {
	if len(ids) == 0 {
		return nil
	}
	b, _ := json.Marshal(ids)
	s := string(b)
	return &s
}

// SystemsList returns every system with its counts and recent activity:
// talkgroups, units, calls in the last 24 hours, the last call, and the
// talkgroups auto-populate skips.
func (o *Operations) SystemsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	systems, err := o.Queries.ListSystems(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list systems: %w", err)
	}
	tgCounts := map[int64]int64{}
	if rows, err := o.Queries.CountTalkgroupsPerSystem(ctx); err == nil {
		for _, r := range rows {
			tgCounts[r.SystemID] = r.Talkgroups
		}
	}
	unitCounts := map[int64]int64{}
	if rows, err := o.Queries.CountUnitsPerSystem(ctx); err == nil {
		for _, r := range rows {
			unitCounts[r.SystemID] = r.Units
		}
	}
	type stat struct{ recent, last int64 }
	stats := map[int64]stat{}
	if rows, err := o.Queries.SystemCallStats(ctx, time.Now().Add(-24*time.Hour).Unix()); err == nil {
		for _, r := range rows {
			stats[r.SystemID] = stat{r.CallsRecent, r.LastCall}
		}
	}

	out := make([]map[string]any, 0, len(systems))
	for _, s := range systems {
		m := mapSystem(s)
		m["talkgroups"] = tgCounts[s.ID]
		m["units"] = unitCounts[s.ID]
		m["calls24h"] = stats[s.ID].recent
		m["lastCall"] = nil
		if st := stats[s.ID]; st.last > 0 {
			m["lastCall"] = st.last
		}
		m["blocked"] = blockedTalkgroups(nullStr(s.BlacklistsJson))
		out = append(out, m)
	}
	return out, nil
}

type systemRequest struct {
	ID                     int64   `json:"id"`
	SystemID               int64   `json:"systemId"`
	Label                  string  `json:"label"`
	AutoPopulateTalkgroups int64   `json:"autoPopulateTalkgroups"`
	BlacklistsJson         *string `json:"blacklistsJson"`
	Led                    *string `json:"led"`
	Order                  int64   `json:"order"`
}

func (r *systemRequest) check() error {
	r.Label = strings.TrimSpace(r.Label)
	if r.Label == "" {
		return UserError("label is required")
	}
	if len(r.Label) > 64 {
		return UserError("label must be 64 characters or fewer")
	}
	if r.SystemID < 0 {
		return UserError("systemId must be 0 or more")
	}
	if r.AutoPopulateTalkgroups != 0 && r.AutoPopulateTalkgroups != 1 {
		return UserError("autoPopulateTalkgroups must be 0 or 1")
	}
	if r.Led != nil && strings.TrimSpace(*r.Led) == "" {
		r.Led = nil
	}
	if err := checkLed(r.Led); err != nil {
		return err
	}
	if r.BlacklistsJson != nil {
		if strings.TrimSpace(*r.BlacklistsJson) == "" {
			r.BlacklistsJson = nil
		} else {
			var ids []int64
			if err := json.Unmarshal([]byte(*r.BlacklistsJson), &ids); err != nil {
				return UserError("blacklistsJson must be a JSON list of talkgroup ids")
			}
		}
	}
	return nil
}

// SystemsCreate creates a new system.
func (o *Operations) SystemsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req systemRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	id, err := o.Queries.CreateSystem(ctx, db.CreateSystemParams{
		SystemID:               req.SystemID,
		Label:                  req.Label,
		AutoPopulateTalkgroups: req.AutoPopulateTalkgroups,
		BlacklistsJson:         ptrToNullStr(req.BlacklistsJson),
		Led:                    ptrToNullStr(req.Led),
		Order:                  req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError(fmt.Sprintf("system number %d is already in use", req.SystemID))
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create system: %w", err)
	}

	system, err := o.Queries.GetSystem(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created system: %w", err)
	}
	slog.Info("admin: system created", "id", system.ID, "system_id", system.SystemID, "label", system.Label, "by", callerID)
	o.audit(ctx, fmt.Sprintf("admin: system %q (number %d) created by %s", system.Label, system.SystemID, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("systems.updated", nil)
	o.broadcastCFG(ctx)
	return mapSystem(system), nil
}

// SystemsUpdate updates an existing system.
func (o *Operations) SystemsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req systemRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	before, err := o.Queries.GetSystem(ctx, req.ID)
	if err != nil {
		return nil, UserError("system not found")
	}

	err = o.Queries.UpdateSystem(ctx, db.UpdateSystemParams{
		ID:                     req.ID,
		SystemID:               req.SystemID,
		Label:                  req.Label,
		AutoPopulateTalkgroups: req.AutoPopulateTalkgroups,
		BlacklistsJson:         ptrToNullStr(req.BlacklistsJson),
		Led:                    ptrToNullStr(req.Led),
		Order:                  req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError(fmt.Sprintf("system number %d is already in use", req.SystemID))
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update system: %w", err)
	}

	system, err := o.Queries.GetSystem(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated system: %w", err)
	}
	slog.Info("admin: system updated", "id", system.ID, "system_id", system.SystemID, "by", callerID)
	var changes []string
	if before.Label != system.Label {
		changes = append(changes, fmt.Sprintf("label %q → %q", before.Label, system.Label))
	}
	if before.SystemID != system.SystemID {
		changes = append(changes, fmt.Sprintf("number %d → %d", before.SystemID, system.SystemID))
	}
	if before.AutoPopulateTalkgroups != system.AutoPopulateTalkgroups {
		if system.AutoPopulateTalkgroups == 1 {
			changes = append(changes, "talkgroup auto-populate on")
		} else {
			changes = append(changes, "talkgroup auto-populate off")
		}
	}
	if before.Led != system.Led {
		changes = append(changes, fmt.Sprintf("led %s → %s", orDefault(before.Led.String), orDefault(system.Led.String)))
	}
	if before.BlacklistsJson != system.BlacklistsJson {
		changes = append(changes, fmt.Sprintf("blocked talkgroups now %v", blockedTalkgroups(nullStr(system.BlacklistsJson))))
	}
	if len(changes) > 0 {
		o.audit(ctx, fmt.Sprintf("admin: system %q changed by %s: %s", system.Label, o.callerName(ctx, callerID), strings.Join(changes, ", ")))
	}
	o.broadcastAdminEvent("systems.updated", nil)
	o.broadcastCFG(ctx)
	return mapSystem(system), nil
}

func orDefault(s string) string {
	if s == "" {
		return "default"
	}
	return s
}

// SystemsDelete deletes a system with its talkgroups and units. Calls stay,
// labelled by their numbers only.
func (o *Operations) SystemsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	system, err := o.Queries.GetSystem(ctx, req.ID)
	if err != nil {
		return nil, UserError("system not found")
	}
	tgs, _ := o.Queries.ListTalkgroupsBySystem(ctx, req.ID)
	units, _ := o.Queries.ListUnitsBySystem(ctx, req.ID)

	if err := o.Queries.DeleteSystem(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete system: %w", err)
	}
	slog.Info("admin: system deleted", "id", req.ID, "by", callerID)
	o.audit(ctx, fmt.Sprintf("admin: system %q (number %d) deleted by %s with %d talkgroups and %d units",
		system.Label, system.SystemID, o.callerName(ctx, callerID), len(tgs), len(units)))
	o.broadcastAdminEvent("systems.updated", nil)
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastAdminEvent("units.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "talkgroups": len(tgs), "units": len(units)}, nil
}

// SystemsReorder stores the given order of system ids; systems not named
// keep their place after the named ones.
func (o *Operations) SystemsReorder(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.Unmarshal(params, &req); err != nil || len(req.IDs) == 0 {
		return nil, UserError("ids are required")
	}
	systems, err := o.Queries.ListSystems(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list systems: %w", err)
	}
	known := map[int64]bool{}
	for _, s := range systems {
		known[s.ID] = true
	}
	order := int64(0)
	seen := map[int64]bool{}
	for _, id := range req.IDs {
		if !known[id] || seen[id] {
			continue
		}
		seen[id] = true
		if err := o.Queries.UpdateSystemOrder(ctx, db.UpdateSystemOrderParams{Order: order, ID: id}); err != nil {
			return nil, fmt.Errorf("failed to reorder: %w", err)
		}
		order++
	}
	for _, s := range systems {
		if seen[s.ID] {
			continue
		}
		if err := o.Queries.UpdateSystemOrder(ctx, db.UpdateSystemOrderParams{Order: order, ID: s.ID}); err != nil {
			return nil, fmt.Errorf("failed to reorder: %w", err)
		}
		order++
	}
	o.audit(ctx, fmt.Sprintf("admin: systems reordered by %s", o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("systems.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]bool{"ok": true}, nil
}

// SystemsBlock adds a talkgroup number to a system's auto-populate skips;
// SystemsUnblock removes it. Existing talkgroups and calls are untouched.
func (o *Operations) SystemsBlock(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	return o.setBlocked(ctx, params, callerID, true)
}

// SystemsUnblock removes a talkgroup number from a system's auto-populate skips.
func (o *Operations) SystemsUnblock(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	return o.setBlocked(ctx, params, callerID, false)
}

func (o *Operations) setBlocked(ctx context.Context, params json.RawMessage, callerID int64, block bool) (any, error) {
	var req struct {
		ID          int64 `json:"id"`
		TalkgroupID int64 `json:"talkgroupId"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if req.TalkgroupID < 0 {
		return nil, UserError("talkgroupId must be 0 or more")
	}
	system, err := o.Queries.GetSystem(ctx, req.ID)
	if err != nil {
		return nil, UserError("system not found")
	}
	ids := blockedTalkgroups(nullStr(system.BlacklistsJson))
	next := make([]int64, 0, len(ids)+1)
	for _, id := range ids {
		if id != req.TalkgroupID {
			next = append(next, id)
		}
	}
	if block {
		next = append(next, req.TalkgroupID)
		sort.Slice(next, func(i, j int) bool { return next[i] < next[j] })
	}
	if err := o.Queries.UpdateSystemBlacklists(ctx, db.UpdateSystemBlacklistsParams{
		BlacklistsJson: ptrToNullStr(blockedJSON(next)), ID: req.ID,
	}); err != nil {
		return nil, fmt.Errorf("failed to update blocked talkgroups: %w", err)
	}
	verb := "blocked from auto-populate on"
	if !block {
		verb = "unblocked on"
	}
	o.audit(ctx, fmt.Sprintf("admin: talkgroup %d %s system %q by %s", req.TalkgroupID, verb, system.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("systems.updated", nil)
	return map[string]any{"ok": true, "blocked": next}, nil
}
