package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/keywordalert"
)

// KeywordRulesList returns every keyword rule.
func (o *Operations) KeywordRulesList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	rules, err := o.Queries.ListKeywordRules(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list keyword rules: %w", err)
	}
	out := make([]map[string]any, 0, len(rules))
	for _, r := range rules {
		out = append(out, mapKeywordRule(r))
	}
	return out, nil
}

type keywordRuleRequest struct {
	ID             int64   `json:"id"`
	Label          string  `json:"label"`
	PatternsJson   string  `json:"patternsJson"`
	SystemsJson    *string `json:"systemsJson"`
	TalkgroupsJson *string `json:"talkgroupsJson"`
	CooldownSec     int64   `json:"cooldownSec"`
	Disabled       int64   `json:"disabled"`
	Order          int64   `json:"order"`
}

func (r *keywordRuleRequest) check() error {
	r.Label = strings.TrimSpace(r.Label)
	if r.Label == "" {
		return UserError("label is required")
	}
	if len(r.Label) > 64 {
		return UserError("label must be 64 characters or fewer")
	}
	var patterns []string
	if err := json.Unmarshal([]byte(r.PatternsJson), &patterns); err != nil {
		return UserError("patterns must be a JSON list of strings")
	}
	if len(patterns) == 0 {
		return UserError("at least one pattern is required")
	}
	if r.SystemsJson != nil && *r.SystemsJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.SystemsJson), &ids); err != nil {
			return UserError("systems must be a list of system ids")
		}
	}
	if r.TalkgroupsJson != nil && *r.TalkgroupsJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.TalkgroupsJson), &ids); err != nil {
			return UserError("talkgroups must be a list of talkgroup ids")
		}
	}
	if r.CooldownSec < 0 {
		return UserError("cooldown must be zero or more seconds")
	}
	if r.CooldownSec == 0 {
		r.CooldownSec = 120
	}
	return nil
}

