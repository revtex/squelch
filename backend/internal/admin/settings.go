package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/mail"
	"strconv"
	"strings"
	"time"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/logging"
)

// ConfigGet returns the current settings (sensitive values decrypted) along
// with server capabilities. Server-only secrets such as the JWT signing key
// are never returned.
func (o *Operations) ConfigGet(ctx context.Context, _ json.RawMessage, _ int64) (any, error) {
	settings, err := o.Queries.ListSettings(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to list settings: %w", err)
	}

	settingsList := make([]map[string]string, 0, len(settings))
	for _, s := range settings {
		if serverOnlySettingKeys[s.Key] {
			continue
		}
		val := s.Value
		if SensitiveSettingKeys[s.Key] && o.Deps.EncryptionKey != "" {
			if plain, err := auth.DecryptString(val, o.Deps.EncryptionKey); err == nil {
				val = plain
			}
		}
		settingsList = append(settingsList, map[string]string{"key": s.Key, "value": val})
	}

	trusted := []string{}
	if o.Deps.IPBlocks != nil {
		for _, p := range o.Deps.IPBlocks.TrustedList() {
			trusted = append(trusted, p.String())
		}
	}

	return map[string]any{
		"settings": settingsList,
		"capabilities": map[string]bool{
			"ffmpeg":  o.Deps.FFmpegAvailable,
			"fdkAac":  o.Deps.FDKAACAvailable,
			"whisper": o.Deps.WhisperAvailable,
		},
		"storage":          o.Storage(ctx),
		"trustedAddresses": trusted,
	}, nil
}

// settingRanges bounds the numeric settings: key → lowest and highest
// value the admin may save. Zero usually means "off" or "no limit".
var settingRanges = map[string]struct{ min, max int }{
	"apiKeyCallRate":              {1, 600},
	"auditRetentionDays":          {1, 3650},
	"connectionHistoryDays":       {0, 3650},
	"duplicateDetectionTimeFrame": {0, 60_000},
	"loginLockoutMinutes":         {1, 1440},
	"loginMaxFailures":            {1, 20},
	"maxClients":                  {0, 100_000},
	"pruneDays":                   {0, 3650},
	"sharedLinkExpiry":            {0, 3650},
	"transcriptionMinDurationMs":  {0, 60_000},
}

// settingChoices lists the settings that take one of a few words.
var settingChoices = map[string][]string{
	"keypadBeeps":               {"uniden", "whistler", "disabled"},
	"audioConversion":           {"0", "1", "2", "3"},
	"disableDuplicateDetection": {"true", "false"},
	"publicAccess":              {"true", "false"},
	"shareableLinks":            {"true", "false"},
	"showListenersCount":        {"true", "false"},
	"time12hFormat":             {"true", "false"},
	"trMqttEnabled":             {"true", "false"},
	"autoPopulateSystems":       {"true", "false"},
	"transcriptionEnabled":      {"true", "false"},
	"transcriptionDiarize":      {"true", "false"},
	"liveTranscriptDisplay":     {"true", "false"},
}

// checkSetting validates one setting's value the way the page that edits it
// would, so a hand-written request cannot store something the server then
// trips over.
func checkSetting(key, value string) error {
	value = strings.TrimSpace(value)
	if r, ok := settingRanges[key]; ok {
		n, err := strconv.Atoi(value)
		if err != nil || n < r.min || n > r.max {
			return UserError(fmt.Sprintf("%s must be a whole number from %d to %d", key, r.min, r.max))
		}
		return nil
	}
	if choices, ok := settingChoices[key]; ok && len(choices) > 0 {
		for _, c := range choices {
			if value == c {
				return nil
			}
		}
		return UserError(fmt.Sprintf("%s must be one of %s", key, strings.Join(choices, ", ")))
	}
	switch key {
	case "email":
		if value == "" {
			return nil
		}
		addr, err := mail.ParseAddress(value)
		if err != nil || addr.Address != value {
			return UserError("email must be a plain address such as ops@example.org, or empty")
		}
	case "branding":
		if len(value) > 64 {
			return UserError("branding must be 64 characters or fewer")
		}
	case "logLevel":
		if _, ok := logging.ParseLevel(value); !ok {
			return UserError("invalid logLevel; expected debug, info, warn, or error")
		}
	}
	return nil
}

// ApplyLoginLimits reads the sign-in lockout settings and hands them to the
// limiter. Missing or unreadable values keep the limiter's defaults.
func ApplyLoginLimits(ctx context.Context, q *db.Queries, limiter *auth.RateLimiter) {
	if limiter == nil {
		return
	}
	failures, lockout := auth.DefaultMaxFailures, auth.DefaultLockout
	if s, err := q.GetSetting(ctx, "loginMaxFailures"); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(s.Value)); err == nil && n > 0 {
			failures = n
		}
	}
	if s, err := q.GetSetting(ctx, "loginLockoutMinutes"); err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(s.Value)); err == nil && n > 0 {
			lockout = time.Duration(n) * time.Minute
		}
	}
	limiter.SetLimits(failures, lockout)
}

