package imports_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

// A RadioReference export has both a Tag and a Category column. Category is
// the agency or county and becomes the group, as the import wizard and
// rdio-scanner read it; Tag stays the tag.
func TestImportTalkgroups_RadioReferenceCategoryIsGroup(t *testing.T) {
	engine, q, tok := importsFixture(t)
	ctx := context.Background()
	sysID, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 6643, Label: "MARCS"})
	if err != nil {
		t.Fatalf("CreateSystem: %v", err)
	}
	csv := "Decimal,Hex,Alpha Tag,Mode,Description,Tag,Category\n" +
		`5000,1388,"FD01DISP","D","County Fire/EMS Dispatch","Fire Dispatch","Adams County"` + "\n"
	body, ct := multipartCSV(t, map[string]string{"system_id": fmt.Sprintf("%d", sysID)}, csv)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/import/talkgroups", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d; body: %s", w.Code, w.Body.String())
	}

	tg, err := q.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{SystemID: sysID, TalkgroupID: 5000})
	if err != nil {
		t.Fatalf("talkgroup not created: %v", err)
	}
	if tg.Label.String != "FD01DISP" || tg.Name.String != "County Fire/EMS Dispatch" {
		t.Errorf("label, name = %q, %q", tg.Label.String, tg.Name.String)
	}
	if !tg.GroupID.Valid {
		t.Fatalf("group not set")
	}
	if g, _ := q.GetGroup(ctx, tg.GroupID.Int64); g.Label != "Adams County" {
		t.Errorf("group = %q, want Adams County", g.Label)
	}
	if !tg.TagID.Valid {
		t.Fatalf("tag not set")
	}
	if tag, _ := q.GetTag(ctx, tg.TagID.Int64); tag.Label != "Fire Dispatch" {
		t.Errorf("tag = %q, want Fire Dispatch", tag.Label)
	}
}
