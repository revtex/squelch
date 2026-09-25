package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// Restore modes: merge adds and updates, never deletes; replace also removes
// what the file does not carry.
const (
	RestoreMerge   = "merge"
	RestoreReplace = "replace"
)

// configBackupLastAtKey records when a configuration backup was last
// downloaded. Server-only: neither exported nor shown under Settings.
const configBackupLastAtKey = "configBackupLastAt"

// preRestoreKeep is how many pre-restore snapshots stay on disk.
const preRestoreKeep = 10

// backupFile is what a configuration backup carries and a restore reads.
// A nil slice means the file does not have that table at all; Replace
// leaves such tables alone. Mode rides beside the tables so the same
// object is both the file and the restore request.
type backupFile struct {
	Mode        string             `json:"mode,omitempty"`
	Settings    []db.Setting       `json:"settings"`
	Users       []db.User          `json:"users"`
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

func (f backupFile) empty() bool {
	return f.Settings == nil && f.Users == nil && f.Groups == nil && f.Tags == nil && f.Systems == nil &&
		f.Talkgroups == nil && f.Units == nil && f.APIKeys == nil && f.DirMonitors == nil &&
		f.Downstreams == nil && f.Webhooks == nil
}

// parseBackup reads a backup file, with the optional restore mode beside
// its tables.
func parseBackup(params json.RawMessage) (backupFile, error) {
	var f backupFile
	if err := json.Unmarshal(params, &f); err != nil {
		return f, UserError("the file is not a Squelch backup: " + err.Error())
	}
	if f.empty() {
		return f, UserError("the file is not a Squelch backup: none of its tables were found")
	}
	switch f.Mode {
	case "":
		f.Mode = RestoreMerge
	case RestoreMerge, RestoreReplace:
	default:
		return f, UserError("mode must be merge or replace")
	}
	return f, nil
}

// checkBackupSecrets refuses a file whose encrypted values this server
// could not read back.
func (o *Operations) checkBackupSecrets(f backupFile) error {
	encKey := o.Deps.EncryptionKey
	for _, s := range f.Settings {
		if SensitiveSettingKeys[s.Key] && auth.IsEncrypted(s.Value) {
			if encKey == "" {
				return UserError("the backup holds encrypted settings but this server has no encryption key; start it with --encryption-key first")
			}
			if _, err := auth.DecryptString(s.Value, encKey); err != nil {
				return UserError("the backup holds encrypted settings this server's encryption key cannot read; it needs the key the backup was made with")
			}
		}
	}
	for _, d := range f.Downstreams {
		if auth.IsEncrypted(d.ApiKey) {
			if encKey == "" {
				return UserError("the backup holds encrypted forwarding keys but this server has no encryption key; start it with --encryption-key first")
			}
			if _, err := auth.DecryptString(d.ApiKey, encKey); err != nil {
				return UserError("the backup holds encrypted forwarding keys this server's encryption key cannot read; it needs the key the backup was made with")
			}
		}
	}
	return nil
}

// BackupEntity compares one table between a backup and the live data.
type BackupEntity struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	// Included is false when the file does not carry this table.
	Included bool `json:"included"`
	InFile   int  `json:"inFile"`
	Now      int  `json:"now"`
	// Added is in the file and not here; Changed is in both but different;
	// Removed is here and not in the file, which only Replace deletes.
	Added   int `json:"added"`
	Changed int `json:"changed"`
	Removed int `json:"removed"`
	// Examples names a few of what Replace would remove.
	Examples []string `json:"examples"`
} // @name BackupEntity

// BackupPreview is the review step of a restore.
type BackupPreview struct {
	Entities []BackupEntity `json:"entities"`
	Warnings []string       `json:"warnings"`
} // @name BackupPreview

// keyedRow is one row reduced to its natural key, a display name and a
// fingerprint of the fields a restore would write.
type keyedRow struct{ key, name, print string }

func diffRows(key, label string, file, live []keyedRow, included bool) BackupEntity {
	e := BackupEntity{Key: key, Label: label, Included: included, Now: len(live), Examples: []string{}}
	if !included {
		return e
	}
	e.InFile = len(file)
	inFile := make(map[string]keyedRow, len(file))
	for _, r := range file {
		inFile[r.key] = r
	}
	seen := make(map[string]bool, len(live))
	for _, r := range live {
		f, ok := inFile[r.key]
		if !ok {
			e.Removed++
			if len(e.Examples) < 3 {
				e.Examples = append(e.Examples, r.name)
			}
			continue
		}
		seen[r.key] = true
		if f.print != r.print {
			e.Changed++
		}
	}
	for k := range inFile {
		if !seen[k] {
			e.Added++
		}
	}
	return e
}

