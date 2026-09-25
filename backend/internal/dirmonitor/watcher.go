// Package dirmonitor uses fsnotify to watch directories for new audio files.
package dirmonitor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/dirmonitor/status"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/ws"
)

// DownstreamNotifier is the interface used to notify the downstream pusher.
type DownstreamNotifier interface {
	Notify(event downstream.CallEvent)
}

// Service manages all active DirMonitor watchers.
type Service struct {
	queries     *db.Queries
	processor   *audio.Processor
	hub         *ws.Hub
	dsNotifier  DownstreamNotifier
	transcriber audio.Transcriber // nil when transcription is disabled
	status      *status.Tracker
	mu          sync.Mutex
	reloadMu    sync.Mutex // serialises Reload calls to prevent duplicate goroutine spawning
	appCtx      context.Context
	cancel      context.CancelFunc
	wg          sync.WaitGroup
}

// NewService creates a DirMonitor service.
func NewService(queries *db.Queries, processor *audio.Processor, hub *ws.Hub, dsNotifier DownstreamNotifier, transcriber audio.Transcriber) *Service {
	return &Service{
		queries:     queries,
		processor:   processor,
		hub:         hub,
		dsNotifier:  dsNotifier,
		transcriber: transcriber,
		status:      status.New(),
	}
}

// Status reports what one monitor is doing, or false when it has never run.
func (s *Service) Status(id int64) (status.Snapshot, bool) {
	return s.status.Get(id)
}

// Forget drops a deleted monitor's status.
func (s *Service) Forget(id int64) {
	s.status.Forget(id)
}

// Start loads all active dirmonitor configs from the DB and starts a watcher
// goroutine for each one. The watchers run until ctx is cancelled or Reload
// is called.
func (s *Service) Start(ctx context.Context) {
	childCtx, cancel := context.WithCancel(ctx)

	s.mu.Lock()
	s.appCtx = ctx // remember the long-lived context for Reload
	s.cancel = cancel
	s.mu.Unlock()

	dirmonitors, err := s.queries.ListActiveDirMonitors(childCtx)
	if err != nil {
		slog.Error("dirmonitor: failed to load configs from DB", "error", err)
		cancel()
		return
	}

	slog.Debug("dirmonitor: starting watchers", "count", len(dirmonitors))

	for _, dw := range dirmonitors {
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.runDirMonitor(childCtx, dw)
		}()
	}
}

// Reload stops all running watchers and restarts them fresh from the DB.
// This should be called after admin CRUD changes to dirmonitor configs.
// Reload is serialised via reloadMu to prevent concurrent calls from spawning
// duplicate watcher goroutines. It reuses the application-lifetime context
// from the initial Start call rather than accepting a request-scoped context.
func (s *Service) Reload() {
	s.reloadMu.Lock()
	defer s.reloadMu.Unlock()

	s.mu.Lock()
	appCtx := s.appCtx
	s.mu.Unlock()

	if appCtx == nil {
		return
	}
	s.stop()
	s.Start(appCtx)
}

// stop cancels all running watcher goroutines and waits for them to exit.
func (s *Service) stop() {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	s.wg.Wait()
}

// runDirMonitor dispatches to the appropriate watch strategy for a single entry.
// It includes panic recovery so that a bad file or parser bug cannot kill the
// goroutine permanently.
func (s *Service) runDirMonitor(ctx context.Context, dw db.Dirmonitor) {
	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 4096)
			n := runtime.Stack(buf, false)
			slog.Error("dirmonitor: recovered from panic",
				"id", dw.ID,
				"panic", r,
				"stack", string(buf[:n]),
			)
		}
	}()

	slog.Info("dirmonitor: starting watcher",
		"id", dw.ID,
		"dir", dw.Directory,
		"type", dw.Type,
		"polling", dw.UsePolling == 1,
	)

	var err error
	if dw.UsePolling == 1 {
		slog.Debug("dirmonitor: using polling strategy", "id", dw.ID, "dir", dw.Directory)
		err = s.runWithPolling(ctx, dw)
	} else {
		slog.Debug("dirmonitor: using fsnotify strategy", "id", dw.ID, "dir", dw.Directory)
		err = s.runWithFsnotify(ctx, dw)
	}

	if err != nil {
		s.status.Stopped(dw.ID, err.Error())
		_ = s.queries.CreateLog(context.Background(), db.CreateLogParams{
			DateTime: time.Now().Unix(),
			Level:    "error",
			Message:  fmt.Sprintf("Folder monitor %s stopped: %s", dw.Directory, err.Error()),
		})
	} else {
		s.status.Stopped(dw.ID, "")
	}
	slog.Info("dirmonitor: watcher stopped", "id", dw.ID)
}

// minDebounceMs is the floor for fsnotify debounce to ensure complete file writes.
const minDebounceMs = 2000

