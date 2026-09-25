package dirmonitor

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

// fakeAudioData returns a byte slice large enough to pass the minimum audio
// file size validation (44 bytes — the minimum WAV header size).
func fakeAudioData() []byte {
	data := make([]byte, 64)
	copy(data, []byte("ID3"))
	return data
}

// ── DB helper ─────────────────────────────────────────────────────────────────

// newWatcherTestDB opens an in-memory SQLite database with all migrations applied.
func newWatcherTestDB(t *testing.T) (*sql.DB, *db.Queries) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return sqlDB, db.New(sqlDB)
}

// newWatcherProcessor creates an audio.Processor backed by t.TempDir() with
// audio conversion disabled (no FFmpeg dependency in tests).
func newWatcherProcessor(t *testing.T) (*audio.Processor, string) {
	t.Helper()
	tmpDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	pool := audio.NewWorkerPool(ctx)
	return audio.NewProcessor(tmpDir, pool), tmpDir
}

// ── Service lifecycle ─────────────────────────────────────────────────────────

func TestNewService_ReturnsNonNil(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	svc := NewService(queries, processor, nil, nil, nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
}

func TestService_Start_NoDirMonitors_NoPanic(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc := NewService(queries, processor, nil, nil, nil)
	// Fresh DB has no active dirmonitors → no goroutines should be spawned.
	svc.Start(ctx)

	// stop() should return immediately since no goroutines are running.
	svc.stop()
}

func TestService_Reload_NoPanic(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc := NewService(queries, processor, nil, nil, nil)
	svc.Start(ctx)

	// Reload should stop existing watchers and restart from DB — no panic even
	// when there are no active dirmonitors.
	svc.Reload()
	svc.stop()
}

func TestService_StopBeforeStart_NoPanic(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	svc := NewService(queries, processor, nil, nil, nil)
	// Calling stop() before Start() should be a no-op.
	svc.stop()
}

func TestService_MultipleReloads_NoPanic(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	svc := NewService(queries, processor, nil, nil, nil)
	svc.Start(ctx)

	for i := 0; i < 3; i++ {
		svc.Reload()
	}
	svc.stop()
}

// ── handleFile — security and filtering ───────────────────────────────────────

// buildSvcNilDB builds a Service with nil queries/processor/hub. This is safe
// only in tests where handleFile is expected to return before reaching any DB
// or processor code (path traversal or extension filter rejection).
func buildSvcNilDB() *Service {
	return &Service{}
}

func TestHandleFile_PathTraversal_Rejected(t *testing.T) {
	watchDir := t.TempDir()
	otherDir := t.TempDir()

	// Write the file in a directory that is NOT under watchDir.
	evilPath := filepath.Join(otherDir, "evil.mp3")
	os.WriteFile(evilPath, fakeAudioData(), 0644) //nolint:errcheck

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
	}

	// Service has nil queries/processor; if it reaches ingestCall it will panic.
	svc := buildSvcNilDB()
	// Should silently return — no panic.
	svc.handleFile(context.Background(), dw, evilPath)
}

func TestHandleFile_PathTraversal_DotDot_Rejected(t *testing.T) {
	watchDir := t.TempDir()

	// Construct a path that after filepath.Clean escapes watchDir.
	crafted := filepath.Join(watchDir, "..", "outside.mp3")

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
	}

	svc := buildSvcNilDB()
	svc.handleFile(context.Background(), dw, crafted)
}

func TestHandleFile_ExtensionFilter_WrongExtension_Skipped(t *testing.T) {
	watchDir := t.TempDir()

	mp3Path := filepath.Join(watchDir, "call.mp3")
	os.WriteFile(mp3Path, fakeAudioData(), 0644) //nolint:errcheck

	// DirMonitor only accepts .wav files.
	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
		Extension: sql.NullString{String: "wav", Valid: true},
	}

	svc := buildSvcNilDB()
	// .mp3 does not match .wav → file skipped, no panic.
	svc.handleFile(context.Background(), dw, mp3Path)
}

func TestHandleFile_ExtensionFilter_LeadingDot_Accepted(t *testing.T) {
	watchDir := t.TempDir()

	// trunk-recorder with only the audio file (no sidecar) — parser returns
	// nil because the .json sidecar is missing, so ingestCall is never called.
	// This lets us verify the extension filter passes without hitting the DB.
	wavPath := filepath.Join(watchDir, "call.wav")
	os.WriteFile(wavPath, []byte("RIFF"), 0644) //nolint:errcheck

	// Extension stored with a leading dot — should still match.
	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "trunk-recorder",
		Extension: sql.NullString{String: ".wav", Valid: true},
	}

	svc := buildSvcNilDB()
	// .wav matches; trunk-recorder parser returns nil (no sidecar) → ingestCall skipped.
	svc.handleFile(context.Background(), dw, wavPath)
}

