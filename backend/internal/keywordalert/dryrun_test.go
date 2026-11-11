package keywordalert

import (
	"database/sql"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

func TestDryRunIgnoresScopeWhenUnset(t *testing.T) {
	s := &Service{}
	s.rules = []db.KeywordRule{{
		ID:             1,
		Label:          "413",
		PatternsJson:   `["413","four thirteen"]`,
		SystemsJson:    sql.NullString{String: `[2]`, Valid: true},
		TalkgroupsJson: sql.NullString{String: `[10,20]`, Valid: true},
		CooldownSec:    120,
	}}

	// Admin "Try a transcript" sends systemId=0, talkgroupId=0 — must still
	// exercise patterns even when rules are scoped to real systems/TGs.
	got := s.DryRun(0, 0, "Engine 413 responding to Queen Creek")
	if len(got) != 1 || got[0] != "413" {
		t.Fatalf("DryRun(0,0) = %v, want [413]", got)
	}
}

func TestDryRunRespectsScopeWhenSet(t *testing.T) {
	s := &Service{}
	s.rules = []db.KeywordRule{{
		ID:             1,
		Label:          "413",
		PatternsJson:   `["413"]`,
		SystemsJson:    sql.NullString{String: `[2]`, Valid: true},
		TalkgroupsJson: sql.NullString{String: `[10]`, Valid: true},
		CooldownSec:    120,
	}}

	if got := s.DryRun(2, 10, "Engine 413"); len(got) != 1 {
		t.Fatalf("in-scope DryRun = %v, want [413]", got)
	}
	if got := s.DryRun(2, 99, "Engine 413"); len(got) != 0 {
		t.Fatalf("wrong talkgroup DryRun = %v, want []", got)
	}
	if got := s.DryRun(9, 10, "Engine 413"); len(got) != 0 {
		t.Fatalf("wrong system DryRun = %v, want []", got)
	}
}
