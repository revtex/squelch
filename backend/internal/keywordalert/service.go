// Package keywordalert matches transcript text against configured rules and
// POSTs alerts to Slack, an ESP display, or a generic webhook.
package keywordalert

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/delivery"
	"github.com/revtex/squelch/internal/safehttp"
)

// CallMeta is the call context needed to evaluate and deliver an alert.
type CallMeta struct {
	CallID          int64
	SystemID        int64
	SystemLabel     string
	TalkgroupID     int64
	TalkgroupNumber int64
	TalkgroupLabel  string
}

// Service evaluates rules and delivers to targets.
type Service struct {
	queries       *db.Queries
	client        *http.Client
	encryptionKey string
	userAgent     string
	deliveries    *delivery.Tracker
	cool          *cooldown

	mu     sync.RWMutex
	rules  []db.KeywordRule
	targets []db.KeywordTarget
}

// NewService builds a keyword alert service. version goes in the User-Agent.
func NewService(queries *db.Queries, encryptionKey, version string) *Service {
	s := &Service{
		queries:       queries,
		client:        safehttp.Client(15 * time.Second),
		encryptionKey: encryptionKey,
		userAgent:     "Squelch/" + version,
		cool:          newCooldown(),
	}
	s.deliveries = delivery.New(func(id int64, r delivery.Result) {
		ok := int64(0)
		if r.OK {
			ok = 1
		}
		if err := queries.RecordKeywordTargetDelivery(context.Background(), db.RecordKeywordTargetDeliveryParams{
			At: sql.NullInt64{Int64: r.At, Valid: true}, Ok: ok, Status: int64(r.Status), Error: r.Error, ID: id,
		}); err != nil {
			slog.Warn("keywordalert: failed to record delivery", "target_id", id, "error", err)
		}
	})
	return s
}

// Start seeds delivery stats and loads rules/targets into the cache.
func (s *Service) Start(ctx context.Context) {
	targets, err := s.queries.ListKeywordTargets(ctx)
	if err != nil {
		slog.Error("keywordalert: failed to load targets", "error", err)
	} else {
		for _, t := range targets {
			if t.LastAt.Valid {
				s.deliveries.Seed(t.ID, delivery.Result{
					At: t.LastAt.Int64, OK: t.LastOk == 1, Status: int(t.LastStatus), Error: t.LastError,
				}, t.LastOkAt.Int64)
			}
		}
	}
	s.Reload()
}

// Reload refreshes the in-memory rule and target lists from the database.
func (s *Service) Reload() {
	ctx := context.Background()
	rules, err := s.queries.ListActiveKeywordRules(ctx)
	if err != nil {
		slog.Error("keywordalert: failed to load rules", "error", err)
		return
	}
	targets, err := s.queries.ListActiveKeywordTargets(ctx)
	if err != nil {
		slog.Error("keywordalert: failed to load targets", "error", err)
		return
	}
	s.mu.Lock()
	s.rules = rules
	s.targets = targets
	s.mu.Unlock()
}

// Stats returns recent delivery stats for a target.
func (s *Service) Stats(id int64) delivery.Stats {
	return s.deliveries.Stats(id)
}

// Forget drops in-memory delivery stats for a deleted target.
func (s *Service) Forget(id int64) {
	s.deliveries.Forget(id)
}

