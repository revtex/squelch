package admin

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
)

// Admin transcription calls share the hardened outbound client: a redirect
// from the configured go-whisper URL is not followed to another target.
func TestTranscriptionModels_DoesNotFollowRedirects(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"secret":"internal-only"}`))
	}))
	defer internal.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL+"/metadata", http.StatusFound)
	}))
	defer redirector.Close()

	o, q := newTestOperations(t, "")
	if err := q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "transcriptionUrl", Value: redirector.URL}); err != nil {
		t.Fatal(err)
	}
	got, err := o.TranscriptionModels(context.Background(), nil, 1)
	if err == nil {
		t.Fatalf("redirect was followed; returned %s", got)
	}
}

// whisperStub answers like go-whisper: a model list with a Server header,
// and a streamed model download that reports progress before it is done.
func whisperStub(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/whisper/model", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Server", "go-whisper/0.9.2")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","models":[{"id":"ggml-base.en","object":"model","path":"ggml-base.en.bin","created":1},{"id":"ggml-small.en-tdrz","object":"model","path":"x","created":2}]}`))
	})
	mux.HandleFunc("POST /api/whisper/model", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ Model string }
		_ = json.NewDecoder(r.Body).Decode(&body)
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("download did not ask for a progress stream")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		_, _ = fmt.Fprint(w, "event: progress\ndata: {\"current\": 10, \"total\": 100, \"percent\": 10}\n\n")
		fl.Flush()
		_, _ = fmt.Fprintf(w, "event: done\ndata: {\"id\":%q,\"object\":\"model\"}\n\n", body.Model)
	})
	return httptest.NewServer(mux)
}

func TestTranscriptionTest_ReportsVersionModelsAndAudits(t *testing.T) {
	srv := whisperStub(t)
	defer srv.Close()
	o, _ := newTestOperations(t, "")

	res, err := o.TranscriptionTest(context.Background(), params(t, map[string]any{"url": srv.URL + "/"}), 1)
	if err != nil {
		t.Fatal(err)
	}
	got := res.(map[string]any)
	if got["ok"] != true || got["version"] != "0.9.2" || got["models"] != 2 {
		t.Errorf("test = %v", got)
	}
	if msg := lastLogMessage(t, o); !strings.Contains(msg, "tested by user #1: ok (") || !strings.Contains(msg, "2 models, go-whisper 0.9.2)") {
		t.Errorf("audit = %q", msg)
	}

	// A dead address fails in words, not a Go error string.
	res, err = o.TranscriptionTest(context.Background(), params(t, map[string]any{"url": "http://127.0.0.1:1"}), 1)
	if err != nil {
		t.Fatal(err)
	}
	got = res.(map[string]any)
	if got["ok"] != false || got["error"] != "nothing is listening at that address" {
		t.Errorf("dead test = %v", got)
	}
}

