package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/safehttp"
)

// transcriptionHTTP talks to go-whisper for the admin transcription
// operations. Like the transcription worker, it goes through safehttp so
// SQUELCH_BLOCK_INTERNAL_HTTP and the no-redirect policy apply here too.
// Each call bounds itself with a context deadline.
var transcriptionHTTP = safehttp.Client(0)

// transcriptionBaseURL reads the transcriptionUrl setting from DB.
func (o *Operations) transcriptionBaseURL(ctx context.Context) (string, error) {
	s, err := o.Queries.GetSetting(ctx, "transcriptionUrl")
	if err == nil && s.Value != "" && validHTTPURL(s.Value) {
		return strings.TrimRight(s.Value, "/"), nil
	}
	// Fall back to the live manager's URL (e.g. when DB setting was just saved
	// but the query above fails due to timing).
	if tr := o.Deps.TranscriberReload; tr != nil {
		if u := tr.BaseURL(); u != "" {
			return strings.TrimRight(u, "/"), nil
		}
	}
	return "", UserError("transcriptionUrl setting is not configured")
}

// TranscriptionStatus returns whether transcription is enabled, the
// configured model/language, and live connectivity to go-whisper.
func (o *Operations) TranscriptionStatus(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	// Read settings from DB.
	getVal := func(key string) string {
		s, err := o.Queries.GetSetting(ctx, key)
		if err != nil {
			return ""
		}
		return s.Value
	}

	enabled := getVal("transcriptionEnabled") == "true"
	baseURL := getVal("transcriptionUrl")
	model := getVal("transcriptionModel")
	language := getVal("transcriptionLanguage")
	diarize := getVal("transcriptionDiarize") == "true"
	liveDisplay := getVal("liveTranscriptDisplay") == "true"

	// Check live connection to go-whisper.
	connected := false
	if baseURL != "" && validHTTPURL(baseURL) {
		trimmed := strings.TrimRight(baseURL, "/")
		reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, trimmed+"/api/whisper/model", nil)
		if err == nil {
			resp, err := transcriptionHTTP.Do(req)
			if err == nil {
				resp.Body.Close()
				connected = resp.StatusCode >= 200 && resp.StatusCode < 400
			}
		}
	}

	return map[string]any{
		"enabled":     enabled,
		"url":         baseURL,
		"model":       model,
		"language":    language,
		"diarize":     diarize,
		"liveDisplay": liveDisplay,
		"connected":   connected,
	}, nil
}

// TranscriptionModels proxies the model list from go-whisper.
func (o *Operations) TranscriptionModels(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	baseURL, err := o.transcriptionBaseURL(ctx)
	if err != nil {
		return nil, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL+"/api/whisper/model", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := transcriptionHTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("go-whisper unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("go-whisper returned status %d", resp.StatusCode)
	}

	var result json.RawMessage
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("invalid JSON from go-whisper: %w", err)
	}
	return result, nil
}

// TranscriptionDownload triggers a model download on go-whisper.
func (o *Operations) TranscriptionDownload(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.Model == "" {
		return nil, UserError("model name is required")
	}

	// go-whisper expects model names with .bin extension
	model := req.Model
	if !strings.HasSuffix(model, ".bin") {
		model += ".bin"
	}

	// tdrz (tinydiarize) models live in a different HuggingFace repo.
	// go-whisper's store accepts a full URL as the model path for non-default repos.
	if strings.Contains(model, "tdrz") {
		model = "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-" + strings.TrimPrefix(model, "ggml-")
	}

	baseURL, err := o.transcriptionBaseURL(ctx)
	if err != nil {
		return nil, err
	}

	reqBody, _ := json.Marshal(map[string]string{"model": model})

	// Model downloads can take a long time (500MB+).
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, baseURL+"/api/whisper/model", strings.NewReader(string(reqBody)))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := transcriptionHTTP.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("go-whisper unreachable: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		slog.Warn("go-whisper model download failed", "status", resp.StatusCode, "body", string(body))
		return nil, fmt.Errorf("go-whisper returned status %d", resp.StatusCode)
	}

	var result json.RawMessage
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("invalid JSON from go-whisper: %w", err)
	}
	return result, nil
}

// TranscriptionDelete deletes a model on go-whisper.
func (o *Operations) TranscriptionDelete(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID == "" {
		return nil, UserError("model id is required")
	}

	// Sanitise: model ID should be alphanumeric + hyphens/dots/underscores only.
	for _, ch := range req.ID {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '.' || ch == '_') {
			return nil, UserError("invalid model id")
		}
	}

	baseURL, err := o.transcriptionBaseURL(ctx)
	if err != nil {
		return nil, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodDelete, baseURL+"/api/whisper/model/"+req.ID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	resp, err := transcriptionHTTP.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("go-whisper unreachable: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body) //nolint:errcheck

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("go-whisper returned status %d", resp.StatusCode)
	}

	return map[string]any{"deleted": true}, nil
}

// TranscriptionStats aggregates transcription DB stats and live pool status.
func (o *Operations) TranscriptionStats(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	// DB aggregate stats — "recent" = last 24 hours.
	since := time.Now().Add(-24 * time.Hour).Unix()
	stats, err := o.Queries.TranscriptionStats(ctx, since)
	if err != nil {
		return nil, fmt.Errorf("query transcription stats: %w", err)
	}

	byLang, err := o.Queries.TranscriptionsByLanguage(ctx)
	if err != nil {
		return nil, fmt.Errorf("query transcriptions by language: %w", err)
	}

	byModel, err := o.Queries.TranscriptionsByModel(ctx)
	if err != nil {
		return nil, fmt.Errorf("query transcriptions by model: %w", err)
	}

	// Pool stats (live).
	queueDepth := 0
	poolEnabled := false
	if tr := o.Deps.TranscriberReload; tr != nil {
		poolEnabled = tr.Enabled()
		queueDepth = tr.QueueDepth()
	}

	// Convert interface{} values from COALESCE/AVG to int64.
	toInt64 := func(v interface{}) int64 {
		switch n := v.(type) {
		case int64:
			return n
		case float64:
			return int64(n)
		default:
			return 0
		}
	}

	langBreakdown := make([]map[string]any, 0, len(byLang))
	for _, l := range byLang {
		langBreakdown = append(langBreakdown, map[string]any{
			"language": l.Lang,
			"count":    l.Cnt,
		})
	}

	modelBreakdown := make([]map[string]any, 0, len(byModel))
	for _, m := range byModel {
		modelBreakdown = append(modelBreakdown, map[string]any{
			"model": m.ModelName,
			"count": m.Cnt,
		})
	}

	return map[string]any{
		"total":         stats.Total,
		"recent24h":     stats.RecentCount,
		"avgDurationMs": toInt64(stats.AvgDurationMs),
		"minDurationMs": toInt64(stats.MinDurationMs),
		"maxDurationMs": toInt64(stats.MaxDurationMs),
		"queueDepth":    queueDepth,
		"poolEnabled":   poolEnabled,
		"byLanguage":    langBreakdown,
		"byModel":       modelBreakdown,
	}, nil
}
