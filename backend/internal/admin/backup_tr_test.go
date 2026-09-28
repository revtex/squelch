package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

type fakeTRSync struct{ updated, removed []int64 }

func (f *fakeTRSync) Update(_ context.Context, id int64) error {
	f.updated = append(f.updated, id)
	return nil
}

func (f *fakeTRSync) Remove(_ context.Context, id int64) error {
	f.removed = append(f.removed, id)
	return nil
}

func createBroker(t *testing.T, q *db.Queries, label, password string, enabled int64) db.TrInstance {
	t.Helper()
	row, err := q.CreateTRInstance(context.Background(), db.CreateTRInstanceParams{
		Label: label, InstanceID: "tr-" + label, BrokerUrl: "tcp://192.0.2.10:1883", BaseTopic: "trunk-recorder",
		UnitTopic: sql.NullString{String: "units", Valid: true}, Username: sql.NullString{String: "squelch", Valid: true},
		PasswordEnc: sql.NullString{String: password, Valid: password != ""}, Qos: 1, Enabled: enabled, CreatedAt: 1, UpdatedAt: 1,
	})
	if err != nil {
		t.Fatalf("CreateTRInstance(%q): %v", label, err)
	}
	return row
}

func TestBackup_TrunkRecorderBrokersRoundTrip(t *testing.T) {
	const key = "backup-test-key-backup-test-key-1"
	ops, q := newTestOperations(t, key)
	sync := &fakeTRSync{}
	ops.Deps.TRInstances = sync
	seedLive(t, ops, q)
	ctx := context.Background()
	enc, err := auth.EncryptString("mqtt-secret", key)
	if err != nil {
		t.Fatal(err)
	}
	original := createBroker(t, q, "lake", enc, 1)

	res, err := ops.ExportConfig(ctx, nil, 1)
	if err != nil {
		t.Fatalf("ExportConfig: %v", err)
	}
	blob, _ := json.Marshal(res)
	f, err := parseBackup(blob)
	if err != nil {
		t.Fatalf("export does not read back: %v", err)
	}
	if len(f.TRInstances) != 1 || f.TRInstances[0].PasswordEnc == nil || *f.TRInstances[0].PasswordEnc != enc {
		t.Fatalf("export trInstances = %+v, want the broker with its stored password", f.TRInstances)
	}

	// The broker is lost; a merge brings it back as it was and reconnects it.
	if err := q.DeleteTRInstance(ctx, original.ID); err != nil {
		t.Fatal(err)
	}
	p, err := ops.previewBackup(ctx, f)
	if err != nil {
		t.Fatal(err)
	}
	if e := entity(t, p, "trInstances"); e.Added != 1 || e.Label != "Trunk Recorder brokers" {
		t.Errorf("preview = %+v, want 1 broker added", e)
	}
	f.Mode = RestoreMerge
	blob, _ = json.Marshal(f)
	if _, err := ops.ImportConfig(ctx, blob, 1); err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	got, err := q.GetTRInstanceByLabel(ctx, "lake")
	if err != nil {
		t.Fatalf("broker not restored: %v", err)
	}
	if got.BrokerUrl != original.BrokerUrl || got.PasswordEnc.String != enc || got.UnitTopic.String != "units" || got.Qos != 1 || got.Enabled != 1 {
		t.Errorf("restored broker = %+v", got)
	}
	if !slices.Contains(sync.updated, got.ID) {
		t.Errorf("sync.updated = %v, want the restored broker %d reconnected", sync.updated, got.ID)
	}
}

func TestImportConfig_ReplaceRemovesAbsentBrokersAndDisconnectsThem(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sync := &fakeTRSync{}
	ops.Deps.TRInstances = sync
	seedLive(t, ops, q)
	ctx := context.Background()
	createBroker(t, q, "lake", "", 1)
	geauga := createBroker(t, q, "geauga", "", 1)
	paused := createBroker(t, q, "paused", "", 0)

	file := backupFixture("replace")
	file["trInstances"] = []map[string]any{
		{"label": "lake", "instance_id": "tr-lake", "broker_url": "tcp://192.0.2.20:1883", "base_topic": "trunk-recorder", "enabled": 1},
		{"label": "paused", "instance_id": "tr-paused", "broker_url": "tcp://192.0.2.10:1883", "base_topic": "trunk-recorder", "enabled": 0},
	}
	res, err := ops.ImportConfig(ctx, params(t, file), 1)
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	if r := res.(RestoreResult); r.Removed != 4 /* 41021, Police, alice, geauga */ {
		t.Errorf("removed = %d, want 4 (%+v)", r.Removed, r)
	}
	if _, err := q.GetTRInstanceByLabel(ctx, "geauga"); err == nil {
		t.Error("replace kept the geauga broker")
	}
	if lake, _ := q.GetTRInstanceByLabel(ctx, "lake"); lake.BrokerUrl != "tcp://192.0.2.20:1883" {
		t.Errorf("lake broker url = %q, want the file's", lake.BrokerUrl)
	}
	if !slices.Contains(sync.removed, geauga.ID) || !slices.Contains(sync.removed, paused.ID) {
		t.Errorf("sync.removed = %v, want the removed geauga and the disabled paused", sync.removed)
	}
}

func TestImportConfig_RefusesBrokerPasswordsItCannotRead(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)
	enc, err := auth.EncryptString("mqtt-secret", "some-other-servers-key-0123456789")
	if err != nil {
		t.Fatal(err)
	}
	file := backupFixture("merge")
	file["trInstances"] = []map[string]any{{"label": "lake", "broker_url": "tcp://192.0.2.10:1883", "base_topic": "tr", "password_enc": enc}}
	_, err = ops.ImportConfig(context.Background(), params(t, file), 1)
	if err == nil || !strings.Contains(err.Error(), "Trunk Recorder broker passwords") {
		t.Fatalf("err = %v, want a refusal naming the broker passwords", err)
	}
}

// A system Replace removes takes its talkgroups and units with it; the
// result counts them, as the review does.
func TestImportConfig_ReplaceCountsWhatARemovedSystemTakesWithIt(t *testing.T) {
	ops, q := newTestOperations(t, "")
	seedLive(t, ops, q)
	ctx := context.Background()
	geauga := createSystem(t, ops, 2, "Geauga")
	createTalkgroup(t, ops, geauga, 1001, "GCSO")
	createTalkgroup(t, ops, geauga, 1002, "GC Fire")
	if _, err := q.CreateUnit(ctx, db.CreateUnitParams{SystemID: geauga, UnitID: 7001, Label: sql.NullString{String: "Car 1", Valid: true}}); err != nil {
		t.Fatal(err)
	}

	res, err := ops.ImportConfig(ctx, params(t, backupFixture("replace")), 1)
	if err != nil {
		t.Fatalf("ImportConfig: %v", err)
	}
	// 41021, Police, alice, and Geauga with its two talkgroups and one unit.
	if r := res.(RestoreResult); r.Removed != 7 {
		t.Errorf("removed = %d, want 7 (%+v)", r.Removed, r)
	}
}