// runWithFsnotify watches using kernel inotify/kqueue Create/Write events.
// A per-file debounce timer ensures we only process a file once its writer
// has finished — each new Create or Write resets the timer.
func (s *Service) runWithFsnotify(ctx context.Context, dw db.Dirmonitor) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		slog.Error("dirmonitor: failed to create fsnotify watcher", "id", dw.ID, "error", err)
		return fmt.Errorf("cannot watch for file changes on this system: %w", err)
	}
	defer watcher.Close()

	if err := watcher.Add(dw.Directory); err != nil {
		slog.Error("dirmonitor: failed to add directory to watcher",
			"id", dw.ID, "dir", dw.Directory, "error", err)
		return fmt.Errorf("cannot watch the folder: %w", err)
	}
	s.status.Running(dw.ID, status.Watching)

	delayMs := int64(minDebounceMs)
	if dw.Delay.Valid && dw.Delay.Int64 > delayMs {
		delayMs = dw.Delay.Int64
	}
	debounce := time.Duration(delayMs) * time.Millisecond

	timers := make(map[string]*time.Timer)
	var timersMu sync.Mutex

	// stopAllTimers cancels every pending debounce timer.
	stopAllTimers := func() {
		timersMu.Lock()
		defer timersMu.Unlock()
		for path, t := range timers {
			t.Stop()
			delete(timers, path)
		}
	}
	defer stopAllTimers()

	for {
		select {
		case <-ctx.Done():
			return nil
		case event, ok := <-watcher.Events:
			if !ok {
				return fmt.Errorf("the file watcher closed unexpectedly")
			}
			if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
				continue
			}
			path := event.Name

			timersMu.Lock()
			if t, exists := timers[path]; exists {
				t.Stop()
			}
			timers[path] = time.AfterFunc(debounce, func() {
				timersMu.Lock()
				delete(timers, path)
				timersMu.Unlock()
				s.handleFile(ctx, dw, path)
			})
			timersMu.Unlock()

		case err, ok := <-watcher.Errors:
			if !ok {
				return fmt.Errorf("the file watcher closed unexpectedly")
			}
			slog.Warn("dirmonitor: fsnotify error", "id", dw.ID, "error", err)
			s.status.Trouble(dw.ID, err.Error())
		}
	}
}

// minPollIntervalMs is the floor for the polling delay to prevent tight CPU loops.
const minPollIntervalMs = 500

// runWithPolling scans the directory on a regular ticker.
func (s *Service) runWithPolling(ctx context.Context, dw db.Dirmonitor) error {
	delayMs := int64(2000)
	if dw.Delay.Valid && dw.Delay.Int64 > 0 {
		delayMs = dw.Delay.Int64
	}
	// SECURITY: enforce a minimum polling interval to prevent tight CPU loops.
	if delayMs < minPollIntervalMs {
		slog.Warn("dirmonitor: poll delay below minimum, clamping",
			"id", dw.ID, "requested_ms", delayMs, "min_ms", minPollIntervalMs)
		delayMs = minPollIntervalMs
	}

	ticker := time.NewTicker(time.Duration(delayMs) * time.Millisecond)
	defer ticker.Stop()

	seen := make(map[string]bool)
	s.status.Running(dw.ID, status.Polling)
	trouble := false

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			entries, err := os.ReadDir(dw.Directory)
			if err != nil {
				slog.Warn("dirmonitor: failed to read directory",
					"id", dw.ID, "dir", dw.Directory, "error", err)
				if !trouble {
					trouble = true
					s.status.Trouble(dw.ID, "cannot read the folder: "+err.Error())
				}
				continue
			}
			if trouble {
				trouble = false
				s.status.Trouble(dw.ID, "")
			}
			for _, entry := range entries {
				if entry.IsDir() {
					continue
				}
				path := filepath.Join(dw.Directory, entry.Name())
				if seen[path] {
					continue
				}
				seen[path] = true
				s.handleFile(ctx, dw, path)
			}
			// Prune stale entries from the seen map to prevent unbounded memory
			// growth in long-running deployments (e.g. delete_after=1 leaves
			// entries for already-deleted files).
			current := make(map[string]bool, len(entries))
			for _, entry := range entries {
				if !entry.IsDir() {
					current[filepath.Join(dw.Directory, entry.Name())] = true
				}
			}
			for path := range seen {
				if !current[path] {
					delete(seen, path)
				}
			}
		}
	}
}

