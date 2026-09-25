package admin

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/safehttp"
)

// transcriptionHTTP talks to go-whisper for the admin transcription
// operations. Like the transcription worker, it goes through safehttp so
// SQUELCH_BLOCK_INTERNAL_HTTP and the no-redirect policy apply here too.
// Each call bounds itself with a context deadline.
var transcriptionHTTP = safehttp.Client(0)

// modelIDPattern is what a go-whisper model id may look like.
var modelIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// whisperModel is one entry of go-whisper's model list.
type whisperModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Path    string `json:"path"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

// modelDownload is a download in flight, kept so the page can show its
// progress after a reload and the admin can cancel it.
type modelDownload struct {
	Model   string  `json:"model"`
	Current int64   `json:"current"`
	Total   int64   `json:"total"`
	Percent float64 `json:"percent"`
	cancel  context.CancelFunc
}

// downloads tracks model downloads by model id, process-wide: the admin
// socket may reconnect while one runs.
var downloads = struct {
	sync.Mutex
	m map[string]*modelDownload
}{m: map[string]*modelDownload{}}

func downloadsSnapshot() []modelDownload {
	downloads.Lock()
	defer downloads.Unlock()
	out := make([]modelDownload, 0, len(downloads.m))
	for _, d := range downloads.m {
		out = append(out, modelDownload{Model: d.Model, Current: d.Current, Total: d.Total, Percent: d.Percent})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Model < out[j].Model })
	return out
}

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

// whisperProbe is what one round trip to go-whisper's model list tells us.
type whisperProbe struct {
	OK        bool
	LatencyMs int64
	Version   string
	Models    []whisperModel
	Error     string
}

// probeWhisper fetches the model list, which doubles as the health check:
// go-whisper has no health or version endpoint, so the version comes from
// its Server header when it sends one.
func probeWhisper(ctx context.Context, baseURL string) whisperProbe {
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL+"/api/whisper/model", nil)
	if err != nil {
		return whisperProbe{Error: err.Error()}
	}
	start := time.Now()
	resp, err := transcriptionHTTP.Do(req)
	if err != nil {
		return whisperProbe{Error: plainNetError(err)}
	}
	defer resp.Body.Close()
	p := whisperProbe{LatencyMs: time.Since(start).Milliseconds(), Version: whisperVersion(resp.Header.Get("Server"))}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		p.Error = "reading the reply failed: " + err.Error()
		return p
	}
	if resp.StatusCode != http.StatusOK {
		p.Error = fmt.Sprintf("the server answered %d", resp.StatusCode)
		return p
	}
	var list struct {
		Models []whisperModel `json:"models"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		p.Error = "the reply was not a go-whisper model list"
		return p
	}
	p.OK = true
	p.Models = list.Models
	if p.Models == nil {
		p.Models = []whisperModel{}
	}
	return p
}

// whisperVersion pulls "0.9.2" out of a Server header like "go-whisper/0.9.2".
func whisperVersion(server string) string {
	server = strings.TrimSpace(server)
	if server == "" {
		return ""
	}
	if i := strings.Index(server, "/"); i >= 0 && i < len(server)-1 {
		return strings.Fields(server[i+1:])[0]
	}
	return ""
}

// plainNetError turns a transport error into a sentence for the banner.
func plainNetError(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "connection refused"):
		return "nothing is listening at that address"
	case strings.Contains(s, "no such host"):
		return "the host name does not resolve"
	case errors.Is(err, context.DeadlineExceeded) || strings.Contains(s, "deadline exceeded") || strings.Contains(s, "Timeout"):
		return "no answer within 5 seconds"
	}
	if i := strings.LastIndex(s, ": "); i >= 0 {
		return s[i+2:]
	}
	return s
}

