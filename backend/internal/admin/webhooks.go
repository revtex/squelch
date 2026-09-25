package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/webhook"
)

// WebhooksList returns every webhook with how deliveries to it have been
// going. The secret never leaves the server; only whether one is set.
func (o *Operations) WebhooksList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	whs, err := o.Queries.ListWebhooks(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list webhooks: %w", err)
	}
	out := make([]map[string]any, 0, len(whs))
	for _, w := range whs {
		m := mapWebhook(w)
		addDeliveryStats(m, o.Deps.Webhooks, w.ID, w.LastAt, w.LastOk, w.LastStatus, w.LastError, w.LastOkAt)
		out = append(out, m)
	}
	return out, nil
}

// WebhooksSample returns the JSON a generic webhook receives for a call,
// for the admin's payload preview.
func (o *Operations) WebhooksSample(_ context.Context, _ json.RawMessage, _ int64) (any, error) {
	return map[string]any{
		"payload": webhook.SamplePayload(),
		"headers": map[string]string{
			"Content-Type":        "application/json",
			"X-Squelch-Event":     "call",
			"X-Squelch-Signature": "sha256=<hex HMAC-SHA256 of the body under the secret>",
		},
	}, nil
}

type webhookRequest struct {
	ID          int64   `json:"id"`
	Label       string  `json:"label"`
	Url         string  `json:"url"`
	Type        string  `json:"type"`
	Secret      *string `json:"secret"`
	ClearSecret bool    `json:"clearSecret"`
	SystemsJson *string `json:"systemsJson"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
}

func (r *webhookRequest) check() error {
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
	if r.Type == "" {
		r.Type = webhook.TypeGeneric
	}
	if r.Type != webhook.TypeGeneric && r.Type != webhook.TypeDiscord {
		return UserError("type must be generic or discord")
	}
	if r.SystemsJson != nil && *r.SystemsJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.SystemsJson), &ids); err != nil {
			return UserError("systems must be a list of system ids")
		}
	}
	return nil
}

// WebhooksCreate creates a new webhook.
func (o *Operations) WebhooksCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req webhookRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	secret, err := o.sealOptionalSecret(req.Secret)
	if err != nil {
		return nil, fmt.Errorf("encrypt webhook secret: %w", err)
	}

	id, err := o.Queries.CreateWebhook(ctx, db.CreateWebhookParams{
		Url:         req.Url,
		Type:        req.Type,
		Secret:      secret,
		SystemsJson: ptrToNullStr(req.SystemsJson),
		Disabled:    req.Disabled,
		Order:       req.Order,
		Label:       req.Label,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create webhook: %w", err)
	}

	wh, err := o.Queries.GetWebhook(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created webhook: %w", err)
	}
	o.reloadWebhooks()
	o.audit(ctx, fmt.Sprintf("admin: webhook %q created by %s", webhook.Name(wh), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("webhooks.updated", nil)
	return mapWebhook(wh), nil
}

// WebhooksUpdate updates an existing webhook. A blank secret keeps the
// current one; clearSecret removes it.
func (o *Operations) WebhooksUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req webhookRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	existing, err := o.Queries.GetWebhook(ctx, req.ID)
	if err != nil {
		return nil, UserError("webhook not found")
	}

	secret := existing.Secret
	newSecret := false
	switch {
	case req.ClearSecret:
		secret = sql.NullString{}
		newSecret = existing.Secret.Valid
	case req.Secret != nil && *req.Secret != "":
		if secret, err = o.sealOptionalSecret(req.Secret); err != nil {
			return nil, fmt.Errorf("encrypt webhook secret: %w", err)
		}
		newSecret = true
	}

	if err := o.Queries.UpdateWebhook(ctx, db.UpdateWebhookParams{
		ID:          req.ID,
		Url:         req.Url,
		Type:        req.Type,
		Secret:      secret,
		SystemsJson: ptrToNullStr(req.SystemsJson),
		Disabled:    req.Disabled,
		Order:       req.Order,
		Label:       req.Label,
	}); err != nil {
		return nil, fmt.Errorf("failed to update webhook: %w", err)
	}

	wh, err := o.Queries.GetWebhook(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated webhook: %w", err)
	}
	o.reloadWebhooks()
	o.audit(ctx, changeLine("webhook", webhook.Name(wh), existing.Disabled, wh.Disabled, newSecret, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("webhooks.updated", nil)
	return mapWebhook(wh), nil
}

// WebhooksDelete deletes a webhook.
func (o *Operations) WebhooksDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	wh, err := o.Queries.GetWebhook(ctx, req.ID)
	if err != nil {
		return nil, UserError("webhook not found")
	}

	if err := o.Queries.DeleteWebhook(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete webhook: %w", err)
	}
	if o.Deps.Webhooks != nil {
		o.Deps.Webhooks.Forget(req.ID)
	}
	o.reloadWebhooks()
	o.audit(ctx, fmt.Sprintf("admin: webhook %q deleted by %s", webhook.Name(wh), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("webhooks.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// WebhooksTest posts a test message to one webhook and reports the answer.
func (o *Operations) WebhooksTest(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if o.Deps.Webhooks == nil {
		return nil, UserError("webhooks are not running on this server")
	}
	wh, err := o.Queries.GetWebhook(ctx, req.ID)
	if err != nil {
		return nil, UserError("webhook not found")
	}
	r, err := o.Deps.Webhooks.Test(ctx, req.ID)
	if err != nil {
		return nil, UserError(err.Error())
	}
	o.audit(ctx, fmt.Sprintf("admin: webhook %q tested by %s: %s", webhook.Name(wh), o.callerName(ctx, callerID), resultLine(r)))
	o.broadcastAdminEvent("webhooks.updated", nil)
	return mapResult(r), nil
}

func (o *Operations) reloadWebhooks() {
	if o.Deps.Webhooks != nil {
		o.Deps.Webhooks.Reload()
	}
}

// sealOptionalSecret encrypts a webhook secret for storage; nil or blank
// means no secret.
func (o *Operations) sealOptionalSecret(secret *string) (sql.NullString, error) {
	if secret == nil || *secret == "" {
		return sql.NullString{}, nil
	}
	sealed, err := o.sealSecret(*secret)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: sealed, Valid: true}, nil
}