// handleFile applies security checks, the extension filter, and calls the
// appropriate parser before handing off to ingestCall.
func (s *Service) handleFile(ctx context.Context, dw db.Dirmonitor, filePath string) {
	// Security: resolve symlinks then reject paths that escape the watched directory.
	watchedReal, err := filepath.EvalSymlinks(filepath.Clean(dw.Directory))
	if err != nil {
		slog.Warn("dirmonitor: failed to resolve watched directory",
			"dir", dw.Directory, "error", err)
		return
	}
	fileReal, err := filepath.EvalSymlinks(filepath.Clean(filePath))
	if err != nil {
		slog.Warn("dirmonitor: failed to resolve file path, rejected",
			"file", filePath, "error", err)
		return
	}
	rel, err := filepath.Rel(watchedReal, fileReal)
	if err != nil || strings.HasPrefix(rel, "..") {
		slog.Warn("dirmonitor: file outside watched directory, rejected",
			"file", filePath, "dir", watchedReal)
		return
	}

	// Extension filter: only process files that match dw.Extension when set.
	if dw.Extension.Valid && dw.Extension.String != "" {
		want := strings.ToLower(dw.Extension.String)
		if !strings.HasPrefix(want, ".") {
			want = "." + want
		}
		got := strings.ToLower(filepath.Ext(filePath))
		if got != want {
			return
		}
	}

	parse := parserForType(dw.Type)
	slog.Debug("dirmonitor: processing file", "id", dw.ID, "file", filePath, "parser", dw.Type)
	parsed, err := parse(dw, fileReal)
	if err != nil {
		slog.Error("dirmonitor: parse error", "id", dw.ID, "file", filePath, "error", err)
		s.status.Seen(dw.ID, filePath, "could not be read: "+err.Error(), 0)
		return
	}
	if parsed == nil {
		// Parser signalled skip (e.g. audio not yet arrived for trunk-recorder sidecar).
		return
	}

	// Apply mask-based metadata extraction from filename. This fills in
	// zero-valued fields (e.g. TalkgroupID, SystemID) that the parser did
	// not extract but the mask can provide. Fields already set by the parser
	// or config overrides are never overwritten.
	maskNote := ""
	if dw.Mask.Valid && dw.Mask.String != "" {
		base := strings.TrimSuffix(filepath.Base(fileReal), filepath.Ext(fileReal))
		if values, ok := ParseMask(dw.Mask.String, base); ok {
			ApplyMaskValues(parsed, values)
			maskNote = ", mask matched"
		} else {
			slog.Debug("dirmonitor: mask did not match filename",
				"id", dw.ID, "mask", dw.Mask.String, "filename", base)
			maskNote = ", mask did not match"
		}
	}

	// Security: the parser may have picked companion files (the audio next to
	// a sidecar, or the sidecar next to audio) that were not the triggering
	// path. Each must resolve inside the watched directory too, or a symlink
	// dropped next to a sidecar could publish any readable file as a call.
	for _, p := range []string{parsed.AudioFilePath, parsed.SidecarPath} {
		if p == "" {
			continue
		}
		f, err := openWithinDir(dw.Directory, p)
		if err != nil {
			slog.Warn("dirmonitor: companion file outside watched directory, rejected",
				"id", dw.ID, "file", p, "error", err)
			s.status.Seen(dw.ID, filePath, "rejected: a companion file lies outside the folder", 0)
			return
		}
		_ = f.Close()
	}

	// File size validation: reject files smaller than a valid audio header
	// (44 bytes is the minimum WAV header size).
	const minAudioBytes = 44
	if fi, err := os.Stat(parsed.AudioFilePath); err != nil {
		slog.Warn("dirmonitor: cannot stat audio file", "id", dw.ID, "file", parsed.AudioFilePath, "error", err)
		s.status.Seen(dw.ID, filePath, "skipped: the audio file could not be read", 0)
		return
	} else if fi.Size() < minAudioBytes {
		slog.Info("dirmonitor: file too small, skipping",
			"id", dw.ID, "file", parsed.AudioFilePath, "size", fi.Size(), "min", minAudioBytes)
		s.status.Seen(dw.ID, filePath, "skipped: the audio file is too small to be a call", 0)
		return
	}

	// DateTime validation: reject calls with zero/missing timestamps.
	if parsed.DateTime.IsZero() {
		slog.Info("dirmonitor: missing or zero datetime, skipping",
			"id", dw.ID, "file", parsed.AudioFilePath)
		s.status.Seen(dw.ID, filePath, "skipped: no date and time could be found"+maskNote, 0)
		return
	}

	callID, err := s.ingestCall(ctx, dw, parsed)
	if err != nil {
		slog.Error("dirmonitor: ingest failed", "id", dw.ID, "file", filePath, "error", err)
		s.status.Seen(dw.ID, filePath, "failed: "+err.Error()+maskNote, 0)
		return
	}
	if callID == 0 {
		s.status.Seen(dw.ID, filePath, "skipped: duplicate or not accepted"+maskNote, 0)
		return
	}
	s.status.Seen(dw.ID, filePath, fmt.Sprintf("became call %d on system %d, talkgroup %d%s",
		callID, parsed.SystemID, parsed.TalkgroupID, maskNote), callID)
}

