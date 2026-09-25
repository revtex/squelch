package admin

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// importAPIKey, importDownstream, and importWebhook are the flat shape a
// backup carries (plain string/null instead of {String,Valid} blobs).
// Unmarshalling directly into the db.* structs would fail for any non-null
// nullable field because sql.NullString has no JSON unmarshaler.
type importAPIKey struct {
	ID            int64   `json:"id"`
	Key           string  `json:"key"`
	Ident         *string `json:"ident"`
	Disabled      int64   `json:"disabled"`
	SystemsJson   *string `json:"systems_json"`
	CallRateLimit *int64  `json:"call_rate_limit"`
	Order         int64   `json:"order"`
}

type importDownstream struct {
	ID          int64   `json:"id"`
	Url         string  `json:"url"`
	ApiKey      string  `json:"api_key"`
	SystemsJson *string `json:"systems_json"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
	Label       string  `json:"label"`
}

type importWebhook struct {
	ID          int64   `json:"id"`
	Url         string  `json:"url"`
	Type        string  `json:"type"`
	Secret      *string `json:"secret"`
	SystemsJson *string `json:"systems_json"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
	Label       string  `json:"label"`
}

// RestoreResult says what a restore did.
type RestoreResult struct {
	OK      bool   `json:"ok"`
	Mode    string `json:"mode"`
	Created int    `json:"created"`
	Updated int    `json:"updated"`
	Removed int    `json:"removed"`
	// Snapshot is where the previous configuration was saved, or "" when
	// the server has no database file to keep it beside.
	Snapshot string `json:"snapshot"`
} // @name RestoreResult

// restoredPassword gives a user restored from a backup a password nobody
// knows: backups carry no password hashes, so an admin sets one under
// Users before that person can sign in.
func restoredPassword() (string, error) {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("random password: %w", err)
	}
	return auth.HashPassword(hex.EncodeToString(b[:]))
}

