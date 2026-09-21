package auth

import (
	"database/sql"
	"testing"
)

func TestParseSystemGrants(t *testing.T) {
	tests := []struct {
		name     string
		in       sql.NullString
		wantNil  bool
		wantSys  int64 // a system that must be granted (0 = skip)
		wantDeny int64 // a system that must be denied (0 = skip)
	}{
		{name: "null is unrestricted", in: sql.NullString{}, wantNil: true},
		{name: "blank is unrestricted", in: sql.NullString{Valid: true, String: "  "}, wantNil: true},
		{name: "empty array is unrestricted", in: sql.NullString{Valid: true, String: "[]"}, wantNil: true},
		{name: "flat UI form", in: sql.NullString{Valid: true, String: "[2,3]"}, wantSys: 2, wantDeny: 1},
		{name: "object form", in: sql.NullString{Valid: true, String: `[{"id":2}]`}, wantSys: 2, wantDeny: 1},
		{name: "garbage denies all", in: sql.NullString{Valid: true, String: "not-json"}, wantDeny: 1},
		{name: "wrong JSON type denies all", in: sql.NullString{Valid: true, String: `{"id":1}`}, wantDeny: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseSystemGrants(tc.in)
			if (got == nil) != tc.wantNil {
				t.Fatalf("ParseSystemGrants() nil = %v, want %v (got %v)", got == nil, tc.wantNil, got)
			}
			if tc.wantSys != 0 && !HasSystemAccess(got, tc.wantSys, 99) {
				t.Errorf("system %d should be granted by %q", tc.wantSys, tc.in.String)
			}
			if tc.wantDeny != 0 && HasSystemAccess(got, tc.wantDeny, 99) {
				t.Errorf("system %d should be denied by %q", tc.wantDeny, tc.in.String)
			}
		})
	}
}

func TestHasSystemAccess(t *testing.T) {
	tests := []struct {
		name   string
		grants []SystemGrant
		sys    int64
		tg     int64
		want   bool
	}{
		{name: "nil allows all", grants: nil, sys: 1, tg: 1, want: true},
		{name: "empty non-nil denies all", grants: DenyAllGrants(), sys: 1, tg: 1, want: false},
		{name: "system grant, any talkgroup", grants: []SystemGrant{{ID: 1}}, sys: 1, tg: 7, want: true},
		{name: "talkgroup grant, match", grants: []SystemGrant{{ID: 1, Talkgroups: []int64{7}}}, sys: 1, tg: 7, want: true},
		{name: "talkgroup grant, other talkgroup", grants: []SystemGrant{{ID: 1, Talkgroups: []int64{7}}}, sys: 1, tg: 8, want: false},
		{name: "other system", grants: []SystemGrant{{ID: 1}}, sys: 2, tg: 7, want: false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := HasSystemAccess(tc.grants, tc.sys, tc.tg); got != tc.want {
				t.Errorf("HasSystemAccess() = %v, want %v", got, tc.want)
			}
		})
	}
}
