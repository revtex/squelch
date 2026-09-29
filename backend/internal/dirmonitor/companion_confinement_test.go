package dirmonitor

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

// trIngestFixture returns a trunk-recorder dirmonitor service over a fresh
// watch directory, plus a directory outside it.
func trIngestFixture(t *testing.T) (*Service, *db.Queries, db.Dirmonitor, string, string) {
	t.Helper()
	_, queries := newWatcherTestDB(t)
	ctx := context.Background()
	for _, kv := range [][2]string{
		{"autoPopulateSystems", "true"},
		{"audioConversion", "0"},
		{"disableDuplicateDetection", "true"},
	} {
		if err := queries.UpsertSetting(ctx, db.UpsertSettingParams{Key: kv[0], Value: kv[1]}); err != nil {
			t.Fatal(err)
		}
	}
	processor, _ := newWatcherProcessor(t)
	watchDir := t.TempDir()
	outside := t.TempDir()
	svc := &Service{queries: queries, processor: processor}
	dw := db.Dirmonitor{ID: 1, Directory: watchDir, Type: "trunk-recorder"}
	return svc, queries, dw, watchDir, outside
}

func callCount(t *testing.T, q *db.Queries) int64 {
	t.Helper()
	n, err := q.CountCalls(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// A sidecar whose audio sibling is a symlink out of the watched directory
// must not publish the link target as a call.
func TestHandleFile_EscapingAudioSiblingRejected(t *testing.T) {
	svc, q, dw, watchDir, outside := trIngestFixture(t)
	jsonPath, audioPath := writeTRWatcherFiles(t, watchDir)
	secret := filepath.Join(outside, "secret.bin")
	if err := os.WriteFile(secret, fakeAudioData(), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(audioPath)
	if err := os.Symlink(secret, audioPath); err != nil {
		t.Skipf("symlinks not supported: %v", err)
	}

	svc.handleFile(context.Background(), dw, jsonPath)
	if n := callCount(t, q); n != 0 {
		t.Errorf("escaping audio sibling ingested (%d calls)", n)
	}
}

// Audio whose sidecar is a symlink out of the watched directory is refused.
func TestHandleFile_EscapingSidecarRejected(t *testing.T) {
	svc, q, dw, watchDir, outside := trIngestFixture(t)
	jsonPath, audioPath := writeTRWatcherFiles(t, watchDir)
	moved := filepath.Join(outside, "call.json")
	if err := os.Rename(jsonPath, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(moved, jsonPath); err != nil {
		t.Skipf("symlinks not supported: %v", err)
	}

	svc.handleFile(context.Background(), dw, audioPath)
	if n := callCount(t, q); n != 0 {
		t.Errorf("call ingested through an escaping sidecar (%d calls)", n)
	}
}

// Symlinks that stay inside the watched directory keep working.
func TestHandleFile_InDirectorySymlinkSiblingAccepted(t *testing.T) {
	svc, q, dw, watchDir, _ := trIngestFixture(t)
	jsonPath, audioPath := writeTRWatcherFiles(t, watchDir)
	sub := filepath.Join(watchDir, "store")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(sub, "audio.mp3")
	if err := os.Rename(audioPath, real); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(real, audioPath); err != nil {
		t.Skipf("symlinks not supported: %v", err)
	}

	svc.handleFile(context.Background(), dw, jsonPath)
	if n := callCount(t, q); n != 1 {
		t.Errorf("in-directory symlink sibling: %d calls, want 1", n)
	}
}
