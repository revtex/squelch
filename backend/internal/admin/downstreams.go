package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/delivery"
)

// Forwarder is what a downstream or webhook service tells the admin about
// its deliveries, and how the admin asks it to try a target.
type Forwarder interface {
	Stats(id int64) delivery.Stats
	Test(ctx context.Context, id int64) (delivery.Result, error)
	Forget(id int64)
	Reload()
}

// DownstreamsList returns every downstream with how forwarding to it has
// been going.
func (o *Operations) DownstreamsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	ds, err := o.Queries.ListDownstreams(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list downstreams: %w", err)
	}
	out := make([]map[string]any, 0, len(ds))
	for _, d := range ds {
		m := mapDownstream(d)
		addDeliveryStats(m, o.Deps.Downstreams, d.ID, d.LastAt, d.LastOk, d.LastStatus, d.LastError, d.LastOkAt)
		out = append(out, m)
	}
	return out, nil
}

type downstreamRequest struct {
	ID          int64   `json:"id"`
	Label       string  `json:"label"`
	Url         string  `json:"url"`
	ApiKey      string  `json:"apiKey"`
	SystemsJson *string `json:"systemsJson"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
}

func (r *downstreamRequest) check() error {
	r.Label = strings.TrimSpace(r.Label)
	if len(r.Label) > 64 {
		return UserError("label must be 64 characters or fewer")
	}
	r.Url = strings.TrimSpace(r.Url)
	if r.Url == "" {
		return UserError("url is required")
	}
	if !validHTTPURL(r.Url) {
		return UserError("url must use http or https scheme")
	}
	if r.SystemsJson != nil && *r.SystemsJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.SystemsJson), &ids); err != nil {
			return UserError("systems must be a list of system ids")
		}
	}
	return nil
}

// DownstreamsCreate creates a new downstream and triggers a reload.
func (o *Operations) DownstreamsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req downstreamRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	if req.ApiKey == "" {
		return nil, UserError("the remote server's API key is required")
	}
	apiKey, err := o.sealSecret(req.ApiKey)
	if err != nil {
		return nil, fmt.Errorf("encrypt downstream API key: %w", err)
	}

	id, err := o.Queries.CreateDownstream(ctx, db.CreateDownstreamParams{
		Url:         req.Url,
		ApiKey:      apiKey,
		SystemsJson: ptrToNullStr(req.SystemsJson),
		Disabled:    req.Disabled,
		Order:       req.Order,
		Label:       req.Label,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create downstream: %w", err)
	}

	ds, err := o.Queries.GetDownstream(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created downstream: %w", err)
	}
	o.reloadDownstreams()
	o.audit(ctx, fmt.Sprintf("admin: downstream %q created by %s", downstreamName(ds), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("downstreams.updated", nil)
	return mapDownstream(ds), nil
}

// DownstreamsUpdate updates a downstream. Blank apiKey preserves the current one.
func (o *Operations) DownstreamsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req downstreamRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	existing, err := o.Queries.GetDownstream(ctx, req.ID)
	if err != nil {
		return nil, UserError("downstream not found")
	}

	// Preserve existing API key if none provided (key is never sent to clients).
	apiKey := existing.ApiKey
	if req.ApiKey != "" {
		if apiKey, err = o.sealSecret(req.ApiKey); err != nil {
			return nil, fmt.Errorf("encrypt downstream API key: %w", err)
		}
	}

	if err := o.Queries.UpdateDownstream(ctx, db.UpdateDownstreamParams{
		ID:          req.ID,
		Url:         req.Url,
		ApiKey:      apiKey,
		SystemsJson: ptrToNullStr(req.SystemsJson),
		Disabled:    req.Disabled,
		Order:       req.Order,
		Label:       req.Label,
	}); err != nil {
		return nil, fmt.Errorf("failed to update downstream: %w", err)
	}

	ds, err := o.Queries.GetDownstream(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated downstream: %w", err)
	}
	o.reloadDownstreams()
	o.audit(ctx, changeLine("downstream", downstreamName(ds), existing.Disabled, ds.Disabled, req.ApiKey != "", o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("downstreams.updated", nil)
	return mapDownstream(ds), nil
}

// DownstreamsDelete deletes a downstream and triggers a reload.
func (o *Operations) DownstreamsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	ds, err := o.Queries.GetDownstream(ctx, req.ID)
	if err != nil {
		return nil, UserError("downstream not found")
	}

	if err := o.Queries.DeleteDownstream(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete downstream: %w", err)
	}
	if o.Deps.Downstreams != nil {
		o.Deps.Downstreams.Forget(req.ID)
	}
	o.reloadDownstreams()
	o.audit(ctx, fmt.Sprintf("admin: downstream %q deleted by %s", downstreamName(ds), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("downstreams.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// DownstreamsTest asks the remote server whether it accepts this
// downstream's key, without sending a call.
func (o *Operations) DownstreamsTest(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if o.Deps.Downstreams == nil {
		return nil, UserError("forwarding is not running on this server")
	}
	ds, err := o.Queries.GetDownstream(ctx, req.ID)
	if err != nil {
		return nil, UserError("downstream not found")
	}
	r, err := o.Deps.Downstreams.Test(ctx, req.ID)
	if err != nil {
		return nil, UserError(err.Error())
	}
	o.audit(ctx, fmt.Sprintf("admin: downstream %q tested by %s: %s", downstreamName(ds), o.callerName(ctx, callerID), resultLine(r)))
	return mapResult(r), nil
}

func (o *Operations) reloadDownstreams() {
	if o.Deps.DownstreamReload != nil {
		o.Deps.DownstreamReload.Reload()
	}
}

// sealSecret encrypts a secret for storage when the server has an
// encryption key, and stores it as given otherwise.
func (o *Operations) sealSecret(plain string) (string, error) {
	if o.Deps.EncryptionKey == "" || plain == "" {
		return plain, nil
	}
	return auth.EncryptString(plain, o.Deps.EncryptionKey)
}

func downstreamName(ds db.Downstream) string {
	if ds.Label != "" {
		return ds.Label
	}
	return ds.Url
}

// changeLine words an update for the audit log: what flipped, or that a
// secret was replaced, or just that it was edited.
func changeLine(kind, name string, wasDisabled, nowDisabled int64, newSecret bool, by string) string {
	switch {
	case wasDisabled == 0 && nowDisabled != 0:
		return fmt.Sprintf("admin: %s %q disabled by %s", kind, name, by)
	case wasDisabled != 0 && nowDisabled == 0:
		return fmt.Sprintf("admin: %s %q enabled by %s", kind, name, by)
	case newSecret:
		return fmt.Sprintf("admin: %s %q updated with a new secret by %s", kind, name, by)
	default:
		return fmt.Sprintf("admin: %s %q updated by %s", kind, name, by)
	}
}

// addDeliveryStats puts a target's delivery state on its map: what the
// running service knows, or what the row remembers from before a restart.
func addDeliveryStats(m map[string]any, f Forwarder, id int64, lastAt sqlNullInt, lastOK, lastStatus int64, lastError string, lastOKAt sqlNullInt) {
	var s delivery.Stats
	if f != nil {
		s = f.Stats(id)
	}
	if s.Last.At == 0 && lastAt.Valid {
		s.Last = delivery.Result{At: lastAt.Int64, OK: lastOK == 1, Status: int(lastStatus), Error: lastError}
		s.LastOKAt = lastOKAt.Int64
	}
	if s.Last.At == 0 {
		m["last"] = nil
	} else {
		m["last"] = mapResult(s.Last)
	}
	m["lastOkAt"] = nullableUnix(s.LastOKAt)
	m["sent24h"] = int64(s.Sent24h)
	m["failed24h"] = int64(s.Failed24h)
}

func mapResult(r delivery.Result) map[string]any {
	return map[string]any{
		"at":     r.At,
		"ok":     r.OK,
		"status": r.Status,
		"error":  r.Error,
		"millis": r.Millis,
	}
}

func resultLine(r delivery.Result) string {
	if r.OK && r.Error == "" {
		return fmt.Sprintf("ok (%d in %d ms)", r.Status, r.Millis)
	}
	if r.OK {
		return fmt.Sprintf("%s (%d in %d ms)", r.Error, r.Status, r.Millis)
	}
	return "failed: " + r.Error
}

func nullableUnix(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return &v
}
