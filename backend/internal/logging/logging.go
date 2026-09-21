// Package logging provides structured logging with an in-memory ring buffer
// and optional log file. All slog output is captured so the admin UI can
// display live logs without hitting the database.
package logging

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

// LogEntry is a single captured log line, kept in the ring buffer and
// returned by the admin logs API.
type LogEntry struct {
	Time    time.Time         `json:"time"`
	Level   string            `json:"level"`
	Message string            `json:"msg"`
	Attrs   map[string]string `json:"attrs,omitempty"`
}

// ringBuffer is a fixed-size circular buffer of log entries.
type ringBuffer struct {
	mu   sync.RWMutex
	buf  []LogEntry
	pos  int  // next write position
	full bool // true once we've wrapped
	cap  int
	seq  uint64 // monotonic counter for stable ordering
}

const defaultRingSize = 10_000

func newRingBuffer(size int) *ringBuffer {
	return &ringBuffer{buf: make([]LogEntry, size), cap: size}
}

func (r *ringBuffer) push(e LogEntry) {
	r.mu.Lock()
	r.buf[r.pos] = e
	r.pos = (r.pos + 1) % r.cap
	if r.pos == 0 {
		r.full = true
	}
	r.seq++
	r.mu.Unlock()
}

// snapshot returns all entries in chronological order.
func (r *ringBuffer) snapshot() []LogEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var n int
	if r.full {
		n = r.cap
	} else {
		n = r.pos
	}
	out := make([]LogEntry, n)
	if r.full {
		copy(out, r.buf[r.pos:])
		copy(out[r.cap-r.pos:], r.buf[:r.pos])
	} else {
		copy(out, r.buf[:r.pos])
	}
	return out
}

// ── Global state ──

var (
	levelVar slog.LevelVar
	ring     = newRingBuffer(defaultRingSize)
	logFile  *os.File
	logMu    sync.Mutex
)

// ParseLevel converts a human-readable level string to slog.Level.
func ParseLevel(raw string) (slog.Level, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug, true
	case "info":
		return slog.LevelInfo, true
	case "warn", "warning":
		return slog.LevelWarn, true
	case "error":
		return slog.LevelError, true
	default:
		return slog.LevelInfo, false
	}
}

// LevelString converts slog.Level to a lowercase string.
func LevelString(l slog.Level) string {
	switch {
	case l >= slog.LevelError:
		return "error"
	case l >= slog.LevelWarn:
		return "warn"
	case l >= slog.LevelInfo:
		return "info"
	default:
		return "debug"
	}
}

// Configure sets up slog with a tee handler that writes to stdout (text or
// JSON depending on mode) AND captures every log line into the ring buffer.
// If logFilePath is non-empty, logs are also appended to that file.
func Configure(development bool, logFilePath string) {
	logMu.Lock()
	defer logMu.Unlock()

	if development {
		levelVar.Set(slog.LevelDebug)
	} else {
		levelVar.Set(slog.LevelInfo)
	}

	opts := &slog.HandlerOptions{Level: &levelVar}

	var consoleHandler slog.Handler
	if development {
		consoleHandler = slog.NewTextHandler(os.Stdout, opts)
	} else {
		consoleHandler = slog.NewJSONHandler(os.Stdout, opts)
	}

	// Open log file if requested.
	if logFilePath != "" {
		f, err := os.OpenFile(logFilePath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
		if err != nil {
			// Fall back — log to stderr and continue without file.
			fmt.Fprintf(os.Stderr, "logging: failed to open log file %s: %v\n", logFilePath, err)
		} else {
			logFile = f
		}
	}

	handler := &teeHandler{
		console: consoleHandler,
		ring:    ring,
		file:    logFile,
		opts:    opts,
	}
	slog.SetDefault(slog.New(handler))
}

// SetLevel changes the runtime minimum log level.
func SetLevel(raw string) error {
	level, ok := ParseLevel(raw)
	if !ok {
		return fmt.Errorf("invalid log level: %s", raw)
	}
	levelVar.Set(level)
	return nil
}

// GetLevel returns the current runtime log level as a lowercase string.
func GetLevel() string {
	return LevelString(levelVar.Level())
}

// QueryEntries returns log entries from the ring buffer, filtered by the
// given parameters. All filtering is done in-memory (fast, no DB).
// Entries are scanned newest-first so that the most recent `limit` matching
// entries are always returned, then reversed to restore chronological order
// before returning. This ensures recent debug logs are never hidden behind
// a page of older entries when the buffer exceeds the limit.
func QueryEntries(level string, from, to int64, query string, limit int) []LogEntry {
	all := ring.snapshot()
	level = strings.ToLower(strings.TrimSpace(level))
	query = strings.ToLower(strings.TrimSpace(query))

	// Scan newest-first so we always capture the tail of the buffer.
	result := make([]LogEntry, 0, min(len(all), limit))
	for i := len(all) - 1; i >= 0; i-- {
		e := all[i]
		if from > 0 && e.Time.Unix() < from {
			continue
		}
		if to > 0 && e.Time.Unix() > to {
			continue
		}
		if level != "" && e.Level != level {
			continue
		}
		if query != "" {
			msg := strings.ToLower(e.Message)
			attrs := ""
			for _, v := range e.Attrs {
				attrs += " " + strings.ToLower(v)
			}
			if !strings.Contains(msg+attrs, query) {
				continue
			}
		}
		result = append(result, e)
		if len(result) >= limit {
			break
		}
	}

	// Reverse to restore chronological (oldest-first) order for the UI.
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result
}

// LoadHistoricalLogs reads the log file and prepopulates the ring buffer
// so that the admin UI shows entries from before the current process started.
func LoadHistoricalLogs(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 256*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		entry, ok := parseJSONLogLine(line)
		if !ok {
			continue
		}
		ring.push(entry)
	}
}

