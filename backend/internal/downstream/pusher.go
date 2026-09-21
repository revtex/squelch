// Package downstream pushes accepted calls to remote Squelch instances.
package downstream

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/safehttp"
)

// CallEvent holds the data for a call that should be pushed downstream.
type CallEvent struct {
	CallID      int64
	AudioPath   string // relative path under processor.RecordingsDir()
	AudioName   string
	AudioType   string
	DateTime    int64 // unix timestamp
	SystemID    int64 // radio system ID (not DB ID)
	System      int64 // DB system ID
	TalkgroupID int64 // radio talkgroup ID (not DB ID)
	Talkgroup   int64 // DB talkgroup ID
	Frequency   int64 // Hz, 0 if unknown
	Duration    int64 // ms, 0 if unknown
	Source      int64 // source unit ID, 0 if unknown
	Sources     string
	Frequencies string
	Patches     string

	// Human-readable labels for downstream consumers.
	SystemLabel    string
	TalkgroupLabel string
	TalkgroupName  string
	TalkgroupGroup string // group label
	TalkgroupTag   string // tag label
	TalkerAlias    string // DMR/P25 talker alias
}

// systemGrant describes which talkgroups are permitted for a system. IDs are
// database primary keys (systems.id / talkgroups.id), matching what the admin
// UI and config import store.
type systemGrant = auth.SystemGrant

// pusherEntry pairs a downstream config with its dedicated event channel.
type pusherEntry struct {
	ch chan CallEvent
}

// Service manages goroutines that push calls to remote instances.
type Service struct {
	queries       *db.Queries
	processor     *audio.Processor
	client        *http.Client
	encryptionKey string
	mu            sync.Mutex
	reloadMu      sync.Mutex
	appCtx        context.Context
	cancel        context.CancelFunc
	wg            sync.WaitGroup
	pushers       []pusherEntry
}

// NewService creates a downstream pusher service.
func NewService(queries *db.Queries, processor *audio.Processor, encryptionKey string) *Service {
	return &Service{
		queries:       queries,
		encryptionKey: encryptionKey,
		processor:     processor,
		client:        safehttp.Client(30 * time.Second),
	}
}

// Start loads active downstream configs and starts one goroutine per entry.
func (s *Service) Start(ctx context.Context) {
	childCtx, cancel := context.WithCancel(ctx)

	s.mu.Lock()
	s.appCtx = ctx
	s.cancel = cancel
	s.mu.Unlock()

	downstreams, err := s.queries.ListActiveDownstreams(childCtx)
	if err != nil {
		slog.Error("downstream: failed to load configs from DB", "error", err)
		cancel()
		return
	}

	entries := make([]pusherEntry, len(downstreams))
	slog.Debug("downstream: starting pushers", "count", len(downstreams))
	for i, ds := range downstreams {
		ch := make(chan CallEvent, 1000)
		entries[i] = pusherEntry{ch: ch}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.runPusher(childCtx, ds, ch)
		}()
	}

	s.mu.Lock()
	s.pushers = entries
	s.mu.Unlock()
}

// Reload stops all running pushers and restarts them from the DB.
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

// Stop cancels all running pusher goroutines and waits for them to exit.
func (s *Service) Stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.pushers = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	s.wg.Wait()
}

// Notify fans out a call event to every active downstream goroutine.
// The send is non-blocking; if a downstream's channel is full the event is
// dropped and a warning is logged.
func (s *Service) Notify(event CallEvent) {
	s.mu.Lock()
	entries := s.pushers
	s.mu.Unlock()

	slog.Debug("downstream: notifying pushers", "call_id", event.CallID, "pushers", len(entries))

	for i := range entries {
		select {
		case entries[i].ch <- event:
		default:
			slog.Warn("downstream: channel full, dropping call event",
				"call_id", event.CallID)
		}
	}
}

// runPusher consumes call events for a single downstream and pushes matching
// calls via HTTP.
func (s *Service) runPusher(ctx context.Context, ds db.Downstream, ch <-chan CallEvent) {
	slog.Info("downstream: starting pusher", "id", ds.ID, "url", ds.Url)

	grants := parseGrants(ds.SystemsJson)

	for {
		select {
		case <-ctx.Done():
			slog.Info("downstream: pusher stopped", "id", ds.ID)
			return
		case event := <-ch:
			if !isGranted(grants, event.System, event.Talkgroup) {
				slog.Debug("downstream: call filtered by grants",
					"downstream_id", ds.ID, "call_id", event.CallID,
					"system", event.SystemID, "talkgroup", event.TalkgroupID)
				continue
			}
			slog.Debug("downstream: pushing call", "downstream_id", ds.ID, "call_id", event.CallID)
			s.pushWithRetry(ctx, ds, event)
		}
	}
}

// parseGrants decodes the systems_json column into a grant list. It returns
// nil (all calls pass) only for NULL, blank or empty; an unparseable value
// yields a deny-all list.
func parseGrants(sj sql.NullString) []systemGrant {
	return auth.ParseSystemGrants(sj)
}

// isGranted checks whether a call matches the grant filter. systemID and
// talkgroupID are database primary keys.
func isGranted(grants []systemGrant, systemID, talkgroupID int64) bool {
	return auth.HasSystemAccess(grants, systemID, talkgroupID)
}

const maxRetries = 5

