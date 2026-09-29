package auth

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"strings"
)

// SystemGrant is a system-level listener grant with optional talkgroup filter.
// Shared shape used across WS auth, downstream filtering, and API grant checks.
// ID is a systems.id primary key; Talkgroups holds talkgroups.id primary keys.
type SystemGrant struct {
	ID         int64   `json:"id"`
	Talkgroups []int64 `json:"talkgroups,omitempty"`
}

// ParseSystemGrants decodes a NULL-able systems_json column into grants.
//
// It accepts both stored shapes: the object form `[{"id":1,"talkgroups":[5]}]`
// and the flat form `[1,2]` the admin UI writes. A nil result means "all
// access" and is returned only for NULL, blank, or an empty array. Anything
// that cannot be parsed returns a non-nil empty slice, which denies
// everything: a corrupt grant must never widen access.
func ParseSystemGrants(sj sql.NullString) []SystemGrant {
	if !sj.Valid || strings.TrimSpace(sj.String) == "" {
		return nil
	}
	grants, err := parseSystemGrants(sj.String)
	if err != nil {
		slog.Warn("auth: unparseable systems_json; denying all systems", "error", err)
		return []SystemGrant{}
	}
	if len(grants) == 0 {
		return nil
	}
	return grants
}

func parseSystemGrants(s string) ([]SystemGrant, error) {
	var ids []int64
	if err := json.Unmarshal([]byte(s), &ids); err == nil {
		grants := make([]SystemGrant, 0, len(ids))
		for _, id := range ids {
			grants = append(grants, SystemGrant{ID: id})
		}
		return grants, nil
	}
	var grants []SystemGrant
	if err := json.Unmarshal([]byte(s), &grants); err != nil {
		return nil, err
	}
	return grants, nil
}

// APIKeySystemsContextKey is the gin context key under which APIKeyAuth
// stores a scoped API key's grants ([]SystemGrant). It is absent for keys
// with no system restriction.
const APIKeySystemsContextKey = "apiKeySystems"

// DenyAllGrants returns a grant list that matches nothing. Use it when the
// grants for a principal cannot be determined.
func DenyAllGrants() []SystemGrant {
	return []SystemGrant{}
}

// GrantsIncludeSystem reports whether grants cover systemID at all, ignoring
// any talkgroup filter. A nil list covers every system.
func GrantsIncludeSystem(grants []SystemGrant, systemID int64) bool {
	if grants == nil {
		return true
	}
	for _, g := range grants {
		if g.ID == systemID {
			return true
		}
	}
	return false
}

// HasSystemAccess reports whether the given grants permit access to a call on
// (systemID, talkgroupID). A nil list means "allow all"; a non-nil empty list
// denies everything.
func HasSystemAccess(grants []SystemGrant, systemID, talkgroupID int64) bool {
	if grants == nil {
		return true
	}
	for _, g := range grants {
		if g.ID != systemID {
			continue
		}
		if len(g.Talkgroups) == 0 {
			return true
		}
		for _, tg := range g.Talkgroups {
			if tg == talkgroupID {
				return true
			}
		}
	}
	return false
}
