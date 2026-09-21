package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/revtex/squelch/internal/db"
)

// ExportConfig returns the full config (settings, systems, talkgroups, …)
// shaped for import.go to round-trip.
func (o *Operations) ExportConfig(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	allSettings, err := o.Queries.ListSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export settings: %w", err)
	}
	settings := make([]db.Setting, 0, len(allSettings))
	for _, s := range allSettings {
		if !serverOnlySettingKeys[s.Key] {
			settings = append(settings, s)
		}
	}
	users, err := o.Queries.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export users: %w", err)
	}
	systems, err := o.Queries.ListSystems(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export systems: %w", err)
	}
	talkgroups, err := o.Queries.ListAllTalkgroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export talkgroups: %w", err)
	}
	units, err := o.Queries.ListAllUnits(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export units: %w", err)
	}
	groups, err := o.Queries.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export groups: %w", err)
	}
	tags, err := o.Queries.ListTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export tags: %w", err)
	}
	apiKeys, err := o.Queries.ListAPIKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export api keys: %w", err)
	}
	dirmonitors, err := o.Queries.ListDirMonitors(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export dirmonitors: %w", err)
	}
	downstreams, err := o.Queries.ListDownstreams(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export downstreams: %w", err)
	}
	webhooks, err := o.Queries.ListWebhooks(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to export webhooks: %w", err)
	}

	// Export all fields — use snake_case keys to match db struct JSON tags.
	// API keys include the hashed key so import can restore authentication.
	// Downstream API keys and webhook secrets are included for full backup.
	// The exported JSON file should be treated as sensitive.
	exportAPIKeys := make([]map[string]any, len(apiKeys))
	for i, k := range apiKeys {
		exportAPIKeys[i] = map[string]any{
			"id":              k.ID,
			"key":             k.Key,
			"ident":           nullStr(k.Ident),
			"disabled":        k.Disabled,
			"systems_json":    nullStr(k.SystemsJson),
			"call_rate_limit": nullInt(k.CallRateLimit),
			"order":           k.Order,
		}
	}
	exportDownstreams := make([]map[string]any, len(downstreams))
	for i, d := range downstreams {
		exportDownstreams[i] = map[string]any{
			"id":           d.ID,
			"url":          d.Url,
			"api_key":      d.ApiKey,
			"systems_json": nullStr(d.SystemsJson),
			"disabled":     d.Disabled,
			"order":        d.Order,
		}
	}
	exportWebhooks := make([]map[string]any, len(webhooks))
	for i, w := range webhooks {
		exportWebhooks[i] = map[string]any{
			"id":           w.ID,
			"url":          w.Url,
			"type":         w.Type,
			"secret":       nullStr(w.Secret),
			"systems_json": nullStr(w.SystemsJson),
			"disabled":     w.Disabled,
			"order":        w.Order,
		}
	}

	return map[string]any{
		"settings":    settings,
		"users":       users,
		"systems":     systems,
		"talkgroups":  talkgroups,
		"units":       units,
		"groups":      groups,
		"tags":        tags,
		"apiKeys":     exportAPIKeys,
		"dirmonitors": dirmonitors,
		"downstreams": exportDownstreams,
		"webhooks":    exportWebhooks,
	}, nil
}

// ExportTalkgroups returns a CSV export of talkgroups for a given system.
func (o *Operations) ExportTalkgroups(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID *int64 `json:"systemId"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req)
	}
	if req.SystemID == nil {
		return nil, fmt.Errorf("systemId is required")
	}

	talkgroups, err := o.Queries.ListTalkgroupsBySystem(ctx, *req.SystemID)
	if err != nil {
		return nil, fmt.Errorf("failed to list talkgroups: %w", err)
	}

	// Build ID→label maps so we can emit portable text names instead of
	// PK integers (PKs are not stable across instances).
	groupMap := make(map[int64]string)
	if gs, err := o.Queries.ListGroups(ctx); err == nil {
		for _, g := range gs {
			groupMap[g.ID] = g.Label
		}
	}
	tagMap := make(map[int64]string)
	if ts, err := o.Queries.ListTags(ctx); err == nil {
		for _, t := range ts {
			tagMap[t.ID] = t.Label
		}
	}

	var buf strings.Builder
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"talkgroup_id", "label", "name", "tag", "group", "frequency", "led", "order"})
	for _, tg := range talkgroups {
		freq := ""
		if tg.Frequency.Valid {
			freq = strconv.FormatInt(tg.Frequency.Int64, 10)
		}
		groupLabel := ""
		if tg.GroupID.Valid {
			groupLabel = groupMap[tg.GroupID.Int64]
		}
		tagLabel := ""
		if tg.TagID.Valid {
			tagLabel = tagMap[tg.TagID.Int64]
		}
		_ = w.Write([]string{
			strconv.FormatInt(tg.TalkgroupID, 10),
			tg.Label.String,
			tg.Name.String,
			tagLabel,
			groupLabel,
			freq,
			tg.Led.String,
			strconv.FormatInt(tg.Order, 10),
		})
	}
	w.Flush()

	return buf.String(), nil
}

// ExportUnits returns a CSV export of units for a given system.
func (o *Operations) ExportUnits(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID *int64 `json:"systemId"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req)
	}
	if req.SystemID == nil {
		return nil, fmt.Errorf("systemId is required")
	}

	units, err := o.Queries.ListUnitsBySystem(ctx, *req.SystemID)
	if err != nil {
		return nil, fmt.Errorf("failed to list units: %w", err)
	}

	var buf strings.Builder
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"unit_id", "label", "order"})
	for _, u := range units {
		_ = w.Write([]string{
			strconv.FormatInt(u.UnitID, 10),
			u.Label.String,
			strconv.FormatInt(u.Order, 10),
		})
	}
	w.Flush()

	return buf.String(), nil
}

// ExportGroups returns a CSV export of groups.
func (o *Operations) ExportGroups(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	groups, err := o.Queries.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list groups: %w", err)
	}
	var buf strings.Builder
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"label"})
	for _, g := range groups {
		_ = w.Write([]string{g.Label})
	}
	w.Flush()
	return buf.String(), nil
}

// ExportTags returns a CSV export of tags.
func (o *Operations) ExportTags(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	tags, err := o.Queries.ListTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %w", err)
	}
	var buf strings.Builder
	w := csv.NewWriter(&buf)
	_ = w.Write([]string{"label"})
	for _, t := range tags {
		_ = w.Write([]string{t.Label})
	}
	w.Flush()
	return buf.String(), nil
}
