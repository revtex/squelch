// Package config handles server startup configuration via CLI flags, environment variables, and optional JSON file.
//
// Configuration precedence: CLI flags > environment variables > JSON file > built-in defaults.
package config

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
)

// Version is set at build time via ldflags (-X ...config.Version=...).
// Defaults to "dev" so unversioned local builds are clearly identifiable.
var Version = "dev"

// Config holds all server startup configuration.
type Config struct {
	Listen            string // HTTP listen address (default ":3022")
	DBFile            string // SQLite database file path (default "squelch.db")
	RecordingsDir     string // Directory for call audio recordings (default: executable dir)
	SSLListen         string // HTTPS listen address
	SSLCert           string // TLS certificate file (PEM)
	SSLKey            string // TLS private key file (PEM)
	SSLAutoCert       string // Domain for Let's Encrypt auto-cert
	EncryptionKey     string // AES-256 key for encrypting secrets at rest
	EncryptionKeyFile string // Path to file containing encryption key
	AdminPassword     string // Reset first admin user's password on startup
	Timezone          string // IANA timezone for recorder timestamps (default: TZ env or "UTC")
	TrustedProxies    string // Comma-separated proxy IPs/CIDRs whose X-Forwarded-For is honoured; "none" disables
	ConfigFile        string // Path to JSON config file (default "squelch.json")
	ConfigSave        bool   // Write current flags to JSON config file and exit
	ShowVersion       bool   // Print version and exit
	Service           string // Service command: install, uninstall, start, stop, restart
}

// jsonFileConfig is the on-disk startup config. It MUST NOT contain any
// secret material. The encryption key is supplied via --encryption-key,
// --encryption-key-file, or the SQUELCH_ENCRYPTION_KEY env var only.
type jsonFileConfig struct {
	Listen        string `json:"listen"`
	DBFile        string `json:"db_file"`
	RecordingsDir string `json:"recordings_dir"`
	SSLListen     string `json:"ssl_listen"`
	SSLCert       string `json:"ssl_cert_file"`
	SSLKey        string `json:"ssl_key_file"`
	SSLAutoCert   string `json:"ssl_auto_cert"`
	Timezone      string `json:"timezone"`
	// TrustedProxies is a comma-separated list; see Config.TrustedProxies.
	TrustedProxies string `json:"trusted_proxies,omitempty"`

	// LegacyEncryptionKey captures the deprecated "encryption_key" field to
	// detect and refuse startup on legacy config files that leaked the key to disk.
	LegacyEncryptionKey string `json:"encryption_key,omitempty"`
}

// Load parses configuration from CLI flags, environment variables, and an optional JSON file.
// Precedence: CLI flags > environment variables > JSON file > built-in defaults.
func Load() (*Config, error) {
	cfg := &Config{}
	// Determine default RecordingsDir (directory of the running executable).
	exePath, err := os.Executable()
	if err != nil {
		exePath = "."
	}
	defaultRecordingsDir := filepath.Dir(exePath)

	// Define CLI flags.
	flag.StringVar(&cfg.Listen, "listen", ":3022", "HTTP listen address")
	flag.StringVar(&cfg.DBFile, "db-file", "squelch.db", "SQLite database file path")
	flag.StringVar(&cfg.RecordingsDir, "recordings-dir", defaultRecordingsDir, "Directory for call audio recordings")
	flag.StringVar(&cfg.SSLListen, "ssl-listen", "", "HTTPS listen address")
	flag.StringVar(&cfg.SSLCert, "ssl-cert", "", "TLS certificate file (PEM)")
	flag.StringVar(&cfg.SSLKey, "ssl-key", "", "TLS private key file (PEM)")
	flag.StringVar(&cfg.SSLAutoCert, "ssl-auto-cert", "", "Domain for Let's Encrypt auto-cert")
	flag.StringVar(&cfg.EncryptionKey, "encryption-key", "", "AES-256 key for encrypting secrets at rest")
	flag.StringVar(&cfg.EncryptionKeyFile, "encryption-key-file", "", "Path to file containing encryption key")
	flag.StringVar(&cfg.AdminPassword, "admin-password", "", "Reset first admin user's password on startup")
	flag.StringVar(&cfg.Timezone, "timezone", "", "IANA timezone for recorder timestamps (e.g. America/New_York)")
	flag.StringVar(&cfg.TrustedProxies, "trusted-proxies", "", "Comma-separated proxy IPs/CIDRs allowed to set X-Forwarded-For (default: loopback and private ranges; \"none\" to disable)")
	flag.StringVar(&cfg.ConfigFile, "config", "squelch.json", "Path to JSON config file")
	flag.BoolVar(&cfg.ConfigSave, "config-save", false, "Write current flags to JSON config file and exit")
	flag.BoolVar(&cfg.ShowVersion, "version", false, "Print version and exit")
	flag.StringVar(&cfg.Service, "service", "", "Service command: install, uninstall, start, stop, restart")

	flag.Usage = func() { PrintUsage(os.Stderr) }
	flag.Parse()

	// Capture which flags were explicitly set on the command line and their values,
	// before loadJSON/applyEnv can overwrite them.
	explicitFlags := make(map[string]string)
	flag.Visit(func(f *flag.Flag) {
		explicitFlags[f.Name] = f.Value.String()
	})

	// Load JSON file defaults (lowest precedence after built-in defaults).
	loadJSON(cfg)

	// Apply environment variables (higher precedence than JSON file).
	applyEnv(cfg)

	// Restore explicitly-set CLI flags (highest precedence).
	restoreExplicitFlags(cfg, explicitFlags)

	return cfg, nil
}

