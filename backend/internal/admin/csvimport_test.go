package admin

import (
	"context"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

func TestParseUnitCSV_WithAndWithoutHeader(t *testing.T) {
	rows, problems, err := ParseUnitCSV(strings.NewReader("system,unit_id,label,order\n1,7100101,Engine 1,2\n1,x,Bad,0\n1,7100102,,\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].UnitID != 7100101 || *rows[0].Label != "Engine 1" || *rows[0].Order != 2 || rows[1].Label != nil {
		t.Errorf("rows = %+v", rows)
	}
	if len(problems) != 1 || problems[0].Row != 3 {
		t.Errorf("problems = %+v", problems)
	}

	bare, _, err := ParseUnitCSV(strings.NewReader("7100200,Medic 2\n"))
	if err != nil || len(bare) != 1 || *bare[0].Label != "Medic 2" {
		t.Errorf("bare = %+v, %v", bare, err)
	}
	if _, _, err := ParseUnitCSV(strings.NewReader("label,order\nx,1\n")); err == nil {
		t.Error("a header without a unit id column was accepted")
	}
}

func TestPreviewAndImportUnits(t *testing.T) {
	ops, q := newTestOperations(t, "")
	ctx := context.Background()
	sysID := createSystem(t, ops, 1, "MARCS")
	for _, u := range []db.CreateUnitParams{
		{SystemID: sysID, UnitID: 1},
		{SystemID: sysID, UnitID: 2, Label: ptrToNullStr(strPtrOf("Engine 2"))},
	} {
		if _, err := q.CreateUnit(ctx, u); err != nil {
			t.Fatal(err)
		}
	}
	rows, _, _ := ParseUnitCSV(strings.NewReader("unit_id,label\n1,Engine 1\n2,Engine Two\n3,Medic 3\n2,dup\n"))
	p, err := PreviewUnitImport(ctx, q, sysID, rows, nil)
	if err != nil {
		t.Fatal(err)
	}
	if p.New != 1 || p.Changed != 2 || p.Unchanged != 0 || len(p.Problems) != 1 {
		t.Errorf("preview = new %d changed %d unchanged %d problems %d", p.New, p.Changed, p.Unchanged, len(p.Problems))
	}

	res, err := ops.UnitsImport(ctx, params(t, map[string]any{"systemId": sysID, "mode": "fill", "rows": rows}), 1)
	if err != nil {
		t.Fatalf("UnitsImport(fill): %v", err)
	}
	got := res.(map[string]any)
	if got["created"] != 1 || got["updated"] != 1 || got["unchanged"] != 1 {
		t.Errorf("fill = %+v", got)
	}
	u2, _ := q.GetUnitBySystemAndUnitID(ctx, db.GetUnitBySystemAndUnitIDParams{SystemID: sysID, UnitID: 2})
	if u2.Label.String != "Engine 2" {
		t.Errorf("fill overwrote unit 2: %q", u2.Label.String)
	}

	res, err = ops.UnitsImport(ctx, params(t, map[string]any{"systemId": sysID, "mode": "overwrite", "rows": rows}), 1)
	if err != nil {
		t.Fatalf("UnitsImport(overwrite): %v", err)
	}
	if got := res.(map[string]any); got["updated"] != 1 {
		t.Errorf("overwrite = %+v", got)
	}
	u2, _ = q.GetUnitBySystemAndUnitID(ctx, db.GetUnitBySystemAndUnitIDParams{SystemID: sysID, UnitID: 2})
	if u2.Label.String != "Engine Two" {
		t.Errorf("overwrite left unit 2 as %q", u2.Label.String)
	}
	if _, err := ops.UnitsImport(ctx, params(t, map[string]any{"systemId": sysID, "mode": "sideways", "rows": rows}), 1); err == nil {
		t.Error("a bad mode was accepted")
	}
}

func strPtrOf(s string) *string { return &s }

func TestParseAndPreviewLabels_ThenImport(t *testing.T) {
	rows, problems, err := ParseLabelCSV(strings.NewReader("label\nFire\n\nEMS\n" + strings.Repeat("x", 65) + "\nfire\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].Label != "Fire" || rows[1].Label != "EMS" {
		t.Errorf("rows = %+v", rows)
	}
	if len(problems) != 1 || !strings.Contains(problems[0].Reason, "64") {
		t.Errorf("problems = %+v", problems)
	}
	p := PreviewLabelImport([]string{"fire"}, rows, problems)
	if p.New != 1 || p.Unchanged != 1 || len(p.Problems) != 2 {
		t.Errorf("preview = new %d unchanged %d problems %+v", p.New, p.Unchanged, p.Problems)
	}

	bare, _, _ := ParseLabelCSV(strings.NewReader("Police\nRoads\n"))
	if len(bare) != 2 || bare[0].Label != "Police" {
		t.Errorf("bare = %+v", bare)
	}

	ops, q := newTestOperations(t, "")
	ctx := context.Background()
	if _, err := q.CreateGroup(ctx, "Fire"); err != nil {
		t.Fatal(err)
	}
	res, err := ops.GroupsImport(ctx, params(t, map[string]any{"labels": []string{"Fire", "EMS", "ems"}}), 1)
	if err != nil {
		t.Fatalf("GroupsImport: %v", err)
	}
	if got := res.(map[string]any); got["created"] != 1 || got["unchanged"] != 2 {
		t.Errorf("groups = %+v", got)
	}
	res, err = ops.TagsImport(ctx, params(t, map[string]any{"labels": []string{"Dispatch"}}), 1)
	if err != nil {
		t.Fatalf("TagsImport: %v", err)
	}
	if got := res.(map[string]any); got["created"] != 1 {
		t.Errorf("tags = %+v", got)
	}
	if _, err := ops.TagsImport(ctx, params(t, map[string]any{"labels": []string{""}}), 1); err == nil {
		t.Error("an empty label was accepted")
	}
}
