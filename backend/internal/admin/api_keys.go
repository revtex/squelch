package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// rotationGrace is how long a replaced key keeps working after a rotation,
// so the recorder can be updated without a gap in uploads.
const rotationGrace = 24 * time.Hour

// APIKeysList returns every API key with how it has been used: when and
// from where it last authenticated, calls uploaded in the last 24 hours,
// legacy /api/* requests in the same window, and whether a rotation's grace
// period is still running.
func (o *Operations) APIKeysList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	keys, err := o.Queries.ListAPIKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list API keys: %w", err)
	}
	since := time.Now().Add(-24 * time.Hour).Unix()
	counts, err := o.Queries.CountCallsPerAPIKeySince(ctx, since)
	if err != nil {
		return nil, fmt.Errorf("failed to count calls per key: %w", err)
	}
	calls := make(map[int64]int64, len(counts))
	for _, c := range counts {
		if c.ApiKeyID.Valid {
			calls[c.ApiKeyID.Int64] = c.Calls
		}
	}
	// Legacy hits carry the key's id; their ident is cut to six characters
	// and cannot tell "TR-Lake-North" from "TR-Lake-South".
	legacy := map[int64]int64{}
	if o.Deps.LegacyUsage != nil {
		for _, e := range o.Deps.LegacyUsage.Aggregate24h() {
			if e.APIKeyID != 0 {
				legacy[e.APIKeyID] += int64(e.Count)
			}
		}
	}
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		m := mapAPIKey(k)
		m["calls24h"] = calls[k.ID]
		m["legacy24h"] = legacy[k.ID]
		out = append(out, m)
	}
	return out, nil
}

type apiKeyRequest struct {
	ID            int64   `json:"id"`
	Key           *string `json:"key"`
	Ident         *string `json:"ident"`
	Disabled      int64   `json:"disabled"`
	SystemsJson   *string `json:"systemsJson"`
	CallRateLimit *int64  `json:"callRateLimit"`
	Order         int64   `json:"order"`
}

// check validates the parts of a request that create and update share.
func (r *apiKeyRequest) check() error {
	if r.Ident != nil {
		label := strings.TrimSpace(*r.Ident)
		if len(label) > 64 {
			return UserError("label must be 64 characters or fewer")
		}
		r.Ident = &label
		if label == "" {
			r.Ident = nil
		}
	}
	if r.CallRateLimit != nil && (*r.CallRateLimit < 1 || *r.CallRateLimit > 600) {
		return UserError("rate limit must be between 1 and 600 calls a minute")
	}
	if r.SystemsJson != nil && *r.SystemsJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.SystemsJson), &ids); err != nil {
			return UserError("systems must be a list of system ids")
		}
	}
	return nil
}

// APIKeysCreate creates a new API key. Returns the plaintext key once.
func (o *Operations) APIKeysCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req apiKeyRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	if req.Ident == nil {
		return nil, UserError("give the key a label so you can tell it apart later")
	}

	plainKey := uuid.New().String()
	if req.Key != nil && *req.Key != "" {
		plainKey = *req.Key
	}
	hashedKey := auth.HashAPIKey(plainKey)

	id, err := o.Queries.CreateAPIKey(ctx, db.CreateAPIKeyParams{
		Key:           hashedKey,
		Ident:         ptrToNullStr(req.Ident),
		Disabled:      req.Disabled,
		SystemsJson:   ptrToNullStr(req.SystemsJson),
		CallRateLimit: ptrToNullInt(req.CallRateLimit),
		Order:         req.Order,
		CreatedAt:     time.Now().Unix(),
	})
	if isUniqueViolation(err) {
		return nil, UserError("API key already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to create API key: %w", err)
	}

	key, err := o.Queries.GetAPIKey(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created API key: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: API key %q created by %s", key.Ident.String, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("apikeys.updated", nil)

	resp := mapAPIKey(key)
	resp["createdKey"] = plainKey // Return plain key once on creation.
	return resp, nil
}

// APIKeysUpdate updates an existing API key. A blank key preserves the current one.
func (o *Operations) APIKeysUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req apiKeyRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}

	current, err := o.Queries.GetAPIKey(ctx, req.ID)
	if err != nil {
		return nil, UserError("API key not found")
	}

	keyHash := current.Key
	if req.Key != nil && *req.Key != "" {
		keyHash = auth.HashAPIKey(*req.Key)
	}

	err = o.Queries.UpdateAPIKey(ctx, db.UpdateAPIKeyParams{
		ID:            req.ID,
		Key:           keyHash,
		Ident:         ptrToNullStr(req.Ident),
		Disabled:      req.Disabled,
		SystemsJson:   ptrToNullStr(req.SystemsJson),
		CallRateLimit: ptrToNullInt(req.CallRateLimit),
		Order:         req.Order,
	})
	if isUniqueViolation(err) {
		return nil, UserError("API key already exists")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update API key: %w", err)
	}

	key, err := o.Queries.GetAPIKey(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated API key: %w", err)
	}
	by := o.callerName(ctx, callerID)
	switch {
	case current.Disabled == 0 && key.Disabled != 0:
		o.audit(ctx, fmt.Sprintf("admin: API key %q disabled by %s", apiKeyName(key), by))
	case current.Disabled != 0 && key.Disabled == 0:
		o.audit(ctx, fmt.Sprintf("admin: API key %q enabled by %s", apiKeyName(key), by))
	default:
		o.audit(ctx, fmt.Sprintf("admin: API key %q updated by %s", apiKeyName(key), by))
	}
	o.broadcastAdminEvent("apikeys.updated", nil)
	return mapAPIKey(key), nil
}

// APIKeysRotate replaces a key's secret. The old secret keeps working for
// rotationGrace so the recorder can be switched over without dropping
// uploads. Returns the new plaintext key once.
func (o *Operations) APIKeysRotate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	current, err := o.Queries.GetAPIKey(ctx, req.ID)
	if err != nil {
		return nil, UserError("API key not found")
	}

	plainKey := uuid.New().String()
	expires := time.Now().Add(rotationGrace).Unix()
	if err := o.Queries.RotateAPIKey(ctx, db.RotateAPIKeyParams{
		Key:                  auth.HashAPIKey(plainKey),
		PreviousKey:          sql.NullString{String: current.Key, Valid: true},
		PreviousKeyExpiresAt: sql.NullInt64{Int64: expires, Valid: true},
		ID:                   req.ID,
	}); err != nil {
		return nil, fmt.Errorf("failed to rotate API key: %w", err)
	}
	key, err := o.Queries.GetAPIKey(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch rotated API key: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: API key %q rotated by %s; the old secret works until %s",
		apiKeyName(key), o.callerName(ctx, callerID), time.Unix(expires, 0).UTC().Format(time.RFC3339)))
	o.broadcastAdminEvent("apikeys.updated", nil)

	resp := mapAPIKey(key)
	resp["createdKey"] = plainKey
	return resp, nil
}

// APIKeysDelete deletes an API key.
func (o *Operations) APIKeysDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}

	key, err := o.Queries.GetAPIKey(ctx, req.ID)
	if err != nil {
		return nil, UserError("API key not found")
	}

	if err := o.Queries.DeleteAPIKey(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete API key: %w", err)
	}
	o.audit(ctx, fmt.Sprintf("admin: API key %q deleted by %s", apiKeyName(key), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("apikeys.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// apiKeyName is the label, or the fingerprint for an unlabelled key.
func apiKeyName(k db.ApiKey) string {
	if k.Ident.Valid && k.Ident.String != "" {
		return k.Ident.String
	}
	return apiKeyFingerprint(k)
}
