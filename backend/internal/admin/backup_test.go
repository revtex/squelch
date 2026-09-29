package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

func createRawUser(t *testing.T, q *db.Queries, username, role string) int64 {
	t.Helper()
	id, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: username, PasswordHash: "x", Role: role, CreatedAt: 1, UpdatedAt: 1,
	})
	if err != nil {
		t.Fatalf("CreateUser(%q): %v", username, err)
	}
	return id
}

// backupFixture is a backup made elsewhere: its PKs (99, 5, 6) mean nothing
// here, so matching has to go by system number, talkgroup number and label.
func backupFixture(mode string) map[string]any {
	return map[string]any{
		"mode":    mode,
		"systems": []map[string]any{{"id": 99, "system_id": 1, "label": "MARCS Lake", "auto_populate_talkgroups": 1, "order": 0}},
		"talkgroups": []map[string]any{
			{"id": 1, "system_id": 99, "talkgroup_id": 41011, "label": map[string]any{"String": "LC FD", "Valid": true}, "group_id": map[string]any{"Int64": 5, "Valid": true}},
			{"id": 2, "system_id": 99, "talkgroup_id": 41031, "label": map[string]any{"String": "LC EMS", "Valid": true}, "group_id": map[string]any{"Int64": 6, "Valid": true}},
		},
		"groups": []map[string]any{{"id": 5, "label": "Fire"}, {"id": 6, "label": "EMS"}},
		"users":  []map[string]any{{"username": "guest", "role": "listener", "disabled": 0}},
	}
}

func seedLive(t *testing.T, ops *Operations, q *db.Queries) (sysID int64) {
	t.Helper()
	createRawUser(t, q, "admin", "admin") // id 1, the caller
	createRawUser(t, q, "alice", "listener")
	sysID = createSystem(t, ops, 1, "MARCS")
	createTalkgroup(t, ops, sysID, 41011, "LC FD Disp")
	createTalkgroup(t, ops, sysID, 41021, "LCSO")
	for _, g := range []string{"Fire", "Police"} {
		if _, err := q.CreateGroup(context.Background(), g); err != nil {
			t.Fatal(err)
		}
	}
	return sysID
}

func entity(t *testing.T, p BackupPreview, key string) BackupEntity {
	t.Helper()
	for _, e := range p.Entities {
		if e.Key == key {
			return e
		}
	}
	t.Fatalf("no %q entity in %+v", key, p.Entities)
	return BackupEntity{}
}

func TestBackupPreview_ComparesFileWithLive(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)

	res, err := ops.BackupPreview(context.Background(), params(t, backupFixture("")), 1)
	if err != nil {
		t.Fatalf("BackupPreview: %v", err)
	}
	p := res.(BackupPreview)

	sys := entity(t, p, "systems")
	if sys.InFile != 1 || sys.Now != 1 || sys.Changed != 1 || sys.Added != 0 || sys.Removed != 0 {
		t.Errorf("systems = %+v, want 1 in file, 1 now, 1 changed", sys)
	}
	tg := entity(t, p, "talkgroups")
	if tg.InFile != 2 || tg.Now != 2 || tg.Added != 1 || tg.Changed != 1 || tg.Removed != 1 {
		t.Errorf("talkgroups = %+v, want 1 added, 1 changed, 1 removed", tg)
	}
	if len(tg.Examples) != 1 || tg.Examples[0] != "LCSO" {
		t.Errorf("talkgroup examples = %v, want [LCSO]", tg.Examples)
	}
	groups := entity(t, p, "groups")
	if groups.Added != 1 || groups.Removed != 1 || groups.Examples[0] != "Police" {
		t.Errorf("groups = %+v, want EMS added and Police removed", groups)
	}
	users := entity(t, p, "users")
	if users.Added != 1 || users.Removed != 2 {
		t.Errorf("users = %+v, want guest added, admin and alice not in file", users)
	}
	if s := entity(t, p, "settings"); s.Included || s.InFile != 0 {
		t.Errorf("settings = %+v, want not included", s)
	}
	if len(p.Warnings) != 0 {
		t.Errorf("warnings = %v, want none", p.Warnings)
	}
}

