package db

import (
	"database/sql"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/revtex/squelch/migrations"
	_ "modernc.org/sqlite" // register "sqlite" driver
)

// Open opens (or creates) the SQLite database at path, enables WAL mode and
// foreign keys, applies any pending embedded migrations, and returns the
// *sql.DB ready for use.
func Open(path string) (*sql.DB, error) {
	if err := restrictFileModes(path); err != nil {
		return nil, err
	}
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", path, err)
	}

	if err := sqlDB.Ping(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("ping sqlite %q: %w", path, err)
	}

	if err := applyMigrations(sqlDB); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("apply migrations: %w", err)
	}

	return sqlDB, nil
}

// restrictFileModes makes the database owner-only before it is opened. The
// database holds secrets (the JWT signing key when no encryption key is set,
// password hashes), so it must not inherit a world-readable umask default.
// SQLite gives the -wal and -shm files the main file's mode when it creates
// them; existing ones are tightened here too.
func restrictFileModes(path string) error {
	if runtime.GOOS == "windows" || path == "" || path == ":memory:" || strings.HasPrefix(path, "file:") {
		return nil
	}
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return fmt.Errorf("open sqlite %q: %w", path, err)
	}
	_ = f.Close()
	for _, name := range []string{path, path + "-wal", path + "-shm"} {
		info, err := os.Stat(name)
		if err != nil {
			continue
		}
		if mode := info.Mode().Perm(); mode&0o077 != 0 {
			if err := os.Chmod(name, mode&^0o077); err != nil {
				return fmt.Errorf("restrict permissions on %q: %w", name, err)
			}
			slog.Info("db: restricted file permissions to owner only", "file", name, "was", mode.String())
		}
	}
	return nil
}

// applyMigrations creates the schema_migrations tracking table if needed and
// applies any unapplied migration files from the embedded FS in order.
func applyMigrations(db *sql.DB) error {
	const createTracking = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT    PRIMARY KEY,
    applied_at INTEGER NOT NULL
)`
	if _, err := db.Exec(createTracking); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations dir: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		if err := applyOne(db, entry.Name()); err != nil {
			return err
		}
	}
	return nil
}

// applyOne applies a single migration file if it has not been recorded yet.
func applyOne(db *sql.DB, name string) error {
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, name,
	).Scan(&count); err != nil {
		return fmt.Errorf("check migration %q: %w", name, err)
	}
	if count > 0 {
		return nil // already applied
	}

	data, err := migrations.FS.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read migration %q: %w", name, err)
	}

	upSQL := extractUpSection(string(data))
	if strings.TrimSpace(upSQL) == "" {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx for migration %q: %w", name, err)
	}

	if _, err := tx.Exec(upSQL); err != nil {
		tx.Rollback() //nolint:errcheck
		return fmt.Errorf("exec migration %q: %w", name, err)
	}

	if _, err := tx.Exec(
		`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
		name, time.Now().Unix(),
	); err != nil {
		tx.Rollback() //nolint:errcheck
		return fmt.Errorf("record migration %q: %w", name, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %q: %w", name, err)
	}

	slog.Info("db: migration applied", "version", name)
	return nil
}

// extractUpSection returns the SQL between the "-- +migrate Up" marker and
// either the "-- +migrate Down" marker or end of file.
func extractUpSection(content string) string {
	var (
		inUp bool
		sb   strings.Builder
	)
	for _, line := range strings.Split(content, "\n") {
		switch strings.TrimSpace(line) {
		case "-- +migrate Up":
			inUp = true
		case "-- +migrate Down":
			return sb.String()
		default:
			if inUp {
				sb.WriteString(line)
				sb.WriteByte('\n')
			}
		}
	}
	return sb.String()
}
