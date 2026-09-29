package db_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

// The database file and its WAL companions must be owner-only, both when
// created fresh and when an existing install left them world-readable.
func TestOpen_DatabaseFilesAreOwnerOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permissions only")
	}
	for _, preexisting := range []bool{false, true} {
		path := filepath.Join(t.TempDir(), "squelch.db")
		if preexisting {
			if err := os.WriteFile(path, nil, 0o644); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, 0o644); err != nil {
				t.Fatal(err)
			}
		}
		sqlDB, err := db.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := sqlDB.Exec(`INSERT INTO settings (key, value) VALUES ('probe', 'x')`); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{path, path + "-wal", path + "-shm"} {
			info, err := os.Stat(name)
			if err != nil {
				continue
			}
			if perm := info.Mode().Perm(); perm&0o077 != 0 {
				t.Errorf("preexisting=%v: %s mode = %v, want owner-only", preexisting, filepath.Base(name), perm)
			}
		}
		_ = sqlDB.Close()
	}
}