// Evaluate matches text against rules for this call and delivers alerts.
func (s *Service) Evaluate(ctx context.Context, call CallMeta, text string) {
	s.mu.RLock()
	rules := append([]db.KeywordRule(nil), s.rules...)
	targets := append([]db.KeywordTarget(nil), s.targets...)
	s.mu.RUnlock()
	if len(rules) == 0 || len(targets) == 0 {
		return
	}

	for _, rule := range rules {
		if !ruleApplies(rule, call.SystemID, call.TalkgroupID) {
			continue
		}
		patterns, err := parseStringSlice(rule.PatternsJson)
		if err != nil || len(patterns) == 0 {
			continue
		}
		hit := MatchRulePatterns(text, rule.Label, patterns)
		if !hit.Matched {
			continue
		}
		key := cooldownKey(call.TalkgroupID, rule.ID)
		if s.cool.Active(key) {
			slog.Info("keywordalert: match on cooldown", "rule", rule.Label, "talkgroup_id", call.TalkgroupID, "call_id", call.CallID)
			continue
		}
		alert := Alert{
			CallID:          call.CallID,
			SystemID:        call.SystemID,
			SystemLabel:     call.SystemLabel,
			TalkgroupID:     call.TalkgroupID,
			TalkgroupNumber: call.TalkgroupNumber,
			TalkgroupLabel:  call.TalkgroupLabel,
			Transcript:      text,
			MatchedTerms:    hit.Terms,
			RuleID:          rule.ID,
			RuleLabel:       rule.Label,
		}
		sent := false
		for _, target := range targets {
			if !targetAcceptsRule(target, rule.ID) {
				continue
			}
			r := s.deliver(ctx, target, alert)
			s.deliveries.Record(target.ID, r)
			if r.OK {
				sent = true
				slog.Info("keywordalert: delivered", "target", Name(target), "rule", rule.Label, "call_id", call.CallID)
			} else {
				slog.Warn("keywordalert: delivery failed", "target", Name(target), "rule", rule.Label, "error", r.Error, "status", r.Status)
			}
		}
		if sent {
			sec := rule.CooldownSec
			if sec <= 0 {
				sec = 120
			}
			s.cool.Set(key, time.Duration(sec)*time.Second)
		}
	}
}

// Test posts a sample alert to one target and returns the delivery result.
func (s *Service) Test(ctx context.Context, targetID int64) (delivery.Result, error) {
	target, err := s.queries.GetKeywordTarget(ctx, targetID)
	if err != nil {
		return delivery.Result{}, fmt.Errorf("keyword target not found")
	}
	alert := Alert{
		CallID:          0,
		SystemID:        1,
		SystemLabel:     "Test",
		TalkgroupID:     1,
		TalkgroupNumber: 3067,
		TalkgroupLabel:  "M/G FD C4",
		Transcript:      "Engine 413 responding to Queen Creek and Ocotillo",
		MatchedTerms:    []string{"413"},
		RuleID:          0,
		RuleLabel:       "test",
	}
	r := s.deliver(ctx, target, alert)
	s.deliveries.Record(target.ID, r)
	return r, nil
}

// DryRun reports which rule labels would match text for the given scope.
func (s *Service) DryRun(systemID, talkgroupID int64, text string) []string {
	s.mu.RLock()
	rules := append([]db.KeywordRule(nil), s.rules...)
	s.mu.RUnlock()
	var labels []string
	for _, rule := range rules {
		if !ruleApplies(rule, systemID, talkgroupID) {
			continue
		}
		patterns, err := parseStringSlice(rule.PatternsJson)
		if err != nil || len(patterns) == 0 {
			continue
		}
		if MatchRulePatterns(text, rule.Label, patterns).Matched {
			labels = append(labels, rule.Label)
		}
	}
	return labels
}

// Name is the admin-facing name for a target.
func Name(t db.KeywordTarget) string {
	if t.Label != "" {
		return t.Label
	}
	return t.Url
}

func ruleApplies(rule db.KeywordRule, systemID, talkgroupID int64) bool {
	systems, err := parseIDSlice(rule.SystemsJson)
	if err != nil {
		return false
	}
	if len(systems) > 0 && !containsID(systems, systemID) {
		return false
	}
	talkgroups, err := parseIDSlice(rule.TalkgroupsJson)
	if err != nil {
		return false
	}
	if len(talkgroups) > 0 && !containsID(talkgroups, talkgroupID) {
		return false
	}
	return true
}

func targetAcceptsRule(target db.KeywordTarget, ruleID int64) bool {
	rules, err := parseIDSlice(target.RulesJson)
	if err != nil {
		return false
	}
	if len(rules) == 0 {
		return true
	}
	return containsID(rules, ruleID)
}

func parseStringSlice(raw string) ([]string, error) {
	if raw == "" {
		return nil, nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func parseIDSlice(ns sql.NullString) ([]int64, error) {
	if !ns.Valid || ns.String == "" {
		return nil, nil
	}
	var out []int64
	if err := json.Unmarshal([]byte(ns.String), &out); err != nil {
		return nil, err
	}
	return out, nil
}

func containsID(ids []int64, want int64) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}
