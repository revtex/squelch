package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/revtex/squelch/internal/db"
)

// TagsList returns every tag with how many talkgroups use it.
func (o *Operations) TagsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	tags, err := o.Queries.ListTagsWithUsage(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list tags: %w", err)
	}
	out := make([]map[string]any, 0, len(tags))
	for _, g := range tags {
		out = append(out, map[string]any{"id": g.ID, "label": g.Label, "talkgroups": g.Talkgroups})
	}
	return out, nil
}

// TagsCreate creates a new tag.
func (o *Operations) TagsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
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

	id, err := o.Queries.CreateTag(ctx, label)
	if isUniqueViolation(err) {
		return nil, UserError("tag label already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create tag: %w", err)
	}

	tag, err := o.Queries.GetTag(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created tag: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: tag %q created by %s", tag.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("tags.updated", nil)
	o.broadcastCFG(ctx)
	return tag, nil
}

// TagsUpdate renames a tag.
func (o *Operations) TagsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
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

	before, err := o.Queries.GetTag(ctx, req.ID)
	if err != nil {
		return nil, UserError("tag not found")
	}

	err = o.Queries.UpdateTag(ctx, db.UpdateTagParams{ID: req.ID, Label: label})
	if isUniqueViolation(err) {
		return nil, UserError("tag label already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update tag: %w", err)
	}

	tag, err := o.Queries.GetTag(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated tag: %w", err)
	}
	if before.Label != tag.Label {
		o.audit(ctx, fmt.Sprintf("admin: tag %q renamed to %q by %s", before.Label, tag.Label, o.callerName(ctx, callerID)))
	}
	o.broadcastAdminEvent("tags.updated", nil)
	o.broadcastCFG(ctx)
	return tag, nil
}

// TagsDelete deletes a tag. A tag that talkgroups still use is only
// deleted when the request says where those talkgroups go: another tag
// ("moveTo") or no tag at all ("moveTo": null with "reassign": true).
func (o *Operations) TagsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
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

	tag, err := o.Queries.GetTag(ctx, req.ID)
	if err != nil {
		return nil, UserError("tag not found")
	}
	inUse, err := o.Queries.CountTalkgroupsWithTag(ctx, sql.NullInt64{Int64: req.ID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("failed to count talkgroups: %w", err)
	}

	moved := ""
	if inUse > 0 {
		if !req.Reassign {
			return nil, UserError(fmt.Sprintf("%d talkgroups use this tag; say where they should go first", inUse))
		}
		to := sql.NullInt64{}
		moved = "no tag"
		if req.MoveTo != nil {
			if *req.MoveTo == req.ID {
				return nil, UserError("talkgroups cannot move to the tag being deleted")
			}
			target, err := o.Queries.GetTag(ctx, *req.MoveTo)
			if err != nil {
				return nil, UserError("the tag to move talkgroups to was not found")
			}
			to = sql.NullInt64{Int64: target.ID, Valid: true}
			moved = fmt.Sprintf("tag %q", target.Label)
		}
		if err := o.Queries.MoveTalkgroupsToTag(ctx, db.MoveTalkgroupsToTagParams{
			ToTag:   to,
			FromTag: sql.NullInt64{Int64: req.ID, Valid: true},
		}); err != nil {
			return nil, fmt.Errorf("failed to move talkgroups: %w", err)
		}
	}

	if err := o.Queries.DeleteTag(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete tag: %w", err)
	}
	msg := fmt.Sprintf("admin: tag %q deleted by %s", tag.Label, o.callerName(ctx, callerID))
	if moved != "" {
		msg += fmt.Sprintf(" (%d talkgroups moved to %s)", inUse, moved)
	}
	o.audit(ctx, msg)
	o.broadcastAdminEvent("tags.updated", nil)
	o.broadcastAdminEvent("talkgroups.updated", nil)
	o.broadcastCFG(ctx)
	return map[string]any{"ok": true, "moved": inUse}, nil
}