func joinPrint(parts ...string) string { return strings.Join(parts, "\x1f") }

func settingRows(settings []db.Setting, encKey string) []keyedRow {
	out := make([]keyedRow, 0, len(settings))
	for _, s := range settings {
		if serverOnlySettingKeys[s.Key] || !allowedSettingKeys[s.Key] {
			continue
		}
		val := s.Value
		if SensitiveSettingKeys[s.Key] && encKey != "" && auth.IsEncrypted(val) {
			if plain, err := auth.DecryptString(val, encKey); err == nil {
				val = plain
			}
		}
		out = append(out, keyedRow{key: s.Key, name: s.Key, print: val})
	}
	return out
}

func userRows(users []db.User) []keyedRow {
	out := make([]keyedRow, 0, len(users))
	for _, u := range users {
		out = append(out, keyedRow{
			key:  strings.ToLower(u.Username),
			name: u.Username,
			print: joinPrint(u.Role, strconv.FormatInt(u.Disabled, 10), u.SystemsJson.String,
				nullInt64Print(u.Expiration.Valid, u.Expiration.Int64), nullInt64Print(u.Limit.Valid, u.Limit.Int64)),
		})
	}
	return out
}

func nullInt64Print(valid bool, v int64) string {
	if !valid {
		return ""
	}
	return strconv.FormatInt(v, 10)
}

func labelRows(labels []string) []keyedRow {
	out := make([]keyedRow, 0, len(labels))
	for _, l := range labels {
		out = append(out, keyedRow{key: strings.ToLower(strings.TrimSpace(l)), name: l})
	}
	return out
}

func groupLabels(groups []db.Group) []string {
	out := make([]string, len(groups))
	for i, g := range groups {
		out[i] = g.Label
	}
	return out
}

func tagLabels(tags []db.Tag) []string {
	out := make([]string, len(tags))
	for i, t := range tags {
		out[i] = t.Label
	}
	return out
}

func systemRows(systems []db.System) []keyedRow {
	out := make([]keyedRow, 0, len(systems))
	for _, s := range systems {
		out = append(out, keyedRow{
			key:   strconv.FormatInt(s.SystemID, 10),
			name:  s.Label,
			print: joinPrint(s.Label, strconv.FormatInt(s.AutoPopulateTalkgroups, 10), s.BlacklistsJson.String, s.Led.String, strconv.FormatInt(s.Order, 10)),
		})
	}
	return out
}

// systemNumbers maps system PKs to the radio system number, the key that is
// stable between two databases.
func systemNumbers(systems []db.System) map[int64]int64 {
	out := make(map[int64]int64, len(systems))
	for _, s := range systems {
		out[s.ID] = s.SystemID
	}
	return out
}

func groupNames(groups []db.Group) map[int64]string {
	out := make(map[int64]string, len(groups))
	for _, g := range groups {
		out[g.ID] = g.Label
	}
	return out
}

func tagNames(tags []db.Tag) map[int64]string {
	out := make(map[int64]string, len(tags))
	for _, t := range tags {
		out[t.ID] = t.Label
	}
	return out
}

func talkgroupRows(tgs []db.Talkgroup, systems map[int64]int64, groups, tags map[int64]string) []keyedRow {
	out := make([]keyedRow, 0, len(tgs))
	for _, tg := range tgs {
		sys, ok := systems[tg.SystemID]
		if !ok {
			continue
		}
		name := tg.Label.String
		if name == "" {
			name = "TG " + strconv.FormatInt(tg.TalkgroupID, 10)
		}
		group, tag := "", ""
		if tg.GroupID.Valid {
			group = groups[tg.GroupID.Int64]
		}
		if tg.TagID.Valid {
			tag = tags[tg.TagID.Int64]
		}
		out = append(out, keyedRow{
			key:  strconv.FormatInt(sys, 10) + ":" + strconv.FormatInt(tg.TalkgroupID, 10),
			name: name,
			print: joinPrint(tg.Label.String, tg.Name.String, nullInt64Print(tg.Frequency.Valid, tg.Frequency.Int64),
				tg.Led.String, strconv.FormatInt(tg.Order, 10), strings.ToLower(group), strings.ToLower(tag)),
		})
	}
	return out
}