// ingestCall runs the full call ingest pipeline for a parsed file, mirroring
// the logic in api/calls.go but without an HTTP context.
func (s *Service) ingestCall(ctx context.Context, dw db.Dirmonitor, parsed *ParsedCall) (int64, error) {
	slog.Debug("dirmonitor: ingest pipeline start",
		"id", dw.ID,
		"system_id", parsed.SystemID,
		"system_label", parsed.SystemLabel,
		"talkgroup_id", parsed.TalkgroupID,
		"file", parsed.AudioFilePath,
	)
	// Helper to retrieve a setting value from the DB (returns "" on missing/error).
	getSetting := func(key string) string {
		v, err := s.queries.GetSetting(ctx, key)
		if err != nil {
			return ""
		}
		return v.Value
	}

	autoPopulateSystems := getSetting("autoPopulateSystems") == "true"

	// Validate required IDs before touching the DB.
	if parsed.SystemID == 0 && strings.TrimSpace(parsed.SystemLabel) == "" {
		return 0, fmt.Errorf("no system ID in parsed call for file %s", parsed.AudioFilePath)
	}
	if parsed.TalkgroupID == 0 {
		return 0, fmt.Errorf("no talkgroup ID in parsed call for file %s", parsed.AudioFilePath)
	}

	// ── Resolve system ──────────────────────────────────────────────────────
	var (
		system db.System
		err    error
	)

	if parsed.SystemID > 0 {
		system, err = s.queries.GetSystemBySystemID(ctx, parsed.SystemID)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("query system %d: %w", parsed.SystemID, err)
			}
			if !autoPopulateSystems {
				return 0, fmt.Errorf("system %d not found and autoPopulateSystems is disabled", parsed.SystemID)
			}
			label := strings.TrimSpace(parsed.SystemLabel)
			if label == "" {
				label = strconv.FormatInt(parsed.SystemID, 10)
			}
			newID, cerr := s.queries.CreateSystem(ctx, db.CreateSystemParams{
				SystemID:               parsed.SystemID,
				Label:                  label,
				AutoPopulateTalkgroups: 1,
			})
			if cerr != nil {
				return 0, fmt.Errorf("auto-create system %d: %w", parsed.SystemID, cerr)
			}
			slog.Info("dirmonitor: auto-populated system", "system_id", parsed.SystemID, "label", label, "db_id", newID)
			system = db.System{ID: newID, SystemID: parsed.SystemID, Label: label, AutoPopulateTalkgroups: 1}
			s.hub.BroadcastCFG(ctx)
		}
	} else {
		label := strings.TrimSpace(parsed.SystemLabel)
		system, err = s.queries.GetSystemByLabel(ctx, label)
		if err != nil {
			if !errors.Is(err, sql.ErrNoRows) {
				return 0, fmt.Errorf("query system label %q: %w", label, err)
			}
			if !autoPopulateSystems {
				return 0, fmt.Errorf("system %q not found and autoPopulateSystems is disabled", label)
			}

			systems, lerr := s.queries.ListSystems(ctx)
			if lerr != nil {
				return 0, fmt.Errorf("list systems for auto-create: %w", lerr)
			}
			nextSystemID := int64(1)
			for _, existing := range systems {
				if existing.SystemID >= nextSystemID {
					nextSystemID = existing.SystemID + 1
				}
			}

			newID, cerr := s.queries.CreateSystem(ctx, db.CreateSystemParams{
				SystemID:               nextSystemID,
				Label:                  label,
				AutoPopulateTalkgroups: 1,
			})
			if cerr != nil {
				return 0, fmt.Errorf("auto-create system %q: %w", label, cerr)
			}
			slog.Info("dirmonitor: auto-populated system from label", "system_label", label, "system_id", nextSystemID, "db_id", newID)
			system = db.System{ID: newID, SystemID: nextSystemID, Label: label, AutoPopulateTalkgroups: 1}
			s.hub.BroadcastCFG(ctx)
		}
		parsed.SystemID = system.SystemID
	}

	// ── Blacklist check ─────────────────────────────────────────────────────
	if isBlacklisted(system.BlacklistsJson, parsed.TalkgroupID) {
		slog.Info("dirmonitor: talkgroup is blacklisted, skipping",
			"system_id", system.SystemID, "talkgroup_id", parsed.TalkgroupID)
		return 0, nil
	}

	// ── Resolve talkgroup ───────────────────────────────────────────────────
	talkgroup, err := s.queries.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{
		SystemID:    system.ID,
		TalkgroupID: parsed.TalkgroupID,
	})
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return 0, fmt.Errorf("query talkgroup %d: %w", parsed.TalkgroupID, err)
		}
		if system.AutoPopulateTalkgroups == 0 {
			return 0, fmt.Errorf("talkgroup %d not found and auto-populate is disabled for this system", parsed.TalkgroupID)
		}
		var tgLabel, tgName sql.NullString
		if parsed.TalkgroupTitle != "" {
			tgLabel = sql.NullString{String: parsed.TalkgroupTitle, Valid: true}
		}
		if parsed.TalkgroupName != "" {
			tgName = sql.NullString{String: parsed.TalkgroupName, Valid: true}
		}
		var groupID sql.NullInt64
		if parsed.TalkgroupGroup != "" {
			groupID = resolveGroupID(ctx, s.queries, parsed.TalkgroupGroup)
		}
		var tagID sql.NullInt64
		if parsed.TalkgroupTag != "" {
			tagID = resolveTagID(ctx, s.queries, parsed.TalkgroupTag)
		}
		newID, cerr := s.queries.CreateTalkgroup(ctx, db.CreateTalkgroupParams{
			SystemID:    system.ID,
			TalkgroupID: parsed.TalkgroupID,
			Label:       tgLabel,
			Name:        tgName,
			GroupID:     groupID,
			TagID:       tagID,
		})
		if cerr != nil {
			return 0, fmt.Errorf("auto-create talkgroup %d: %w", parsed.TalkgroupID, cerr)
		}
		slog.Info("dirmonitor: auto-populated talkgroup",
			"system_id", system.SystemID, "talkgroup_id", parsed.TalkgroupID, "label", tgLabel.String, "db_id", newID)
		talkgroup = db.Talkgroup{ID: newID, SystemID: system.ID, TalkgroupID: parsed.TalkgroupID, Label: tgLabel, Name: tgName, GroupID: groupID, TagID: tagID}
		s.hub.BroadcastCFG(ctx)
	} else if needsBackfill(talkgroup, parsed) {
		// Existing talkgroup has empty fields — backfill from audio metadata.
		if !talkgroup.Label.Valid && parsed.TalkgroupTitle != "" {
			talkgroup.Label = sql.NullString{String: parsed.TalkgroupTitle, Valid: true}
		}
		if !talkgroup.Name.Valid && parsed.TalkgroupName != "" {
			talkgroup.Name = sql.NullString{String: parsed.TalkgroupName, Valid: true}
		}
		if !talkgroup.GroupID.Valid && parsed.TalkgroupGroup != "" {
			talkgroup.GroupID = resolveGroupID(ctx, s.queries, parsed.TalkgroupGroup)
		}
		if !talkgroup.TagID.Valid && parsed.TalkgroupTag != "" {
			talkgroup.TagID = resolveTagID(ctx, s.queries, parsed.TalkgroupTag)
		}
		if uerr := s.queries.UpdateTalkgroup(ctx, db.UpdateTalkgroupParams{
			ID:          talkgroup.ID,
			TalkgroupID: talkgroup.TalkgroupID,
			Label:       talkgroup.Label,
			Name:        talkgroup.Name,
			Frequency:   talkgroup.Frequency,
			Led:         talkgroup.Led,
			GroupID:     talkgroup.GroupID,
			TagID:       talkgroup.TagID,
			Order:       talkgroup.Order,
		}); uerr != nil {
			slog.Warn("dirmonitor: failed to backfill talkgroup from metadata",
				"talkgroup_id", talkgroup.TalkgroupID, "error", uerr)
		} else {
			slog.Info("dirmonitor: backfilled talkgroup from audio metadata",
				"talkgroup_id", talkgroup.TalkgroupID)
			s.hub.BroadcastCFG(ctx)
		}
	}

	// ── Duplicate detection ─────────────────────────────────────────────────
	if getSetting("disableDuplicateDetection") != "true" {
		windowMs := int64(2000)
		if v := getSetting("duplicateDetectionTimeFrame"); v != "" {
			if wm, err := strconv.ParseInt(v, 10, 64); err == nil {
				windowMs = wm
			}
		}
		dup, derr := audio.IsDuplicate(ctx, s.queries, system.ID, talkgroup.ID, parsed.DateTime, windowMs)
		if derr != nil {
			slog.Error("dirmonitor: duplicate detection error", "error", derr)
			// Non-fatal: proceed.
		} else if dup {
			slog.Info("dirmonitor: duplicate call rejected",
				"system_id", system.SystemID, "talkgroup_id", parsed.TalkgroupID)
			return 0, nil
		}
	}

	// ── Resolve conversion mode ─────────────────────────────────────────────
	convMode := audio.ConversionDisabled
	if mStr := getSetting("audioConversion"); mStr != "" {
		if m, err := strconv.Atoi(mStr); err == nil {
			convMode = audio.ConversionMode(m)
		}
	}

	// Resolve encoding preset from settings.
	convPreset := audio.ParseEncodingPreset(getSetting("audioEncodingPreset"))

	// ── Store audio ─────────────────────────────────────────────────────────────────────────
	audioFile, err := openWithinDir(dw.Directory, parsed.AudioFilePath)
	if err != nil {
		return 0, fmt.Errorf("open audio: %w", err)
	}
	defer audioFile.Close()
	relPath, err := s.processor.StoreReader(ctx, audioFile, filepath.Base(parsed.AudioFilePath), convMode, convPreset)
	if err != nil {
		return 0, fmt.Errorf("store audio: %w", err)
	}

	// Determine MIME type.  When conversion is enabled the output format
	// depends on the encoding preset (M4A for AAC, MP3 for MP3 presets).
	var audioType string
	if convMode != audio.ConversionDisabled {
		audioType = audio.OutputMIME(convPreset)
	} else {
		audioType = mimeFromExt(filepath.Ext(parsed.AudioFilePath))
	}

	// ── Build nullable fields ───────────────────────────────────────────────
	var freq sql.NullInt64
	if parsed.Frequency > 0 {
		freq = sql.NullInt64{Int64: parsed.Frequency, Valid: true}
	}
	var dur sql.NullInt64
	if parsed.Duration > 0 {
		dur = sql.NullInt64{Int64: parsed.Duration, Valid: true}
	} else {
		// Parser didn't supply a duration — probe the stored file.
		absPath := filepath.Join(s.processor.RecordingsDir(), relPath)
		if d := audio.ProbeDuration(ctx, absPath); d > 0 {
			dur = sql.NullInt64{Int64: d, Valid: true}
		}
	}
	var src sql.NullInt64
	if parsed.Source > 0 {
		src = sql.NullInt64{Int64: parsed.Source, Valid: true}
	}
	var srcJSON, freqJSON, patchJSON sql.NullString
	if parsed.SourcesJSON != "" {
		srcJSON = sql.NullString{String: parsed.SourcesJSON, Valid: true}
	}
	if parsed.FreqsJSON != "" {
		freqJSON = sql.NullString{String: parsed.FreqsJSON, Valid: true}
	}
	if parsed.PatchesJSON != "" {
		patchJSON = sql.NullString{String: parsed.PatchesJSON, Valid: true}
	}

	dateTimeUnix := parsed.DateTime.Unix()

	// ── Optional string metadata ──────────────────────────────────────────
	var siteCol, channelCol, decoderCol sql.NullString
	if parsed.Site != "" {
		siteCol = sql.NullString{String: parsed.Site, Valid: true}
	}
	if parsed.Channel != "" {
		channelCol = sql.NullString{String: parsed.Channel, Valid: true}
	}
	if parsed.Decoder != "" {
		decoderCol = sql.NullString{String: parsed.Decoder, Valid: true}
	}

	// ── Insert call record ──────────────────────────────────────────────────
	callID, err := s.queries.CreateCall(ctx, db.CreateCallParams{
		AudioPath:       relPath,
		AudioName:       filepath.Base(relPath),
		AudioType:       audioType,
		DateTime:        dateTimeUnix,
		Frequency:       freq,
		Duration:        dur,
		Source:          src,
		SourcesJson:     srcJSON,
		FrequenciesJson: freqJSON,
		PatchesJson:     patchJSON,
		SystemID:        system.ID,
		TalkgroupID:     sql.NullInt64{Int64: talkgroup.ID, Valid: true},
		Site:            siteCol,
		Channel:         channelCol,
		Decoder:         decoderCol,
	})
	if err != nil {
		return 0, fmt.Errorf("insert call record: %w", err)
	}

	slog.Debug("dirmonitor: call record inserted", "call_id", callID, "audio_path", relPath)

	slog.Info("dirmonitor: call ingested",
		"id", callID,
		"system_id", system.SystemID,
		"talkgroup_id", talkgroup.TalkgroupID,
	)

	// Extract unit tags from sources JSON and upsert into units table.
	if srcJSON.Valid {
		upsertUnitsFromSources(ctx, s.queries, system.ID, srcJSON.String)
	}

	// ── Broadcast to WebSocket listeners ────────────────────────────────────
	if s.hub != nil {
		calPayload := map[string]any{
			"id":          callID,
			"audioName":   filepath.Base(relPath),
			"audioType":   audioType,
			"dateTime":    dateTimeUnix,
			"systemId":    system.SystemID,
			"system":      system.ID,
			"talkgroupId": talkgroup.TalkgroupID,
			"talkgroup":   talkgroup.ID,
		}
		if freq.Valid {
			calPayload["frequency"] = freq.Int64
		}
		if dur.Valid {
			calPayload["duration"] = dur.Int64
		}
		if src.Valid {
			calPayload["source"] = src.Int64
		}
		if siteCol.Valid {
			calPayload["site"] = siteCol.String
		}
		if channelCol.Valid {
			calPayload["channel"] = channelCol.String
		}
		if decoderCol.Valid {
			calPayload["decoder"] = decoderCol.String
		}
		if srcJSON.Valid {
			calPayload["sources"] = srcJSON.String
		}
		if freqJSON.Valid {
			calPayload["frequencies"] = freqJSON.String
		}

		calMsg, err := ws.NewCALMessage(calPayload)
		if err != nil {
			slog.Error("dirmonitor: failed to build CAL message", "error", err)
		} else {
			_ = calMsg
			s.hub.BroadcastCAL(calPayload, func(cl *ws.Client) bool {
				return cl.CanReceive(system.ID, talkgroup.ID)
			})
		}
	}

	// ── Notify downstream pushers ──────────────────────────────────────────
	if s.dsNotifier != nil {
		// Resolve labels for downstream consumers.
		var groupLabel, tagLabel string
		if talkgroup.GroupID.Valid {
			if g, err := s.queries.GetGroup(ctx, talkgroup.GroupID.Int64); err == nil {
				groupLabel = g.Label
			}
		}
		if talkgroup.TagID.Valid {
			if t, err := s.queries.GetTag(ctx, talkgroup.TagID.Int64); err == nil {
				tagLabel = t.Label
			}
		}

		s.dsNotifier.Notify(downstream.CallEvent{
			CallID:         callID,
			AudioPath:      relPath,
			AudioName:      filepath.Base(relPath),
			AudioType:      audioType,
			DateTime:       dateTimeUnix,
			SystemID:       system.SystemID,
			System:         system.ID,
			TalkgroupID:    talkgroup.TalkgroupID,
			Talkgroup:      talkgroup.ID,
			Frequency:      freq.Int64,
			Duration:       dur.Int64,
			Source:         src.Int64,
			Sources:        srcJSON.String,
			Frequencies:    freqJSON.String,
			Patches:        patchJSON.String,
			SystemLabel:    system.Label,
			TalkgroupLabel: talkgroup.Label.String,
			TalkgroupName:  talkgroup.Name.String,
			TalkgroupGroup: groupLabel,
			TalkgroupTag:   tagLabel,
		})
	}

	// ── Enqueue transcription ───────────────────────────────────────────────
	if s.transcriber != nil {
		absPath := filepath.Join(s.processor.RecordingsDir(), relPath)
		if err := s.transcriber.Submit(ctx, audio.TranscriptionJob{
			CallID:     callID,
			AudioPath:  absPath,
			DurationMs: dur.Int64,
		}); err != nil {
			slog.Warn("dirmonitor: failed to enqueue transcription", "call_id", callID, "error", err)
		}
	}

	// ── Delete source file if configured ────────────────────────────────────
	if dw.DeleteAfter == 1 {
		// Open the watched directory as an os.Root so both deletes are
		// structurally confined to it. This is defence-in-depth on top of
		// the existing symlink-resolve + Rel checks and narrows the path
		// for static taint analysis.
		root, rootErr := os.OpenRoot(filepath.Clean(dw.Directory))
		if rootErr != nil {
			slog.Warn("dirmonitor: failed to open watched directory root",
				"dir", dw.Directory, "error", rootErr)
			return callID, nil
		}
		defer root.Close()

		watchedReal, _ := filepath.EvalSymlinks(filepath.Clean(dw.Directory))

		removeWithinRoot := func(absPath, label string) {
			realPath, _ := filepath.EvalSymlinks(filepath.Clean(absPath))
			rel, err := filepath.Rel(watchedReal, realPath)
			if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
				slog.Warn("dirmonitor: refusing to delete "+label+" outside watched directory",
					"file", absPath, "dir", dw.Directory)
				return
			}
			if err := root.Remove(rel); err != nil && !os.IsNotExist(err) {
				slog.Warn("dirmonitor: failed to delete "+label,
					"file", rel, "error", err)
			}
		}

		removeWithinRoot(parsed.AudioFilePath, "source file")
		if parsed.SidecarPath != "" {
			removeWithinRoot(parsed.SidecarPath, "sidecar file")
		}
	}

	return callID, nil
}

