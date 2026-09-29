package trmqtt

import (
	"context"

	"github.com/revtex/squelch/internal/db"
)

// Querier is the subset of sqlc-generated DB methods this package needs.
// Kept as an interface for testability — the concrete *db.Queries satisfies it.
type Querier interface {
	ListEnabledTRInstances(ctx context.Context) ([]db.TrInstance, error)
	GetTRInstance(ctx context.Context, id int64) (db.TrInstance, error)
	TouchTRInstanceLastSeen(ctx context.Context, arg db.TouchTRInstanceLastSeenParams) error
}

// Enricher is a stub interface for talkgroup/unit metadata lookups against
// the existing tables. Step 3+ wires real lookups; v1 here just returns the
// TR-supplied alpha tags as-is when present.
//
// TODO(step-3): wire real lookups against db.GetTalkgroupByIDs / units table
// and prefer TR's own alpha tag only when the DB has no entry.
type Enricher interface {
	EnrichUnit(ctx context.Context, systemShortname string, unitID int64) (alpha string, ok bool)
	EnrichTalkgroup(ctx context.Context, systemShortname string, tgID int64) (alpha string, ok bool)
}

// noopEnricher is the default; always returns ok=false so callers fall back
// to whatever alpha tag the TR plugin supplied.
type noopEnricher struct{}

func (noopEnricher) EnrichUnit(context.Context, string, int64) (string, bool) {
	return "", false
}
func (noopEnricher) EnrichTalkgroup(context.Context, string, int64) (string, bool) {
	return "", false
}