func unitRows(units []db.Unit, systems map[int64]int64) []keyedRow {
	out := make([]keyedRow, 0, len(units))
	for _, u := range units {
		sys, ok := systems[u.SystemID]
		if !ok {
			continue
		}
		name := u.Label.String
		if name == "" {
			name = "unit " + strconv.FormatInt(u.UnitID, 10)
		}
		out = append(out, keyedRow{
			key:   strconv.FormatInt(sys, 10) + ":" + strconv.FormatInt(u.UnitID, 10),
			name:  name,
			print: joinPrint(u.Label.String, strconv.FormatInt(u.Order, 10)),
		})
	}
	return out
}

func apiKeyRows(keys []importAPIKey) []keyedRow {
	out := make([]keyedRow, 0, len(keys))
	for _, k := range keys {
		name := "key #" + strconv.FormatInt(k.ID, 10)
		if k.Ident != nil && *k.Ident != "" {
			name = *k.Ident
		}
		out = append(out, keyedRow{
			key:   k.Key,
			name:  name,
			print: joinPrint(strPtr(k.Ident), strconv.FormatInt(k.Disabled, 10), intPtr(k.CallRateLimit), strconv.FormatInt(k.Order, 10)),
		})
	}
	return out
}

func dirMonitorRows(mons []db.Dirmonitor) []keyedRow {
	out := make([]keyedRow, 0, len(mons))
	for _, d := range mons {
		out = append(out, keyedRow{
			key:  d.Directory,
			name: d.Directory,
			print: joinPrint(d.Type, d.Mask.String, d.Extension.String, nullInt64Print(d.Frequency.Valid, d.Frequency.Int64),
				nullInt64Print(d.Delay.Valid, d.Delay.Int64), strconv.FormatInt(d.DeleteAfter, 10), strconv.FormatInt(d.UsePolling, 10),
				strconv.FormatInt(d.Disabled, 10), strconv.FormatInt(d.Order, 10)),
		})
	}
	return out
}

func downstreamRows(ds []importDownstream) []keyedRow {
	out := make([]keyedRow, 0, len(ds))
	for _, d := range ds {
		name := d.Label
		if name == "" {
			name = d.Url
		}
		out = append(out, keyedRow{key: d.Url, name: name, print: joinPrint(d.Label, strconv.FormatInt(d.Disabled, 10), strconv.FormatInt(d.Order, 10))})
	}
	return out
}

func webhookRows(ws []importWebhook) []keyedRow {
	out := make([]keyedRow, 0, len(ws))
	for _, w := range ws {
		name := w.Label
		if name == "" {
			name = w.Url
		}
		out = append(out, keyedRow{key: w.Type + "|" + w.Url, name: name, print: joinPrint(w.Label, strconv.FormatInt(w.Disabled, 10), strconv.FormatInt(w.Order, 10))})
	}
	return out
}

func strPtr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func intPtr(p *int64) string {
	if p == nil {
		return ""
	}
	return strconv.FormatInt(*p, 10)
}

// liveConfig is every table a backup covers, as the database has it now.
type liveConfig struct {
	Settings    []db.Setting
	Users       []db.User
	Groups      []db.Group
	Tags        []db.Tag
	Systems     []db.System
	Talkgroups  []db.Talkgroup
	Units       []db.Unit
	APIKeys     []db.ApiKey
	DirMonitors []db.Dirmonitor
	Downstreams []db.Downstream
	Webhooks    []db.Webhook
}

func (o *Operations) loadLiveConfig(ctx context.Context) (liveConfig, error) {
	var l liveConfig
	var err error
	if l.Settings, err = o.Queries.ListSettings(ctx); err != nil {
		return l, fmt.Errorf("failed to list settings: %w", err)
	}
	if l.Users, err = o.Queries.ListUsers(ctx); err != nil {
		return l, fmt.Errorf("failed to list users: %w", err)
	}
	if l.Groups, err = o.Queries.ListGroups(ctx); err != nil {
		return l, fmt.Errorf("failed to list groups: %w", err)
	}
	if l.Tags, err = o.Queries.ListTags(ctx); err != nil {
		return l, fmt.Errorf("failed to list tags: %w", err)
	}
	if l.Systems, err = o.Queries.ListSystems(ctx); err != nil {
		return l, fmt.Errorf("failed to list systems: %w", err)
	}
	if l.Talkgroups, err = o.Queries.ListAllTalkgroups(ctx); err != nil {
		return l, fmt.Errorf("failed to list talkgroups: %w", err)
	}
	if l.Units, err = o.Queries.ListAllUnits(ctx); err != nil {
		return l, fmt.Errorf("failed to list units: %w", err)
	}
	if l.APIKeys, err = o.Queries.ListAPIKeys(ctx); err != nil {
		return l, fmt.Errorf("failed to list api keys: %w", err)
	}
	if l.DirMonitors, err = o.Queries.ListDirMonitors(ctx); err != nil {
		return l, fmt.Errorf("failed to list dirmonitors: %w", err)
	}
	if l.Downstreams, err = o.Queries.ListDownstreams(ctx); err != nil {
		return l, fmt.Errorf("failed to list downstreams: %w", err)
	}
	if l.Webhooks, err = o.Queries.ListWebhooks(ctx); err != nil {
		return l, fmt.Errorf("failed to list webhooks: %w", err)
	}
	return l, nil
}

