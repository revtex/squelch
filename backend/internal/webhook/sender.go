// Package webhook posts a small JSON message to a URL whenever a call is
// accepted, for alerting, logging or automation on the other end. Generic
// targets get Squelch's own payload, signed with HMAC when the webhook has
// a secret; Discord targets get an embed their webhook URL understands.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/delivery"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/safehttp"
)

// TypeGeneric posts Squelch's JSON payload; TypeDiscord posts a Discord
// embed.
const (
	TypeGeneric = "generic"
	TypeDiscord = "discord"
)

const (
	maxAttempts = 3
	queueSize   = 200
)

// Service fans call events out to every enabled webhook, one goroutine
// per webhook so a slow target never holds the others up.
type Service struct {
	queries       *db.Queries
	client        *http.Client
	encryptionKey string
	deliveries    *delivery.Tracker
	userAgent     string

	mu       sync.Mutex
	reloadMu sync.Mutex
	appCtx   context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
	workers  []chan downstream.CallEvent
}

// NewService creates a webhook sender. version goes in the User-Agent.
func NewService(queries *db.Queries, encryptionKey, version string) *Service {
	s := &Service{
		queries:       queries,
		client:        safehttp.Client(15 * time.Second),
		encryptionKey: encryptionKey,
		userAgent:     "Squelch/" + version,
	}
	s.deliveries = delivery.New(func(id int64, r delivery.Result) {
		ok := int64(0)
		if r.OK {
			ok = 1
		}
		if err := queries.RecordWebhookDelivery(context.Background(), db.RecordWebhookDeliveryParams{
			At: sql.NullInt64{Int64: r.At, Valid: true}, Ok: ok, Status: int64(r.Status), Error: r.Error, ID: id,
		}); err != nil {
			slog.Warn("webhook: failed to record delivery", "webhook_id", id, "error", err)
		}
	})
	return s
}

// Start loads the enabled webhooks and starts a worker for each.
func (s *Service) Start(ctx context.Context) {
	childCtx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	s.appCtx = ctx
	s.cancel = cancel
	s.mu.Unlock()

	hooks, err := s.queries.ListActiveWebhooks(childCtx)
	if err != nil {
		slog.Error("webhook: failed to load webhooks", "error", err)
		cancel()
		return
	}
	workers := make([]chan downstream.CallEvent, len(hooks))
	for i, wh := range hooks {
		if wh.LastAt.Valid {
			s.deliveries.Seed(wh.ID, delivery.Result{
				At: wh.LastAt.Int64, OK: wh.LastOk == 1, Status: int(wh.LastStatus), Error: wh.LastError,
			}, wh.LastOkAt.Int64)
		}
		ch := make(chan downstream.CallEvent, queueSize)
		workers[i] = ch
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.run(childCtx, wh, ch)
		}()
	}
	s.mu.Lock()
	s.workers = workers
	s.mu.Unlock()
	slog.Debug("webhook: workers started", "count", len(hooks))
}

// Reload restarts the workers from the database.
func (s *Service) Reload() {
	s.reloadMu.Lock()
	defer s.reloadMu.Unlock()
	s.mu.Lock()
	appCtx := s.appCtx
	s.mu.Unlock()
	if appCtx == nil {
		return
	}
	s.Stop()
	s.Start(appCtx)
}

// Stop ends every worker and waits for them.
func (s *Service) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.workers = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	s.wg.Wait()
}

// Notify hands a call to every worker without blocking; a worker whose
// queue is full drops the call and says so in the log.
func (s *Service) Notify(event downstream.CallEvent) {
	s.mu.Lock()
	workers := s.workers
	s.mu.Unlock()
	for _, ch := range workers {
		select {
		case ch <- event:
		default:
			slog.Warn("webhook: queue full, dropping call", "call_id", event.CallID)
		}
	}
}

// Stats reports how deliveries to one webhook have been going.
func (s *Service) Stats(id int64) delivery.Stats {
	return s.deliveries.Stats(id)
}

// Forget drops a deleted webhook's delivery history.
func (s *Service) Forget(id int64) {
	s.deliveries.Forget(id)
}