// loadJSON reads the JSON config file and applies values as defaults.
func loadJSON(cfg *Config) {
	data, err := os.ReadFile(cfg.ConfigFile)
	if err != nil {
		// Config file is optional; if it doesn't exist, silently continue.
		return
	}

	var fileCfg jsonFileConfig
	if err := json.Unmarshal(data, &fileCfg); err != nil {
		// Keep startup resilient if the config file is malformed.
		slog.Warn("failed to parse JSON config file", "file", cfg.ConfigFile, "error", err)
		return
	}

	// Refuse to start if the legacy (insecure) encryption_key field is present
	// in the JSON config. The encryption key must come from env var or CLI flag.
	if fileCfg.LegacyEncryptionKey != "" {
		slog.Error("insecure config: 'encryption_key' field found in JSON config file — remove it and supply the key via --encryption-key, --encryption-key-file, or SQUELCH_ENCRYPTION_KEY",
			"file", cfg.ConfigFile)
		fmt.Fprintf(os.Stderr, "squelch: refusing to start — remove 'encryption_key' from %s; pass the key via --encryption-key, --encryption-key-file, or SQUELCH_ENCRYPTION_KEY\n", cfg.ConfigFile)
		os.Exit(1)
	}

	if v := fileCfg.Listen; v != "" {
		cfg.Listen = v
	}
	if v := fileCfg.DBFile; v != "" {
		cfg.DBFile = v
	}
	if v := fileCfg.RecordingsDir; v != "" {
		cfg.RecordingsDir = v
	}
	if v := fileCfg.SSLListen; v != "" {
		cfg.SSLListen = v
	}
	if v := fileCfg.SSLCert; v != "" {
		cfg.SSLCert = v
	}
	if v := fileCfg.SSLKey; v != "" {
		cfg.SSLKey = v
	}
	if v := fileCfg.SSLAutoCert; v != "" {
		cfg.SSLAutoCert = v
	}
	if v := fileCfg.Timezone; v != "" {
		cfg.Timezone = v
	}
	if v := fileCfg.TrustedProxies; v != "" {
		cfg.TrustedProxies = v
	}
}

// applyEnv applies environment variable overrides.
func applyEnv(cfg *Config) {
	if v := os.Getenv("SQUELCH_LISTEN"); v != "" {
		cfg.Listen = v
	}
	if v := os.Getenv("SQUELCH_DB_FILE"); v != "" {
		cfg.DBFile = v
	}
	if v := os.Getenv("SQUELCH_RECORDINGS_DIR"); v != "" {
		cfg.RecordingsDir = v
	}
	if v := os.Getenv("SQUELCH_SSL_LISTEN"); v != "" {
		cfg.SSLListen = v
	}
	if v := os.Getenv("SQUELCH_SSL_CERT"); v != "" {
		cfg.SSLCert = v
	}
	if v := os.Getenv("SQUELCH_SSL_KEY"); v != "" {
		cfg.SSLKey = v
	}
	if v := os.Getenv("SQUELCH_SSL_AUTO_CERT"); v != "" {
		cfg.SSLAutoCert = v
	}
	if v := os.Getenv("SQUELCH_ENCRYPTION_KEY"); v != "" {
		cfg.EncryptionKey = v
	}
	if v := os.Getenv("SQUELCH_ENCRYPTION_KEY_FILE"); v != "" {
		cfg.EncryptionKeyFile = v
	}
	if v := os.Getenv("SQUELCH_ADMIN_PASSWORD"); v != "" {
		cfg.AdminPassword = v
	}
	if v := os.Getenv("SQUELCH_TRUSTED_PROXIES"); v != "" {
		cfg.TrustedProxies = v
	}
	if v := os.Getenv("SQUELCH_TIMEZONE"); v != "" {
		cfg.Timezone = v
	} else if v := os.Getenv("TZ"); v != "" {
		cfg.Timezone = v
	}
}

