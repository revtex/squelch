package stream

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
	streamsvc "github.com/revtex/squelch/internal/stream"
)

func TestUserFilter_AccountStateAndGrants(t *testing.T) {
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	q := db.New(sqlDB)
	ctx := context.Background()
	now := time.Now().Unix()

	mk := func(name string, disabled int64, exp sql.NullInt64, systems string) int64 {
		t.Helper()
		id, err := q.CreateUser(ctx, db.CreateUserParams{
			Username: name, PasswordHash: "x", Role: "listener", Disabled: disabled,
			SystemsJson: sql.NullString{String: systems, Valid: systems != ""},
			Expiration:  exp, CreatedAt: now, UpdatedAt: now,
		})
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return id
	}

	call := streamsvc.Call{ID: 1, SystemID: 1, TalkgroupID: 5}
	tests := []struct {
		name   string
		userID int64
		want   bool
	}{
		{name: "active, unrestricted", userID: mk("active", 0, sql.NullInt64{}, ""), want: true},
		{name: "disabled", userID: mk("disabled", 1, sql.NullInt64{}, ""), want: false},
		{name: "expired", userID: mk("expired", 0, sql.NullInt64{Int64: now - 3600, Valid: true}, ""), want: false},
		{name: "not yet expired", userID: mk("future", 0, sql.NullInt64{Int64: now + 3600, Valid: true}, ""), want: true},
		{name: "flat grant for the call's system", userID: mk("granted", 0, sql.NullInt64{}, "[1]"), want: true},
		{name: "flat grant for another system", userID: mk("ungranted", 0, sql.NullInt64{}, "[2]"), want: false},
		{name: "corrupt grant denies", userID: mk("corrupt", 0, sql.NullInt64{}, "{bad"), want: false},
		{name: "missing user", userID: 9999, want: false},
	}
	filter := userFilter(q)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := filter(ctx, tc.userID, call); got != tc.want {
				t.Errorf("filter() = %v, want %v", got, tc.want)
			}
		})
	}
}