// TranscriptionStatus returns the settings, the live pool and whether
// go-whisper answers right now.
func (o *Operations) TranscriptionStatus(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	getVal := func(key string) string {
		s, err := o.Queries.GetSetting(ctx, key)
		if err != nil {
			return ""
		}
		return s.Value
	}

	baseURL := getVal("transcriptionUrl")
	minMs, _ := strconv.ParseInt(getVal("transcriptionMinDurationMs"), 10, 64)

	out := map[string]any{
		"enabled":       getVal("transcriptionEnabled") == "true",
		"url":           baseURL,
		"model":         getVal("transcriptionModel"),
		"language":      getVal("transcriptionLanguage"),
		"diarize":       getVal("transcriptionDiarize") == "true",
		"liveDisplay":   getVal("liveTranscriptDisplay") == "true",
		"minDurationMs": minMs,
		"connected":     false,
		"version":       "",
		"latencyMs":     int64(0),
		"error":         "",
		"workers":       0,
		"queueDepth":    0,
		"poolEnabled":   false,
	}
	if tr := o.Deps.TranscriberReload; tr != nil {
		out["workers"] = tr.Workers()
		out["queueDepth"] = tr.QueueDepth()
		out["poolEnabled"] = tr.Enabled()
	}
	if baseURL != "" && validHTTPURL(baseURL) {
		p := probeWhisper(ctx, strings.TrimRight(baseURL, "/"))
		out["connected"] = p.OK
		out["version"] = p.Version
		out["latencyMs"] = p.LatencyMs
		out["error"] = p.Error
	} else if baseURL != "" {
		out["error"] = "the URL must start with http:// or https://"
	}
	return out, nil
}