// KeywordRulesCreate creates a keyword rule.
func (o *Operations) KeywordRulesCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req keywordRuleRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	id, err := o.Queries.CreateKeywordRule(ctx, db.CreateKeywordRuleParams{
		Label:          req.Label,
		PatternsJson:   req.PatternsJson,
		SystemsJson:    ptrToNullStr(req.SystemsJson),
		TalkgroupsJson: ptrToNullStr(req.TalkgroupsJson),
		CooldownSec:     req.CooldownSec,
		Disabled:       req.Disabled,
		Order:          req.Order,
		CreatedAt:      time.Now().Unix(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create keyword rule: %w", err)
	}
	rule, err := o.Queries.GetKeywordRule(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created keyword rule: %w", err)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, fmt.Sprintf("admin: keyword rule %q created by %s", rule.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return mapKeywordRule(rule), nil
}

// KeywordRulesUpdate updates a keyword rule.
func (o *Operations) KeywordRulesUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req keywordRuleRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	existing, err := o.Queries.GetKeywordRule(ctx, req.ID)
	if err != nil {
		return nil, UserError("keyword rule not found")
	}
	if err := o.Queries.UpdateKeywordRule(ctx, db.UpdateKeywordRuleParams{
		ID:             req.ID,
		Label:          req.Label,
		PatternsJson:   req.PatternsJson,
		SystemsJson:    ptrToNullStr(req.SystemsJson),
		TalkgroupsJson: ptrToNullStr(req.TalkgroupsJson),
		CooldownSec:     req.CooldownSec,
		Disabled:       req.Disabled,
		Order:          req.Order,
	}); err != nil {
		return nil, fmt.Errorf("failed to update keyword rule: %w", err)
	}
	rule, err := o.Queries.GetKeywordRule(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated keyword rule: %w", err)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, changeLine("keyword rule", rule.Label, existing.Disabled, rule.Disabled, false, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return mapKeywordRule(rule), nil
}

// KeywordRulesDelete deletes a keyword rule.
func (o *Operations) KeywordRulesDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	rule, err := o.Queries.GetKeywordRule(ctx, req.ID)
	if err != nil {
		return nil, UserError("keyword rule not found")
	}
	if err := o.Queries.DeleteKeywordRule(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete keyword rule: %w", err)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, fmt.Sprintf("admin: keyword rule %q deleted by %s", rule.Label, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// KeywordTargetsList returns every keyword target with delivery stats.
func (o *Operations) KeywordTargetsList(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	targets, err := o.Queries.ListKeywordTargets(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list keyword targets: %w", err)
	}
	out := make([]map[string]any, 0, len(targets))
	for _, t := range targets {
		m := mapKeywordTarget(t)
		addDeliveryStats(m, o.Deps.KeywordAlerts, t.ID, t.LastAt, t.LastOk, t.LastStatus, t.LastError, t.LastOkAt)
		out = append(out, m)
	}
	return out, nil
}

type keywordTargetRequest struct {
	ID          int64   `json:"id"`
	Label       string  `json:"label"`
	Type        string  `json:"type"`
	Url         string  `json:"url"`
	Secret      *string `json:"secret"`
	ClearSecret bool    `json:"clearSecret"`
	RulesJson   *string `json:"rulesJson"`
	Disabled    int64   `json:"disabled"`
	Order       int64   `json:"order"`
}

func (r *keywordTargetRequest) check() error {
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
		r.Type = keywordalert.TypeGeneric
	}
	switch r.Type {
	case keywordalert.TypeGeneric, keywordalert.TypeSlack, keywordalert.TypeDisplay:
	default:
		return UserError("type must be generic, slack, or display")
	}
	if r.RulesJson != nil && *r.RulesJson != "" {
		var ids []int64
		if err := json.Unmarshal([]byte(*r.RulesJson), &ids); err != nil {
			return UserError("rules must be a list of rule ids")
		}
	}
	return nil
}

// KeywordTargetsCreate creates a keyword target.
func (o *Operations) KeywordTargetsCreate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req keywordTargetRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	secret, err := o.sealOptionalSecret(req.Secret)
	if err != nil {
		return nil, fmt.Errorf("encrypt keyword target secret: %w", err)
	}
	id, err := o.Queries.CreateKeywordTarget(ctx, db.CreateKeywordTargetParams{
		Label:     req.Label,
		Type:      req.Type,
		Url:       req.Url,
		Secret:    secret,
		RulesJson: ptrToNullStr(req.RulesJson),
		Disabled:  req.Disabled,
		Order:     req.Order,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create keyword target: %w", err)
	}
	target, err := o.Queries.GetKeywordTarget(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch created keyword target: %w", err)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, fmt.Sprintf("admin: keyword target %q created by %s", keywordalert.Name(target), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return mapKeywordTarget(target), nil
}

// KeywordTargetsUpdate updates a keyword target.
func (o *Operations) KeywordTargetsUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req keywordTargetRequest
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if err := req.check(); err != nil {
		return nil, err
	}
	existing, err := o.Queries.GetKeywordTarget(ctx, req.ID)
	if err != nil {
		return nil, UserError("keyword target not found")
	}
	secret := existing.Secret
	newSecret := false
	switch {
	case req.ClearSecret:
		secret = sql.NullString{}
		newSecret = existing.Secret.Valid
	case req.Secret != nil && *req.Secret != "":
		if secret, err = o.sealOptionalSecret(req.Secret); err != nil {
			return nil, fmt.Errorf("encrypt keyword target secret: %w", err)
		}
		newSecret = true
	}
	if err := o.Queries.UpdateKeywordTarget(ctx, db.UpdateKeywordTargetParams{
		ID:        req.ID,
		Label:     req.Label,
		Type:      req.Type,
		Url:       req.Url,
		Secret:    secret,
		RulesJson: ptrToNullStr(req.RulesJson),
		Disabled:  req.Disabled,
		Order:     req.Order,
	}); err != nil {
		return nil, fmt.Errorf("failed to update keyword target: %w", err)
	}
	target, err := o.Queries.GetKeywordTarget(ctx, req.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch updated keyword target: %w", err)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, changeLine("keyword target", keywordalert.Name(target), existing.Disabled, target.Disabled, newSecret, o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return mapKeywordTarget(target), nil
}

// KeywordTargetsDelete deletes a keyword target.
func (o *Operations) KeywordTargetsDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	target, err := o.Queries.GetKeywordTarget(ctx, req.ID)
	if err != nil {
		return nil, UserError("keyword target not found")
	}
	if err := o.Queries.DeleteKeywordTarget(ctx, req.ID); err != nil {
		return nil, fmt.Errorf("failed to delete keyword target: %w", err)
	}
	if o.Deps.KeywordAlerts != nil {
		o.Deps.KeywordAlerts.Forget(req.ID)
	}
	o.reloadKeywordAlerts()
	o.audit(ctx, fmt.Sprintf("admin: keyword target %q deleted by %s", keywordalert.Name(target), o.callerName(ctx, callerID)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// KeywordTargetsTest posts a sample alert to one target.
func (o *Operations) KeywordTargetsTest(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID <= 0 {
		return nil, UserError("id is required")
	}
	if o.Deps.KeywordAlerts == nil {
		return nil, UserError("keyword alerts are not running on this server")
	}
	target, err := o.Queries.GetKeywordTarget(ctx, req.ID)
	if err != nil {
		return nil, UserError("keyword target not found")
	}
	r, err := o.Deps.KeywordAlerts.Test(ctx, req.ID)
	if err != nil {
		return nil, UserError(err.Error())
	}
	o.audit(ctx, fmt.Sprintf("admin: keyword target %q tested by %s: %s", keywordalert.Name(target), o.callerName(ctx, callerID), resultLine(r)))
	o.broadcastAdminEvent("keywordAlerts.updated", nil)
	return mapResult(r), nil
}

// KeywordAlertsTest matches a transcript against active rules without sending.
func (o *Operations) KeywordAlertsTest(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		Text        string `json:"text"`
		SystemID    int64  `json:"systemId"`
		TalkgroupID int64  `json:"talkgroupId"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if strings.TrimSpace(req.Text) == "" {
		return nil, UserError("text is required")
	}
	if o.Deps.KeywordAlerts == nil {
		return nil, UserError("keyword alerts are not running on this server")
	}
	// DryRun lives on the concrete service; Forwarder does not expose it.
	type dryRunner interface {
		DryRun(systemID, talkgroupID int64, text string) []string
	}
	dr, ok := o.Deps.KeywordAlerts.(dryRunner)
	if !ok {
		return nil, UserError("keyword alerts cannot dry-run on this server")
	}
	matched := dr.DryRun(req.SystemID, req.TalkgroupID, req.Text)
	if matched == nil {
		matched = []string{}
	}
	return map[string]any{"matched": matched}, nil
}

func (o *Operations) reloadKeywordAlerts() {
	if o.Deps.KeywordAlerts != nil {
		o.Deps.KeywordAlerts.Reload()
	}
}

func mapKeywordRule(r db.KeywordRule) map[string]any {
	return map[string]any{
		"id":             r.ID,
		"label":          r.Label,
		"patternsJson":   r.PatternsJson,
		"systemsJson":    nullStr(r.SystemsJson),
		"talkgroupsJson": nullStr(r.TalkgroupsJson),
		"cooldownSec":    r.CooldownSec,
		"disabled":       r.Disabled,
		"order":          r.Order,
		"createdAt":      r.CreatedAt,
	}
}

func mapKeywordTarget(t db.KeywordTarget) map[string]any {
	return map[string]any{
		"id":        t.ID,
		"label":     t.Label,
		"type":      t.Type,
		"url":       t.Url,
		"hasSecret": t.Secret.Valid && t.Secret.String != "",
		"rulesJson": nullStr(t.RulesJson),
		"disabled":  t.Disabled,
		"order":     t.Order,
	}
}

// remapIDJSON remaps a JSON array of int64 ids through remap; unknown ids drop.
func remapIDJSON(in *string, remap map[int64]int64) sql.NullString {
	if in == nil || strings.TrimSpace(*in) == "" {
		return sql.NullString{}
	}
	if len(remap) == 0 {
		return sql.NullString{String: *in, Valid: true}
	}
	var ids []int64
	if err := json.Unmarshal([]byte(*in), &ids); err != nil {
		return sql.NullString{String: *in, Valid: true}
	}
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if newID, ok := remap[id]; ok {
			out = append(out, newID)
		}
	}
	raw, _ := json.Marshal(out)
	return sql.NullString{String: string(raw), Valid: true}
}
