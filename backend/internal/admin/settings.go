package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"

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

	return map[string]any{
		"settings": settingsList,
		"capabilities": map[string]bool{
			"ffmpeg":  o.Deps.FFmpegAvailable,
			"fdkAac":  o.Deps.FDKAACAvailable,
			"whisper": o.Deps.WhisperAvailable,
		},
	}, nil
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
		if s.Key == "logLevel" {
			if _, ok := logging.ParseLevel(s.Value); !ok {
				return nil, UserError("invalid logLevel; expected debug, info, warn, or error")
			}
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

	// Log each changed setting, redacting sensitive keys.
	for _, s := range settings {
		v := s.Value
		if s.Key == "vapidPrivateKey" {
			v = "[REDACTED]"
		}
		slog.Info("admin: config updated", "key", s.Key, "value", v, "by", callerID)
	}

	// Apply log level change at runtime.
	for _, s := range settings {
		if s.Key == "logLevel" {
			if err := logging.SetLevel(s.Value); err != nil {
				slog.Warn("invalid logLevel setting, keeping previous runtime level", "value", s.Value, "error", err)
			}
			break
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
