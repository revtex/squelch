package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

func createSystem(t *testing.T, ops *Operations, number int64, label string) int64 {
	t.Helper()
	res, err := ops.SystemsCreate(context.Background(), params(t, map[string]any{
		"systemId": number, "label": label, "autoPopulateTalkgroups": 1,
	}), 1)
	if err != nil {
		t.Fatalf("SystemsCreate(%q): %v", label, err)
	}
	return res.(map[string]any)["id"].(int64)
}

func createTalkgroup(t *testing.T, ops *Operations, systemID, number int64, label string) int64 {
	t.Helper()
	req := map[string]any{"systemId": systemID, "talkgroupId": number}
	if label != "" {
		req["label"] = label
	}
	res, err := ops.TalkgroupsCreate(context.Background(), params(t, req), 1)
	if err != nil {
		t.Fatalf("TalkgroupsCreate(%d): %v", number, err)
	}
	return res.(map[string]any)["id"].(int64)
}

func TestSystemsList_CountsAndRecentActivity(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sysID := createSystem(t, ops, 1, "MARCS")
	tgID := createTalkgroup(t, ops, sysID, 41011, "LC FD Disp")
	createTalkgroup(t, ops, sysID, 41021, "")
	if _, err := q.CreateUnit(context.Background(), db.CreateUnitParams{SystemID: sysID, UnitID: 7100101}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Unix()
	for _, at := range []int64{now - 60, now - 3600, now - 3*86400} {
		if _, err := q.CreateCall(context.Background(), db.CreateCallParams{
			AudioPath: "a", AudioName: "a", AudioType: "audio/mpeg", DateTime: at, SystemID: sysID,
			TalkgroupID: sql.NullInt64{Int64: tgID, Valid: true}, Duration: sql.NullInt64{Int64: 6000, Valid: true},
			Source: sql.NullInt64{Int64: 7100101, Valid: true},
		}); err != nil {
			t.Fatal(err)
		}
	}

	rows := decodeList(t, must(ops.SystemsList(context.Background(), nil, 1)))
	if len(rows) != 1 {
		t.Fatalf("systems = %d", len(rows))
	}
	s := rows[0]
	if s["talkgroups"] != float64(2) || s["units"] != float64(1) || s["calls24h"] != float64(2) {
		t.Errorf("counts = tg %v units %v calls24h %v", s["talkgroups"], s["units"], s["calls24h"])
	}
	if s["lastCall"] != float64(now-60) {
		t.Errorf("lastCall = %v", s["lastCall"])
	}

	tgs := decodeList(t, must(ops.TalkgroupsList(context.Background(), params(t, map[string]any{"systemId": sysID}), 1)))
	if len(tgs) != 2 {
		t.Fatalf("talkgroups = %d", len(tgs))
	}
	if tgs[0]["calls24h"] != float64(2) || tgs[0]["lastHeard"] != float64(now-60) || tgs[0]["avgDurationMs"] != float64(6000) {
		t.Errorf("talkgroup stats = %v", tgs[0])
	}
	if tgs[1]["calls24h"] != float64(0) || tgs[1]["lastHeard"] != nil {
		t.Errorf("quiet talkgroup stats = %v", tgs[1])
	}

	units := decodeList(t, must(ops.UnitsList(context.Background(), params(t, map[string]any{"systemId": sysID}), 1)))
	if len(units) != 1 || units[0]["lastHeard"] != float64(now-60) {
		t.Errorf("units = %v", units)
	}
}

func TestSystems_ValidationAndAudit(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	seedSessionUser(t, ops.Queries, "admin")
	_, err := ops.SystemsCreate(context.Background(), params(t, map[string]any{"systemId": 1, "label": "  "}), 1)
	var ue UserError
	if !errors.As(err, &ue) || !strings.Contains(err.Error(), "label is required") {
		t.Errorf("blank label: %v", err)
	}
	_, err = ops.SystemsCreate(context.Background(), params(t, map[string]any{"systemId": 1, "label": "X", "led": "plaid"}), 1)
	if !errors.As(err, &ue) || !strings.Contains(err.Error(), "led must be") {
		t.Errorf("bad led: %v", err)
	}
	id := createSystem(t, ops, 1, "MARCS")
	if got := lastLogMessage(t, ops); !strings.Contains(got, `system "MARCS" (number 1) created by admin`) {
		t.Errorf("audit = %q", got)
	}
	_, err = ops.SystemsCreate(context.Background(), params(t, map[string]any{"systemId": 1, "label": "Again"}), 1)
	if !errors.As(err, &ue) || !strings.Contains(err.Error(), "already in use") {
		t.Errorf("duplicate number: %v", err)
	}

	_, err = ops.SystemsUpdate(context.Background(), params(t, map[string]any{
		"id": id, "systemId": 2, "label": "MARCS-IP", "autoPopulateTalkgroups": 0, "led": "red",
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	got := lastLogMessage(t, ops)
	for _, want := range []string{`label "MARCS" → "MARCS-IP"`, "number 1 → 2", "talkgroup auto-populate off", "led default → red"} {
		if !strings.Contains(got, want) {
			t.Errorf("audit %q lacks %q", got, want)
		}
	}
}

func TestSystems_BlockReorderDelete(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	a := createSystem(t, ops, 1, "A")
	b := createSystem(t, ops, 2, "B")
	c := createSystem(t, ops, 3, "C")

	res, err := ops.SystemsBlock(context.Background(), params(t, map[string]any{"id": a, "talkgroupId": 42000}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ops.SystemsBlock(context.Background(), params(t, map[string]any{"id": a, "talkgroupId": 41999}), 1); err != nil {
		t.Fatal(err)
	}
	_ = res
	rows := decodeList(t, must(ops.SystemsList(context.Background(), nil, 1)))
	if got := rows[0]["blocked"]; len(got.([]any)) != 2 || got.([]any)[0] != float64(41999) {
		t.Errorf("blocked = %v", got)
	}
	if _, err := ops.SystemsUnblock(context.Background(), params(t, map[string]any{"id": a, "talkgroupId": 41999}), 1); err != nil {
		t.Fatal(err)
	}
	rows = decodeList(t, must(ops.SystemsList(context.Background(), nil, 1)))
	if got := rows[0]["blocked"]; len(got.([]any)) != 1 {
		t.Errorf("blocked after unblock = %v", got)
	}

	if _, err := ops.SystemsReorder(context.Background(), params(t, map[string]any{"ids": []int64{c, a}}), 1); err != nil {
		t.Fatal(err)
	}
	rows = decodeList(t, must(ops.SystemsList(context.Background(), nil, 1)))
	order := []string{rows[0]["label"].(string), rows[1]["label"].(string), rows[2]["label"].(string)}
	if strings.Join(order, "") != "CAB" {
		t.Errorf("order = %v", order)
	}

	createTalkgroup(t, ops, b, 1, "")
	out, err := ops.SystemsDelete(context.Background(), params(t, map[string]any{"id": b}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["talkgroups"] != 1 {
		t.Errorf("delete result = %v", out)
	}
	if got := lastLogMessage(t, ops); !strings.Contains(got, `system "B" (number 2) deleted`) || !strings.Contains(got, "1 talkgroups and 0 units") {
		t.Errorf("audit = %q", got)
	}
}

func TestTalkgroups_BulkAndDeleteMany(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sysID := createSystem(t, ops, 1, "A")
	x := createTalkgroup(t, ops, sysID, 100, "X")
	y := createTalkgroup(t, ops, sysID, 101, "Y")
	z := createTalkgroup(t, ops, sysID, 102, "Z")
	fire, err := q.CreateGroup(context.Background(), "Fire")
	if err != nil {
		t.Fatal(err)
	}

	res, err := ops.TalkgroupsBulk(context.Background(), params(t, map[string]any{
		"ids": []int64{x, y}, "groupId": fire, "led": "red",
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["updated"] != 2 {
		t.Errorf("bulk = %v", res)
	}
	tg, _ := q.GetTalkgroup(context.Background(), x)
	if tg.GroupID.Int64 != fire || tg.Led.String != "red" {
		t.Errorf("x after bulk = %+v", tg)
	}
	tg, _ = q.GetTalkgroup(context.Background(), z)
	if tg.GroupID.Valid || tg.Led.Valid {
		t.Errorf("z touched by bulk = %+v", tg)
	}
	if _, err := ops.TalkgroupsBulk(context.Background(), params(t, map[string]any{"ids": []int64{x}, "groupId": nil}), 1); err != nil {
		t.Fatal(err)
	}
	tg, _ = q.GetTalkgroup(context.Background(), x)
	if tg.GroupID.Valid {
		t.Errorf("group not cleared: %+v", tg)
	}
	if _, err := ops.TalkgroupsBulk(context.Background(), params(t, map[string]any{"ids": []int64{x}}), 1); err == nil {
		t.Error("bulk with nothing to change should fail")
	}

	out, err := ops.TalkgroupsDelete(context.Background(), params(t, map[string]any{"ids": []int64{y, z}}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if out.(map[string]any)["deleted"] != 2 {
		t.Errorf("delete = %v", out)
	}
	if got := lastLogMessage(t, ops); !strings.Contains(got, "2 talkgroups deleted") || !strings.Contains(got, "101 (Y), 102 (Z)") {
		t.Errorf("audit = %q", got)
	}
}

func TestParseTalkgroupCSV_Formats(t *testing.T) {
	cases := []struct {
		name, csv, format string
		rows              int
		problems          int
	}{
		{"squelch header", "talkgroup_id,label,name,tag,group,frequency,led,order\n41011,LC FD,Lake Fire,Dispatch,Fire,853.9125,red,1\n", FormatSquelch, 1, 0},
		{"headerless", "41011,LC FD,Lake Fire\n41012,LCSO,Sheriff\n", FormatSquelch, 2, 0},
		{"rdio-scanner", "dec,hex,alpha_tag,description,tag,group,priority\n41011,A02B,LC FD,Lake Fire,Dispatch,Fire,1\n", FormatRdioScanner, 1, 0},
		{"radioreference", "Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category\n41011,A02B,LC FD,D,Lake Fire,Fire Dispatch,Fire\nabc,,,,,,\n", FormatRadioReference, 1, 1},
	}
	for _, c := range cases {
		format, rows, problems, err := ParseTalkgroupCSV(strings.NewReader(c.csv))
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if format != c.format || len(rows) != c.rows || len(problems) != c.problems {
			t.Errorf("%s: format %s rows %d problems %d", c.name, format, len(rows), len(problems))
		}
	}
	_, rows, _, _ := ParseTalkgroupCSV(strings.NewReader("talkgroup_id,label,name,tag,group,frequency,led,order\n41011,LC FD,Lake Fire,Dispatch,Fire,853.9125,red,1\n"))
	if rows[0].Frequency == nil || *rows[0].Frequency != 853_912_500 {
		t.Errorf("MHz frequency not scaled: %v", rows[0].Frequency)
	}
	if rows[0].Group == nil || *rows[0].Group != "Fire" || rows[0].Tag == nil || *rows[0].Tag != "Dispatch" {
		t.Errorf("group/tag = %v/%v", rows[0].Group, rows[0].Tag)
	}
	if _, _, _, err := ParseTalkgroupCSV(strings.NewReader("label,name\nx,y\n")); err == nil {
		t.Error("a header without an id column should fail")
	}
}

func TestTalkgroupImport_PreviewAndApply(t *testing.T) {
	ops, q := newTestOperations(t, "")
	sysID := createSystem(t, ops, 1, "A")
	createTalkgroup(t, ops, sysID, 41011, "LC FD Disp")
	createTalkgroup(t, ops, sysID, 41777, "")

	format, rows, problems, err := ParseTalkgroupCSV(strings.NewReader(
		"talkgroup_id,label,name,group,tag\n41011,LC FD Disp,Lake County Fire Dispatch,Fire,Dispatch\n41777,Lake EMA,,,\n41250,Painesville FD,,Fire,\n41250,dup,,,\n"))
	if err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewTalkgroupImport(context.Background(), q, sysID, format, rows, problems)
	if err != nil {
		t.Fatal(err)
	}
	if preview.New != 1 || preview.Changed != 2 || preview.Unchanged != 0 || len(preview.Problems) != 1 {
		t.Errorf("preview = new %d changed %d unchanged %d problems %d", preview.New, preview.Changed, preview.Unchanged, len(preview.Problems))
	}
	first := preview.Rows[0]
	if first.Status != "changed" || len(first.Changes) != 3 || first.Changes[0].Field != "name" || first.Changes[0].Now != "" {
		t.Errorf("row 41011 = %+v", first)
	}

	// Fill mode only sets blanks; the existing label on 41011 stays.
	apply := func(mode string) map[string]any {
		body, _ := json.Marshal(map[string]any{"systemId": sysID, "mode": mode, "rows": rows})
		res, err := ops.TalkgroupsImport(context.Background(), body, 1)
		if err != nil {
			t.Fatalf("import %s: %v", mode, err)
		}
		return res.(map[string]any)
	}
	res := apply("fill")
	if res["created"] != 1 || res["updated"] != 2 {
		t.Errorf("fill = %v", res)
	}
	tg, _ := q.GetTalkgroupBySystemAndTGID(context.Background(), db.GetTalkgroupBySystemAndTGIDParams{SystemID: sysID, TalkgroupID: 41011})
	if tg.Name.String != "Lake County Fire Dispatch" || !tg.GroupID.Valid || !tg.TagID.Valid {
		t.Errorf("41011 after fill = %+v", tg)
	}
	g, err := q.GetGroupByLabel(context.Background(), "Fire")
	if err != nil || g.ID != tg.GroupID.Int64 {
		t.Errorf("group Fire not created/linked: %v %v", err, g)
	}
	// A second preview finds nothing to do; the browser reads "changes" as
	// a list even then, so it must never serialise as null.
	again, err := PreviewTalkgroupImport(context.Background(), q, sysID, format, rows, problems)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range again.Rows {
		if r.Status != "unchanged" || r.Changes == nil {
			t.Errorf("second preview row %d = %+v", r.TalkgroupID, r)
		}
	}
	res = apply("fill")
	if res["updated"] != 0 || res["unchanged"] != 3 {
		t.Errorf("second fill = %v", res)
	}

	// Overwrite replaces what is there.
	_, rows2, _, _ := ParseTalkgroupCSV(strings.NewReader("talkgroup_id,label\n41011,New Label\n"))
	body, _ := json.Marshal(map[string]any{"systemId": sysID, "mode": "overwrite", "rows": rows2})
	if _, err := ops.TalkgroupsImport(context.Background(), body, 1); err != nil {
		t.Fatal(err)
	}
	tg, _ = q.GetTalkgroupBySystemAndTGID(context.Background(), db.GetTalkgroupBySystemAndTGIDParams{SystemID: sysID, TalkgroupID: 41011})
	if tg.Label.String != "New Label" {
		t.Errorf("overwrite did not apply: %+v", tg)
	}
	if got := lastLogMessage(t, ops); !strings.Contains(got, `talkgroups imported into system "A"`) {
		t.Errorf("audit = %q", got)
	}
}