func TestTranscriptionDownload_StreamsProgressThenDone(t *testing.T) {
	srv := whisperStub(t)
	defer srv.Close()
	o, q := newTestOperations(t, "")
	sink := &recordingSink{}
	o.Events = sink
	if err := q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "transcriptionUrl", Value: srv.URL}); err != nil {
		t.Fatal(err)
	}

	res, err := o.TranscriptionDownload(context.Background(), params(t, map[string]any{"model": "ggml-small.en-tdrz"}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["started"] != true {
		t.Fatalf("download = %v", res)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !sink.sawTopic("transcription.download.done") && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if !sink.sawTopic("transcription.download.progress") || !sink.sawTopic("transcription.download.done") {
		t.Errorf("events = %v", sink.topics)
	}
	if len(downloadsSnapshot()) != 0 {
		t.Errorf("download still listed after it finished: %v", downloadsSnapshot())
	}
	models, err := o.TranscriptionModels(context.Background(), nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := models.(map[string]any)["models"].([]whisperModel); len(got) != 2 || got[0].ID != "ggml-base.en" {
		t.Errorf("models = %+v", got)
	}

	// The model in use cannot be deleted while transcription is on.
	for k, v := range map[string]string{"transcriptionModel": "ggml-base.en", "transcriptionEnabled": "true"} {
		_ = q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: k, Value: v})
	}
	if _, err := o.TranscriptionDelete(context.Background(), params(t, map[string]any{"id": "ggml-base.en"}), 1); err == nil || !strings.Contains(err.Error(), "in use") {
		t.Errorf("delete of the active model: %v", err)
	}
}

// fakeTranscriber stands in for the live pool.
type fakeTranscriber struct {
	enabled bool
	minMs   int64
	retried []string
}

func (f *fakeTranscriber) Reload(bool, string, string, string, bool) bool { return true }
func (f *fakeTranscriber) Enabled() bool                                  { return f.enabled }
func (f *fakeTranscriber) BaseURL() string                                { return "" }
func (f *fakeTranscriber) Model() string                                  { return "ggml-base" }
func (f *fakeTranscriber) QueueDepth() int                                { return 0 }
func (f *fakeTranscriber) Workers() int                                   { return 2 }
func (f *fakeTranscriber) MinDurationMs() int64                           { return f.minMs }
func (f *fakeTranscriber) SetMinDurationMs(ms int64)                      { f.minMs = ms }
func (f *fakeTranscriber) Retry(_ context.Context, _ int64, path string) error {
	f.retried = append(f.retried, path)
	return nil
}

func TestTranscriptionJobs_HistoryStatsAndRetry(t *testing.T) {
	o, q := newTestOperations(t, "")
	fake := &fakeTranscriber{enabled: false}
	o.Deps.TranscriberReload = fake
	o.Deps.RecordingsDir = "/rec"
	sysID := createSystem(t, o, 1, "Lake")
	tgID := createTalkgroup(t, o, sysID, 101, "LC FD Disp")
	now := time.Now().Unix()
	call := func(name string, dur int64) int64 {
		id, err := q.CreateCall(context.Background(), db.CreateCallParams{
			AudioPath: "x/" + name, AudioName: name, AudioType: "audio/mp4", DateTime: now,
			Duration: sql.NullInt64{Int64: dur, Valid: true}, SystemID: sysID, TalkgroupID: sql.NullInt64{Int64: tgID, Valid: true},
		})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	a, b, c := call("a.m4a", 6000), call("b.m4a", 900), call("c.m4a", 4000)

	rec := TranscriptionJobRecorder{Queries: q}
	rec.Queued(context.Background(), a, "ggml-base")
	rec.Finished(context.Background(), a, 1800, nil)
	rec.Skipped(context.Background(), b, "ggml-base", "shorter than 1.0 s")
	rec.Queued(context.Background(), c, "ggml-base")
	rec.Finished(context.Background(), c, 30000, fmt.Errorf("go-whisper request: context deadline exceeded"))

	res, err := o.TranscriptionJobs(context.Background(), params(t, map[string]any{"status": "failed"}), 1)
	if err != nil {
		t.Fatal(err)
	}
	failed := res.([]map[string]any)
	if len(failed) != 1 || failed[0]["callId"] != c || failed[0]["error"] != "sidecar timed out" || failed[0]["talkgroupLabel"] != "LC FD Disp" || failed[0]["systemLabel"] != "Lake" {
		t.Errorf("failed jobs = %v", failed)
	}
	res, err = o.TranscriptionJobs(context.Background(), nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if all := res.([]map[string]any); len(all) != 3 {
		t.Errorf("all jobs = %d", len(all))
	}

	stats, err := o.TranscriptionStats(context.Background(), nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	st := stats.(map[string]any)
	if st["failed24h"] != int64(1) || st["skipped24h"] != int64(1) || st["calls24h"] != int64(3) || st["queued"] != int64(0) {
		t.Errorf("stats = %v", st)
	}

	// Retry needs transcription on; then it hands the file to the pool.
	if _, err := o.TranscriptionRetry(context.Background(), params(t, map[string]any{"callId": c}), 1); err == nil || !strings.Contains(err.Error(), "off") {
		t.Errorf("retry while off: %v", err)
	}
	fake.enabled = true
	res, err = o.TranscriptionRetry(context.Background(), params(t, map[string]any{"callIds": []int64{c, 99999}}), 1)
	if err != nil {
		t.Fatal(err)
	}
	if res.(map[string]any)["retried"] != 1 || len(fake.retried) != 1 || fake.retried[0] != "/rec/x/c.m4a" {
		t.Errorf("retry = %v, paths %v", res, fake.retried)
	}
	if msg := lastLogMessage(t, o); !strings.HasSuffix(msg, "1 transcription retried by user #1") {
		t.Errorf("audit = %q", msg)
	}

	// The minimum length setting reaches the pool and is range-checked.
	if _, err := o.ConfigUpdate(context.Background(), params(t, map[string]any{"settings": []map[string]string{{"key": "transcriptionMinDurationMs", "value": "1500"}}}), 1); err != nil {
		t.Fatal(err)
	}
	if fake.minMs != 1500 {
		t.Errorf("min duration not applied: %d", fake.minMs)
	}
	if _, err := o.ConfigUpdate(context.Background(), params(t, map[string]any{"settings": []map[string]string{{"key": "transcriptionMinDurationMs", "value": "999999"}}}), 1); err == nil {
		t.Error("out-of-range minimum was accepted")
	}
}

func TestTranscriptionJobRecorder_AnnouncesEachChange(t *testing.T) {
	o, q := newTestOperations(t, "")
	sink := &recordingSink{}
	sysID := createSystem(t, o, 1, "Lake")
	tgID := createTalkgroup(t, o, sysID, 101, "Disp")
	callID, err := q.CreateCall(context.Background(), db.CreateCallParams{
		AudioPath: "x/r.m4a", AudioName: "r.m4a", AudioType: "audio/mp4",
		DateTime: time.Now().Unix(), Duration: sql.NullInt64{Int64: 4000, Valid: true},
		SystemID: sysID, TalkgroupID: sql.NullInt64{Int64: tgID, Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	rec := TranscriptionJobRecorder{Queries: q, Events: sink}
	rec.Queued(context.Background(), callID, "ggml-base")
	rec.Finished(context.Background(), callID, 300, nil)
	if got := len(sink.topics); got != 2 {
		t.Fatalf("expected 2 events, got %d: %v", got, sink.topics)
	}
	if !sink.sawTopic("transcription.jobs.updated") {
		t.Fatalf("expected transcription.jobs.updated, got %v", sink.topics)
	}
	job, err := q.GetTranscriptionJob(context.Background(), callID)
	if err != nil || job.Status != "done" {
		t.Fatalf("job = %+v, err = %v", job, err)
	}
}

// TestParseModelList_BothShapes: deployed go-whisper answers with a bare
// array, its API doc with an object; anything else is not a model list.
func TestParseModelList_BothShapes(t *testing.T) {
	bare := `[{"id":"ggml-large-v3-turbo","object":"model","path":"ggml-large-v3-turbo.bin","created":1776783926,"owned_by":"whisper"}]`
	if got, ok := parseModelList([]byte(bare)); !ok || len(got) != 1 || got[0].ID != "ggml-large-v3-turbo" {
		t.Errorf("bare array = %+v, %v", got, ok)
	}
	wrapped := `{"object":"list","models":[{"id":"ggml-base.en"}]}`
	if got, ok := parseModelList([]byte(wrapped)); !ok || len(got) != 1 || got[0].ID != "ggml-base.en" {
		t.Errorf("wrapped = %+v, %v", got, ok)
	}
	for _, empty := range []string{`[]`, `{"object":"list","models":[]}`} {
		if got, ok := parseModelList([]byte(empty)); !ok || got == nil || len(got) != 0 {
			t.Errorf("%s = %+v, %v", empty, got, ok)
		}
	}
	for _, bad := range []string{`{"error":"nope"}`, `<html>`, `"text"`, `{}`} {
		if _, ok := parseModelList([]byte(bad)); ok {
			t.Errorf("%s parsed as a model list", bad)
		}
	}
}

// TestTranscriptionModels_BareArrayAndReadableError: the op works against a
// sidecar that answers with a bare array, and a failure reaches the admin as
// a UserError that names the reason.
func TestTranscriptionModels_BareArrayAndReadableError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"ggml-large-v3-turbo","object":"model","path":"ggml-large-v3-turbo.bin"}]`))
	}))
	defer srv.Close()
	o, q := newTestOperations(t, "")
	_ = q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "transcriptionUrl", Value: srv.URL})
	res, err := o.TranscriptionModels(context.Background(), nil, 1)
	if err != nil {
		t.Fatal(err)
	}
	if got := res.(map[string]any)["models"].([]whisperModel); len(got) != 1 || got[0].ID != "ggml-large-v3-turbo" {
		t.Errorf("models = %+v", got)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html>`))
	}))
	defer bad.Close()
	_ = q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "transcriptionUrl", Value: bad.URL})
	_, err = o.TranscriptionModels(context.Background(), nil, 1)
	var ue UserError
	if !errors.As(err, &ue) || !strings.Contains(err.Error(), "not a go-whisper model list") {
		t.Errorf("err = %#v", err)
	}
}