// restoreExplicitFlags restores CLI flag values that were explicitly set by the user.
// This ensures CLI flags > env vars > JSON file > defaults.
func restoreExplicitFlags(cfg *Config, explicit map[string]string) {
	if v, ok := explicit["listen"]; ok {
		cfg.Listen = v
	}
	if v, ok := explicit["db-file"]; ok {
		cfg.DBFile = v
	}
	if v, ok := explicit["recordings-dir"]; ok {
		cfg.RecordingsDir = v
	}
	if v, ok := explicit["ssl-listen"]; ok {
		cfg.SSLListen = v
	}
	if v, ok := explicit["ssl-cert"]; ok {
		cfg.SSLCert = v
	}
	if v, ok := explicit["ssl-key"]; ok {
		cfg.SSLKey = v
	}
	if v, ok := explicit["ssl-auto-cert"]; ok {
		cfg.SSLAutoCert = v
	}
	if v, ok := explicit["encryption-key"]; ok {
		cfg.EncryptionKey = v
	}
	if v, ok := explicit["encryption-key-file"]; ok {
		cfg.EncryptionKeyFile = v
	}
	if v, ok := explicit["admin-password"]; ok {
		cfg.AdminPassword = v
	}
	if v, ok := explicit["timezone"]; ok {
		cfg.Timezone = v
	}
	if v, ok := explicit["trusted-proxies"]; ok {
		cfg.TrustedProxies = v
	}
}

// DefaultTrustedProxies are the peers whose X-Forwarded-For is honoured when
// no list is configured: loopback and private ranges, which covers a reverse
// proxy on the same host, LAN, or container network. A client connecting
// directly from a public address can never choose its own client IP.
var DefaultTrustedProxies = []string{
	"127.0.0.0/8", "::1/128",
	"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
	"fc00::/7",
}

// TrustedProxyList returns the proxies to pass to gin's SetTrustedProxies.
// An empty setting yields DefaultTrustedProxies; "none" yields nil, so the
// client IP is always the TCP peer.
func (c *Config) TrustedProxyList() []string {
	v := strings.TrimSpace(c.TrustedProxies)
	switch strings.ToLower(v) {
	case "":
		return DefaultTrustedProxies
	case "none":
		return nil
	}
	var out []string
	for _, p := range strings.Split(v, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// SaveJSON writes the current configuration to the JSON config file.
// The encryption key is NEVER written to disk; it must be supplied via env var or CLI flag.
func (c *Config) SaveJSON() error {
	fileCfg := jsonFileConfig{
		Listen:        c.Listen,
		DBFile:        c.DBFile,
		RecordingsDir: c.RecordingsDir,
		SSLListen:     c.SSLListen,
		SSLCert:       c.SSLCert,
		SSLKey:        c.SSLKey,
		SSLAutoCert:   c.SSLAutoCert,
		Timezone:      c.Timezone,

		TrustedProxies: c.TrustedProxies,
	}

	data, err := json.MarshalIndent(fileCfg, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	slog.Info("saving configuration", "file", c.ConfigFile)
	return os.WriteFile(c.ConfigFile, data, 0o600)
}

// ResolveEncryptionKey reads the encryption key from a file if EncryptionKeyFile is set.
// Must be called after Load() and before any DB operations.
func (c *Config) ResolveEncryptionKey() error {
	if c.EncryptionKeyFile != "" {
		data, err := os.ReadFile(c.EncryptionKeyFile)
		if err != nil {
			return fmt.Errorf("read encryption key file: %w", err)
		}
		c.EncryptionKey = strings.TrimSpace(string(data))
	}
	return nil
}

// String returns a safe string representation (no secrets).
func (c *Config) String() string {
	return fmt.Sprintf("listen=%s db-file=%s recordings-dir=%s ssl-listen=%s ssl-auto-cert=%s timezone=%s",
		c.Listen, c.DBFile, c.RecordingsDir, c.SSLListen, c.SSLAutoCert, c.Timezone)
}

// ValidateJSONFile validates a startup JSON config file and basic host filesystem assumptions.
func ValidateJSONFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("config file not found: %s", path)
		}
		return fmt.Errorf("read config file: %w", err)
	}

	var fileCfg jsonFileConfig
	if err := json.Unmarshal(data, &fileCfg); err != nil {
		return fmt.Errorf("parse JSON config: %w", err)
	}

	if fileCfg.LegacyEncryptionKey != "" {
		return fmt.Errorf("invalid config: the 'encryption_key' field is not allowed in the JSON config — supply the key via --encryption-key, --encryption-key-file, or SQUELCH_ENCRYPTION_KEY")
	}

	if fileCfg.Listen == "" {
		return fmt.Errorf("invalid config: listen is required")
	}
	if _, err := net.ResolveTCPAddr("tcp", fileCfg.Listen); err != nil {
		return fmt.Errorf("invalid listen address %q: %w", fileCfg.Listen, err)
	}

	if fileCfg.DBFile == "" {
		return fmt.Errorf("invalid config: db_file is required")
	}
	if err := ensureParentDirWritable(fileCfg.DBFile); err != nil {
		return fmt.Errorf("db_file path is not writable: %w", err)
	}

	if fileCfg.RecordingsDir == "" {
		return fmt.Errorf("invalid config: recordings_dir is required")
	}
	if err := ensureDirWritable(fileCfg.RecordingsDir); err != nil {
		return fmt.Errorf("recordings_dir is not writable: %w", err)
	}

	return nil
}