func TestBackupPreview_RejectsWhatIsNotABackup(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	for _, raw := range []string{`{"hello":"world"}`, `[]`, `{"mode":"sideways","systems":[]}`} {
		if _, err := ops.BackupPreview(context.Background(), json.RawMessage(raw), 1); err == nil {
			t.Errorf("BackupPreview(%s) accepted", raw)
		} else if _, ok := err.(UserError); !ok {
			t.Errorf("BackupPreview(%s) error %T, want a user error", raw, err)
		}
	}
}

func TestImportConfig_MergeAddsAndUpdatesButKeeps(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sysID := seedLive(t, ops, q)
	ctx := context.Background()

	res, err := ops.ImportConfig(ctx, params(t, backupFixture("merge")), 1)
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	r := res.(RestoreResult)
	if r.Mode != "merge" || r.Removed != 0 || r.Created != 3 /* EMS, 41031, guest */ || r.Updated != 2 /* system, 41011 */ {
		t.Errorf("result = %+v", r)
	}
	if s, _ := q.GetSystem(ctx, sysID); s.Label != "MARCS Lake" {
		t.Errorf("system label = %q, want renamed", s.Label)
	}
	tgs, _ := q.ListTalkgroupsBySystem(ctx, sysID)
	if len(tgs) != 3 {
		t.Fatalf("talkgroups = %d, want 41011, 41021 kept and 41031 added", len(tgs))
	}
	ems, err := q.GetGroupByLabel(ctx, "EMS")
	if err != nil {
		t.Fatal("EMS group not created")
	}
	for _, tg := range tgs {
		if tg.TalkgroupID == 41031 && (!tg.GroupID.Valid || tg.GroupID.Int64 != ems.ID) {
			t.Errorf("41031 group = %+v, want remapped to EMS %d", tg.GroupID, ems.ID)
		}
	}
	guest, err := q.GetUserByUsername(ctx, "guest")
	if err != nil {
		t.Fatal("guest not restored")
	}
	if guest.PasswordNeedChange != 1 || guest.PasswordHash == "" || guest.PasswordHash == "x" {
		t.Errorf("restored user = need change %d, hash %q; want a fresh unknown password", guest.PasswordNeedChange, guest.PasswordHash)
	}
	if _, err := q.GetUserByUsername(ctx, "alice"); err != nil {
		t.Error("merge removed alice")
	}
	if _, err := q.GetGroupByLabel(ctx, "Police"); err != nil {
		t.Error("merge removed the Police group")
	}
}

func TestImportConfig_ReplaceRemovesWhatTheFileLacks_AfterASnapshot(t *testing.T) {
	ops, q := newTestOperations(t, "")
	dir := t.TempDir()
	ops.Deps.DBFile = filepath.Join(dir, "squelch.db")
	sysID := seedLive(t, ops, q)
	ctx := context.Background()

	res, err := ops.ImportConfig(ctx, params(t, backupFixture("replace")), 1)
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	r := res.(RestoreResult)
	if r.Removed != 3 /* 41021, Police, alice */ {
		t.Errorf("removed = %d, want 3 (%+v)", r.Removed, r)
	}
	if !strings.HasPrefix(filepath.Base(r.Snapshot), "pre-restore-") {
		t.Fatalf("snapshot = %q", r.Snapshot)
	}
	blob, err := os.ReadFile(r.Snapshot)
	if err != nil {
		t.Fatalf("snapshot missing: %v", err)
	}
	var saved backupFile
	if err := json.Unmarshal(blob, &saved); err != nil {
		t.Fatalf("snapshot is not a backup: %v", err)
	}
	if len(saved.Talkgroups) != 2 || len(saved.Users) != 2 {
		t.Errorf("snapshot has %d talkgroups and %d users, want the pre-restore 2 and 2", len(saved.Talkgroups), len(saved.Users))
	}
	if strings.Contains(string(blob), "password_hash") {
		t.Error("snapshot carries password hashes")
	}

	tgs, _ := q.ListTalkgroupsBySystem(ctx, sysID)
	for _, tg := range tgs {
		if tg.TalkgroupID == 41021 {
			t.Error("replace kept 41021")
		}
	}
	if _, err := q.GetUserByUsername(ctx, "alice"); err == nil {
		t.Error("replace kept alice")
	}
	if _, err := q.GetUserByUsername(ctx, "admin"); err != nil {
		t.Error("replace removed the caller")
	}
	if _, err := q.GetGroupByLabel(ctx, "Police"); err == nil {
		t.Error("replace kept the Police group")
	}
	if _, err := q.GetGroupByLabel(ctx, "Fire"); err != nil {
		t.Error("replace removed Fire, which the file has")
	}
}