func parseJSONLogLine(line []byte) (LogEntry, bool) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		return LogEntry{}, false
	}

	var e LogEntry

	if t, ok := raw["time"]; ok {
		var ts string
		if json.Unmarshal(t, &ts) == nil {
			if parsed, err := time.Parse(time.RFC3339Nano, ts); err == nil {
				e.Time = parsed
			}
		}
	}
	if e.Time.IsZero() {
		return LogEntry{}, false
	}

	if l, ok := raw["level"]; ok {
		var ls string
		if json.Unmarshal(l, &ls) == nil {
			e.Level = strings.ToLower(ls)
		}
	}

	if m, ok := raw["msg"]; ok {
		var ms string
		if json.Unmarshal(m, &ms) == nil {
			e.Message = ms
		}
	}

	e.Attrs = make(map[string]string)
	for k, v := range raw {
		if k == "time" || k == "level" || k == "msg" {
			continue
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			e.Attrs[k] = s
		} else {
			// Numbers, bools, etc — use raw JSON.
			e.Attrs[k] = string(v)
		}
	}
	if len(e.Attrs) == 0 {
		e.Attrs = nil
	}

	return e, true
}

// CloseLogFile closes the log file if open.
func CloseLogFile() {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile != nil {
		logFile.Close()
		logFile = nil
	}
}

// ── teeHandler: slog.Handler that writes to console + ring buffer + file ──

type teeHandler struct {
	console slog.Handler
	ring    *ringBuffer
	file    *os.File
	opts    *slog.HandlerOptions
	groups  []string
	attrs   []slog.Attr
}

func (h *teeHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.console.Enabled(ctx, level)
}

func (h *teeHandler) Handle(ctx context.Context, r slog.Record) error {
	// 1. Write to console.
	_ = h.console.Handle(ctx, r)

	// 2. Build LogEntry for the ring buffer.
	entry := LogEntry{
		Time:    r.Time,
		Level:   LevelString(r.Level),
		Message: r.Message,
	}

	attrs := make(map[string]string)
	// Include handler-level attrs.
	for _, a := range h.attrs {
		attrs[a.Key] = fmt.Sprintf("%v", a.Value.Any())
	}
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = fmt.Sprintf("%v", a.Value.Any())
		return true
	})
	if len(attrs) > 0 {
		entry.Attrs = attrs
	}

	h.ring.push(entry)

	// 3. Write JSON line to log file.
	if h.file != nil {
		data, err := json.Marshal(map[string]any{
			"time":  r.Time.Format(time.RFC3339Nano),
			"level": LevelString(r.Level),
			"msg":   r.Message,
		})
		if err == nil {
			// Append attrs inline.
			if len(attrs) > 0 {
				attrsJSON, _ := json.Marshal(attrs)
				// Merge: strip outer {} from both and combine.
				base := string(data[:len(data)-1])
				extra := string(attrsJSON[1:])
				data = []byte(base + "," + extra)
			}
			data = append(data, '\n')
			_, _ = h.file.Write(data)
		}
	}

	return nil
}

func (h *teeHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &teeHandler{
		console: h.console.WithAttrs(attrs),
		ring:    h.ring,
		file:    h.file,
		opts:    h.opts,
		groups:  h.groups,
		attrs:   append(h.attrs, attrs...),
	}
}

func (h *teeHandler) WithGroup(name string) slog.Handler {
	return &teeHandler{
		console: h.console.WithGroup(name),
		ring:    h.ring,
		file:    h.file,
		opts:    h.opts,
		groups:  append(h.groups, name),
		attrs:   h.attrs,
	}
}

// Implement the context-aware interface properly.
var _ io.Writer = (*teeHandler)(nil)

func (h *teeHandler) Write(p []byte) (n int, err error) {
	return len(p), nil // satisfy interface — actual writing is in Handle
}
