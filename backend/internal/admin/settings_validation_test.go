package admin

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

func updateSetting(t *testing.T, ops *Operations, key, value string) error {
	t.Helper()
	_, err := ops.ConfigUpdate(context.Background(), params(t, map[string]any{
		"settings": []map[string]string{{"key": key, "value": value}},
	}), 1)
	return err
}

func TestConfigUpdate_ValidatesValues(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	bad := []struct{ key, value, want string }{
		{"email", "not an address", "plain address"},
		{"email", "Ops <ops@example.org>", "plain address"},
		{"pruneDays", "-1", "0 to 3650"},
		{"pruneDays", "soon", "0 to 3650"},
		{"apiKeyCallRate", "0", "1 to 600"},
		{"loginMaxFailures", "0", "1 to 20"},
		{"loginLockoutMinutes", "99999", "1 to 1440"},
		{"keypadBeeps", "loud", "one of uniden, whistler, disabled"},
		{"publicAccess", "yes", "one of true, false"},
		{"branding", strings.Repeat("x", 65), "64 characters"},
		{"activityDashboard", "true", "unknown setting key"},
	}
	for _, c := range bad {
		err := updateSetting(t, ops, c.key, c.value)
		var ue UserError
		if !errors.As(err, &ue) {
			t.Errorf("%s=%q: want a UserError, got %v", c.key, c.value, err)
			continue
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s=%q: error %q does not mention %q", c.key, c.value, err, c.want)
		}
	}
	good := []struct{ key, value string }{
		{"email", "ops@example.org"},
		{"email", ""},
		{"pruneDays", " 30 "},
		{"keypadBeeps", "whistler"},
		{"loginMaxFailures", "5"},
	}
	for _, c := range good {
		if err := updateSetting(t, ops, c.key, c.value); err != nil {
			t.Errorf("%s=%q: unexpected error %v", c.key, c.value, err)
		}
	}
}

func TestConfigUpdate_AppliesLoginLimitsAtOnce(t *testing.T) {
	ops, queries := newTestOperations(t, "")
	limiter := auth.NewRateLimiter(context.Background())
	ops.Deps.LoginLimiter = limiter

	if err := updateSetting(t, ops, "loginMaxFailures", "5"); err != nil {
		t.Fatal(err)
	}
	if err := updateSetting(t, ops, "loginLockoutMinutes", "30"); err != nil {
		t.Fatal(err)
	}
	if n, d := limiter.Limits(); n != 5 || d != 30*time.Minute {
		t.Errorf("limits = %d, %s; want 5, 30m", n, d)
	}

	// A fresh limiter picks the saved values up at startup too.
	fresh := auth.NewRateLimiter(context.Background())
	ApplyLoginLimits(context.Background(), queries, fresh)
	if n, d := fresh.Limits(); n != 5 || d != 30*time.Minute {
		t.Errorf("startup limits = %d, %s; want 5, 30m", n, d)
	}

	// Unusable values keep the defaults.
	if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "loginMaxFailures", Value: "nope"}); err != nil {
		t.Fatal(err)
	}
	if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "loginLockoutMinutes", Value: "0"}); err != nil {
		t.Fatal(err)
	}
	def := auth.NewRateLimiter(context.Background())
	ApplyLoginLimits(context.Background(), queries, def)
	if n, d := def.Limits(); n != auth.DefaultMaxFailures || d != auth.DefaultLockout {
		t.Errorf("default limits = %d, %s", n, d)
	}
}

func TestConfigGet_ReportsStorageAndTrustedAddresses(t *testing.T) {
	ops, queries := newTestOperations(t, "")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.wav"), make([]byte, 1000), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sub", "b.wav"), make([]byte, 500), 0o600); err != nil {
		t.Fatal(err)
	}
	ops.Deps.RecordingsDir = dir

	sysID, err := queries.CreateSystem(context.Background(), db.CreateSystemParams{SystemID: 1, Label: "Test", AutoPopulateTalkgroups: 1})
	if err != nil {
		t.Fatalf("create system: %v", err)
	}
	if _, err := queries.CreateCall(context.Background(), db.CreateCallParams{
		AudioPath: "a.wav", AudioName: "a.wav", AudioType: "audio/wav",
		DateTime: 1_700_000_000, SystemID: sysID,
	}); err != nil {
		t.Fatalf("insert call: %v", err)
	}

	// The walk runs in the background; wait for it to land.
	var info StorageInfo
	for range 50 {
		info = ops.Storage(context.Background())
		if info.MeasuredAt != 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if info.MeasuredAt == 0 {
		t.Fatal("recordings were never measured")
	}
	if info.RecordingsBytes != 1500 || info.RecordingFiles != 2 {
		t.Errorf("recordings = %d bytes in %d files; want 1500 in 2", info.RecordingsBytes, info.RecordingFiles)
	}
	if info.VolumeTotalBytes == 0 || info.VolumeFreeBytes == 0 {
		t.Errorf("volume figures missing: %+v", info)
	}
	if info.OldestCall == nil || *info.OldestCall != 1_700_000_000 {
		t.Errorf("oldest call = %v", info.OldestCall)
	}

	out, err := ops.ConfigGet(context.Background(), json.RawMessage("{}"), 1)
	if err != nil {
		t.Fatal(err)
	}
	m := out.(map[string]any)
	if _, ok := m["storage"].(StorageInfo); !ok {
		t.Errorf("config.get has no storage figures: %T", m["storage"])
	}
	if trusted, ok := m["trustedAddresses"].([]string); !ok || len(trusted) != 0 {
		t.Errorf("trustedAddresses = %v (%T); want an empty list", m["trustedAddresses"], m["trustedAddresses"])
	}
}

func TestConfigUpdate_AuditsBeforeAndAfter(t *testing.T) {
	ops, queries := newTestOperations(t, "k")
	if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "pruneDays", Value: "7"}); err != nil {
		t.Fatal(err)
	}
	_, err := ops.ConfigUpdate(context.Background(), params(t, map[string]any{
		"settings": []map[string]string{
			{"key": "pruneDays", "value": "30"},
			{"key": "branding", "value": "Lake"},
			{"key": "vapidPrivateKey", "value": "secret"},
		},
	}), 1)
	if err != nil {
		t.Fatal(err)
	}
	got := lastLogMessage(t, ops)
	for _, want := range []string{"settings changed by", "pruneDays 7 → 30", "branding (unset) → Lake", "vapidPrivateKey (unset) → [REDACTED]"} {
		if !strings.Contains(got, want) {
			t.Errorf("audit line %q lacks %q", got, want)
		}
	}
	if strings.Contains(got, "secret") {
		t.Errorf("audit line leaks the secret: %q", got)
	}
}