// Test posts a test message to one webhook and reports what came back.
// The result is recorded like any delivery, so a failing test shows on
// the page.
func (s *Service) Test(ctx context.Context, id int64) (delivery.Result, error) {
	wh, err := s.queries.GetWebhook(ctx, id)
	if err != nil {
		return delivery.Result{}, fmt.Errorf("webhook not found")
	}
	body, err := s.testBody(wh)
	if err != nil {
		return delivery.Result{}, err
	}
	r := s.post(ctx, wh, "test", body)
	s.deliveries.Record(wh.ID, r)
	return r, nil
}

func (s *Service) run(ctx context.Context, wh db.Webhook, ch <-chan downstream.CallEvent) {
	grants := auth.ParseSystemGrants(wh.SystemsJson)
	for {
		select {
		case <-ctx.Done():
			return
		case event := <-ch:
			if !auth.HasSystemAccess(grants, event.System, event.Talkgroup) {
				continue
			}
			body, err := s.callBody(wh, event)
			if err != nil {
				slog.Warn("webhook: cannot build payload", "webhook_id", wh.ID, "error", err)
				continue
			}
			s.sendWithRetry(ctx, wh, body)
		}
	}
}

func (s *Service) sendWithRetry(ctx context.Context, wh db.Webhook, body []byte) {
	backoff := 2 * time.Second
	var last delivery.Result
	for attempt := range maxAttempts {
		last = s.post(ctx, wh, "call", body)
		if last.OK {
			s.deliveries.Record(wh.ID, last)
			return
		}
		slog.Warn("webhook: delivery failed", "webhook_id", wh.ID, "attempt", attempt+1, "status", last.Status, "error", last.Error)
		if attempt == maxAttempts-1 || ctx.Err() != nil {
			break
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		backoff *= 2
	}
	s.deliveries.Record(wh.ID, last)
	_ = s.queries.CreateLog(ctx, db.CreateLogParams{
		DateTime: time.Now().Unix(),
		Level:    "error",
		Message:  fmt.Sprintf("Webhook %s: delivery failed after %d attempts: %s", Name(wh), maxAttempts, last.Error),
	})
}

// post sends one request and describes what happened. It never returns an
// error: a failure is a Result with OK false.
func (s *Service) post(ctx context.Context, wh db.Webhook, event string, body []byte) delivery.Result {
	start := time.Now()
	r := delivery.Result{At: start.Unix()}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, wh.Url, bytes.NewReader(body))
	if err != nil {
		r.Error = "bad URL: " + err.Error()
		return r
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", s.userAgent)
	if wh.Type != TypeDiscord {
		req.Header.Set("X-Squelch-Event", event)
		secret, err := s.plainSecret(wh)
		if err != nil {
			r.Error = err.Error()
			return r
		}
		if secret != "" {
			req.Header.Set("X-Squelch-Signature", Sign(secret, body))
		}
	}
	resp, err := s.client.Do(req)
	r.Millis = time.Since(start).Milliseconds()
	if err != nil {
		r.Error = err.Error()
		return r
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	r.Status = resp.StatusCode
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		r.OK = true
	} else {
		r.Error = fmt.Sprintf("the target answered %d %s", resp.StatusCode, http.StatusText(resp.StatusCode))
	}
	return r
}

// Sign returns the value of X-Squelch-Signature for a body: "sha256=" and
// the hex HMAC-SHA256 of the body under the secret.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func (s *Service) plainSecret(wh db.Webhook) (string, error) {
	if !wh.Secret.Valid || wh.Secret.String == "" {
		return "", nil
	}
	if !auth.IsEncrypted(wh.Secret.String) {
		return wh.Secret.String, nil
	}
	if s.encryptionKey == "" {
		return "", fmt.Errorf("the secret is encrypted but the server has no encryption key")
	}
	plain, err := auth.DecryptString(wh.Secret.String, s.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("the secret could not be decrypted: %w", err)
	}
	return plain, nil
}

// Name is the label, or the URL for an unlabelled webhook.
func Name(wh db.Webhook) string {
	if wh.Label != "" {
		return wh.Label
	}
	return wh.Url
}

// CallPayload is what a generic webhook receives for each call.
type CallPayload struct {
	Event  string      `json:"event"`
	SentAt int64       `json:"sentAt"`
	Call   CallDetails `json:"call"`
}