// mimeFromExt maps a file extension (including leading dot) to an audio MIME type.
func mimeFromExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	case ".opus":
		return "audio/opus"
	default:
		return "application/octet-stream"
	}
}

// isBlacklisted checks whether a talkgroup ID appears in the system's blacklist.
// The blacklist is stored as a JSON array of integers in the blacklists_json column.
// Returns false if the column is NULL, empty, or unparseable.
func isBlacklisted(blacklistsJSON sql.NullString, talkgroupID int64) bool {
	if !blacklistsJSON.Valid || strings.TrimSpace(blacklistsJSON.String) == "" {
		return false
	}
	var ids []int64
	if err := json.Unmarshal([]byte(blacklistsJSON.String), &ids); err != nil {
		slog.Warn("dirmonitor: failed to parse blacklists_json", "error", err)
		return false
	}
	for _, id := range ids {
		if id == talkgroupID {
			return true
		}
	}
	return false
}

// resolveGroupID looks up an existing group by label or creates one if it
// doesn't exist. Returns a valid sql.NullInt64 with the group's DB ID, or
// an invalid NullInt64 if the operation fails.
func resolveGroupID(ctx context.Context, q *db.Queries, label string) sql.NullInt64 {
	g, err := q.GetGroupByLabel(ctx, label)
	if err == nil {
		return sql.NullInt64{Int64: g.ID, Valid: true}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		slog.Warn("dirmonitor: failed to look up group by label", "label", label, "error", err)
		return sql.NullInt64{}
	}
	newID, cerr := q.CreateGroup(ctx, label)
	if cerr != nil {
		slog.Warn("dirmonitor: failed to auto-create group", "label", label, "error", cerr)
		return sql.NullInt64{}
	}
	slog.Info("dirmonitor: auto-populated group", "label", label, "db_id", newID)
	return sql.NullInt64{Int64: newID, Valid: true}
}

