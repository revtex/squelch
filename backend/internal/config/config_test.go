package config_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/config"
)

// writeTempConfig writes a JSON config file in t.TempDir() and returns its path.
func writeTempConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "squelch.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

// TestValidateJSONFile_LegacyEncryptionKey_Refused asserts startup refusal when
// the deprecated "encryption_key" field is present in the JSON config.
// (Note: the same check exists in loadJSON but uses os.Exit(1); ValidateJSONFile
// is the exported, testable twin.)
func TestValidateJSONFile_LegacyEncryptionKey_Refused(t *testing.T) {
	path := writeTempConfig(t, `{
		"listen": ":3022",
		"db_file": "squelch.db",
		"recordings_dir": "`+t.TempDir()+`",
		"encryption_key": "leaked-secret"
	}`)

	err := config.ValidateJSONFile(path)
	if err == nil {
		t.Fatal("ValidateJSONFile should refuse when 'encryption_key' is present")
	}
	if !strings.Contains(err.Error(), "encryption_key") {
		t.Errorf("error should mention 'encryption_key'; got: %v", err)
	}
}

func TestValidateJSONFile_HappyPath(t *testing.T) {
	recDir := t.TempDir()
	dbDir := t.TempDir()
	path := writeTempConfig(t, `{
		"listen": ":3022",
		"db_file": "`+filepath.Join(dbDir, "squelch.db")+`",
		"recordings_dir": "`+recDir+`",
		"timezone": "UTC"
	}`)

	if err := config.ValidateJSONFile(path); err != nil {
		t.Fatalf("ValidateJSONFile: %v", err)
	}
}

func TestValidateJSONFile_MissingFile(t *testing.T) {
	// Intentionally point at a non-existent file.
	err := config.ValidateJSONFile(filepath.Join(t.TempDir(), "does-not-exist.json"))
	if err == nil {
		t.Fatal("ValidateJSONFile should return an error for a missing file")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error should mention 'not found'; got: %v", err)
	}
}

func TestValidateJSONFile_MalformedJSON(t *testing.T) {
	path := writeTempConfig(t, `not json at all`)

	err := config.ValidateJSONFile(path)
	if err == nil {
		t.Fatal("ValidateJSONFile should reject malformed JSON")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("error should mention 'parse'; got: %v", err)
	}
}

func TestValidateJSONFile_MissingListen(t *testing.T) {
	path := writeTempConfig(t, `{
		"db_file": "squelch.db",
		"recordings_dir": "`+t.TempDir()+`"
	}`)

	err := config.ValidateJSONFile(path)
	if err == nil {
		t.Fatal("ValidateJSONFile should require 'listen'")
	}
	if !strings.Contains(err.Error(), "listen") {
		t.Errorf("error should mention 'listen'; got: %v", err)
	}
}

// TestSaveJSON_OmitsEncryptionKey verifies that SaveJSON never writes the
// encryption key to disk and that the file is written with 0o600 permissions.
func TestSaveJSON_OmitsEncryptionKey(t *testing.T) {
	recDir := t.TempDir()
	path := filepath.Join(t.TempDir(), "squelch.json")

	cfg := &config.Config{
		Listen:        ":3022",
		DBFile:        "squelch.db",
		RecordingsDir: recDir,
		Timezone:      "UTC",
		EncryptionKey: "this-must-never-be-persisted",
		ConfigFile:    path,
	}

	if err := cfg.SaveJSON(); err != nil {
		t.Fatalf("SaveJSON: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}

	// Raw string check — belt-and-suspenders guard against marshal drift.
	if strings.Contains(string(data), "this-must-never-be-persisted") {
		t.Errorf("saved config contains the raw encryption key: %s", data)
	}
	if strings.Contains(string(data), `"encryption_key"`) {
		t.Errorf("saved config contains the 'encryption_key' JSON field: %s", data)
	}

	// Also parse as JSON and ensure no stray keys match.
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse saved JSON: %v", err)
	}
	if _, ok := parsed["encryption_key"]; ok {
		t.Error("parsed config has 'encryption_key' key")
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("file perms = %o, want 0600", perm)
	}
}

// TestSaveJSON_RoundTrip writes a config, re-validates the file, and confirms
// fields survive the round trip.
func TestSaveJSON_RoundTrip(t *testing.T) {
	recDir := t.TempDir()
	dbFile := filepath.Join(t.TempDir(), "squelch.db")
	path := filepath.Join(t.TempDir(), "squelch.json")

	cfg := &config.Config{
		Listen:        ":4000",
		DBFile:        dbFile,
		RecordingsDir: recDir,
		Timezone:      "America/New_York",
		ConfigFile:    path,
	}
	if err := cfg.SaveJSON(); err != nil {
		t.Fatalf("SaveJSON: %v", err)
	}
	if err := config.ValidateJSONFile(path); err != nil {
		t.Fatalf("ValidateJSONFile (round trip): %v", err)
	}

	data, _ := os.ReadFile(path)
	var parsed map[string]any
	_ = json.Unmarshal(data, &parsed)
	if parsed["listen"] != ":4000" {
		t.Errorf("listen not persisted; got %v", parsed["listen"])
	}
	if parsed["timezone"] != "America/New_York" {
		t.Errorf("timezone not persisted; got %v", parsed["timezone"])
	}
}

func TestTrustedProxyList(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"", config.DefaultTrustedProxies},
		{"none", nil},
		{" NONE ", nil},
		{"10.1.2.3, 172.18.0.0/16", []string{"10.1.2.3", "172.18.0.0/16"}},
	}
	for _, tc := range cases {
		got := (&config.Config{TrustedProxies: tc.in}).TrustedProxyList()
		if !slices.Equal(got, tc.want) {
			t.Errorf("TrustedProxyList(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
