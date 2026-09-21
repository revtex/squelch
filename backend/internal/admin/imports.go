package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// importAPIKey, importDownstream, and importWebhook mirror the flat shape
// emitted by ExportConfig (plain string/null instead of {String,Valid}
// blobs). Unmarshalling directly into the db.* structs would fail for any
// non-null nullable field because sql.NullString has no JSON unmarshaler.
type importAPIKey struct {
	Key           string  `json:"key"`
	Ident         *string `json:"ident"`
	Disabled      int64   `json:"disabled"`
	SystemsJson   *string `json:"systems_json"`
	CallRateLimit *int64  `json:"call_rate_limit"`
	Order         int64   `json:"order"`
}

type importDownstream struct {
	Url         string  `json:"url"`
	ApiKey      string  `json:"api_key"`
	SystemsJson *string `json:"systems_json"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
}

type importWebhook struct {
	Url         string  `json:"url"`
	Type        string  `json:"type"`
	Secret      *string `json:"secret"`
	SystemsJson *string `json:"systems_json"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
}

// ImportConfig applies a full config backup atomically, remapping foreign
// keys between the source and destination databases.
func (o *Operations) ImportConfig(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var data struct {
		Settings    []db.Setting       `json:"settings"`
		Groups      []db.Group         `json:"groups"`
		Tags        []db.Tag           `json:"tags"`
		Systems     []db.System        `json:"systems"`
		Talkgroups  []db.Talkgroup     `json:"talkgroups"`
		Units       []db.Unit          `json:"units"`
		APIKeys     []importAPIKey     `json:"apiKeys"`
		DirMonitors []db.Dirmonitor    `json:"dirmonitors"`
		Downstreams []importDownstream `json:"downstreams"`
		Webhooks    []importWebhook    `json:"webhooks"`
	}
	if err := json.Unmarshal(params, &data); err != nil {
		slog.Warn("import config: failed to parse payload", "error", err)
		return nil, UserError("invalid backup file: " + err.Error())
	}

	// Validate encrypted values: reject if no key configured, or if the wrong key is configured.
	encKey := o.Deps.EncryptionKey
	for _, s := range data.Settings {
		if SensitiveSettingKeys[s.Key] && auth.IsEncrypted(s.Value) {
			if encKey == "" {
				return nil, UserError("backup contains encrypted settings but no encryption key is configured — set --encryption-key before importing")
			}
			if _, err := auth.DecryptString(s.Value, encKey); err != nil {
				return nil, UserError("backup contains encrypted settings that cannot be decrypted with the current encryption key — check that --encryption-key matches the key used when the backup was created")
			}
		}
	}
	for _, d := range data.Downstreams {
		if auth.IsEncrypted(d.ApiKey) {
			if encKey == "" {
				return nil, UserError("backup contains encrypted downstream API keys but no encryption key is configured — set --encryption-key before importing")
			}
			if _, err := auth.DecryptString(d.ApiKey, encKey); err != nil {
				return nil, UserError("backup contains encrypted downstream API keys that cannot be decrypted with the current encryption key — check that --encryption-key matches the key used when the backup was created")
			}
		}
	}

	sqlDB := o.Deps.SQLDB
	if sqlDB == nil {
		return nil, fmt.Errorf("transaction support not available")
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := o.Queries.WithTx(tx)

	// Settings
	for _, s := range data.Settings {
		if !allowedSettingKeys[s.Key] {
			slog.Warn("import config: skipping unknown setting key", "key", s.Key)
			continue
		}
		if err := qtx.UpsertSetting(ctx, db.UpsertSettingParams(s)); err != nil {
			return nil, fmt.Errorf("failed to import settings: %w", err)
		}
	}

	// Groups — capture old→new id remap so talkgroups can rewrite their
	// group_id FKs (the export carries the source DB's PKs, but on a fresh
	// install those PKs don't exist yet).
	groupRemap := make(map[int64]int64, len(data.Groups))
	for _, g := range data.Groups {
		newID, err := qtx.CreateGroup(ctx, g.Label)
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, fmt.Errorf("failed to import groups: %w", err)
			}
			existing, gerr := qtx.GetGroupByLabel(ctx, g.Label)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing group %q: %w", g.Label, gerr)
			}
			newID = existing.ID
		}
		groupRemap[g.ID] = newID
	}

	// Tags — same remap pattern as groups.
	tagRemap := make(map[int64]int64, len(data.Tags))
	for _, t := range data.Tags {
		newID, err := qtx.CreateTag(ctx, t.Label)
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, fmt.Errorf("failed to import tags: %w", err)
			}
			existing, gerr := qtx.GetTagByLabel(ctx, t.Label)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing tag %q: %w", t.Label, gerr)
			}
			newID = existing.ID
		}
		tagRemap[t.ID] = newID
	}

	// Systems — remap by old PK → new PK. The natural key is SystemID
	// (the radio-system ID, e.g. 1, 100), which sqlc enforces UNIQUE.
	systemRemap := make(map[int64]int64, len(data.Systems))
	for _, s := range data.Systems {
		newID, err := qtx.CreateSystem(ctx, db.CreateSystemParams{
			SystemID:               s.SystemID,
			Label:                  s.Label,
			AutoPopulateTalkgroups: s.AutoPopulateTalkgroups,
			BlacklistsJson:         s.BlacklistsJson,
			Led:                    s.Led,
			Order:                  s.Order,
		})
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, fmt.Errorf("failed to import systems: %w", err)
			}
			existing, gerr := qtx.GetSystemBySystemID(ctx, s.SystemID)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing system %d: %w", s.SystemID, gerr)
			}
			newID = existing.ID
		}
		systemRemap[s.ID] = newID
	}

	// Talkgroups — translate FKs (system_id, group_id, tag_id) through the
	// remaps built above, then upsert. Capture the new PK so dirmonitors
	// can rewrite their talkgroup_id FKs.
	tgRemap := make(map[int64]int64, len(data.Talkgroups))
	for _, tg := range data.Talkgroups {
		newSystemID, ok := systemRemap[tg.SystemID]
		if !ok {
			slog.Warn("import config: skipping talkgroup with unknown system_id",
				"talkgroup_id", tg.TalkgroupID, "system_id", tg.SystemID)
			continue
		}
		groupID := tg.GroupID
		if groupID.Valid {
			if mapped, ok := groupRemap[groupID.Int64]; ok {
				groupID.Int64 = mapped
			} else {
				// Group wasn't in the export — drop the FK rather than fail.
				groupID = sql.NullInt64{}
			}
		}
		tagID := tg.TagID
		if tagID.Valid {
			if mapped, ok := tagRemap[tagID.Int64]; ok {
				tagID.Int64 = mapped
			} else {
				tagID = sql.NullInt64{}
			}
		}
		if err := qtx.UpsertTalkgroup(ctx, db.UpsertTalkgroupParams{
			SystemID:    newSystemID,
			TalkgroupID: tg.TalkgroupID,
			Label:       tg.Label,
			Name:        tg.Name,
			Frequency:   tg.Frequency,
			Led:         tg.Led,
			GroupID:     groupID,
			TagID:       tagID,
			Order:       tg.Order,
		}); err != nil {
			return nil, fmt.Errorf("failed to import talkgroups: %w", err)
		}
		row, err := qtx.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{
			SystemID:    newSystemID,
			TalkgroupID: tg.TalkgroupID,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to look up imported talkgroup (system=%d tg=%d): %w",
				newSystemID, tg.TalkgroupID, err)
		}
		tgRemap[tg.ID] = row.ID
	}

	// Units — translate system_id.
	for _, u := range data.Units {
		newSystemID, ok := systemRemap[u.SystemID]
		if !ok {
			slog.Warn("import config: skipping unit with unknown system_id",
				"unit_id", u.UnitID, "system_id", u.SystemID)
			continue
		}
		if err := qtx.UpsertUnit(ctx, db.UpsertUnitParams{
			SystemID: newSystemID,
			UnitID:   u.UnitID,
			Label:    u.Label,
			Order:    u.Order,
		}); err != nil {
			return nil, fmt.Errorf("failed to import units: %w", err)
		}
	}

	// API Keys — remap any system PKs embedded in systems_json.
	for _, k := range data.APIKeys {
		if _, err := qtx.CreateAPIKey(ctx, db.CreateAPIKeyParams{
			Key:           k.Key,
			Ident:         ptrToNullStr(k.Ident),
			Disabled:      k.Disabled,
			SystemsJson:   ptrToNullStr(remapSystemsJSON(k.SystemsJson, systemRemap)),
			CallRateLimit: ptrToNullInt(k.CallRateLimit),
			Order:         k.Order,
		}); err != nil && !isUniqueViolation(err) {
			return nil, fmt.Errorf("failed to import api keys: %w", err)
		}
	}

	// DirMonitors — translate system_id and talkgroup_id FKs.
	for _, d := range data.DirMonitors {
		sysID := d.SystemID
		if sysID.Valid {
			if mapped, ok := systemRemap[sysID.Int64]; ok {
				sysID.Int64 = mapped
			} else {
				slog.Warn("import config: dirmonitor system_id not found in import; dropping FK",
					"directory", d.Directory, "system_id", sysID.Int64)
				sysID = sql.NullInt64{}
			}
		}
		tgID := d.TalkgroupID
		if tgID.Valid {
			if mapped, ok := tgRemap[tgID.Int64]; ok {
				tgID.Int64 = mapped
			} else {
				slog.Warn("import config: dirmonitor talkgroup_id not found in import; dropping FK",
					"directory", d.Directory, "talkgroup_id", tgID.Int64)
				tgID = sql.NullInt64{}
			}
		}
		if _, err := qtx.CreateDirMonitor(ctx, db.CreateDirMonitorParams{
			Directory:   d.Directory,
			Type:        d.Type,
			Mask:        d.Mask,
			Extension:   d.Extension,
			Frequency:   d.Frequency,
			Delay:       d.Delay,
			DeleteAfter: d.DeleteAfter,
			UsePolling:  d.UsePolling,
			Disabled:    d.Disabled,
			SystemID:    sysID,
			TalkgroupID: tgID,
			Order:       d.Order,
		}); err != nil && !isUniqueViolation(err) {
			return nil, fmt.Errorf("failed to import dirmonitors: %w", err)
		}
	}

	// Downstreams — remap embedded system PKs.
	for _, d := range data.Downstreams {
		if !validHTTPURL(d.Url) {
			slog.Warn("import config: skipping downstream with invalid URL", "url", d.Url)
			continue
		}
		if _, err := qtx.CreateDownstream(ctx, db.CreateDownstreamParams{
			Url:         d.Url,
			ApiKey:      d.ApiKey,
			SystemsJson: ptrToNullStr(remapSystemsJSON(d.SystemsJson, systemRemap)),
			Disabled:    d.Disabled,
			Order:       d.Order,
		}); err != nil && !isUniqueViolation(err) {
			return nil, fmt.Errorf("failed to import downstreams: %w", err)
		}
	}

	// Webhooks — remap embedded system PKs.
	for _, w := range data.Webhooks {
		if !validHTTPURL(w.Url) {
			slog.Warn("import config: skipping webhook with invalid URL", "url", w.Url)
			continue
		}
		if _, err := qtx.CreateWebhook(ctx, db.CreateWebhookParams{
			Url:         w.Url,
			Type:        w.Type,
			Secret:      ptrToNullStr(w.Secret),
			SystemsJson: ptrToNullStr(remapSystemsJSON(w.SystemsJson, systemRemap)),
			Disabled:    w.Disabled,
			Order:       w.Order,
		}); err != nil && !isUniqueViolation(err) {
			return nil, fmt.Errorf("failed to import webhooks: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit import: %w", err)
	}

	// Hot-reload subsystems whose live state derives from the rows or
	// settings we just rewrote. Without these, the in-process worker
	// pools, downstream forwarders, and dirmonitor watchers keep using
	// their pre-import config — symptom: transcription stops, downstream
	// forwarding goes silent, dirmonitors don't pick up new directories
	// until the operator restarts the server.
	if o.Deps.TranscriberReload != nil && len(data.Settings) > 0 {
		tEnabled, _ := o.Queries.GetSetting(ctx, "transcriptionEnabled")
		tURL, _ := o.Queries.GetSetting(ctx, "transcriptionUrl")
		tModel, _ := o.Queries.GetSetting(ctx, "transcriptionModel")
		tLang, _ := o.Queries.GetSetting(ctx, "transcriptionLanguage")
		tDiarize, _ := o.Queries.GetSetting(ctx, "transcriptionDiarize")

		ok := o.Deps.TranscriberReload.Reload(
			tEnabled.Value == "true",
			tURL.Value,
			tModel.Value,
			tLang.Value,
			tDiarize.Value == "true",
		)
		o.Deps.WhisperAvailable = ok && tEnabled.Value == "true"
	}
	if o.Deps.DirMonitorReload != nil && len(data.DirMonitors) > 0 {
		o.Deps.DirMonitorReload.Reload()
	}
	if o.Deps.DownstreamReload != nil && len(data.Downstreams) > 0 {
		o.Deps.DownstreamReload.Reload()
	}

	// Notify all admin/listener clients to refetch — without these the
	// admin UI shows stale (empty) lists and the user thinks the import
	// silently failed. Order doesn't matter; events are fire-and-forget.
	for _, topic := range []string{
		"groups.updated",
		"tags.updated",
		"systems.updated",
		"talkgroups.updated",
		"units.updated",
		"apikeys.updated",
		"dirmonitors.updated",
		"downstreams.updated",
		"webhooks.updated",
	} {
		o.broadcastAdminEvent(topic, nil)
	}
	o.enforcePublicAccess(ctx)
	o.broadcastCFG(ctx)

	slog.Info("config imported successfully via WS",
		"by", callerID,
		"settings", len(data.Settings),
		"groups", len(data.Groups),
		"tags", len(data.Tags),
		"systems", len(data.Systems),
		"talkgroups", len(data.Talkgroups),
		"units", len(data.Units),
		"apiKeys", len(data.APIKeys),
		"dirmonitors", len(data.DirMonitors),
		"downstreams", len(data.Downstreams),
		"webhooks", len(data.Webhooks),
	)
	return map[string]bool{"ok": true}, nil
}