// resolveTagID looks up an existing tag by label or creates one if it
// doesn't exist. Returns a valid sql.NullInt64 with the tag's DB ID, or
// an invalid NullInt64 if the operation fails.
func resolveTagID(ctx context.Context, q *db.Queries, label string) sql.NullInt64 {
	t, err := q.GetTagByLabel(ctx, label)
	if err == nil {
		return sql.NullInt64{Int64: t.ID, Valid: true}
	}
	if !errors.Is(err, sql.ErrNoRows) {
		slog.Warn("dirmonitor: failed to look up tag by label", "label", label, "error", err)
		return sql.NullInt64{}
	}
	newID, cerr := q.CreateTag(ctx, label)
	if cerr != nil {
		slog.Warn("dirmonitor: failed to auto-create tag", "label", label, "error", cerr)
		return sql.NullInt64{}
	}
	slog.Info("dirmonitor: auto-populated tag", "label", label, "db_id", newID)
	return sql.NullInt64{Int64: newID, Valid: true}
}

// needsBackfill returns true if at least one talkgroup field is empty and a
// corresponding value was provided in the parsed metadata.
func needsBackfill(tg db.Talkgroup, parsed *ParsedCall) bool {
	if !tg.Label.Valid && parsed.TalkgroupTitle != "" {
		return true
	}
	if !tg.Name.Valid && parsed.TalkgroupName != "" {
		return true
	}
	if !tg.TagID.Valid && parsed.TalkgroupTag != "" {
		return true
	}
	if !tg.GroupID.Valid && parsed.TalkgroupGroup != "" {
		return true
	}
	return false
}