// CallDetails describes one call in a webhook payload.
type CallDetails struct {
	ID          int64          `json:"id"`
	DateTime    int64          `json:"dateTime"`
	Frequency   int64          `json:"frequency,omitempty"`
	Duration    int64          `json:"duration,omitempty"`
	Source      int64          `json:"source,omitempty"`
	TalkerAlias string         `json:"talkerAlias,omitempty"`
	System      SystemDetails  `json:"system"`
	Talkgroup   TalkgroupCalls `json:"talkgroup"`
}

// SystemDetails names the call's system by its radio id and label.
type SystemDetails struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
}

// TalkgroupCalls names the call's talkgroup with its labels.
type TalkgroupCalls struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
	Name  string `json:"name,omitempty"`
	Group string `json:"group,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// Payload builds the generic payload for a call.
func Payload(event downstream.CallEvent, sentAt int64) CallPayload {
	return CallPayload{
		Event:  "call",
		SentAt: sentAt,
		Call: CallDetails{
			ID:          event.CallID,
			DateTime:    event.DateTime,
			Frequency:   event.Frequency,
			Duration:    event.Duration,
			Source:      event.Source,
			TalkerAlias: event.TalkerAlias,
			System:      SystemDetails{ID: event.SystemID, Label: event.SystemLabel},
			Talkgroup: TalkgroupCalls{
				ID: event.TalkgroupID, Label: event.TalkgroupLabel, Name: event.TalkgroupName,
				Group: event.TalkgroupGroup, Tag: event.TalkgroupTag,
			},
		},
	}
}

// SamplePayload is the generic payload shown to admins as a preview.
func SamplePayload() CallPayload {
	return Payload(downstream.CallEvent{
		CallID: 18942, DateTime: 1_790_000_000, Frequency: 853_512_500, Duration: 12_400, Source: 2_304_117,
		SystemID: 1, SystemLabel: "County", TalkgroupID: 3204, TalkgroupLabel: "FD Disp",
		TalkgroupName: "Fire Dispatch", TalkgroupGroup: "Fire", TalkgroupTag: "Fire Dispatch",
	}, 1_790_000_003)
}

func (s *Service) callBody(wh db.Webhook, event downstream.CallEvent) ([]byte, error) {
	if wh.Type == TypeDiscord {
		return json.Marshal(discordEmbed(event))
	}
	return json.Marshal(Payload(event, time.Now().Unix()))
}

func (s *Service) testBody(wh db.Webhook) ([]byte, error) {
	if wh.Type == TypeDiscord {
		return json.Marshal(map[string]any{
			"content": fmt.Sprintf("Squelch test: the webhook %q works.", Name(wh)),
		})
	}
	p := SamplePayload()
	p.Event = "test"
	p.SentAt = time.Now().Unix()
	return json.Marshal(p)
}

// discordEmbed is the message a Discord webhook URL shows for a call.
func discordEmbed(event downstream.CallEvent) map[string]any {
	title := event.TalkgroupLabel
	if title == "" {
		title = fmt.Sprintf("Talkgroup %d", event.TalkgroupID)
	}
	if event.SystemLabel != "" {
		title += " · " + event.SystemLabel
	}
	fields := []map[string]any{
		{"name": "Talkgroup", "value": fmt.Sprintf("%d", event.TalkgroupID), "inline": true},
	}
	if event.Duration > 0 {
		fields = append(fields, map[string]any{"name": "Length", "value": fmt.Sprintf("%.0f s", float64(event.Duration)/1000), "inline": true})
	}
	if event.Source > 0 {
		src := fmt.Sprintf("%d", event.Source)
		if event.TalkerAlias != "" {
			src = event.TalkerAlias + " (" + src + ")"
		}
		fields = append(fields, map[string]any{"name": "Unit", "value": src, "inline": true})
	}
	embed := map[string]any{
		"title":     title,
		"fields":    fields,
		"timestamp": time.Unix(event.DateTime, 0).UTC().Format(time.RFC3339),
	}
	if event.TalkgroupName != "" {
		embed["description"] = event.TalkgroupName
	}
	return map[string]any{"embeds": []map[string]any{embed}}
}