// TranscriptionTest tries the sidecar once and says how it went.
func (o *Operations) TranscriptionTest(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		URL string `json:"url"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, UserError("invalid request body")
		}
	}
	baseURL := strings.TrimRight(strings.TrimSpace(req.URL), "/")
	if baseURL == "" {
		var err error
		if baseURL, err = o.transcriptionBaseURL(ctx); err != nil {
			return nil, err
		}
	}
	if !validHTTPURL(baseURL) {
		return nil, UserError("the URL must start with http:// or https://")
	}
	p := probeWhisper(ctx, baseURL)
	outcome := fmt.Sprintf("ok (%d ms, %d models", p.LatencyMs, len(p.Models))
	if p.Version != "" {
		outcome += ", go-whisper " + p.Version
	}
	outcome += ")"
	if !p.OK {
		outcome = "failed: " + p.Error
	}
	o.audit(ctx, fmt.Sprintf("transcription connection to %s tested by %s: %s", baseURL, o.callerName(ctx, callerID), outcome))
	return map[string]any{
		"ok":        p.OK,
		"latencyMs": p.LatencyMs,
		"version":   p.Version,
		"models":    len(p.Models),
		"error":     p.Error,
	}, nil
}

// TranscriptionModels lists the models go-whisper has, plus the downloads
// still running.
func (o *Operations) TranscriptionModels(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	baseURL, err := o.transcriptionBaseURL(ctx)
	if err != nil {
		return nil, err
	}
	p := probeWhisper(ctx, baseURL)
	if !p.OK {
		return nil, fmt.Errorf("go-whisper at %s: %s", baseURL, p.Error)
	}
	return map[string]any{
		"models":    p.Models,
		"downloads": downloadsSnapshot(),
	}, nil
}

// whisperModelPath is what go-whisper wants asked for: the file name, or a
// full URL for the tinydiarize models that live in another repository.
func whisperModelPath(model string) string {
	if !strings.HasSuffix(model, ".bin") {
		model += ".bin"
	}
	if strings.Contains(model, "tdrz") {
		return "https://huggingface.co/akashmjn/tinydiarize-whisper.cpp/resolve/main/ggml-" + strings.TrimPrefix(model, "ggml-")
	}
	return model
}

// TranscriptionDownload starts a model download and returns at once; the
// download reports through transcription.download events (progress, done,
// failed) and the models list carries it while it runs.
func (o *Operations) TranscriptionDownload(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	model := strings.TrimSuffix(strings.TrimSpace(req.Model), ".bin")
	if model == "" {
		return nil, UserError("model name is required")
	}
	if !modelIDPattern.MatchString(model) {
		return nil, UserError("invalid model id")
	}
	baseURL, err := o.transcriptionBaseURL(ctx)
	if err != nil {
		return nil, err
	}

	downloads.Lock()
	if _, running := downloads.m[model]; running {
		downloads.Unlock()
		return map[string]any{"started": false, "model": model}, nil
	}
	dlCtx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	d := &modelDownload{Model: model, cancel: cancel}
	downloads.m[model] = d
	downloads.Unlock()

	who := o.callerName(ctx, callerID)
	o.audit(ctx, fmt.Sprintf("model %s download started by %s", model, who))
	go o.runModelDownload(dlCtx, cancel, baseURL, d)
	return map[string]any{"started": true, "model": model}, nil
}

// runModelDownload streams go-whisper's progress events until the download
// ends one way or another.
func (o *Operations) runModelDownload(ctx context.Context, cancel context.CancelFunc, baseURL string, d *modelDownload) {
	defer cancel()
	finish := func(topic string, extra map[string]any) {
		downloads.Lock()
		delete(downloads.m, d.Model)
		downloads.Unlock()
		data := map[string]any{"model": d.Model}
		for k, v := range extra {
			data[k] = v
		}
		o.broadcastAdminEvent(topic, data)
	}

	body, _ := json.Marshal(map[string]string{"model": whisperModelPath(d.Model)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/whisper/model", strings.NewReader(string(body)))
	if err != nil {
		finish("transcription.download.failed", map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := transcriptionHTTP.Do(req)
	if err != nil {
		if errors.Is(ctx.Err(), context.Canceled) {
			finish("transcription.download.cancelled", nil)
			return
		}
		finish("transcription.download.failed", map[string]any{"error": plainNetError(err)})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 200 {
			msg = msg[:200] + "…"
		}
		slog.Warn("go-whisper model download failed", "model", d.Model, "status", resp.StatusCode, "body", msg)
		finish("transcription.download.failed", map[string]any{"error": fmt.Sprintf("the server answered %d: %s", resp.StatusCode, msg)})
		return
	}

	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		// An older sidecar answers only when the file is there.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		o.audit(ctx, fmt.Sprintf("model %s downloaded", d.Model))
		finish("transcription.download.done", nil)
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	event := ""
	lastSent := time.Time{}
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			switch event {
			case "progress", "":
				var p struct {
					Current int64   `json:"current"`
					Total   int64   `json:"total"`
					Percent float64 `json:"percent"`
				}
				if json.Unmarshal([]byte(data), &p) != nil {
					continue
				}
				downloads.Lock()
				d.Current, d.Total, d.Percent = p.Current, p.Total, p.Percent
				downloads.Unlock()
				if time.Since(lastSent) >= 500*time.Millisecond {
					lastSent = time.Now()
					o.broadcastAdminEvent("transcription.download.progress", map[string]any{
						"model": d.Model, "current": p.Current, "total": p.Total, "percent": p.Percent,
					})
				}
			case "done":
				o.audit(ctx, fmt.Sprintf("model %s downloaded", d.Model))
				finish("transcription.download.done", nil)
				return
			case "error":
				finish("transcription.download.failed", map[string]any{"error": data})
				return
			}
		case line == "":
			event = ""
		}
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		finish("transcription.download.cancelled", nil)
		return
	}
	if err := scanner.Err(); err != nil {
		finish("transcription.download.failed", map[string]any{"error": plainNetError(err)})
		return
	}
	// The stream ended without a done event: go-whisper closes it once the
	// file is written, so treat a clean end as success.
	o.audit(ctx, fmt.Sprintf("model %s downloaded", d.Model))
	finish("transcription.download.done", nil)
}

// TranscriptionDownloadCancel stops a running download.
func (o *Operations) TranscriptionDownloadCancel(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(params, &req); err != nil || req.Model == "" {
		return nil, UserError("model name is required")
	}
	downloads.Lock()
	d, ok := downloads.m[req.Model]
	downloads.Unlock()
	if !ok {
		return map[string]any{"cancelled": false}, nil
	}
	d.cancel()
	o.audit(ctx, fmt.Sprintf("model %s download cancelled by %s", req.Model, o.callerName(ctx, callerID)))
	return map[string]any{"cancelled": true}, nil
}

// TranscriptionDelete deletes a model on go-whisper.
func (o *Operations) TranscriptionDelete(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	if req.ID == "" {
		return nil, UserError("model id is required")
	}
	if !modelIDPattern.MatchString(req.ID) {
		return nil, UserError("invalid model id")
	}
	if s, err := o.Queries.GetSetting(ctx, "transcriptionModel"); err == nil && s.Value == req.ID {
		if e, err := o.Queries.GetSetting(ctx, "transcriptionEnabled"); err == nil && e.Value == "true" {
			return nil, UserError("that model is in use; pick another one first")
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
	o.audit(ctx, fmt.Sprintf("model %s deleted by %s", req.ID, o.callerName(ctx, callerID)))
	return map[string]any{"deleted": true}, nil
}

// TranscriptionJobs lists recent jobs: everything, or one status.
func (o *Operations) TranscriptionJobs(ctx context.Context, params json.RawMessage, _ int64) (any, error) {
	var req struct {
		Status string `json:"status"`
		Limit  int64  `json:"limit"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &req); err != nil {
			return nil, UserError("invalid request body")
		}
	}
	switch req.Status {
	case "", "queued", "done", "failed", "skipped":
	default:
		return nil, UserError("status must be queued, done, failed or skipped")
	}
	if req.Limit <= 0 || req.Limit > 500 {
		req.Limit = 100
	}
	rows, err := o.Queries.ListTranscriptionJobs(ctx, db.ListTranscriptionJobsParams{Status: req.Status, Limit: req.Limit})
	if err != nil {
		return nil, fmt.Errorf("list transcription jobs: %w", err)
	}
	out := make([]map[string]any, 0, len(rows))
	for _, r := range rows {
		out = append(out, map[string]any{
			"callId":          r.CallID,
			"status":          r.Status,
			"error":           r.Error.String,
			"model":           r.Model.String,
			"durationMs":      r.DurationMs.Int64,
			"createdAt":       r.CreatedAt,
			"finishedAt":      nullInt(r.FinishedAt),
			"callTime":        r.CallTime,
			"callDurationMs":  r.CallDurationMs,
			"systemLabel":     r.SystemLabel,
			"talkgroupNumber": nullInt(r.TalkgroupNumber),
			"talkgroupLabel":  r.TalkgroupLabel.String,
		})
	}
	return out, nil
}