// pushWithRetry attempts to push a call with exponential backoff.
func (s *Service) pushWithRetry(ctx context.Context, ds db.Downstream, event CallEvent) {
	backoff := time.Second

	for attempt := range maxRetries {
		slog.Debug("downstream: push attempt", "downstream_id", ds.ID, "call_id", event.CallID, "attempt", attempt+1)
		err := s.pushCall(ctx, ds, event)
		if err == nil {
			slog.Info("downstream: call pushed successfully",
				"downstream_id", ds.ID, "call_id", event.CallID)
			_ = s.queries.CreateLog(ctx, db.CreateLogParams{
				DateTime: time.Now().Unix(),
				Level:    "info",
				Message:  fmt.Sprintf("Downstream %d: pushed call %d", ds.ID, event.CallID),
			})
			return
		}

		slog.Warn("downstream: push failed",
			"downstream_id", ds.ID,
			"call_id", event.CallID,
			"attempt", attempt+1,
			"error", err)

		if attempt == maxRetries-1 {
			break
		}

		// Exponential backoff with jitter, capped at 30s.
		jitter := time.Duration(rand.Int64N(int64(backoff) / 2)) //nolint:gosec // jitter only, not security-sensitive
		wait := backoff + jitter
		if wait > 30*time.Second {
			wait = 30 * time.Second
		}

		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		backoff *= 2
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
	}

	slog.Error("downstream: giving up after max retries",
		"downstream_id", ds.ID,
		"call_id", event.CallID)
	_ = s.queries.CreateLog(ctx, db.CreateLogParams{
		DateTime: time.Now().Unix(),
		Level:    "error",
		Message:  fmt.Sprintf("Downstream %d: failed to push call %d after %d retries", ds.ID, event.CallID, maxRetries),
	})
}

// pushCall performs a single HTTP multipart POST to the downstream's
// /api/call-upload endpoint.
func (s *Service) pushCall(ctx context.Context, ds db.Downstream, event CallEvent) error {
	audioPath := filepath.Join(s.processor.RecordingsDir(), event.AudioPath)
	if rel, err := filepath.Rel(s.processor.RecordingsDir(), audioPath); err != nil || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("audio path escapes base directory: %s", event.AudioPath)
	}
	f, err := os.Open(audioPath)
	if err != nil {
		return fmt.Errorf("open audio file: %w", err)
	}
	defer f.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	// Audio file part.
	part, err := writer.CreateFormFile("audio", event.AudioName)
	if err != nil {
		return fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return fmt.Errorf("copy audio data: %w", err)
	}

	// Required fields.
	if err := writer.WriteField("systemId", strconv.FormatInt(event.SystemID, 10)); err != nil {
		return fmt.Errorf("write systemId field: %w", err)
	}
	if err := writer.WriteField("talkgroupId", strconv.FormatInt(event.TalkgroupID, 10)); err != nil {
		return fmt.Errorf("write talkgroupId field: %w", err)
	}
	if err := writer.WriteField("dateTime", strconv.FormatInt(event.DateTime, 10)); err != nil {
		return fmt.Errorf("write dateTime field: %w", err)
	}

	// Optional fields — include only if non-zero/non-empty.
	writeField := func(key, value string) {
		if err := writer.WriteField(key, value); err != nil {
			slog.Warn("downstream: failed to write form field", "key", key, "error", err)
		}
	}
	if event.Frequency != 0 {
		writeField("frequency", strconv.FormatInt(event.Frequency, 10))
	}
	if event.Duration != 0 {
		writeField("duration", strconv.FormatInt(event.Duration, 10))
	}
	if event.Source != 0 {
		writeField("source", strconv.FormatInt(event.Source, 10))
	}
	if event.Sources != "" {
		writeField("sources", event.Sources)
	}
	if event.Frequencies != "" {
		writeField("frequencies", event.Frequencies)
	}
	if event.Patches != "" {
		writeField("patches", event.Patches)
	}
	if event.AudioName != "" {
		writeField("audioName", event.AudioName)
	}
	if event.AudioType != "" {
		writeField("audioType", event.AudioType)
	}

	// Label fields — include only if non-empty.
	if event.SystemLabel != "" {
		writeField("systemLabel", event.SystemLabel)
	}
	if event.TalkgroupLabel != "" {
		writeField("talkgroupLabel", event.TalkgroupLabel)
	}
	if event.TalkgroupName != "" {
		writeField("talkgroupName", event.TalkgroupName)
	}
	if event.TalkgroupGroup != "" {
		writeField("talkgroupGroup", event.TalkgroupGroup)
	}
	if event.TalkgroupTag != "" {
		writeField("talkgroupTag", event.TalkgroupTag)
	}
	if event.TalkerAlias != "" {
		writeField("talkerAlias", event.TalkerAlias)
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("close multipart writer: %w", err)
	}

	url := strings.TrimRight(ds.Url, "/") + "/api/call-upload"
	slog.Debug("downstream: http post", "url", url, "system", event.SystemID, "talkgroup", event.TalkgroupID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	apiKey := ds.ApiKey
	if auth.IsEncrypted(apiKey) {
		if s.encryptionKey == "" {
			slog.Error("downstream: api key is encrypted but no encryption key configured — aborting push",
				"downstream_id", ds.ID,
				"url", ds.Url,
			)
			return fmt.Errorf("downstream %d: api key encrypted but no encryption key configured", ds.ID)
		}
		plain, err := auth.DecryptString(apiKey, s.encryptionKey)
		if err != nil {
			slog.Error("downstream: failed to decrypt api key — aborting push",
				"downstream_id", ds.ID,
				"url", ds.Url,
				"error", err,
			)
			return fmt.Errorf("downstream %d: decrypt api key: %w", ds.ID, err)
		}
		apiKey = plain
	}
	req.Header.Set("X-API-Key", apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		slog.Warn("downstream: failed to drain response body", "error", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("unexpected status %d from %s", resp.StatusCode, ds.Url)
	}
	slog.Debug("downstream: push response received",
		"downstream_id", ds.ID,
		"call_id", event.CallID,
		"status_code", resp.StatusCode,
	)
	return nil
}
