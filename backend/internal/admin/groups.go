package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/revtex/squelch/internal/db"
)

// GroupsList returns every group with how many talkgroups use it.
func (o *Operations) GroupsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	groups, err := o.Queries.ListGroupsWithUsage(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list groups: %w", err)
	}
	out := make([]map[string]any, 0, len(groups))
	for _, g := range groups {
		out = append(out, map[string]any{"id": g.ID, "label": g.Label, "talkgroups": g.Talkgroups})
	}
	return out, nil
}

// GroupsCreate creates a new group.
func (o *Operations) GroupsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		Label string `json:"label"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	label, err := checkLabel(req.Label)
	if err != nil {
		return nil, err
	}

	id, err := o.Queries.CreateGroup(ctx, label)
	if isUniqueViolation(err) {
		return nil, UserError("group label already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create group: %w", err)
	}

	group, err := o.Queries.GetGroup(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created group: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: group %q created by %s", group.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("groups.updated", nil)
	o.broadcastCFG(ctx)
	return group, nil
}

// GroupsUpdate renames a group.
func (o *Operations) GroupsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID    int64  `json:"id"`
		Label string `json:"label"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	label, err := checkLabel(req.Label)
	if err != nil {
		return nil, err
	}

	before, err := o.Queries.GetGroup(ctx, req.ID)
	if err != nil {
		return nil, UserError("group not found")
	}

	err = o.Queries.UpdateGroup(ctx, db.UpdateGroupParams{ID: req.ID, Label: label})
	if isUniqueViolation(err) {
		return nil, UserError("group label already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update group: %w", err)
	}

	group, err := o.Queries.GetGroup(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated group: %w", err)
	}
	if before.Label != group.Label {
		o.audit(ctx, fmt.Sprintf("admin: group %q renamed to %q by %s", before.Label, group.Label, o.callerName(ctx, callerID)))
	}
	o.broadcastAdminEvent("groups.updated", nil)
	o.broadcastCFG(ctx)
	return group, nil
}

// GroupsDelete deletes a group. A group that talkgroups still use is only
// deleted when the request says where those talkgroups go: another group
// ("moveTo") or no group at all ("moveTo": null with "reassign": true).
func (o *Operations) GroupsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID       int64  `json:"id"`
		Reassign bool   `json:"reassign"`
		MoveTo   *int64 `json:"moveTo"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	group, err := o.Queries.GetGroup(ctx, req.ID)
	if err != nil {
		return nil, UserError("group not found")
	}
	inUse, err := o.Queries.CountTalkgroupsInGroup(ctx, sql.NullInt64{Int64: req.ID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("failed to count talkgroups: %w", err)
	}

	moved := ""
	if inUse > 0 {
		if !req.Reassign {
			return nil, UserError(fmt.Sprintf("%d talkgroups use this group; say where they should go first", inUse))
		}
		to := sql.NullInt64{}
		moved = "no group"
		if req.MoveTo != nil {
			if *req.MoveTo == req.ID {
				return nil, UserError("talkgroups cannot move to the group being deleted")
			}
			target, err := o.Queries.GetGroup(ctx, *req.MoveTo)
			if err != nil {
				return nil, UserError("the group to move talkgroups to was not found")
			}
			to = sql.NullInt64{Int64: target.ID, Valid: true}
			moved = fmt.Sprintf("group %q", target.Label)
		}
		if err := o.Queries.MoveTalkgroupsToGroup(ctx, db.MoveTalkgroupsToGroupParams{
			ToGroup:   to,
			FromGroup: sql.NullInt64{Int64: req.ID, Valid: true},
		}); err != nil {
			return nil, fmt.Errorf("failed to move talkgroups: %w", err)
		}
	}

	if err := o.Queries.DeleteGroup(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete group: %w", err)
	}
	msg := fmt.Sprintf("admin: group %q deleted by %s", group.Label, o.callerName(ctx, callerID))
	if moved != "" {
		msg += fmt.Sprintf(" (%d talkgroups moved to %s)", inUse, moved)
	}
	o.audit(ctx, msg)
	o.broadcastAdminEvent("groups.updated", nil)
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "moved": inUse}, nil
}

// checkLabel trims a group or tag label and rejects an empty or overlong one.
func checkLabel(label string) (string, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return "", UserError("label is required")
	}
	if len(label) > 64 {
		return "", UserError("label must be 64 characters or fewer")
	}
	return label, nil
}