func TestHandleFile_NoExtensionFilter_AllFilesProcessed(t *testing.T) {
	watchDir := t.TempDir()

	// A non-audio file — generic parser will return nil, nil → ingestCall never called.
	txtPath := filepath.Join(watchDir, "info.txt")
	os.WriteFile(txtPath, []byte("text"), 0644) //nolint:errcheck

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
		// Extension not set → no filter.
	}

	svc := buildSvcNilDB()
	// Parser returns nil for .txt → ingestCall skipped → no panic with nil queries.
	svc.handleFile(context.Background(), dw, txtPath)
}

func TestHandleFile_ParserReturnsNil_IngestNotCalled(t *testing.T) {
	watchDir := t.TempDir()

	// Non-audio file — all parsers return nil, nil for unknown extensions.
	xmlPath := filepath.Join(watchDir, "meta.xml")
	os.WriteFile(xmlPath, []byte("<x/>"), 0644) //nolint:errcheck

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
	}

	svc := buildSvcNilDB()
	// parseGeneric returns nil for non-audio → ingestCall never called → no panic.
	svc.handleFile(context.Background(), dw, xmlPath)
}

// ── handleFile integration — trunk-recorder full ingest ───────────────────────

// writeTRWatcherFiles creates a trunk-recorder JSON + audio file pair.
func writeTRWatcherFiles(t *testing.T, dir string) (jsonPath, audioPath string) {
	t.Helper()

	sidecar := map[string]any{
		"start_time":         int64(1700000000),
		"stop_time":          int64(1700000020),
		"call_length":        float64(20),
		"freq":               int64(851025000),
		"talkgroup":          int64(12345),
		"sys_num":            int64(1),
		"unit":               int64(5432),
		"srcList":            json.RawMessage(`[]`),
		"freqList":           json.RawMessage(`[]`),
		"patched_talkgroups": json.RawMessage(`[]`),
	}
	data, err := json.Marshal(sidecar)
	if err != nil {
		t.Fatalf("marshal sidecar: %v", err)
	}

	jsonPath = filepath.Join(dir, "call_1700000000.json")
	audioPath = filepath.Join(dir, "call_1700000000.mp3")

	if err := os.WriteFile(jsonPath, data, 0644); err != nil {
		t.Fatalf("write json: %v", err)
	}
	if err := os.WriteFile(audioPath, fakeAudioData(), 0644); err != nil {
		t.Fatalf("write audio: %v", err)
	}
	return jsonPath, audioPath
}

// TestHandleFile_Integration_TrunkRecorder tests the full ingest pipeline:
// trunk-recorder JSON + audio → handleFile → call inserted in DB.
func TestHandleFile_Integration_TrunkRecorder(t *testing.T) {
	ctx := context.Background()
	_, queries := newWatcherTestDB(t)

	// Configure settings: enable autoPopulateSystems, disable FFmpeg conversion,
	// and disable duplicate detection so we don't need to worry about timing.
	for _, kv := range [][2]string{
		{"autoPopulateSystems", "true"},
		{"audioConversion", "0"},
		{"disableDuplicateDetection", "true"},
	} {
		if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: kv[0], Value: kv[1]}); err != nil {
			t.Fatalf("UpsertSetting %q: %v", kv[0], err)
		}
	}

	processor, _ := newWatcherProcessor(t)

	watchDir := t.TempDir()
	_, audioPath := writeTRWatcherFiles(t, watchDir)

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "trunk-recorder",
	}

	svc := &Service{
		queries:   queries,
		processor: processor,
		hub:       nil, // nil hub is handled gracefully in ingestCall
	}

	// Before: no calls in DB.
	beforeCount, err := queries.CountCalls(ctx)
	if err != nil {
		t.Fatalf("CountCalls before: %v", err)
	}
	if beforeCount != 0 {
		t.Fatalf("expected 0 calls before ingest, got %d", beforeCount)
	}

	svc.handleFile(ctx, dw, audioPath)

	// After: exactly one call should be in the DB.
	afterCount, err := queries.CountCalls(ctx)
	if err != nil {
		t.Fatalf("CountCalls after: %v", err)
	}
	if afterCount != 1 {
		t.Errorf("expected 1 call after ingest, got %d", afterCount)
	}
}

