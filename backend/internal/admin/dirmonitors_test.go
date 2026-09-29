package admin

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/revtex/squelch/internal/dirmonitor/status"
)

type fakeMonitors struct {
	snaps  map[int64]status.Snapshot
	forgot []int64
}

func (f *fakeMonitors) Status(id int64) (status.Snapshot, bool) {
	s, ok := f.snaps[id]
	return s, ok
}
func (f *fakeMonitors) Forget(id int64) { f.forgot = append(f.forgot, id) }

type countingReloader struct{ n int }

func (c *countingReloader) Reload() { c.n++ }

func TestDirMonitors_ListCarriesRuntimeStatus(t *testing.T) {
	o, _ := newTestOperations(t, "")
	mons := &fakeMonitors{snaps: map[int64]status.Snapshot{}}
	reload := &countingReloader{}
	o.Deps.DirMonitors = mons
	o.Deps.DirMonitorReload = reload
	ctx := context.Background()
	admin := seedSessionUser(t, o.Queries, "admin")
	dir := t.TempDir()

	created, err := o.DirMonitorsCreate(ctx, params(t, map[string]any{
		"directory": dir, "type": "trunk-recorder", "extension": ".json",
	}), admin)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.(map[string]any)["id"].(int64)
	if reload.n != 1 {
		t.Fatalf("reloads = %d", reload.n)
	}
	if msg := lastLogMessage(t, o); msg != "admin: folder monitor "+dir+" (trunk-recorder) created by admin" {
		t.Fatalf("audit line = %q", msg)
	}

	// Never started: stopped with a reason.
	rows := decodeList(t, must(o.DirMonitorsList(ctx, nil, admin)))
	st := rows[0]["status"].(map[string]any)
	if st["state"] != "stopped" || st["error"] != "not started" || rows[0]["extension"] != "json" {
		t.Fatalf("row = %v", rows[0])
	}

	mons.snaps[id] = status.Snapshot{State: status.Watching, Since: 10, LastFile: "/rec/a.json", LastFileAt: 11, LastResult: "became call 5", LastCallID: 5, Ingested24h: 3}
	rows = decodeList(t, must(o.DirMonitorsList(ctx, nil, admin)))
	st = rows[0]["status"].(map[string]any)
	if st["state"] != "watching" || st["lastCallId"] != float64(5) || st["ingested24h"] != float64(3) {
		t.Fatalf("status = %v", st)
	}

	// Disabled rows say so whatever the service remembers.
	if _, err := o.DirMonitorsUpdate(ctx, params(t, map[string]any{
		"id": id, "directory": dir, "type": "trunk-recorder", "disabled": 1,
	}), admin); err != nil {
		t.Fatalf("update: %v", err)
	}
	rows = decodeList(t, must(o.DirMonitorsList(ctx, nil, admin)))
	if st := rows[0]["status"].(map[string]any); st["state"] != "disabled" || st["lastFile"] != "/rec/a.json" {
		t.Fatalf("disabled status = %v", st)
	}
	if msg := lastLogMessage(t, o); msg != "admin: folder monitor \""+dir+"\" disabled by admin" {
		t.Fatalf("audit line = %q", msg)
	}
	_, err = o.DirMonitorsRestart(ctx, params(t, map[string]any{"id": id}), admin)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("restarting a disabled monitor should be refused, got %v", err)
	}

	if _, err := o.DirMonitorsDelete(ctx, params(t, map[string]any{"id": id}), admin); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(mons.forgot) != 1 || mons.forgot[0] != id {
		t.Fatalf("forgot = %v", mons.forgot)
	}
}

func TestDirMonitors_ChecksTheRequest(t *testing.T) {
	o, _ := newTestOperations(t, "")
	ctx := context.Background()
	for name, body := range map[string]map[string]any{
		"relative path": {"directory": "recordings"},
		"missing":       {"directory": "/definitely/not/here"},
		"bad type":      {"directory": t.TempDir(), "type": "zello"},
		"negative wait": {"directory": t.TempDir(), "delay": -1},
	} {
		_, err := o.DirMonitorsCreate(ctx, params(t, body), 1)
		var ue UserError
		if !errors.As(err, &ue) {
			t.Fatalf("%s: want a user error, got %v", name, err)
		}
	}
}

func TestDirMonitors_TestMask(t *testing.T) {
	o, _ := newTestOperations(t, "")
	o.Deps.MaskTester = func(mask, filename string) (map[string]string, bool) {
		if mask == "#TG_#DATE" && filename == "5200_2025-01-15" {
			return map[string]string{"#TG": "5200", "#DATE": "2025-01-15"}, true
		}
		return nil, false
	}
	res, err := o.DirMonitorsTestMask(context.Background(), params(t, map[string]any{
		"mask": "#TG_#DATE", "filename": "/rec/5200_2025-01-15.wav",
	}), 1)
	if err != nil {
		t.Fatalf("test mask: %v", err)
	}
	b, _ := json.Marshal(res)
	if string(b) != `{"ok":true,"values":{"#DATE":"2025-01-15","#TG":"5200"}}` {
		t.Fatalf("result = %s", b)
	}
	res, _ = o.DirMonitorsTestMask(context.Background(), params(t, map[string]any{"mask": "#TG", "filename": "x"}), 1)
	if res.(map[string]any)["ok"] != false {
		t.Fatalf("non-matching mask should report ok=false: %v", res)
	}
}