// ImportConfig restores a configuration backup in one transaction. Merge
// adds what is missing and updates what matches, by the natural keys that
// survive a move between databases (system number, talkgroup number,
// label, username, key, directory, URL); Replace also deletes what the
// file does not carry, table by table, leaving out tables the file has no
// entry for. The previous configuration is saved beside the database
// first. Settings are only ever upserted.
func (o *Operations) ImportConfig(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	f, err := parseBackup(params)
	if err != nil {
		slog.Warn("restore: failed to parse backup", "error", err)
		return nil, err
	}
	if err := o.checkBackupSecrets(f); err != nil {
		return nil, err
	}
	sqlDB := o.Deps.SQLDB
	if sqlDB == nil {
		return nil, fmt.Errorf("transaction support not available")
	}
	replace := f.Mode == RestoreReplace

	// The review's "differ" count is what a restore reports as updated:
	// every matched row is rewritten, but only these actually change.
	preview, err := o.previewBackup(ctx, f)
	if err != nil {
		return nil, err
	}

	snapshot, err := o.writePreRestoreSnapshot(ctx)
	if err != nil {
		return nil, fmt.Errorf("the previous configuration could not be saved first: %w", err)
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("database error: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	qtx := o.Queries.WithTx(tx)
	res := RestoreResult{OK: true, Mode: f.Mode, Snapshot: snapshot, Updated: preview.changed()}
	now := time.Now().Unix()

	// Settings: upsert the known keys.
	for _, s := range f.Settings {
		if !allowedSettingKeys[s.Key] {
			slog.Warn("restore: skipping unknown setting key", "key", s.Key)
			continue
		}
		if err := qtx.UpsertSetting(ctx, db.UpsertSettingParams(s)); err != nil {
			return nil, fmt.Errorf("failed to restore settings: %w", err)
		}
	}

	// Groups and tags: match by label; keep old→new PK remaps so talkgroups
	// can rewrite their FKs (the file carries the source database's PKs).
	groupRemap := make(map[int64]int64, len(f.Groups))
	groupKeep := map[int64]bool{}
	for _, g := range f.Groups {
		newID, err := qtx.CreateGroup(ctx, g.Label)
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, fmt.Errorf("failed to restore groups: %w", err)
			}
			existing, gerr := qtx.GetGroupByLabel(ctx, g.Label)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing group %q: %w", g.Label, gerr)
			}
			newID = existing.ID
		} else {
			res.Created++
		}
		groupRemap[g.ID] = newID
		groupKeep[newID] = true
	}
	tagRemap := make(map[int64]int64, len(f.Tags))
	tagKeep := map[int64]bool{}
	for _, t := range f.Tags {
		newID, err := qtx.CreateTag(ctx, t.Label)
		if err != nil {
			if !isUniqueViolation(err) {
				return nil, fmt.Errorf("failed to restore tags: %w", err)
			}
			existing, gerr := qtx.GetTagByLabel(ctx, t.Label)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing tag %q: %w", t.Label, gerr)
			}
			newID = existing.ID
		} else {
			res.Created++
		}
		tagRemap[t.ID] = newID
		tagKeep[newID] = true
	}

	// Systems: the natural key is the radio system number.
	systemRemap := make(map[int64]int64, len(f.Systems))
	systemKeep := map[int64]bool{}
	for _, s := range f.Systems {
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
				return nil, fmt.Errorf("failed to restore systems: %w", err)
			}
			existing, gerr := qtx.GetSystemBySystemID(ctx, s.SystemID)
			if gerr != nil {
				return nil, fmt.Errorf("failed to look up existing system %d: %w", s.SystemID, gerr)
			}
			newID = existing.ID
			if err := qtx.UpdateSystem(ctx, db.UpdateSystemParams{
				ID: newID, SystemID: s.SystemID, Label: s.Label, AutoPopulateTalkgroups: s.AutoPopulateTalkgroups,
				BlacklistsJson: s.BlacklistsJson, Led: s.Led, Order: s.Order,
			}); err != nil {
				return nil, fmt.Errorf("failed to update system %d: %w", s.SystemID, err)
			}
		} else {
			res.Created++
		}
		systemRemap[s.ID] = newID
		systemKeep[newID] = true
	}

	// Talkgroups: FKs go through the remaps; keep the new PK for dirmonitors.
	tgRemap := make(map[int64]int64, len(f.Talkgroups))
	tgKeep := map[int64]bool{}
	for _, tg := range f.Talkgroups {
		newSystemID, ok := systemRemap[tg.SystemID]
		if !ok {
			slog.Warn("restore: skipping talkgroup with unknown system_id", "talkgroup_id", tg.TalkgroupID, "system_id", tg.SystemID)
			continue
		}
		groupID := tg.GroupID
		if groupID.Valid {
			if mapped, ok := groupRemap[groupID.Int64]; ok {
				groupID.Int64 = mapped
			} else {
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
		_, lookupErr := qtx.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{SystemID: newSystemID, TalkgroupID: tg.TalkgroupID})
		if err := qtx.UpsertTalkgroup(ctx, db.UpsertTalkgroupParams{
			SystemID: newSystemID, TalkgroupID: tg.TalkgroupID, Label: tg.Label, Name: tg.Name, Frequency: tg.Frequency,
			Led: tg.Led, GroupID: groupID, TagID: tagID, Order: tg.Order,
		}); err != nil {
			return nil, fmt.Errorf("failed to restore talkgroups: %w", err)
		}
		row, err := qtx.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{SystemID: newSystemID, TalkgroupID: tg.TalkgroupID})
		if err != nil {
			return nil, fmt.Errorf("failed to look up restored talkgroup (system=%d tg=%d): %w", newSystemID, tg.TalkgroupID, err)
		}
		if lookupErr == nil {
		} else {
			res.Created++
		}
		tgRemap[tg.ID] = row.ID
		tgKeep[row.ID] = true
	}

	// Units.
	unitKeep := map[int64]bool{}
	for _, u := range f.Units {
		newSystemID, ok := systemRemap[u.SystemID]
		if !ok {
			slog.Warn("restore: skipping unit with unknown system_id", "unit_id", u.UnitID, "system_id", u.SystemID)
			continue
		}
		existing, err := qtx.GetUnitBySystemAndUnitID(ctx, db.GetUnitBySystemAndUnitIDParams{SystemID: newSystemID, UnitID: u.UnitID})
		if err != nil {
			id, cerr := qtx.CreateUnit(ctx, db.CreateUnitParams{SystemID: newSystemID, UnitID: u.UnitID, Label: u.Label, Order: u.Order})
			if cerr != nil {
				return nil, fmt.Errorf("failed to restore units: %w", cerr)
			}
			unitKeep[id] = true
			res.Created++
			continue
		}
		if err := qtx.UpdateUnit(ctx, db.UpdateUnitParams{ID: existing.ID, UnitID: u.UnitID, Label: u.Label, Order: u.Order}); err != nil {
			return nil, fmt.Errorf("failed to update unit %d: %w", u.UnitID, err)
		}
		unitKeep[existing.ID] = true
	}

	// Users: matched by username. Backups carry no passwords, so a user the
	// file adds gets one nobody knows and needs an admin to set it. The
	// primary admin (id 1) and the caller keep their role and access.
	userKeep := map[int64]bool{callerID: true, 1: true}
	for _, u := range f.Users {
		username := strings.TrimSpace(u.Username)
		if username == "" {
			continue
		}
		existing, err := qtx.GetUserByUsername(ctx, username)
		if err != nil {
			hash, herr := restoredPassword()
			if herr != nil {
				return nil, herr
			}
			id, cerr := qtx.CreateUser(ctx, db.CreateUserParams{
				Username: username, PasswordHash: hash, Role: u.Role, Disabled: u.Disabled, SystemsJson: u.SystemsJson,
				Expiration: u.Expiration, Limit: u.Limit, PasswordNeedChange: 1, CreatedAt: now, UpdatedAt: now,
			})
			if cerr != nil {
				return nil, fmt.Errorf("failed to restore user %q: %w", username, cerr)
			}
			userKeep[id] = true
			res.Created++
			continue
		}
		userKeep[existing.ID] = true
		if existing.ID == 1 || existing.ID == callerID {
			continue
		}
		if err := qtx.UpdateUser(ctx, db.UpdateUserParams{
			ID: existing.ID, Username: existing.Username, Role: u.Role, Disabled: u.Disabled, SystemsJson: u.SystemsJson,
			Expiration: u.Expiration, Limit: u.Limit, UpdatedAt: now,
		}); err != nil {
			return nil, fmt.Errorf("failed to update user %q: %w", username, err)
		}
	}

	// API keys: matched by the key itself; system PKs in systems_json are
	// remapped.
	apiKeyKeep := map[int64]bool{}
	for _, k := range f.APIKeys {
		systems := ptrToNullStr(remapSystemsJSON(k.SystemsJson, systemRemap))
		existing, err := qtx.GetAPIKeyByKey(ctx, k.Key)
		if err != nil {
			id, cerr := qtx.CreateAPIKey(ctx, db.CreateAPIKeyParams{
				Key: k.Key, Ident: ptrToNullStr(k.Ident), Disabled: k.Disabled, SystemsJson: systems,
				CallRateLimit: ptrToNullInt(k.CallRateLimit), Order: k.Order, CreatedAt: now,
			})
			if cerr != nil {
				return nil, fmt.Errorf("failed to restore api keys: %w", cerr)
			}
			apiKeyKeep[id] = true
			res.Created++
			continue
		}
		if err := qtx.UpdateAPIKey(ctx, db.UpdateAPIKeyParams{
			ID: existing.ID, Key: k.Key, Ident: ptrToNullStr(k.Ident), Disabled: k.Disabled, SystemsJson: systems,
			CallRateLimit: ptrToNullInt(k.CallRateLimit), Order: k.Order,
		}); err != nil {
			return nil, fmt.Errorf("failed to update api key: %w", err)
		}
		apiKeyKeep[existing.ID] = true
	}

	// Folder monitors: matched by directory.
	liveMonitors, err := qtx.ListDirMonitors(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list dirmonitors: %w", err)
	}
	monitorByDir := make(map[string]db.Dirmonitor, len(liveMonitors))
	for _, m := range liveMonitors {
		monitorByDir[m.Directory] = m
	}
	monitorKeep := map[int64]bool{}
	for _, d := range f.DirMonitors {
		sysID := d.SystemID
		if sysID.Valid {
			if mapped, ok := systemRemap[sysID.Int64]; ok {
				sysID.Int64 = mapped
			} else {
				slog.Warn("restore: dirmonitor system not in file; dropping the link", "directory", d.Directory, "system_id", sysID.Int64)
				sysID = sql.NullInt64{}
			}
		}
		tgID := d.TalkgroupID
		if tgID.Valid {
			if mapped, ok := tgRemap[tgID.Int64]; ok {
				tgID.Int64 = mapped
			} else {
				tgID = sql.NullInt64{}
			}
		}
		if existing, ok := monitorByDir[d.Directory]; ok {
			if err := qtx.UpdateDirMonitor(ctx, db.UpdateDirMonitorParams{
				ID: existing.ID, Directory: d.Directory, Type: d.Type, Mask: d.Mask, Extension: d.Extension, Frequency: d.Frequency,
				Delay: d.Delay, DeleteAfter: d.DeleteAfter, UsePolling: d.UsePolling, Disabled: d.Disabled, SystemID: sysID,
				TalkgroupID: tgID, Order: d.Order,
			}); err != nil {
				return nil, fmt.Errorf("failed to update dirmonitor %q: %w", d.Directory, err)
			}
			monitorKeep[existing.ID] = true
			continue
		}
		id, err := qtx.CreateDirMonitor(ctx, db.CreateDirMonitorParams{
			Directory: d.Directory, Type: d.Type, Mask: d.Mask, Extension: d.Extension, Frequency: d.Frequency, Delay: d.Delay,
			DeleteAfter: d.DeleteAfter, UsePolling: d.UsePolling, Disabled: d.Disabled, SystemID: sysID, TalkgroupID: tgID, Order: d.Order,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to restore dirmonitors: %w", err)
		}
		monitorKeep[id] = true
		res.Created++
	}

	// Forwarding targets: matched by URL.
	liveDownstreams, err := qtx.ListDownstreams(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list downstreams: %w", err)
	}
	downstreamByURL := make(map[string]db.Downstream, len(liveDownstreams))
	for _, d := range liveDownstreams {
		downstreamByURL[d.Url] = d
	}
	downstreamKeep := map[int64]bool{}
	for _, d := range f.Downstreams {
		if !validHTTPURL(d.Url) {
			slog.Warn("restore: skipping downstream with invalid URL", "url", d.Url)
			continue
		}
		systems := ptrToNullStr(remapSystemsJSON(d.SystemsJson, systemRemap))
		if existing, ok := downstreamByURL[d.Url]; ok {
			if err := qtx.UpdateDownstream(ctx, db.UpdateDownstreamParams{
				ID: existing.ID, Url: d.Url, ApiKey: d.ApiKey, SystemsJson: systems, Disabled: d.Disabled, Order: d.Order, Label: d.Label,
			}); err != nil {
				return nil, fmt.Errorf("failed to update downstream %q: %w", d.Url, err)
			}
			downstreamKeep[existing.ID] = true
			continue
		}
		id, err := qtx.CreateDownstream(ctx, db.CreateDownstreamParams{
			Url: d.Url, ApiKey: d.ApiKey, SystemsJson: systems, Disabled: d.Disabled, Order: d.Order, Label: d.Label,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to restore downstreams: %w", err)
		}
		downstreamKeep[id] = true
		res.Created++
	}

	// Webhooks: matched by type and URL.
	liveWebhooks, err := qtx.ListWebhooks(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list webhooks: %w", err)
	}
	webhookByKey := make(map[string]db.Webhook, len(liveWebhooks))
	for _, w := range liveWebhooks {
		webhookByKey[w.Type+"|"+w.Url] = w
	}
	webhookKeep := map[int64]bool{}
	for _, w := range f.Webhooks {
		if !validHTTPURL(w.Url) {
			slog.Warn("restore: skipping webhook with invalid URL", "url", w.Url)
			continue
		}
		systems := ptrToNullStr(remapSystemsJSON(w.SystemsJson, systemRemap))
		if existing, ok := webhookByKey[w.Type+"|"+w.Url]; ok {
			if err := qtx.UpdateWebhook(ctx, db.UpdateWebhookParams{
				ID: existing.ID, Url: w.Url, Type: w.Type, Secret: ptrToNullStr(w.Secret), SystemsJson: systems,
				Disabled: w.Disabled, Order: w.Order, Label: w.Label,
			}); err != nil {
				return nil, fmt.Errorf("failed to update webhook %q: %w", w.Url, err)
			}
			webhookKeep[existing.ID] = true
			continue
		}
		id, err := qtx.CreateWebhook(ctx, db.CreateWebhookParams{
			Url: w.Url, Type: w.Type, Secret: ptrToNullStr(w.Secret), SystemsJson: systems, Disabled: w.Disabled, Order: w.Order, Label: w.Label,
		})
		if err != nil {
			return nil, fmt.Errorf("failed to restore webhooks: %w", err)
		}
		webhookKeep[id] = true
		res.Created++
	}

	if replace {
		removed, err := o.removeAbsent(ctx, qtx, f, systemKeep, tgKeep, unitKeep, groupKeep, tagKeep, userKeep, apiKeyKeep, monitorKeep, downstreamKeep, webhookKeep)
		if err != nil {
			return nil, err
		}
		res.Removed = removed
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit restore: %w", err)
	}

	// Hot-reload the subsystems whose live state derives from the rows or
	// settings just rewritten; otherwise transcription, forwarding and the
	// folder monitors keep their pre-restore config until a restart.
	if o.Deps.TranscriberReload != nil && len(f.Settings) > 0 {
		tEnabled, _ := o.Queries.GetSetting(ctx, "transcriptionEnabled")
		tURL, _ := o.Queries.GetSetting(ctx, "transcriptionUrl")
		tModel, _ := o.Queries.GetSetting(ctx, "transcriptionModel")
		tLang, _ := o.Queries.GetSetting(ctx, "transcriptionLanguage")
		tDiarize, _ := o.Queries.GetSetting(ctx, "transcriptionDiarize")
		ok := o.Deps.TranscriberReload.Reload(tEnabled.Value == "true", tURL.Value, tModel.Value, tLang.Value, tDiarize.Value == "true")
		o.Deps.WhisperAvailable = ok && tEnabled.Value == "true"
	}
	if o.Deps.DirMonitorReload != nil && (f.DirMonitors != nil || replace) {
		o.Deps.DirMonitorReload.Reload()
	}
	if o.Deps.DownstreamReload != nil && (f.Downstreams != nil || replace) {
		o.Deps.DownstreamReload.Reload()
	}

	for _, topic := range []string{
		"groups.updated", "tags.updated", "systems.updated", "talkgroups.updated", "units.updated", "users.updated",
		"apikeys.updated", "dirmonitors.updated", "downstreams.updated", "webhooks.updated",
	} {
		o.broadcastAdminEvent(topic, nil)
	}
	o.enforcePublicAccess(ctx)
	o.broadcastCFG(ctx)

	saved := ""
	if snapshot != "" {
		saved = "; the previous configuration is at " + snapshot
	}
	o.audit(ctx, fmt.Sprintf("admin: configuration restored (%s) by %s: %d added, %d updated, %d removed%s",
		f.Mode, o.callerName(ctx, callerID), res.Created, res.Updated, res.Removed, saved))
	slog.Info("restore: configuration restored", "by", callerID, "mode", f.Mode,
		"created", res.Created, "updated", res.Updated, "removed", res.Removed, "snapshot", snapshot)
	return res, nil
}

// removeAbsent deletes, for each table the file carries, the live rows the
// file does not. Talkgroups and units are only pruned when the file also
// lists systems (otherwise none of its rows could be matched); systems go
// last so their cascades do not hide what the count reports; groups and
// tags are unlinked from talkgroups first.
func (o *Operations) removeAbsent(ctx context.Context, qtx *db.Queries, f backupFile,
	systemKeep, tgKeep, unitKeep, groupKeep, tagKeep, userKeep, apiKeyKeep, monitorKeep, downstreamKeep, webhookKeep map[int64]bool,
) (int, error) {
	removed := 0
	if f.Talkgroups != nil && f.Systems != nil {
		tgs, err := qtx.ListAllTalkgroups(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list talkgroups: %w", err)
		}
		for _, tg := range tgs {
			if tgKeep[tg.ID] || !systemKeep[tg.SystemID] {
				continue
			}
			if err := qtx.DeleteTalkgroup(ctx, tg.ID); err != nil {
				return 0, fmt.Errorf("failed to remove talkgroup %d: %w", tg.TalkgroupID, err)
			}
			removed++
		}
	}
	if f.Units != nil && f.Systems != nil {
		units, err := qtx.ListAllUnits(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list units: %w", err)
		}
		for _, u := range units {
			if unitKeep[u.ID] || !systemKeep[u.SystemID] {
				continue
			}
			if err := qtx.DeleteUnit(ctx, u.ID); err != nil {
				return 0, fmt.Errorf("failed to remove unit %d: %w", u.UnitID, err)
			}
			removed++
		}
	}
	if f.Groups != nil {
		groups, err := qtx.ListGroups(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list groups: %w", err)
		}
		for _, g := range groups {
			if groupKeep[g.ID] {
				continue
			}
			if err := qtx.MoveTalkgroupsToGroup(ctx, db.MoveTalkgroupsToGroupParams{FromGroup: sql.NullInt64{Int64: g.ID, Valid: true}}); err != nil {
				return 0, fmt.Errorf("failed to unlink group %q: %w", g.Label, err)
			}
			if err := qtx.DeleteGroup(ctx, g.ID); err != nil {
				return 0, fmt.Errorf("failed to remove group %q: %w", g.Label, err)
			}
			removed++
		}
	}
	if f.Tags != nil {
		tags, err := qtx.ListTags(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list tags: %w", err)
		}
		for _, t := range tags {
			if tagKeep[t.ID] {
				continue
			}
			if err := qtx.MoveTalkgroupsToTag(ctx, db.MoveTalkgroupsToTagParams{FromTag: sql.NullInt64{Int64: t.ID, Valid: true}}); err != nil {
				return 0, fmt.Errorf("failed to unlink tag %q: %w", t.Label, err)
			}
			if err := qtx.DeleteTag(ctx, t.ID); err != nil {
				return 0, fmt.Errorf("failed to remove tag %q: %w", t.Label, err)
			}
			removed++
		}
	}
	if f.Users != nil {
		users, err := qtx.ListUsers(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list users: %w", err)
		}
		for _, u := range users {
			if userKeep[u.ID] {
				continue
			}
			if err := qtx.DeleteUser(ctx, u.ID); err != nil {
				return 0, fmt.Errorf("failed to remove user %q: %w", u.Username, err)
			}
			removed++
		}
	}
	if f.APIKeys != nil {
		keys, err := qtx.ListAPIKeys(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list api keys: %w", err)
		}
		for _, k := range keys {
			if apiKeyKeep[k.ID] {
				continue
			}
			if err := qtx.DeleteAPIKey(ctx, k.ID); err != nil {
				return 0, fmt.Errorf("failed to remove api key: %w", err)
			}
			removed++
		}
	}
	if f.DirMonitors != nil {
		mons, err := qtx.ListDirMonitors(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list dirmonitors: %w", err)
		}
		for _, m := range mons {
			if monitorKeep[m.ID] || (f.Systems != nil && m.SystemID.Valid && !systemKeep[m.SystemID.Int64]) {
				continue
			}
			if err := qtx.DeleteDirMonitor(ctx, m.ID); err != nil {
				return 0, fmt.Errorf("failed to remove dirmonitor %q: %w", m.Directory, err)
			}
			removed++
		}
	}
	if f.Downstreams != nil {
		ds, err := qtx.ListDownstreams(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list downstreams: %w", err)
		}
		for _, d := range ds {
			if downstreamKeep[d.ID] {
				continue
			}
			if err := qtx.DeleteDownstream(ctx, d.ID); err != nil {
				return 0, fmt.Errorf("failed to remove downstream %q: %w", d.Url, err)
			}
			removed++
		}
	}
	if f.Webhooks != nil {
		ws, err := qtx.ListWebhooks(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list webhooks: %w", err)
		}
		for _, w := range ws {
			if webhookKeep[w.ID] {
				continue
			}
			if err := qtx.DeleteWebhook(ctx, w.ID); err != nil {
				return 0, fmt.Errorf("failed to remove webhook %q: %w", w.Url, err)
			}
			removed++
		}
	}
	if f.Systems != nil {
		systems, err := qtx.ListSystems(ctx)
		if err != nil {
			return 0, fmt.Errorf("failed to list systems: %w", err)
		}
		for _, s := range systems {
			if systemKeep[s.ID] {
				continue
			}
			if err := qtx.DeleteSystem(ctx, s.ID); err != nil {
				return 0, fmt.Errorf("failed to remove system %q: %w", s.Label, err)
			}
			removed++
		}
	}
	return removed, nil
}