// TestHandleFile_Integration_NoSystemID_Fails verifies that ingestCall
// rejects a parsed call with SystemID == 0 (and autoPopulateSystems=false).
func TestHandleFile_Integration_MissingSystemID_Rejected(t *testing.T) {
	ctx := context.Background()
	_, queries := newWatcherTestDB(t)

	// autoPopulateSystems disabled — system/talkgroup must exist.
	if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: "autoPopulateSystems", Value: "false"}); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}
	if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: "audioConversion", Value: "0"}); err != nil {
		t.Fatalf("UpsertSetting: %v", err)
	}

	processor, _ := newWatcherProcessor(t)

	watchDir := t.TempDir()

	// Write a sidecar with sys_num=0 and talkgroup=0 — both zero means SystemID=0.
	sidecar := map[string]any{
		"start_time": int64(1700000000), "call_length": float64(5),
		"freq": int64(851025000), "talkgroup": int64(0), "sys_num": int64(0), "unit": int64(0),
		"srcList": json.RawMessage(`[]`), "freqList": json.RawMessage(`[]`), "patched_talkgroups": json.RawMessage(`[]`),
	}
	data, _ := json.Marshal(sidecar)
	jsonPath := filepath.Join(watchDir, "zero_ids.json")
	audioPath := filepath.Join(watchDir, "zero_ids.mp3")
	os.WriteFile(jsonPath, data, 0644)             //nolint:errcheck
	os.WriteFile(audioPath, fakeAudioData(), 0644) //nolint:errcheck

	dw := db.Dirmonitor{ID: 1, Directory: watchDir, Type: "trunk-recorder"}
	svc := &Service{queries: queries, processor: processor, hub: nil}

	// handleFile should call ingestCall, which returns an error for SystemID=0.
	// The error is logged but handleFile does not propagate it — so no panic.
	svc.handleFile(ctx, dw, audioPath)

	// No call should have been inserted.
	count, _ := queries.CountCalls(ctx)
	if count != 0 {
		t.Errorf("expected 0 calls, got %d", count)
	}
}

// TestIngestCall_SDRTrunk_SystemLabelResolvesSystem verifies rdio-scanner-style
// SDRTrunk behavior where System:<label> metadata can resolve the system when
// numeric system ID is not present in the parsed call.
func TestIngestCall_SDRTrunk_SystemLabelResolvesSystem(t *testing.T) {
	ctx := context.Background()
	_, queries := newWatcherTestDB(t)

	for _, kv := range [][2]string{
		{"autoPopulateSystems", "true"},
		{"audioConversion", "0"},
		{"disableDuplicateDetection", "true"},
	} {
		if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: kv[0], Value: kv[1]}); err != nil {
			t.Fatalf("UpsertSetting %q: %v", kv[0], err)
		}
	}

	// Existing system (as commonly configured from UI) is identified by label.
	const systemLabel = "Ohio MARCS-IP - Lake County"
	systemDBID, err := queries.CreateSystem(ctx, db.CreateSystemParams{
		SystemID:     1,
		Label:        systemLabel,
		AutoPopulateTalkgroups: 1,
	})
	if err != nil {
		t.Fatalf("CreateSystem: %v", err)
	}

	processor, _ := newWatcherProcessor(t)
	watchDir := t.TempDir()
	audioPath := filepath.Join(watchDir, "sdrtrunk_call.mp3")
	if err := os.WriteFile(audioPath, fakeAudioData(), 0644); err != nil {
		t.Fatalf("write audio: %v", err)
	}

	svc := &Service{queries: queries, processor: processor, hub: nil}

	_, err = svc.ingestCall(ctx, db.Dirmonitor{ID: 2, Directory: watchDir, Type: "sdr-trunk"}, &ParsedCall{
		AudioFilePath: audioPath,
		DateTime:      time.Unix(1700000000, 0).UTC(),
		SystemID:      0,
		SystemLabel:   systemLabel,
		TalkgroupID:   27503,
		Frequency:     855787500,
	})
	if err != nil {
		t.Fatalf("ingestCall: %v", err)
	}

	count, err := queries.CountCalls(ctx)
	if err != nil {
		t.Fatalf("CountCalls: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 call, got %d", count)
	}

	talkgroups, err := queries.ListTalkgroupsBySystem(ctx, systemDBID)
	if err != nil {
		t.Fatalf("ListTalkgroupsBySystem: %v", err)
	}
	if len(talkgroups) != 1 || talkgroups[0].TalkgroupID != 27503 {
		t.Fatalf("expected talkgroup 27503 to be auto-populated on resolved system")
	}
}

