package admin

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

// seedTalkgroup creates one talkgroup on a throwaway system, in the given
// group and tag, and returns its row id.
func seedTalkgroup(t *testing.T, q *db.Queries, tgID int64, group, tag sql.NullInt64) int64 {
	t.Helper()
	ctx := context.Background()
	sys, err := q.GetSystemBySystemID(ctx, 1)
	if err != nil {
		id, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 1, Label: "Test", AutoPopulateTalkgroups: 1})
		if err != nil {
			t.Fatalf("CreateSystem: %v", err)
		}
		sys, err = q.GetSystem(ctx, id)
		if err != nil {
			t.Fatalf("GetSystem: %v", err)
		}
	}
	id, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{
		SystemID: sys.ID, TalkgroupID: tgID, GroupID: group, TagID: tag,
	})
	if err != nil {
		t.Fatalf("CreateTalkgroup: %v", err)
	}
	return id
}

func createGroup(t *testing.T, ops *Operations, label string) int64 {
	t.Helper()
	res, err := ops.GroupsCreate(context.Background(), params(t, map[string]any{"label": label}), 1)
	if err != nil {
		t.Fatalf("GroupsCreate(%q): %v", label, err)
	}
	return res.(db.Group).ID
}

func TestGroupsList_CountsTalkgroups(t *testing.T) {
	ops, q := newTestOperations(t, "")
	fire := createGroup(t, ops, "Fire")
	createGroup(t, ops, "Law")
	seedTalkgroup(t, q, 100, sql.NullInt64{Int64: fire, Valid: true}, sql.NullInt64{})
	seedTalkgroup(t, q, 101, sql.NullInt64{Int64: fire, Valid: true}, sql.NullInt64{})

	res, err := ops.GroupsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("GroupsList: %v", err)
	}
	counts := map[string]int64{}
	for _, g := range res.([]map[string]any) {
		counts[g["label"].(string)] = g["talkgroups"].(int64)
	}
	if counts["Fire"] != 2 || counts["Law"] != 0 {
		t.Fatalf("counts = %v, want Fire=2 Law=0", counts)
	}
}

func TestGroupsCreate_TrimsAndRejectsBlank(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	res, err := ops.GroupsCreate(context.Background(), params(t, map[string]any{"label": "  EMS  "}), 1)
	if err != nil {
		t.Fatalf("GroupsCreate: %v", err)
	}
	if got := res.(db.Group).Label; got != "EMS" {
		t.Fatalf("label = %q, want trimmed", got)
	}
	_, err = ops.GroupsCreate(context.Background(), params(t, map[string]any{"label": "   "}), 1)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("blank label: err = %v, want a user error", err)
	}
}

func TestGroupsDelete_InUseNeedsADestination(t *testing.T) {
	ops, q := newTestOperations(t, "")
	fire := createGroup(t, ops, "Fire")
	ems := createGroup(t, ops, "EMS")
	a := seedTalkgroup(t, q, 100, sql.NullInt64{Int64: fire, Valid: true}, sql.NullInt64{})
	b := seedTalkgroup(t, q, 101, sql.NullInt64{Int64: fire, Valid: true}, sql.NullInt64{})

	_, err := ops.GroupsDelete(context.Background(), params(t, map[string]any{"id": fire}), 1)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("delete without a destination: err = %v, want a user error", err)
	}
	if _, err := q.GetGroup(context.Background(), fire); err != nil {
		t.Fatalf("group was deleted anyway: %v", err)
	}

	_, err = ops.GroupsDelete(context.Background(), params(t, map[string]any{"id": fire, "reassign": true, "moveTo": fire}), 1)
	if !errors.As(err, &ue) {
		t.Fatalf("move to itself: err = %v, want a user error", err)
	}

	res, err := ops.GroupsDelete(context.Background(), params(t, map[string]any{"id": fire, "reassign": true, "moveTo": ems}), 1)
	if err != nil {
		t.Fatalf("delete with a destination: %v", err)
	}
	if moved := res.(map[string]any)["moved"].(int64); moved != 2 {
		t.Fatalf("moved = %d, want 2", moved)
	}
	for _, id := range []int64{a, b} {
		tg, err := q.GetTalkgroup(context.Background(), id)
		if err != nil {
			t.Fatalf("GetTalkgroup: %v", err)
		}
		if !tg.GroupID.Valid || tg.GroupID.Int64 != ems {
			t.Fatalf("talkgroup %d group = %v, want EMS", id, tg.GroupID)
		}
	}
	if _, err := q.GetGroup(context.Background(), fire); err == nil {
		t.Fatal("group still exists after delete")
	}
}

func TestGroupsDelete_CanClearTheGroupInstead(t *testing.T) {
	ops, q := newTestOperations(t, "")
	fire := createGroup(t, ops, "Fire")
	a := seedTalkgroup(t, q, 100, sql.NullInt64{Int64: fire, Valid: true}, sql.NullInt64{})

	if _, err := ops.GroupsDelete(context.Background(), params(t, map[string]any{"id": fire, "reassign": true, "moveTo": nil}), 1); err != nil {
		t.Fatalf("GroupsDelete: %v", err)
	}
	tg, err := q.GetTalkgroup(context.Background(), a)
	if err != nil {
		t.Fatalf("GetTalkgroup: %v", err)
	}
	if tg.GroupID.Valid {
		t.Fatalf("talkgroup still has group %d", tg.GroupID.Int64)
	}
}

func TestTagsDelete_MovesTalkgroups(t *testing.T) {
	ops, q := newTestOperations(t, "")
	mk := func(label string) int64 {
		res, err := ops.TagsCreate(context.Background(), params(t, map[string]any{"label": label}), 1)
		if err != nil {
			t.Fatalf("TagsCreate: %v", err)
		}
		return res.(db.Tag).ID
	}
	disp := mk("Dispatch")
	tac := mk("Tac")
	a := seedTalkgroup(t, q, 100, sql.NullInt64{}, sql.NullInt64{Int64: disp, Valid: true})

	_, err := ops.TagsDelete(context.Background(), params(t, map[string]any{"id": disp}), 1)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("delete in-use tag: err = %v, want a user error", err)
	}
	if _, err := ops.TagsDelete(context.Background(), params(t, map[string]any{"id": disp, "reassign": true, "moveTo": tac}), 1); err != nil {
		t.Fatalf("TagsDelete with destination: %v", err)
	}
	tg, _ := q.GetTalkgroup(context.Background(), a)
	if !tg.TagID.Valid || tg.TagID.Int64 != tac {
		t.Fatalf("tag = %v, want Tac", tg.TagID)
	}
}