func flattenAPIKeys(keys []db.ApiKey) []importAPIKey {
	out := make([]importAPIKey, len(keys))
	for i, k := range keys {
		out[i] = importAPIKey{ID: k.ID, Key: k.Key, Ident: nullStr(k.Ident), Disabled: k.Disabled,
			SystemsJson: nullStr(k.SystemsJson), CallRateLimit: nullInt(k.CallRateLimit), Order: k.Order}
	}
	return out
}

func flattenDownstreams(ds []db.Downstream) []importDownstream {
	out := make([]importDownstream, len(ds))
	for i, d := range ds {
		out[i] = importDownstream{ID: d.ID, Url: d.Url, ApiKey: d.ApiKey, SystemsJson: nullStr(d.SystemsJson),
			Disabled: d.Disabled, Order: d.Order, Label: d.Label}
	}
	return out
}

func flattenWebhooks(ws []db.Webhook) []importWebhook {
	out := make([]importWebhook, len(ws))
	for i, w := range ws {
		out[i] = importWebhook{ID: w.ID, Url: w.Url, Type: w.Type, Secret: nullStr(w.Secret), SystemsJson: nullStr(w.SystemsJson),
			Disabled: w.Disabled, Order: w.Order, Label: w.Label}
	}
	return out
}

// BackupPreview compares a backup file with the live data, table by table,
// so the restore's review step can say what Merge would add or change and
// what Replace would also remove. Nothing is written.
func (o *Operations) BackupPreview(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	f, err := parseBackup(params)
	if err != nil {
		return nil, err
	}
	return o.previewBackup(ctx, f)
}

func (o *Operations) previewBackup(ctx context.Context, f backupFile) (BackupPreview, error) {
	live, err := o.loadLiveConfig(ctx)
	if err != nil {
		return BackupPreview{}, err
	}
	p := BackupPreview{Entities: []BackupEntity{}, Warnings: []string{}}
	if err := o.checkBackupSecrets(f); err != nil {
		p.Warnings = append(p.Warnings, err.Error())
	}

	fileSys, liveSys := systemNumbers(f.Systems), systemNumbers(live.Systems)
	fileGroups, liveGroups := groupNames(f.Groups), groupNames(live.Groups)
	fileTags, liveTags := tagNames(f.Tags), tagNames(live.Tags)
	encKey := o.Deps.EncryptionKey

	p.Entities = append(p.Entities,
		diffRows("systems", "Systems", systemRows(f.Systems), systemRows(live.Systems), f.Systems != nil),
		diffRows("talkgroups", "Talkgroups", talkgroupRows(f.Talkgroups, fileSys, fileGroups, fileTags), talkgroupRows(live.Talkgroups, liveSys, liveGroups, liveTags), f.Talkgroups != nil),
		diffRows("units", "Units", unitRows(f.Units, fileSys), unitRows(live.Units, liveSys), f.Units != nil),
		diffRows("groups", "Groups", labelRows(groupLabels(f.Groups)), labelRows(groupLabels(live.Groups)), f.Groups != nil),
		diffRows("tags", "Tags", labelRows(tagLabels(f.Tags)), labelRows(tagLabels(live.Tags)), f.Tags != nil),
		diffRows("users", "Users", userRows(f.Users), userRows(live.Users), f.Users != nil),
		diffRows("settings", "Settings", settingRows(f.Settings, encKey), settingRows(live.Settings, encKey), f.Settings != nil),
		diffRows("apiKeys", "API keys", apiKeyRows(f.APIKeys), apiKeyRows(flattenAPIKeys(live.APIKeys)), f.APIKeys != nil),
		diffRows("dirmonitors", "Folder monitors", dirMonitorRows(f.DirMonitors), dirMonitorRows(live.DirMonitors), f.DirMonitors != nil),
		diffRows("downstreams", "Forwarding targets", downstreamRows(f.Downstreams), downstreamRows(flattenDownstreams(live.Downstreams)), f.Downstreams != nil),
		diffRows("webhooks", "Webhooks", webhookRows(f.Webhooks), webhookRows(flattenWebhooks(live.Webhooks)), f.Webhooks != nil),
	)

	orphans := 0
	for _, tg := range f.Talkgroups {
		if _, ok := fileSys[tg.SystemID]; !ok {
			orphans++
		}
	}
	for _, u := range f.Units {
		if _, ok := fileSys[u.SystemID]; !ok {
			orphans++
		}
	}
	if orphans > 0 {
		p.Warnings = append(p.Warnings, fmt.Sprintf("%d talkgroups or units in the file belong to systems the file does not list; they are skipped", orphans))
	}
	// Settings are never removed: the review must not promise otherwise.
	for i := range p.Entities {
		if p.Entities[i].Key == "settings" {
			p.Entities[i].Removed, p.Entities[i].Examples = 0, []string{}
		}
	}
	return p, nil
}

