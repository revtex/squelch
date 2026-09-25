package admin

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// exportConfigData gathers the full configuration (settings, users without
// passwords, systems, talkgroups, units, groups, tags, API keys, folder
// monitors, forwarding targets and webhooks) in the shape ImportConfig
// reads back. API keys carry their hashed key, forwarding targets their
// key and webhooks their secret, so the file is sensitive.
func (o *Operations) exportConfigData(ctx context.Context) (map[string]any, error) {
	live, err := o.loadLiveConfig(ctx)
	if err != nil {
		return nil, err
	}
	settings := make([]db.Setting, 0, len(live.Settings))
	for _, s := range live.Settings {
		if !serverOnlySettingKeys[s.Key] {
			settings = append(settings, s)
		}
	}
	return map[string]any{
		"settings":    settings,
		"users":       live.Users,
		"systems":     live.Systems,
		"talkgroups":  live.Talkgroups,
		"units":       live.Units,
		"groups":      live.Groups,
		"tags":        live.Tags,
		"apiKeys":     flattenAPIKeys(live.APIKeys),
		"dirmonitors": live.DirMonitors,
		"downstreams": flattenDownstreams(live.Downstreams),
		"webhooks":    flattenWebhooks(live.Webhooks),
	}, nil
}

// ExportConfig is the configuration backup download. It remembers when it
// was taken, for the Backup & import page.
func (o *Operations) ExportConfig(ctx context.Context, _ json.RawMessage, callerID int64) (any, error) {
	data, err := o.exportConfigData(ctx)
	if err != nil {
		return nil, err
	}
	if err := o.Queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: configBackupLastAtKey, Value: strconv.FormatInt(time.Now().Unix(), 10)}); err != nil {
		return nil, fmt.Errorf("failed to record the backup time: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: configuration backup downloaded by %s", o.callerName(ctx, callerID)))
	return data, nil
}

// ExportTalkgroups returns a CSV of one system's talkgroups, or of every
// system's with the system number in a leading column.
func (o *Operations) ExportTalkgroups(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID *int64 `json:"systemId"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req)
	}

	var talkgroups []db.Talkgroup
	var err error
	if req.SystemID != nil {
		talkgroups, err = o.Queries.ListTalkgroupsBySystem(ctx, *req.SystemID)
	} else {
		talkgroups, err = o.Queries.ListAllTalkgroups(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list talkgroups: %w", err)
	}
	systemNums, err := o.systemNumbersByPK(ctx)
	if err != nil {
		return nil, err
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
	header := []string{"talkgroup_id", "label", "name", "tag", "group", "frequency", "led", "order"}
	if req.SystemID == nil {
		header = append([]string{"system"}, header...)
	}
	_ = w.Write(header)
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
		rec := []string{
			strconv.FormatInt(tg.TalkgroupID, 10),
			tg.Label.String,
			tg.Name.String,
			tagLabel,
			groupLabel,
			freq,
			tg.Led.String,
			strconv.FormatInt(tg.Order, 10),
		}
		if req.SystemID == nil {
			rec = append([]string{strconv.FormatInt(systemNums[tg.SystemID], 10)}, rec...)
		}
		_ = w.Write(rec)
	}
	w.Flush()

	return buf.String(), nil
}

// systemNumbersByPK maps system PKs to radio system numbers, for exports
// that span systems.
func (o *Operations) systemNumbersByPK(ctx context.Context) (map[int64]int64, error) {
	systems, err := o.Queries.ListSystems(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list systems: %w", err)
	}
	return systemNumbers(systems), nil
}

// ExportUnits returns a CSV of one system's units, or of every system's
// with the system number in a leading column.
func (o *Operations) ExportUnits(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID *int64 `json:"systemId"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req)
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
	systemNums, err := o.systemNumbersByPK(ctx)
	if err != nil {
		return nil, err
	}

	var buf strings.Builder
	w := csv.NewWriter(&buf)
	header := []string{"unit_id", "label", "order"}
	if req.SystemID == nil {
		header = append([]string{"system"}, header...)
	}
	_ = w.Write(header)
	for _, u := range units {
		rec := []string{
			strconv.FormatInt(u.UnitID, 10),
			u.Label.String,
			strconv.FormatInt(u.Order, 10),
		}
		if req.SystemID == nil {
			rec = append([]string{strconv.FormatInt(systemNums[u.SystemID], 10)}, rec...)
		}
		_ = w.Write(rec)
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