func TestImportConfig_ReplaceLeavesTablesTheFileDoesNotCarry(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)
	ctx := context.Background()

	file := backupFixture("replace")
	delete(file, "users")
	delete(file, "groups")
	if _, err := ops.ImportConfig(ctx, params(t, file), 1); err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if _, err := q.GetUserByUsername(ctx, "alice"); err != nil {
		t.Error("users were pruned though the file has no users table")
	}
	if _, err := q.GetGroupByLabel(ctx, "Police"); err != nil {
		t.Error("groups were pruned though the file has no groups table")
	}
}

func TestExportConfig_RoundTripsAndRecordsTheDownload(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)
	ctx := context.Background()
	if _, err := q.CreateAPIKey(ctx, db.CreateAPIKeyParams{Key: "hash", Ident: sql.NullString{String: "tr", Valid: true}, CreatedAt: 1}); err != nil {
		t.Fatal(err)
	}

	res, err := ops.ExportConfig(ctx, nil, 1)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}
	blob, _ := json.Marshal(res)
	if strings.Contains(string(blob), "password_hash") {
		t.Error("export carries password hashes")
	}
	f, err := parseBackup(blob)
	if err != nil {
		t.Fatalf("export does not read back: %v", err)
	}
	if len(f.APIKeys) != 1 || f.APIKeys[0].Key != "hash" || f.APIKeys[0].Ident == nil || *f.APIKeys[0].Ident != "tr" {
		t.Errorf("api keys = %+v", f.APIKeys)
	}
	counts, err := ops.BackupCounts(ctx, nil, 1)
	if err != nil {
		t.Fatalf("BackupCounts: %v", err)
	}
	c := counts.(BackupCounts)
	if c.LastBackupAt == nil || c.Systems != 1 || c.Talkgroups != 2 || c.Groups != 2 || c.Users != 2 {
		t.Errorf("counts = %+v", c)
	}
	// The download time never leaves the server.
	if _, ok := res.(map[string]any)["settings"].([]db.Setting); !ok {
		t.Fatal("settings missing from the export")
	}
	for _, s := range res.(map[string]any)["settings"].([]db.Setting) {
		if s.Key == configBackupLastAtKey {
			t.Error("export carries the last-backup time")
		}
	}
}

func TestExportTalkgroups_AllSystemsCarriesTheSystemNumber(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)
	other := createSystem(t, ops, 7, "Other")
	createTalkgroup(t, ops, other, 100, "Ops")

	all, err := ops.ExportTalkgroups(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("ExportTalkgroups(all): %v", err)
	}
	lines := strings.Split(strings.TrimSpace(all.(string)), "\n")
	if lines[0] != "system,talkgroup_id,label,name,tag,group,frequency,led,order" {
		t.Errorf("header = %q", lines[0])
	}
	if len(lines) != 4 || !strings.HasPrefix(lines[3], "7,100,Ops") {
		t.Errorf("rows = %q", lines)
	}

	one, err := ops.ExportTalkgroups(context.Background(), params(t, map[string]any{"systemId": other}), 1)
	if err != nil {
		t.Fatalf("ExportTalkgroups(one): %v", err)
	}
	if lines := strings.Split(strings.TrimSpace(one.(string)), "\n"); len(lines) != 2 || !strings.HasPrefix(lines[0], "talkgroup_id,") {
		t.Errorf("one system = %q", lines)
	}
}