// upsertUnitsFromSources parses the sources JSON array and upserts any units
// that include a "tag" (label) into the units table.
// Sources format: [{"pos":0,"src":12345,"tag":"Unit Name"}, ...]
func upsertUnitsFromSources(ctx context.Context, q *db.Queries, systemDBID int64, raw string) {
	var sources []map[string]any
	if err := json.Unmarshal([]byte(raw), &sources); err != nil {
		return
	}
	for _, entry := range sources {
		srcVal, ok := entry["src"]
		if !ok {
			continue
		}
		srcFloat, ok := srcVal.(float64)
		if !ok || srcFloat <= 0 {
			continue
		}
		tagVal, ok := entry["tag"]
		if !ok {
			continue
		}
		tag, ok := tagVal.(string)
		if !ok || tag == "" {
			continue
		}
		if err := q.UpsertUnit(ctx, db.UpsertUnitParams{
			SystemID: systemDBID,
			UnitID:   int64(srcFloat),
			Label:    sql.NullString{String: tag, Valid: true},
		}); err != nil {
			slog.Warn("dirmonitor: failed to upsert unit from sources",
				"unit_id", int64(srcFloat), "tag", tag, "error", err)
		}
	}
}

// openWithinDir opens path for reading only if it is a regular file that
// resolves inside dir. Symlinks are resolved first and the resolved path is
// opened through os.Root, so a file swapped for an escaping symlink after
// the check is still refused.
func openWithinDir(dir, path string) (*os.File, error) {
	base, err := filepath.EvalSymlinks(filepath.Clean(dir))
	if err != nil {
		return nil, err
	}
	real, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	rel, err := filepath.Rel(base, real)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, fmt.Errorf("%s resolves outside %s", path, dir)
	}
	root, err := os.OpenRoot(base)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	f, err := root.Open(rel)
	if err != nil {
		return nil, err
	}
	if fi, err := f.Stat(); err != nil || !fi.Mode().IsRegular() {
		_ = f.Close()
		return nil, fmt.Errorf("%s is not a regular file", path)
	}
	return f, nil
}