// ConfigUpdate applies a batch of settings atomically, encrypting sensitive
// values, hot-reloading transcription if touched, and rebroadcasting CFG.
func (o *Operations) ConfigUpdate(ctx context.Context, params json.RawMessage, callerID int64) (any, error) {
	var body struct {
		Settings []struct {
			Key   string `json:"key"`
			Value string `json:"value"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(params, &body); err != nil {
		return nil, UserError("invalid request body")
	}
	settings := body.Settings

	// Validate all keys first.
	for _, s := range settings {
		if !allowedSettingKeys[s.Key] {
			return nil, UserError("unknown setting key: " + s.Key)
		}
		if err := checkSetting(s.Key, s.Value); err != nil {
			return nil, err
		}
		if s.Key == "audioEncodingPreset" {
			if !audio.IsValidEncodingPreset(s.Value) {
				return nil, UserError("invalid audioEncodingPreset value")
			}
			if audio.IsHEEncodingPreset(s.Value) && !o.Deps.FDKAACAvailable {
				return nil, UserError("selected HE-AAC preset requires libfdk_aac support in ffmpeg")
			}
		}
		if s.Key == "audioConversion" {
			if v, err := strconv.Atoi(s.Value); err == nil && v != 0 && !o.Deps.FFmpegAvailable {
				return nil, UserError("ffmpeg is not installed — install it and restart the service to enable audio conversion")
			}
		}
	}

	sqlDB := o.Deps.SQLDB
	if sqlDB == nil {
		return nil, fmt.Errorf("transaction support not available")
	}

	// Remember what each setting was, for the audit line.
	before := map[string]string{}
	if rows, err := o.Queries.ListSettings(ctx); err == nil {
		for _, r := range rows {
			before[r.Key] = r.Value
		}
	}

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := o.Queries.WithTx(tx)
	for _, s := range settings {
		val := s.Value
		if SensitiveSettingKeys[s.Key] && o.Deps.EncryptionKey != "" && val != "" {
			enc, err := auth.EncryptString(val, o.Deps.EncryptionKey)
			if err != nil {
				return nil, fmt.Errorf("encrypt setting %q: %w", s.Key, err)
			}
			val = enc
		}
		if err := qtx.UpsertSetting(ctx, db.UpsertSettingParams{Key: s.Key, Value: val}); err != nil {
			return nil, fmt.Errorf("failed to save config: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit config: %w", err)
	}

	// Log each changed setting, redacting sensitive keys, and write one
	// audit line naming the before and after values.
	var changes []string
	for _, s := range settings {
		v := strings.TrimSpace(s.Value)
		old, had := before[s.Key]
		if SensitiveSettingKeys[s.Key] {
			v, old = "[REDACTED]", "[REDACTED]"
		}
		slog.Info("admin: config updated", "key", s.Key, "value", v, "by", callerID)
		if had && old == v {
			continue
		}
		if !had {
			old = "(unset)"
		}
		changes = append(changes, fmt.Sprintf("%s %s → %s", s.Key, quoteIfBlank(old), quoteIfBlank(v)))
	}
	if len(changes) > 0 {
		o.audit(ctx, fmt.Sprintf("admin: settings changed by %s: %s", o.callerName(ctx, callerID), strings.Join(changes, ", ")))
	}

	// Apply log level and sign-in lockout changes at runtime.
	for _, s := range settings {
		switch s.Key {
		case "logLevel":
			if err := logging.SetLevel(s.Value); err != nil {
				slog.Warn("invalid logLevel setting, keeping previous runtime level", "value", s.Value, "error", err)
			}
		case "loginMaxFailures", "loginLockoutMinutes":
			ApplyLoginLimits(ctx, o.Queries, o.Deps.LoginLimiter)
		case "transcriptionMinDurationMs":
			if o.Deps.TranscriberReload != nil {
				ApplyTranscriptionMinDuration(ctx, o.Queries, o.Deps.TranscriberReload)
			}
		}
	}

	// Hot-reload transcription if any transcription setting changed.
	if o.Deps.TranscriberReload != nil {
		transcriptionKeys := map[string]bool{
			"transcriptionEnabled":  true,
			"transcriptionUrl":      true,
			"transcriptionModel":    true,
			"transcriptionLanguage": true,
			"transcriptionDiarize":  true,
		}
		needsReload := false
		for _, s := range settings {
			if transcriptionKeys[s.Key] {
				needsReload = true
				break
			}
		}
		if needsReload {
			// Read current settings from DB (just committed).
			tEnabled, _ := o.Queries.GetSetting(ctx, "transcriptionEnabled")
			tURL, _ := o.Queries.GetSetting(ctx, "transcriptionUrl")
			tModel, _ := o.Queries.GetSetting(ctx, "transcriptionModel")
			tLang, _ := o.Queries.GetSetting(ctx, "transcriptionLanguage")
			tDiarize, _ := o.Queries.GetSetting(ctx, "transcriptionDiarize")

			ok := o.Deps.TranscriberReload.Reload(
				tEnabled.Value == "true",
				tURL.Value,
				tModel.Value,
				tLang.Value,
				tDiarize.Value == "true",
			)
			o.Deps.WhisperAvailable = ok && tEnabled.Value == "true"
		}
	}

	// Turning public access off must also end the anonymous sessions it
	// admitted, not just refuse new ones.
	o.enforcePublicAccess(ctx)

	// Broadcast updated config to all WS clients using the safe,
	// curated CFG builder (excludes secrets like VAPID keys).
	o.broadcastCFG(ctx)

	o.broadcastAdminEvent("config.updated", nil)
	return map[string]bool{"ok": true}, nil
}

// quoteIfBlank makes an empty value visible in an audit line.
func quoteIfBlank(v string) string {
	if v == "" {
		return `""`
	}
	return v
}
