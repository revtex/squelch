package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// TalkgroupsList returns talkgroups, all of them or one system's. With a
// systemId the rows carry recent activity: calls in the last 24 hours, the
// last call and the average call length in milliseconds.
func (o *Operations) TalkgroupsList(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		SystemID *int64 `json:"systemId"`
	}
	if params != nil {
		_ = json.Unmarshal(params, &req)
	}
	if req.SystemID == nil {
		tgs, err := o.Queries.ListAllTalkgroups(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to list talkgroups: %w", err)
		}
		return mapTalkgroups(tgs), nil
	}

	tgs, err := o.Queries.ListTalkgroupsBySystem(ctx, *req.SystemID)
	if err != nil {
		return nil, fmt.Errorf("failed to list talkgroups: %w", err)
	}
	type stat struct{ recent, last, avg int64 }
	stats := map[int64]stat{}
	rows, err := o.Queries.TalkgroupCallStats(ctx, db.TalkgroupCallStatsParams{
		Since: time.Now().Add(-24 * time.Hour).Unix(), SystemID: *req.SystemID,
	})
	if err == nil {
		for _, r := range rows {
			if r.TalkgroupID.Valid {
				stats[r.TalkgroupID.Int64] = stat{r.CallsRecent, r.LastCall, r.AvgDuration}
			}
		}
	}
	out := make([]map[string]any, 0, len(tgs))
	for _, tg := range tgs {
		m := mapTalkgroup(tg)
		st := stats[tg.ID]
		m["calls24h"] = st.recent
		m["lastHeard"] = nil
		if st.last > 0 {
			m["lastHeard"] = st.last
		}
		m["avgDurationMs"] = st.avg
		out = append(out, m)
	}
	return out, nil
}

type talkgroupRequest struct {
	ID          int64   `json:"id"`
	SystemID    int64   `json:"systemId"`
	TalkgroupID int64   `json:"talkgroupId"`
	Label       *string `json:"label"`
	Name        *string `json:"name"`
	Frequency   *int64  `json:"frequency"`
	Led         *string `json:"led"`
	GroupID     *int64  `json:"groupId"`
	TagID       *int64  `json:"tagId"`
	Order       int64   `json:"order"`
}

func trimPtr(p *string) *string {
	if p == nil {
		return nil
	}
	s := strings.TrimSpace(*p)
	if s == "" {
		return nil
	}
	return &s
}

func (r *talkgroupRequest) check(ctx context.Context, q *db.Queries) error {
	if r.TalkgroupID < 0 {
		return UserError("talkgroupId must be 0 or more")
	}
	r.Label, r.Name = trimPtr(r.Label), trimPtr(r.Name)
	r.Led = trimPtr(r.Led)
	if r.Label != nil && len(*r.Label) > 64 {
		return UserError("label must be 64 characters or fewer")
	}
	if r.Frequency != nil && *r.Frequency < 0 {
		return UserError("frequency must be 0 or more")
	}
	if err := checkLed(r.Led); err != nil {
		return err
	}
	if r.GroupID != nil {
		if _, err := q.GetGroup(ctx, *r.GroupID); err != nil {
			return UserError("group not found")
		}
	}
	if r.TagID != nil {
		if _, err := q.GetTag(ctx, *r.TagID); err != nil {
			return UserError("tag not found")
		}
	}
	return nil
}

func talkgroupName(tg db.Talkgroup) string {
	if tg.Label.Valid && strings.TrimSpace(tg.Label.String) != "" {
		return fmt.Sprintf("%d (%s)", tg.TalkgroupID, tg.Label.String)
	}
	return fmt.Sprintf("%d", tg.TalkgroupID)
}