// TestHandleFile_Integration_AutoPopulate verifies that systems and talkgroups
// are auto-created when autoPopulateSystems=true.
func TestHandleFile_Integration_AutoPopulate(t *testing.T) {
	ctx := context.Background()
	_, queries := newWatcherTestDB(t)

	for _, kv := range [][2]string{
		{"autoPopulateSystems", "true"},
		{"audioConversion", "0"},
		{"disableDuplicateDetection", "true"},
	} {
		if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: kv[0], Value: kv[1]}); err != nil {
			t.Fatalf("UpsertSetting %q: %v", kv[0], err)
		}
	}

	processor, _ := newWatcherProcessor(t)
	watchDir := t.TempDir()

	// Write two calls for different talkgroups in the same system.
	for i, tg := range []int64{1001, 1002} {
		sidecar := map[string]any{
			"start_time": int64(1700000000 + int64(i)*100), "call_length": float64(10),
			"freq": int64(851025000), "talkgroup": tg, "sys_num": int64(1), "unit": int64(1),
			"srcList": json.RawMessage(`[]`), "freqList": json.RawMessage(`[]`), "patched_talkgroups": json.RawMessage(`[]`),
		}
		data, _ := json.Marshal(sidecar)

		// Use simple sequential names to avoid collision.
		var jsonPath, audioPath string
		if i == 0 {
			jsonPath = filepath.Join(watchDir, "callA.json")
			audioPath = filepath.Join(watchDir, "callA.mp3")
		} else {
			jsonPath = filepath.Join(watchDir, "callB.json")
			audioPath = filepath.Join(watchDir, "callB.mp3")
		}

		os.WriteFile(jsonPath, data, 0644)             //nolint:errcheck
		os.WriteFile(audioPath, fakeAudioData(), 0644) //nolint:errcheck

		dw := db.Dirmonitor{ID: int64(i + 1), Directory: watchDir, Type: "trunk-recorder"}
		svc := &Service{queries: queries, processor: processor, hub: nil}
		svc.handleFile(ctx, dw, audioPath)
	}

	count, err := queries.CountCalls(ctx)
	if err != nil {
		t.Fatalf("CountCalls: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 calls after ingesting 2 files, got %d", count)
	}
}

// ── mimeFromExt ───────────────────────────────────────────────────────────────

func TestMimeFromExt(t *testing.T) {
	cases := []struct {
		ext  string
		want string
	}{
		{".mp3", "audio/mpeg"},
		{".MP3", "audio/mpeg"},
		{".wav", "audio/wav"},
		{".m4a", "audio/mp4"},
		{".aac", "audio/aac"},
		{".ogg", "audio/ogg"},
		{".flac", "audio/flac"},
		{".opus", "audio/opus"},
		{".xyz", "application/octet-stream"},
		{"", "application/octet-stream"},
	}

	for _, tc := range cases {
		t.Run(tc.ext, func(t *testing.T) {
			got := mimeFromExt(tc.ext)
			if got != tc.want {
				t.Errorf("mimeFromExt(%q) = %q, want %q", tc.ext, got, tc.want)
			}
		})
	}
}

// ── Symlink path-traversal ────────────────────────────────────────────────────

func TestHandleFile_Symlink_Escaping_Rejected(t *testing.T) {
	watchDir := t.TempDir()
	secretDir := t.TempDir()

	// Create a real file outside the watch directory.
	secretFile := filepath.Join(secretDir, "secret.mp3")
	os.WriteFile(secretFile, fakeAudioData(), 0644) //nolint:errcheck

	// Create a symlink inside watchDir pointing to the secret file.
	linkPath := filepath.Join(watchDir, "evil.mp3")
	if err := os.Symlink(secretFile, linkPath); err != nil {
		t.Skipf("symlinks not supported: %v", err)
	}

	dw := db.Dirmonitor{
		ID:        1,
		Directory: watchDir,
		Type:      "generic",
	}

	svc := buildSvcNilDB()
	// Should reject because the resolved path escapes watchDir.
	svc.handleFile(context.Background(), dw, linkPath)
	// If we get here without panic, the file was correctly rejected.
}

// ── Reload uses app context, not request context ──────────────────────────────

func TestService_Reload_UsesAppContext(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	appCtx, appCancel := context.WithCancel(context.Background())
	defer appCancel()

	svc := NewService(queries, processor, nil, nil, nil)
	svc.Start(appCtx)

	// Reload no longer accepts a context; it reuses the app context from Start.
	svc.Reload()

	// Verify the service stored appCtx — the watchers should still be alive
	// (not cancelled). We can check by verifying appCtx is not done.
	svc.mu.Lock()
	storedCtx := svc.appCtx
	svc.mu.Unlock()

	if storedCtx == nil {
		t.Fatal("appCtx is nil after Reload")
	}
	select {
	case <-storedCtx.Done():
		t.Error("appCtx is cancelled after Reload — watchers would be dead")
	default:
		// Good — context is still alive.
	}

	svc.stop()
}

func TestService_Reload_BeforeStart_NoPanic(t *testing.T) {
	_, queries := newWatcherTestDB(t)
	processor, _ := newWatcherProcessor(t)

	svc := NewService(queries, processor, nil, nil, nil)
	// Reload before Start — appCtx is nil, should be a no-op.
	svc.Reload()
}
