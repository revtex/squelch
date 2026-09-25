// Package seed inserts default rows into a fresh database. All inserts are
// idempotent (INSERT OR IGNORE) and run inside a single transaction.
package seed

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
)

// Seed inserts default application data if it does not already exist.
// It is safe to call on every startup.
func Seed(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin seed transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // rolled back intentionally on error path

	var seeded bool
	if ok, err := seedAppState(ctx, tx); err != nil {
		return err
	} else if ok {
		seeded = true
	}
	if ok, err := seedSettings(ctx, tx); err != nil {
		return err
	} else if ok {
		seeded = true
	}
	if ok, err := seedGroups(ctx, tx); err != nil {
		return err
	} else if ok {
		seeded = true
	}
	if ok, err := seedTags(ctx, tx); err != nil {
		return err
	} else if ok {
		seeded = true
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit seed transaction: %w", err)
	}

	if seeded {
		slog.Info("database seeded with defaults")
	}
	return nil
}

func seedAppState(ctx context.Context, tx *sql.Tx) (bool, error) {
	res, err := tx.ExecContext(ctx,
		`INSERT OR IGNORE INTO app_state (id, setup_complete) VALUES (1, 0)`)
	if err != nil {
		return false, fmt.Errorf("seed app_state: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func seedSettings(ctx context.Context, tx *sql.Tx) (bool, error) {
	var inserted bool
	defaults := []struct{ key, value string }{
		{"autoPopulateSystems", "true"},
		{"pruneDays", "7"},
		{"connectionHistoryDays", "30"},
		{"maxClients", "200"},
		{"time12hFormat", "false"},
		{"keypadBeeps", "uniden"},
		{"duplicateDetectionTimeFrame", "500"},
		{"disableDuplicateDetection", "false"},
		{"audioConversion", "0"},
		{"audioEncodingPreset", "mp3_32k"},
		{"showListenersCount", "false"},
		{"publicAccess", "false"},
		{"shareableLinks", "false"},
		{"logLevel", "info"},
		{"auditRetentionDays", "90"},
		{"apiKeyCallRate", "60"},
		{"loginMaxFailures", "3"},
		{"loginLockoutMinutes", "10"},
		{"transcriptionEnabled", "false"},
		{"transcriptionUrl", "http://localhost:8081"},
		{"transcriptionModel", "ggml-base"},
		{"transcriptionLanguage", "en"},
		{"transcriptionDiarize", "false"},
		{"branding", ""},
		{"email", ""},
		{"vapidPublicKey", ""},
		{"vapidPrivateKey", ""},
		{"trMqttEnabled", "false"},
	}

	for _, s := range defaults {
		res, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
			s.key, s.value)
		if err != nil {
			return false, fmt.Errorf("seed setting %q: %w", s.key, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted = true
		}
	}
	return inserted, nil
}

func seedGroups(ctx context.Context, tx *sql.Tx) (bool, error) {
	var inserted bool
	groups := []string{"Air", "Common", "EMS", "Fire", "Interop", "Law", "Public Works", "Unknown"}
	for _, name := range groups {
		res, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO groups (label) VALUES (?)`, name)
		if err != nil {
			return false, fmt.Errorf("seed group %q: %w", name, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted = true
		}
	}
	return inserted, nil
}

func seedTags(ctx context.Context, tx *sql.Tx) (bool, error) {
	var inserted bool
	tags := []string{
		"ATC",
		"Corrections",
		"Emergency Ops",
		"EMS Dispatch",
		"EMS Tac",
		"EMS Talk",
		"Fire Dispatch",
		"Fire Tac",
		"Fire Talk",
		"Hospital",
		"Interop",
		"Law Dispatch",
		"Law Tac",
		"Law Talk",
		"Public Works",
		"Schools",
		"Security",
		"Service",
		"Transportation",
		"Untagged",
		"Utilities",
	}
	for _, name := range tags {
		res, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO tags (label) VALUES (?)`, name)
		if err != nil {
			return false, fmt.Errorf("seed tag %q: %w", name, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted = true
		}
	}
	return inserted, nil
}