func ensureParentDirWritable(path string) error {
	dir := filepath.Dir(path)
	return ensureDirWritable(dir)
}

func ensureDirWritable(path string) error {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(path, ".squelch-writecheck-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Remove(name)
}

// PrintUsage writes the full CLI help text to w.
func PrintUsage(w io.Writer) {
	fmt.Fprintf(w, `Squelch — Radio Call Manager (v%s)

Usage:
  squelch [flags]                   Start the server
  squelch <command> [args]          Run a command
  squelch help [command]            Show help for a command

Commands:
  setup               Install Squelch as a system service
  upgrade             Upgrade the installed binary (with service restart)
  config validate     Validate a JSON config file
  service doctor      Show service installation and status diagnostics
  login               Authenticate with a running server (saves token)
  logout              Remove saved authentication token
  change-password     Change the current user's password
  config-get [key]    Retrieve application settings (all or by key)
  config-set <k> <v>  Update an application setting
  user-add            Create a new user (interactive)
  user-remove <user>  Delete a user by username

Server Flags:
  --listen <addr>         HTTP listen address (default ":3022")
  --db-file <path>        SQLite database file path (default "squelch.db")
  --recordings-dir <dir>  Directory for call audio recordings
  --timezone <tz>         IANA timezone (e.g. America/New_York)
  --trusted-proxies <list> Proxy IPs/CIDRs allowed to set X-Forwarded-For
                          (default: loopback + private ranges; "none" = off)
  --config <path>         Path to JSON config file (default "squelch.json")
  --config-save           Write current flags to JSON config file and exit
  --version               Print version and exit

SSL/TLS Flags:
  --ssl-listen <addr>     HTTPS listen address (default ":443" when SSL enabled)
  --ssl-cert <path>       TLS certificate file (PEM)
  --ssl-key <path>        TLS private key file (PEM)
  --ssl-auto-cert <host>  Enable Let's Encrypt for this domain

Encryption Flags:
  --encryption-key <key>       AES-256 key for encrypting secrets at rest
  --encryption-key-file <path> Read encryption key from a file

Service Flags:
  --service <action>      Service control: install, uninstall, start, stop, restart
  --admin-password <pw>   Reset first admin user's password on startup

CLI Flags (for remote commands):
  --server <url>          Server URL (default "http://localhost:3022")
                          Also: SQUELCH_SERVER env var

Environment Variables:
  SQUELCH_LISTEN          Equivalent to --listen
  SQUELCH_DB_FILE         Equivalent to --db-file
  SQUELCH_RECORDINGS_DIR  Equivalent to --recordings-dir
  SQUELCH_SSL_LISTEN      Equivalent to --ssl-listen
  SQUELCH_SSL_CERT        Equivalent to --ssl-cert
  SQUELCH_SSL_KEY         Equivalent to --ssl-key
  SQUELCH_SSL_AUTO_CERT   Equivalent to --ssl-auto-cert
  SQUELCH_ENCRYPTION_KEY       Equivalent to --encryption-key
  SQUELCH_ENCRYPTION_KEY_FILE  Equivalent to --encryption-key-file
  SQUELCH_ADMIN_PASSWORD  Equivalent to --admin-password
  SQUELCH_TIMEZONE        Equivalent to --timezone
  SQUELCH_TRUSTED_PROXIES Equivalent to --trusted-proxies
  SQUELCH_SERVER          Server URL for CLI commands
  TZ                          Fallback timezone

Configuration Precedence:
  CLI flags > environment variables > JSON config file > built-in defaults

Run 'squelch help <command>' for details on a specific command.
`, Version)
}

// commandHelp maps command names to their detailed help text.
var commandHelp = map[string]string{
	"setup": `Usage: squelch setup [flags]

Install Squelch as a system service. Creates config file, database
directory, recordings directory, copies the binary, and registers the service.

Flags:
  --listen <addr>          HTTP listen address (default "127.0.0.1:3022")
  --db-file <path>         SQLite database file path
  --recordings-dir <dir>   Directory for call audio recordings
  --config <path>          Path to JSON config file
  --install-binary <path>  Path where executable is installed
  --interactive            Prompt for setup values interactively
  --force                  Overwrite/reinstall when setup already exists

Examples:
  squelch setup --interactive
  squelch setup --listen 0.0.0.0:8080 --force`,

	"upgrade": `Usage: squelch upgrade [flags]

Upgrade the installed Squelch binary. Stops the service, copies the
new binary, and restarts if it was previously running.

Flags:
  --binary <path>          Path to new executable (default: current executable)
  --install-binary <path>  Installed executable path
  --config <path>          Path to JSON config file

Examples:
  squelch upgrade
  squelch upgrade --binary /tmp/squelch-new`,

	"config": `Usage: squelch config validate [flags]

Validate a JSON configuration file. Checks JSON syntax, required fields,
listen address format, and filesystem permissions.

Flags:
  --config <path>  Path to JSON config file

Examples:
  squelch config validate
  squelch config validate --config /etc/squelch/squelch.json`,

	"service": `Usage: squelch service doctor

Show service installation status and diagnostics, including whether the
service is installed, running, and the default config/binary paths.

Examples:
  squelch service doctor`,

	"login": `Usage: squelch login [flags]

Authenticate with a running Squelch server. Prompts for username and
password interactively. On success, saves the JWT to ~/.squelch-token.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch login
  squelch login --server https://scanner.example.com`,

	"logout": `Usage: squelch logout

Remove the saved authentication token (~/.squelch-token).

Examples:
  squelch logout`,

	"change-password": `Usage: squelch change-password [flags]

Change the current user's password. Prompts for the current password
and the new password (with confirmation). Requires prior login.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch change-password`,

	"config-get": `Usage: squelch config-get [key] [flags]

Retrieve application settings from the running server. Without a key,
prints all settings. With a key, prints only that setting. Requires
admin login.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch config-get
  squelch config-get audioConversion`,

	"config-set": `Usage: squelch config-set <key> <value> [flags]

Update an application setting on the running server. Requires admin login.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch config-set audioConversion 2
  squelch config-set transcriptionEnabled true`,

	"user-add": `Usage: squelch user-add [flags]

Create a new user on the running server. Prompts for username, password,
and role (admin or listener) interactively. Requires admin login.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch user-add`,

	"user-remove": `Usage: squelch user-remove <username> [flags]

Delete a user by username on the running server. Requires admin login.

Flags:
  --server <url>  Server URL (default "http://localhost:3022")

Examples:
  squelch user-remove jdoe`,
}

// RunHelp prints help for a specific command, or the general usage.
// Returns 0 on success, 1 if the command is unknown.
func RunHelp(topic string) int {
	if topic == "" {
		PrintUsage(os.Stdout)
		return 0
	}

	text, ok := commandHelp[topic]
	if !ok {
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\nRun 'squelch help' for a list of commands.\n", topic)
		return 1
	}
	fmt.Println(text)
	return 0
}