// TranscriptionRetry hands calls to the transcriber again.
func (o *Operations) TranscriptionRetry(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var req struct {
		CallID  int64   `json:"callId"`
		CallIDs []int64 `json:"callIds"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		return nil, UserError("invalid request body")
	}
	ids := req.CallIDs
	if req.CallID != 0 {
		ids = append([]int64{req.CallID}, ids...)
	}
	if len(ids) == 0 {
		return nil, UserError("callId is required")
	}
	if len(ids) > 500 {
		return nil, UserError("retry at most 500 calls at once")
	}
	tr := o.Deps.TranscriberReload
	if tr == nil || !tr.Enabled() {
		return nil, UserError("transcription is off; turn it on first")
	}
	retried := 0
	for _, id := range ids {
		call, err := o.Queries.GetCall(ctx, id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				continue
			}
			return nil, fmt.Errorf("load call %d: %w", id, err)
		}
		if err := tr.Retry(ctx, id, filepath.Join(o.Deps.RecordingsDir, call.AudioPath)); err != nil {
			return nil, UserError(err.Error())
		}
		retried++
	}
	o.audit(ctx, fmt.Sprintf("%s retried by %s", pluralWord(retried, "transcription"), o.callerName(ctx, callerID)))
	return map[string]any{"ok": true, "retried": retried}, nil
}

// TranscriptionStats aggregates the transcription table, the job history
// and the live pool.
func (o *Operations) TranscriptionStats(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
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
	jobs, err := o.Queries.CountTranscriptionJobs(ctx, sql.NullInt64{Int64: since, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("count transcription jobs: %w", err)
	}
	calls24h, err := o.Queries.CountCallsSince(ctx, since)
	if err != nil {
		return nil, fmt.Errorf("count calls: %w", err)
	}

	queueDepth := 0
	poolEnabled := false
	if tr := o.Deps.TranscriberReload; tr != nil {
		poolEnabled = tr.Enabled()
		queueDepth = tr.QueueDepth()
	}

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
		langBreakdown = append(langBreakdown, map[string]any{"language": l.Lang, "count": l.Cnt})
	}
	modelBreakdown := make([]map[string]any, 0, len(byModel))
	for _, m := range byModel {
		modelBreakdown = append(modelBreakdown, map[string]any{"model": m.ModelName, "count": m.Cnt})
	}

	return map[string]any{
		"total":         stats.Total,
		"recent24h":     stats.RecentCount,
		"calls24h":      calls24h,
		"failed24h":     jobs.FailedRecent,
		"skipped24h":    jobs.SkippedRecent,
		"queued":        jobs.Queued,
		"avgDurationMs": toInt64(stats.AvgDurationMs),
		"minDurationMs": toInt64(stats.MinDurationMs),
		"maxDurationMs": toInt64(stats.MaxDurationMs),
		"queueDepth":    queueDepth,
		"poolEnabled":   poolEnabled,
		"byLanguage":    langBreakdown,
		"byModel":       modelBreakdown,
	}, nil
}

// ApplyTranscriptionMinDuration pushes the minimum call length setting
// into the live transcriber.
func ApplyTranscriptionMinDuration(ctx context.Context, q *db.Queries, tr TranscriberReloader) {
	s, err := q.GetSetting(ctx, "transcriptionMinDurationMs")
	if err != nil {
		tr.SetMinDurationMs(0)
		return
	}
	ms, _ := strconv.ParseInt(strings.TrimSpace(s.Value), 10, 64)
	tr.SetMinDurationMs(ms)
}

// PruneTranscriptionJobs drops finished job rows older than 30 days; the
// transcripts themselves live in their own table.
func PruneTranscriptionJobs(ctx context.Context, q *db.Queries) {
	before := time.Now().Add(-30 * 24 * time.Hour).Unix()
	n, err := q.DeleteTranscriptionJobsBefore(ctx, before)
	if err != nil {
		slog.Warn("transcription: failed to prune old jobs", "error", err)
		return
	}
	if n > 0 {
		slog.Info("transcription: pruned old jobs", "rows", n)
	}
}

// TranscriptionJobRecorder writes the job history for the transcriber.
type TranscriptionJobRecorder struct {
	Queries *db.Queries
	// Events, when set, tells open admin pages that the job list changed.
	Events interface{ BroadcastAdminEvent(topic string, data any) }
}

func (r TranscriptionJobRecorder) changed(callID int64, status string) {
	if r.Events != nil {
		r.Events.BroadcastAdminEvent("transcription.jobs.updated", map[string]any{"callId": callID, "status": status})
	}
}

// Queued records a call handed to the pool.
func (r TranscriptionJobRecorder) Queued(ctx context.Context, callID int64, model string) {
	if err := r.Queries.UpsertTranscriptionJob(ctx, db.UpsertTranscriptionJobParams{
		CallID: callID, Status: "queued", Model: optStr(model), CreatedAt: time.Now().Unix(),
	}); err != nil {
		slog.Warn("transcription: failed to record queued job", "call_id", callID, "error", err)
	}
	r.changed(callID, "queued")
}

// Skipped records a call the pool never saw, and why.
func (r TranscriptionJobRecorder) Skipped(ctx context.Context, callID int64, model, reason string) {
	if err := r.Queries.UpsertTranscriptionJob(ctx, db.UpsertTranscriptionJobParams{
		CallID: callID, Status: "skipped", Error: optStr(reason), Model: optStr(model), CreatedAt: time.Now().Unix(),
	}); err != nil {
		slog.Warn("transcription: failed to record skipped job", "call_id", callID, "error", err)
	}
	r.changed(callID, "skipped")
}

// Finished records how a pool job ended.
func (r TranscriptionJobRecorder) Finished(ctx context.Context, callID int64, durationMs int64, jobErr error) {
	status, msg := "done", ""
	if jobErr != nil {
		status, msg = "failed", plainJobError(jobErr)
	}
	if err := r.Queries.FinishTranscriptionJob(ctx, db.FinishTranscriptionJobParams{
		CallID: callID, Status: status, Error: optStr(msg),
		DurationMs: sql.NullInt64{Int64: durationMs, Valid: true},
		FinishedAt: sql.NullInt64{Int64: time.Now().Unix(), Valid: true},
	}); err != nil {
		slog.Warn("transcription: failed to record finished job", "call_id", callID, "error", err)
	}
	r.changed(callID, status)
}

// plainJobError shortens a worker error to something a table cell can hold.
func plainJobError(err error) string {
	s := err.Error()
	switch {
	case strings.Contains(s, "connection refused"):
		return "sidecar not reachable"
	case strings.Contains(s, "deadline exceeded") || strings.Contains(s, "Timeout"):
		return "sidecar timed out"
	case strings.Contains(s, "no such file"):
		return "audio file is missing"
	}
	if len(s) > 160 {
		s = s[:160] + "…"
	}
	return s
}

// optStr is a NullString that is NULL when the text is empty.
func optStr(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func pluralWord(n int, one string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %ss", n, one)
}