// changed is how many rows the file would alter: what the review called
// "differ", and what a restore reports as updated.
func (p BackupPreview) changed() int {
	n := 0
	for _, e := range p.Entities {
		n += e.Changed
	}
	return n
}

// BackupCounts is what the Backup & import page shows beside each kind of
// radio data, plus when a backup was last downloaded.
type BackupCounts struct {
	Systems      int    `json:"systems"`
	Talkgroups   int    `json:"talkgroups"`
	Units        int    `json:"units"`
	Groups       int    `json:"groups"`
	Tags         int    `json:"tags"`
	Users        int    `json:"users"`
	LastBackupAt *int64 `json:"lastBackupAt"`
} // @name BackupCounts

// BackupCounts counts the radio data the page offers to export.
func (o *Operations) BackupCounts(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	systems, err := o.Queries.ListSystems(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list systems: %w", err)
	}
	tgCounts, err := o.Queries.CountTalkgroupsPerSystem(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to count talkgroups: %w", err)
	}
	unitCounts, err := o.Queries.CountUnitsPerSystem(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to count units: %w", err)
	}
	groups, err := o.Queries.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list groups: %w", err)
	}
	tags, err := o.Queries.ListTags(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %w", err)
	}
	users, err := o.Queries.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list users: %w", err)
	}
	c := BackupCounts{Systems: len(systems), Groups: len(groups), Tags: len(tags), Users: len(users)}
	for _, row := range tgCounts {
		c.Talkgroups += int(row.Talkgroups)
	}
	for _, row := range unitCounts {
		c.Units += int(row.Units)
	}
	if s, err := o.Queries.GetSetting(ctx, configBackupLastAtKey); err == nil {
		if at, perr := strconv.ParseInt(s.Value, 10, 64); perr == nil {
			c.LastBackupAt = &at
		}
	}
	return c, nil
}

// backupsDir is where pre-restore snapshots go: beside the database.
func (o *Operations) backupsDir() string {
	if o.Deps.DBFile == "" || o.Deps.DBFile == ":memory:" {
		return ""
	}
	return filepath.Join(filepath.Dir(o.Deps.DBFile), "backups")
}

// writePreRestoreSnapshot saves the live configuration before a restore
// rewrites it, so a wrong file is one restore away from undone. It returns
// the path, or "" when the server has no database file to sit beside.
func (o *Operations) writePreRestoreSnapshot(ctx context.Context) (string, error) {
	dir := o.backupsDir()
	if dir == "" {
		return "", nil
	}
	data, err := o.exportConfigData(ctx)
	if err != nil {
		return "", err
	}
	blob, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode snapshot: %w", err)
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("create backups directory: %w", err)
	}
	path := filepath.Join(dir, "pre-restore-"+time.Now().UTC().Format("20060102-150405")+".json")
	if err := os.WriteFile(path, blob, 0o600); err != nil {
		return "", fmt.Errorf("write snapshot: %w", err)
	}
	prunePreRestoreSnapshots(dir)
	return path, nil
}

func prunePreRestoreSnapshots(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "pre-restore-") && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for len(names) > preRestoreKeep {
		if err := os.Remove(filepath.Join(dir, names[0])); err != nil {
			slog.Warn("backup: could not prune old pre-restore snapshot", "file", names[0], "error", err)
		}
		names = names[1:]
	}
}