// TalkgroupsCreate creates a new talkgroup.
func (o *Operations) TalkgroupsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req talkgroupRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	system, err := o.Queries.GetSystem(ctx, req.SystemID)
	if err != nil {
		return nil, UserError("system not found")
	}
	if err := req.check(ctx, o.Queries); err != nil {
		return nil, err
	}

	id, err := o.Queries.CreateTalkgroup(ctx, db.CreateTalkgroupParams{
		SystemID:    req.SystemID,
		TalkgroupID: req.TalkgroupID,
		Label:       ptrToNullStr(req.Label),
		Name:        ptrToNullStr(req.Name),
		Frequency:   ptrToNullInt(req.Frequency),
		Led:         ptrToNullStr(req.Led),
		GroupID:     ptrToNullInt(req.GroupID),
		TagID:       ptrToNullInt(req.TagID),
		Order:       req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError(fmt.Sprintf("talkgroup %d already exists on %s", req.TalkgroupID, system.Label))
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create talkgroup: %w", err)
	}

	tg, err := o.Queries.GetTalkgroup(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created talkgroup: %w", err)
	}
	slog.Info("admin: talkgroup created", "id", tg.ID, "talkgroup_id", tg.TalkgroupID, "by", callerID)
	o.audit(ctx, fmt.Sprintf("admin: talkgroup %s created on system %q by %s", talkgroupName(tg), system.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return mapTalkgroup(tg), nil
}

// TalkgroupsUpdate updates an existing talkgroup.
func (o *Operations) TalkgroupsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req talkgroupRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	before, err := o.Queries.GetTalkgroup(ctx, req.ID)
	if err != nil {
		return nil, UserError("talkgroup not found")
	}
	if err := req.check(ctx, o.Queries); err != nil {
		return nil, err
	}

	err = o.Queries.UpdateTalkgroup(ctx, db.UpdateTalkgroupParams{
		ID:          req.ID,
		TalkgroupID: req.TalkgroupID,
		Label:       ptrToNullStr(req.Label),
		Name:        ptrToNullStr(req.Name),
		Frequency:   ptrToNullInt(req.Frequency),
		Led:         ptrToNullStr(req.Led),
		GroupID:     ptrToNullInt(req.GroupID),
		TagID:       ptrToNullInt(req.TagID),
		Order:       req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError(fmt.Sprintf("talkgroup %d already exists on this system", req.TalkgroupID))
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update talkgroup: %w", err)
	}

	tg, err := o.Queries.GetTalkgroup(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated talkgroup: %w", err)
	}
	slog.Info("admin: talkgroup updated", "id", tg.ID, "talkgroup_id", tg.TalkgroupID, "by", callerID)
	if changes := talkgroupChanges(before, tg); len(changes) > 0 {
		o.audit(ctx, fmt.Sprintf("admin: talkgroup %s changed by %s: %s", talkgroupName(before), o.callerName(ctx, callerID), strings.Join(changes, ", ")))
	}
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return mapTalkgroup(tg), nil
}

func talkgroupChanges(a, b db.Talkgroup) []string {
	var out []string
	str := func(field string, x, y string) {
		if x != y {
			out = append(out, fmt.Sprintf("%s %s → %s", field, quoteIfBlank(x), quoteIfBlank(y)))
		}
	}
	num := func(field string, x, y *int64) {
		xs, ys := "none", "none"
		if x != nil {
			xs = fmt.Sprint(*x)
		}
		if y != nil {
			ys = fmt.Sprint(*y)
		}
		if xs != ys {
			out = append(out, fmt.Sprintf("%s %s → %s", field, xs, ys))
		}
	}
	if a.TalkgroupID != b.TalkgroupID {
		out = append(out, fmt.Sprintf("number %d → %d", a.TalkgroupID, b.TalkgroupID))
	}
	str("label", a.Label.String, b.Label.String)
	str("name", a.Name.String, b.Name.String)
	str("led", a.Led.String, b.Led.String)
	num("group", nullInt(a.GroupID), nullInt(b.GroupID))
	num("tag", nullInt(a.TagID), nullInt(b.TagID))
	num("frequency", nullInt(a.Frequency), nullInt(b.Frequency))
	return out
}

// TalkgroupsDelete deletes one talkgroup, or several with ids.
func (o *Operations) TalkgroupsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID  int64   `json:"id"`
		IDs []int64 `json:"ids"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	ids := req.IDs
	if req.ID > 0 {
		ids = append(ids, req.ID)
	}
	if len(ids) == 0 {
		return nil, UserError("id is required")
	}
	if len(ids) > 10_000 {
		return nil, UserError("too many talkgroups at once")
	}

	deleted := 0
	var names []string
	for _, id := range ids {
		tg, err := o.Queries.GetTalkgroup(ctx, id)
		if err != nil {
			if len(ids) == 1 {
				return nil, UserError("talkgroup not found")
			}
			continue
		}
		if err := o.Queries.DeleteTalkgroup(ctx, id); err != nil {
			return nil, fmt.Errorf("failed to delete talkgroup: %w", err)
		}
		deleted++
		if len(names) < 5 {
			names = append(names, talkgroupName(tg))
		}
	}
	slog.Info("admin: talkgroups deleted", "count", deleted, "by", callerID)
	summary := strings.Join(names, ", ")
	if deleted > len(names) {
		summary += fmt.Sprintf(" and %d more", deleted-len(names))
	}
	o.audit(ctx, fmt.Sprintf("admin: %d talkgroups deleted by %s: %s", deleted, o.callerName(ctx, callerID), summary))
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "deleted": deleted}, nil
}

// TalkgroupsBulk sets the group, tag or LED colour on several talkgroups at
// once. A field that is present is applied, null clearing it; absent fields
// are left alone.
func (o *Operations) TalkgroupsBulk(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	// A null field means "clear it", so presence is read from the raw
	// object rather than from pointers, which json sets to nil for null.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(params, &raw); err != nil {
		return nil, UserError("invalid request body")
	}
	var req struct {
		IDs     []int64          `json:"ids"`
		GroupID *json.RawMessage `json:"groupId"`
		TagID   *json.RawMessage `json:"tagId"`
		Led     *json.RawMessage `json:"led"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	null := json.RawMessage("null")
	if _, ok := raw["groupId"]; ok && req.GroupID == nil {
		req.GroupID = &null
	}
	if _, ok := raw["tagId"]; ok && req.TagID == nil {
		req.TagID = &null
	}
	if _, ok := raw["led"]; ok && req.Led == nil {
		req.Led = &null
	}
	if len(req.IDs) == 0 {
		return nil, UserError("ids are required")
	}
	if len(req.IDs) > 10_000 {
		return nil, UserError("too many talkgroups at once")
	}
	if req.GroupID == nil && req.TagID == nil && req.Led == nil {
		return nil, UserError("nothing to change")
	}

	var changes []string
	var groupID, tagID *int64
	var led *string
	if req.GroupID != nil {
		if err := json.Unmarshal(*req.GroupID, &groupID); err != nil {
			return nil, UserError("groupId must be a number or null")
		}
		if groupID != nil {
			g, err := o.Queries.GetGroup(ctx, *groupID)
			if err != nil {
				return nil, UserError("group not found")
			}
			changes = append(changes, "group "+g.Label)
		} else {
			changes = append(changes, "group cleared")
		}
	}
	if req.TagID != nil {
		if err := json.Unmarshal(*req.TagID, &tagID); err != nil {
			return nil, UserError("tagId must be a number or null")
		}
		if tagID != nil {
			t, err := o.Queries.GetTag(ctx, *tagID)
			if err != nil {
				return nil, UserError("tag not found")
			}
			changes = append(changes, "tag "+t.Label)
		} else {
			changes = append(changes, "tag cleared")
		}
	}
	if req.Led != nil {
		if err := json.Unmarshal(*req.Led, &led); err != nil {
			return nil, UserError("led must be a colour or null")
		}
		led = trimPtr(led)
		if err := checkLed(led); err != nil {
			return nil, err
		}
		if led != nil {
			changes = append(changes, "led "+*led)
		} else {
			changes = append(changes, "led cleared")
		}
	}

	updated := 0
	for _, id := range req.IDs {
		if _, err := o.Queries.GetTalkgroup(ctx, id); err != nil {
			continue
		}
		if req.GroupID != nil {
			if err := o.Queries.SetTalkgroupGroup(ctx, db.SetTalkgroupGroupParams{GroupID: ptrToNullInt(groupID), ID: id}); err != nil {
				return nil, fmt.Errorf("failed to set group: %w", err)
			}
		}
		if req.TagID != nil {
			if err := o.Queries.SetTalkgroupTag(ctx, db.SetTalkgroupTagParams{TagID: ptrToNullInt(tagID), ID: id}); err != nil {
				return nil, fmt.Errorf("failed to set tag: %w", err)
			}
		}
		if req.Led != nil {
			if err := o.Queries.SetTalkgroupLed(ctx, db.SetTalkgroupLedParams{Led: ptrToNullStr(led), ID: id}); err != nil {
				return nil, fmt.Errorf("failed to set led: %w", err)
			}
		}
		updated++
	}
	o.audit(ctx, fmt.Sprintf("admin: %d talkgroups changed by %s: %s", updated, o.callerName(ctx, callerID), strings.Join(changes, ", ")))
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "updated": updated}, nil
}
