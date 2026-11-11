package keywordalert

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/delivery"
)

// Target type constants.
const (
	TypeGeneric = "generic"
	TypeSlack   = "slack"
	TypeDisplay = "display"
)

// Alert is one matched call ready to send.
type Alert struct {
	CallID          int64
	SystemID        int64
	SystemLabel     string
	TalkgroupID     int64
	TalkgroupNumber int64
	TalkgroupLabel  string
	Transcript      string
	MatchedTerms    []string
	RuleID          int64
	RuleLabel       string
}

func (s *Service) deliver(ctx context.Context, target db.KeywordTarget, alert Alert) delivery.Result {
	start := time.Now()
	body, err := buildBody(target.Type, alert)
	if err != nil {
		return delivery.Result{At: time.Now().Unix(), OK: false, Error: err.Error()}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target.Url, bytes.NewReader(body))
	if err != nil {
		return delivery.Result{At: time.Now().Unix(), OK: false, Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", s.userAgent)
	if secret := s.openSecret(target.Secret); secret != "" {
		if target.Type == TypeDisplay {
			req.Header.Set("X-Alert-Token", secret)
		} else {
			req.Header.Set("X-Squelch-Alert-Token", secret)
		}
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return delivery.Result{At: time.Now().Unix(), OK: false, Error: err.Error(), Millis: time.Since(start).Milliseconds()}
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	ok := resp.StatusCode >= 200 && resp.StatusCode < 300
	r := delivery.Result{
		At:     time.Now().Unix(),
		OK:     ok,
		Status: resp.StatusCode,
		Millis: time.Since(start).Milliseconds(),
	}
	if !ok {
		r.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return r
}

func buildBody(targetType string, alert Alert) ([]byte, error) {
	switch targetType {
	case TypeSlack:
		tgBit := fmt.Sprintf("%d", alert.TalkgroupNumber)
		if alert.TalkgroupLabel != "" {
			tgBit += " (" + alert.TalkgroupLabel + ")"
		}
		terms := strings.Join(alert.MatchedTerms, ", ")
		transcript := alert.Transcript
		if transcript == "" {
			transcript = "(empty)"
		}
		text := fmt.Sprintf(
			"*Radio keyword alert*\n• System: `%s`\n• Talkgroup: `%s`\n• Matched: `%s`\n• Transcript: %s",
			alert.SystemLabel, tgBit, terms, transcript,
		)
		return json.Marshal(map[string]string{"text": text})
	case TypeDisplay:
		return json.Marshal(map[string]any{
			"talkgroup":       alert.TalkgroupNumber,
			"talkgroup_label": alert.TalkgroupLabel,
			"transcript":      alert.Transcript,
			"matched_terms":   alert.MatchedTerms,
		})
	default:
		return json.Marshal(map[string]any{
			"event":        "keyword",
			"callId":       alert.CallID,
			"system":       map[string]any{"id": alert.SystemID, "label": alert.SystemLabel},
			"talkgroup":    map[string]any{"id": alert.TalkgroupID, "number": alert.TalkgroupNumber, "label": alert.TalkgroupLabel},
			"transcript":   alert.Transcript,
			"matchedTerms": alert.MatchedTerms,
			"rule":         map[string]any{"id": alert.RuleID, "label": alert.RuleLabel},
		})
	}
}

func (s *Service) openSecret(secret sql.NullString) string {
	if !secret.Valid || secret.String == "" {
		return ""
	}
	if auth.IsEncrypted(secret.String) {
		plain, err := auth.DecryptString(secret.String, s.encryptionKey)
		if err != nil {
			return ""
		}
		return plain
	}
	return secret.String
}
