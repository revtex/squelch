package admin

import (
	"context"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// storageTTL is how long a recordings measurement is trusted before the
// next request kicks off a fresh one.
const storageTTL = 10 * time.Minute

// StorageInfo is what the Settings page shows next to the prune setting:
// how much the recordings take, how big the volume they sit on is, and how
// far back the calls go.
type StorageInfo struct {
	// RecordingsBytes and RecordingFiles come from a walk of the recordings
	// folder; MeasuredAt is zero until the first walk has finished.
	RecordingsBytes int64 `json:"recordingsBytes"`
	RecordingFiles  int64 `json:"recordingFiles"`
	MeasuredAt      int64 `json:"measuredAt"`
	// VolumeTotalBytes and VolumeFreeBytes describe the filesystem that
	// holds the recordings; zero when the platform cannot say.
	VolumeTotalBytes uint64 `json:"volumeTotalBytes"`
	VolumeFreeBytes  uint64 `json:"volumeFreeBytes"`
	// DatabaseBytes is the SQLite file with its write-ahead log.
	DatabaseBytes int64 `json:"databaseBytes"`
	// OldestCall is the earliest call's time, or nil with no calls.
	OldestCall *int64 `json:"oldestCall"`
}

// storageCache remembers the last recordings walk so a Settings page load
// never blocks on it; the walk runs in the background when the figure is
// older than storageTTL.
type storageCache struct {
	mu        sync.Mutex
	bytes     int64
	files     int64
	measured  time.Time
	measuring bool
	// done is closed when the walk in progress finishes.
	done chan struct{}
}

// firstWalkWait is how long the very first request waits for the walk, so a
// small recordings folder shows its size at once rather than "measuring".
const firstWalkWait = 1500 * time.Millisecond

// Storage returns the current storage figures. The recordings walk is
// served from cache and refreshed in the background; the volume, database
// and oldest-call figures are read on every call because they are cheap.
func (o *Operations) Storage(ctx context.Context) StorageInfo {
	var info StorageInfo
	dir := o.Deps.RecordingsDir
	if dir != "" {
		info.RecordingsBytes, info.RecordingFiles, info.MeasuredAt = o.storage.recordings(dir)
		info.VolumeTotalBytes, info.VolumeFreeBytes = volumeSpace(dir)
	}
	if o.Deps.DBFile != "" {
		info.DatabaseBytes = fileSize(o.Deps.DBFile) + fileSize(o.Deps.DBFile+"-wal")
	}
	if oldest, err := o.Queries.OldestCallTime(ctx); err == nil && oldest > 0 {
		info.OldestCall = &oldest
	}
	return info
}

// recordings returns the cached measurement of dir, starting a new walk
// when the cached one is stale or missing.
func (c *storageCache) recordings(dir string) (bytes, files, measuredAt int64) {
	c.mu.Lock()
	if !c.measuring && time.Since(c.measured) > storageTTL {
		c.measuring = true
		c.done = make(chan struct{})
		go c.measure(dir, c.done)
	}
	first, done := c.measured.IsZero(), c.done
	c.mu.Unlock()

	if first && done != nil {
		select {
		case <-done:
		case <-time.After(firstWalkWait):
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.measured.IsZero() {
		return 0, 0, 0
	}
	return c.bytes, c.files, c.measured.Unix()
}

func (c *storageCache) measure(dir string, done chan struct{}) {
	defer close(done)
	var bytes, files int64
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // a file that vanished mid-walk is not worth stopping for
		}
		if d.Type().IsRegular() {
			if fi, err := d.Info(); err == nil {
				bytes += fi.Size()
				files++
			}
		}
		return nil
	})
	if err != nil {
		slog.Warn("storage: recordings walk failed", "dir", dir, "error", err)
	}
	c.mu.Lock()
	c.bytes, c.files, c.measured, c.measuring = bytes, files, time.Now(), false
	c.mu.Unlock()
}

func fileSize(path string) int64 {
	fi, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return fi.Size()
}
