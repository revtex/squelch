// Package main is the entry point for the Squelch server.
//
//	@title			Squelch API
//	@version		1.0	(overridden at runtime with the binary's build version)
//	@description	Radio call manager API — real-time audio streaming, call management, and admin CRUD.
//
//	@BasePath	/api
//
//	@securityDefinitions.apikey	BearerAuth
//	@in							header
//	@name						Authorization
//	@description				Paste the value exactly as copied (already includes Bearer prefix)
//
//	@securityDefinitions.apikey	APIKeyAuth
//	@in							header
//	@name						X-API-Key
//	@description				API key for call upload endpoints
package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/kardianos/service"
	"github.com/revtex/squelch/internal/admin"
	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/cli"
	"github.com/revtex/squelch/internal/config"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/dirmonitor"
	"github.com/revtex/squelch/internal/downstream"
	"github.com/revtex/squelch/internal/handler/routes"
	streamhandler "github.com/revtex/squelch/internal/handler/stream"
	"github.com/revtex/squelch/internal/logging"
	"github.com/revtex/squelch/internal/secrets"
	"github.com/revtex/squelch/internal/seed"
	"github.com/revtex/squelch/internal/trmqtt"
	"github.com/revtex/squelch/internal/ws"
	"golang.org/x/crypto/acme/autocert"
)

var (
	newServiceControllerFn = newServiceController
	serviceControlFn       = service.Control
	executablePathFn       = os.Executable
)

func main() {
	handleLocalSetupCommands()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	if cfg.ShowVersion {
		fmt.Printf("squelch %s\n", config.Version)
		os.Exit(0)
	}

	if cfg.ConfigSave {
		if err := cfg.SaveJSON(); err != nil {
			slog.Error("failed to save configuration", "error", err)
			os.Exit(1)
		}
		fmt.Printf("Configuration saved to %s\n", cfg.ConfigFile)
		os.Exit(0)
	}

	// Check for CLI subcommands (login, logout, config-get, etc.) before starting the server.
	if cli.Run() {
		return
	}

	// kardianos/service configuration.
	svcConfig := &service.Config{
		Name:        "squelch",
		DisplayName: "Squelch",
		Description: "Squelch Radio Call Manager",
		Arguments:   serviceArguments(os.Args[1:]),
	}

	prg := &program{cfg: cfg}
	svc, err := service.New(prg, svcConfig)
	if err != nil {
		slog.Error("failed to create service", "error", err)
		os.Exit(1)
	}

	// Handle service control commands (install/uninstall/start/stop/restart).
	if cfg.Service != "" {
		if err := service.Control(svc, cfg.Service); err != nil {
			slog.Error("service control failed", "action", cfg.Service, "error", err)
			os.Exit(1)
		}
		fmt.Printf("Service action %q completed successfully\n", cfg.Service)
		os.Exit(0)
	}

	// Run the service (works for both foreground and service manager modes).
	if err := svc.Run(); err != nil {
		slog.Error("service run failed", "error", err)
		os.Exit(1)
	}
}

func handleLocalSetupCommands() {
	if len(os.Args) < 2 {
		return
	}

	switch os.Args[1] {
	case "help":
		topic := ""
		if len(os.Args) > 2 {
			topic = os.Args[2]
		}
		os.Exit(config.RunHelp(topic))
	case "setup":
		os.Exit(runSetup(os.Args[2:]))
	case "upgrade":
		os.Exit(runUpgrade(os.Args[2:]))
	case "config":
		if len(os.Args) >= 3 && os.Args[2] == "validate" {
			os.Exit(runConfigValidate(os.Args[3:]))
		}
	case "service":
		if len(os.Args) >= 3 && os.Args[2] == "doctor" {
			os.Exit(runServiceDoctor())
		}
	}
}

func runSetup(args []string) int {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	listen := fs.String("listen", "127.0.0.1:3022", "HTTP listen address")
	dbFile := fs.String("db-file", config.DefaultDBFile, "SQLite database file path")
	recordingsDir := fs.String("recordings-dir", config.DefaultRecordingsDir, "Directory for call audio recordings")
	configFile := fs.String("config", config.DefaultConfigFile, "Path to JSON config file")
	installBinary := fs.String("install-binary", config.DefaultBinaryPath, "Path where Squelch executable is installed")
	interactive := fs.Bool("interactive", false, "Prompt for setup values interactively")
	force := fs.Bool("force", false, "Overwrite/reinstall when setup already exists")
	if err := fs.Parse(args); err != nil {
		return 1
	}

	if *interactive {
		proceed, err := runInteractiveSetup(os.Stdin, os.Stdout, listen, dbFile, recordingsDir, configFile, installBinary)
		if err != nil {
			slog.Error("setup: interactive prompt failed", "error", err)
			return 1
		}
		if !proceed {
			fmt.Println("Setup cancelled.")
			return 0
		}
	}

	configExists := pathExists(*configFile)
	dbExists := pathExists(*dbFile)

	serviceArgs := []string{"--config", *configFile}
	svc, err := newServiceControllerFn(serviceArgs, *installBinary)
	if err != nil {
		slog.Error("setup: failed to initialize service controller", "error", err)
		return 1
	}
	installed, running, statusText := serviceState(svc)

	if (configExists || dbExists || installed) && !*force {
		fmt.Println("Squelch appears to already be set up.")
		fmt.Printf("- config file: %s (exists=%t)\n", *configFile, configExists)
		fmt.Printf("- database file: %s (exists=%t)\n", *dbFile, dbExists)
		fmt.Printf("- service status: installed=%t running=%t (%s)\n", installed, running, statusText)
		fmt.Println("No changes were made. Use --force to overwrite/reinstall.")
		fmt.Println("Next steps: squelch service doctor, squelch config validate --config <path>")
		return 0
	}

	if err := os.MkdirAll(filepath.Dir(*configFile), 0o755); err != nil {
		slog.Error("setup: failed to create config directory", "error", err)
		return 1
	}
	// The database holds secrets; keep its directory private to the service.
	if err := os.MkdirAll(filepath.Dir(*dbFile), 0o700); err != nil {
		slog.Error("setup: failed to create database directory", "error", err)
		return 1
	}
	if err := os.MkdirAll(*recordingsDir, 0o755); err != nil {
		slog.Error("setup: failed to create recordings directory", "error", err)
		return 1
	}

	startupCfg := &config.Config{
		Listen:        *listen,
		DBFile:        *dbFile,
		RecordingsDir: *recordingsDir,
		ConfigFile:    *configFile,
	}
	if err := startupCfg.SaveJSON(); err != nil {
		slog.Error("setup: failed to write config file", "error", err)
		return 1
	}

	if err := config.ValidateJSONFile(*configFile); err != nil {
		slog.Error("setup: config validation failed", "error", err)
		return 1
	}

	exePath, err := executablePathFn()
	if err != nil {
		slog.Error("setup: failed to resolve current executable", "error", err)
		return 1
	}
	if err := installBinaryTo(exePath, *installBinary); err != nil {
		slog.Error("setup: failed to install executable", "source", exePath, "target", *installBinary, "error", err)
		return 1
	}

	if *force && installed {
		_ = serviceControlFn(svc, "stop")
		if err := serviceControlFn(svc, "uninstall"); err != nil {
			slog.Error("setup: failed to uninstall existing service", "error", err)
			return 1
		}
		installed = false
	}

	if !installed {
		if err := serviceControlFn(svc, "install"); err != nil {
			slog.Error("setup: failed to install service", "error", err)
			return 1
		}
	}

	if err := serviceControlFn(svc, "start"); err != nil {
		slog.Error("setup: failed to start service", "error", err)
		return 1
	}

	fmt.Println("Squelch setup completed.")
	fmt.Printf("- executable: %s\n", *installBinary)
	fmt.Printf("- config file: %s\n", *configFile)
	fmt.Printf("- service args: %s\n", strings.Join(serviceArgs, " "))
	fmt.Println("- verify: curl -f http://127.0.0.1:3022/api/health")
	fmt.Println("- doctor: squelch service doctor")
	return 0
}

func runUpgrade(args []string) int {
	fs := flag.NewFlagSet("upgrade", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	binary := fs.String("binary", "", "Path to new Squelch executable (defaults to current executable)")
	installBinary := fs.String("install-binary", config.DefaultBinaryPath, "Installed Squelch executable path")
	configFile := fs.String("config", config.DefaultConfigFile, "Path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return 1
	}

	sourceBinary := strings.TrimSpace(*binary)
	if sourceBinary == "" {
		exePath, err := executablePathFn()
		if err != nil {
			slog.Error("upgrade: failed to resolve current executable", "error", err)
			return 1
		}
		sourceBinary = exePath
	}

	serviceArgs := []string{"--config", *configFile}
	svc, err := newServiceControllerFn(serviceArgs, *installBinary)
	if err != nil {
		slog.Error("upgrade: failed to initialize service controller", "error", err)
		return 1
	}

	installed, running, statusText := serviceState(svc)
	if !installed {
		slog.Error("upgrade: service is not installed")
		fmt.Println("Run 'squelch setup' first.")
		return 1
	}

	if running {
		if err := serviceControlFn(svc, "stop"); err != nil {
			slog.Error("upgrade: failed to stop service", "error", err)
			return 1
		}
	}

	if err := copyBinary(sourceBinary, *installBinary); err != nil {
		slog.Error("upgrade: failed to copy executable", "source", sourceBinary, "target", *installBinary, "error", err)
		return 1
	}

	if running {
		if err := serviceControlFn(svc, "start"); err != nil {
			slog.Error("upgrade: failed to start service", "error", err)
			return 1
		}
	}

	fmt.Println("Squelch upgrade completed.")
	fmt.Printf("- source executable: %s\n", sourceBinary)
	fmt.Printf("- installed executable: %s\n", *installBinary)
	fmt.Printf("- previous service status: %s\n", statusText)
	if running {
		fmt.Println("- service restarted")
	} else {
		fmt.Println("- service was stopped and remains stopped")
	}
	return 0
}

func runConfigValidate(args []string) int {
	fs := flag.NewFlagSet("config validate", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	configFile := fs.String("config", config.DefaultConfigFile, "Path to JSON config file")
	if err := fs.Parse(args); err != nil {
		return 1
	}

	if *configFile == config.DefaultConfigFile && !pathExists(*configFile) {
		slog.Error("config file not found", "path", *configFile)
		fmt.Println("Pass a config path via --config /path/to/squelch.json")
		return 1
	}

	if err := config.ValidateJSONFile(*configFile); err != nil {
		slog.Error("config validation failed", "path", *configFile, "error", err)
		return 1
	}

	fmt.Printf("Config is valid: %s\n", *configFile)
	return 0
}

func runServiceDoctor() int {
	svc, err := newServiceControllerFn(nil, config.DefaultBinaryPath)
	if err != nil {
		slog.Error("service doctor: failed to initialize service controller", "error", err)
		return 1
	}

	installed, running, statusText := serviceState(svc)
	fmt.Println("Squelch Service Doctor")
	fmt.Printf("- installed: %t\n", installed)
	fmt.Printf("- running:   %t\n", running)
	fmt.Printf("- status:    %s\n", statusText)
	fmt.Printf("- default config path: %s\n", config.DefaultConfigFile)
	fmt.Printf("- default executable path: %s\n", config.DefaultBinaryPath)

	if !installed {
		fmt.Println("- hint: install with 'squelch setup' or 'squelch --service install --config /path/to/squelch.json'")
		return 0
	}

	if !running {
		fmt.Println("- hint: start with 'squelch --service start'")
	}

	fmt.Println("- hint: validate config with 'squelch config validate --config /path/to/squelch.json'")
	return 0
}

func newServiceController(args []string, executable string) (service.Service, error) {
	svcConfig := &service.Config{
		Name:        "squelch",
		DisplayName: "Squelch",
		Description: "Squelch Radio Call Manager",
		Arguments:   args,
		Executable:  executable,
	}
	return service.New(&program{}, svcConfig)
}

func serviceState(svc service.Service) (installed bool, running bool, statusText string) {
	status, err := svc.Status()
	if err != nil {
		msg := strings.ToLower(err.Error())
		if strings.Contains(msg, "not installed") || strings.Contains(msg, "no such") || strings.Contains(msg, "could not be found") {
			return false, false, "not installed"
		}
		return true, false, "unknown"
	}

	switch status {
	case service.StatusRunning:
		return true, true, "running"
	case service.StatusStopped:
		return true, false, "stopped"
	default:
		return true, false, "unknown"
	}
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func runInteractiveSetup(
	in io.Reader,
	out io.Writer,
	listen, dbFile, recordingsDir, configFile, installBinary *string,
) (bool, error) {
	reader := bufio.NewReader(in)
	fmt.Fprintln(out, "Squelch interactive setup")

	var err error
	if *listen, err = promptWithDefault(reader, out, "Listen address", *listen); err != nil {
		return false, err
	}
	if *dbFile, err = promptWithDefault(reader, out, "Database file", *dbFile); err != nil {
		return false, err
	}
	if *recordingsDir, err = promptWithDefault(reader, out, "Recordings directory", *recordingsDir); err != nil {
		return false, err
	}
	if *configFile, err = promptWithDefault(reader, out, "Config file", *configFile); err != nil {
		return false, err
	}
	if *installBinary, err = promptWithDefault(reader, out, "Install executable path", *installBinary); err != nil {
		return false, err
	}

	answer, err := promptWithDefault(reader, out, "Proceed with setup? [y/N]", "n")
	if err != nil {
		return false, err
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes", nil
}

func installBinaryTo(sourcePath, targetPath string) error {
	same, err := samePath(sourcePath, targetPath)
	if err != nil {
		return err
	}
	if same {
		return nil
	}

	absSource, err := filepath.Abs(filepath.Clean(sourcePath))
	if err != nil {
		return fmt.Errorf("resolve source path: %w", err)
	}
	absTarget, err := filepath.Abs(filepath.Clean(targetPath))
	if err != nil {
		return fmt.Errorf("resolve target path: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(absTarget), 0o755); err != nil {
		return err
	}

	// On Windows the running binary is locked and cannot be renamed/moved.
	// Use copy everywhere for consistency; the source stays in place.
	if err := copyBinary(absSource, absTarget); err != nil {
		return err
	}

	// Try to remove the source after a successful copy; ignore errors
	// (e.g. Windows locks, read-only mounts, same filesystem with hardlinks).
	// absSource is validated inside copyBinary (must be a regular file).
	_ = os.Remove(absSource)
	return nil
}

func copyBinary(sourcePath, targetPath string) error {
	// Validate the source path before opening: resolve it to an absolute
	// cleaned form and ensure it's a regular file (not a symlink,
	// directory, device, pipe, etc.). The path comes from CLI arguments,
	// so the operator has full authority here, but the validation
	// short-circuits obvious mistakes (e.g. pointing at /dev/zero or a
	// directory) and satisfies static analysis taint tracking.
	absSource, err := filepath.Abs(filepath.Clean(sourcePath))
	if err != nil {
		return fmt.Errorf("resolve source path: %w", err)
	}
	fi, err := os.Lstat(absSource)
	if err != nil {
		return fmt.Errorf("stat source binary: %w", err)
	}
	if !fi.Mode().IsRegular() {
		return fmt.Errorf("source binary is not a regular file: %s", absSource)
	}

	// Normalise the destination path too. This constrains the temp file
	// we create inside Dir(targetPath) and the subsequent Rename/Remove
	// to a canonical location.
	absTarget, err := filepath.Abs(filepath.Clean(targetPath))
	if err != nil {
		return fmt.Errorf("resolve target path: %w", err)
	}
	targetDir := filepath.Dir(absTarget)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}

	in, err := os.Open(absSource)
	if err != nil {
		return err
	}
	defer in.Close()

	tmpFile, err := os.CreateTemp(targetDir, ".squelch-bin-*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	// Guard every cleanup call behind a check that the temp file still
	// lives under the validated targetDir. CreateTemp returns a path we
	// constructed, so this is defence-in-depth against any future change
	// and a narrowing signal for static taint analysis.
	removeTmp := func() {
		if rel, relErr := filepath.Rel(targetDir, tmpName); relErr != nil || strings.HasPrefix(rel, "..") || rel == "." {
			return
		}
		_ = os.Remove(tmpName)
	}

	if _, err := io.Copy(tmpFile, in); err != nil {
		_ = tmpFile.Close()
		removeTmp()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		removeTmp()
		return err
	}
	// Set executable permission; no-op on Windows.
	_ = os.Chmod(tmpName, 0o755)
	if err := os.Rename(tmpName, absTarget); err != nil {
		removeTmp()
		return err
	}
	return nil
}

func samePath(a, b string) (bool, error) {
	aAbs, err := filepath.Abs(a)
	if err != nil {
		return false, err
	}
	bAbs, err := filepath.Abs(b)
	if err != nil {
		return false, err
	}
	return aAbs == bAbs, nil
}

func promptWithDefault(reader *bufio.Reader, out io.Writer, label, def string) (string, error) {
	fmt.Fprintf(out, "%s [%s]: ", label, def)
	line, err := reader.ReadString('\n')
	if err != nil && err != io.EOF {
		return "", err
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return def, nil
	}
	return line, nil
}

// serviceArguments returns startup arguments to persist in service definitions.
// It strips transient flags that should not be saved (service control, admin password reset, etc.).
func serviceArguments(args []string) []string {
	// Flags that take a value and must not be persisted.
	stripValue := map[string]bool{
		"service":             true,
		"admin-password":      true,
		"encryption-key":      true,
		"encryption-key-file": true,
	}
	// Boolean flags that must not be persisted.
	stripBool := map[string]bool{
		"config-save": true,
		"version":     true,
	}

	out := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		a := args[i]
		// The flag package accepts -name and --name, each optionally with
		// =value, so normalise all four spellings before matching.
		name, hasValue := "", false
		if len(a) > 1 && a[0] == '-' && a != "--" {
			name = strings.TrimPrefix(strings.TrimPrefix(a, "-"), "-")
			name, _, hasValue = strings.Cut(name, "=")
		}
		switch {
		case stripValue[name]:
			// Skip this flag and, in the separate-argument form, its value.
			if !hasValue && i+1 < len(args) {
				i++
			}
			continue
		case stripBool[name]:
			continue
		}
		out = append(out, a)
	}
	return out
}

// program implements the kardianos/service.Interface.
type program struct {
	cfg  *config.Config
	stop context.CancelFunc
}

func (p *program) Start(_ service.Service) error {
	go p.run()
	return nil
}

func (p *program) Stop(_ service.Service) error {
	if p.stop != nil {
		p.stop()
	}
	return nil
}

func (p *program) run() {
	cfg := p.cfg

	// Apply configured timezone so recorder timestamps are interpreted correctly.
	if cfg.Timezone != "" {
		loc, err := time.LoadLocation(cfg.Timezone)
		if err != nil {
			slog.Error("invalid timezone", "timezone", cfg.Timezone, "error", err)
			os.Exit(1)
		}
		time.Local = loc
	}

	// Determine log file path (next to the database file).
	logFilePath := strings.TrimSuffix(cfg.DBFile, ".db") + ".log"

	// Load historical logs into the ring buffer before configuring
	// the new slog handler (so they appear in the admin UI immediately).
	logging.LoadHistoricalLogs(logFilePath)

	// Configure structured logging.
	if os.Getenv("SQUELCH_ENV") == "development" {
		logging.Configure(true, logFilePath)
	} else {
		logging.Configure(false, logFilePath)
		gin.SetMode(gin.ReleaseMode)
	}
	defer logging.CloseLogFile()

	// Compute display values for the startup banner (printed after all
	// feature-flag checks complete, down below).
	listenURL := cfg.Listen
	if listenURL[0] == ':' {
		listenURL = "0.0.0.0" + listenURL
	}
	scheme := "http"
	if cfg.SSLCert != "" || cfg.SSLAutoCert != "" {
		scheme = "https"
	}

	// Startup checks: verify external tool availability.
	checkExternalTools()

	// Open database (runs migrations automatically).
	sqlDB, err := db.Open(cfg.DBFile)
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer sqlDB.Close()

	// Seed default data.
	if err := seed.Seed(context.Background(), sqlDB); err != nil {
		slog.Error("failed to seed database", "error", err)
		os.Exit(1)
	}

	queries := db.New(sqlDB)

	if cfg.AdminPassword != "" {
		if err := resetAdminPassword(context.Background(), queries, cfg.AdminPassword); err != nil {
			slog.Error("admin password reset failed", "error", err)
			os.Exit(1)
		}
	}

	// Resolve encryption key (from file if configured).
	if err := cfg.ResolveEncryptionKey(); err != nil {
		slog.Error("failed to resolve encryption key", "error", err)
		os.Exit(1)
	}

	// Gather everything the startup banner needs BEFORE the noisy migration/
	// init phase, so the banner is the first thing users see in the log.
	hasFFmpeg := audio.CheckFFmpeg()
	hasFDKAAC := false
	if hasFFmpeg {
		hasFDKAAC = audio.CheckLibFDKAAC()
	}

	persistedLogLevel := ""
	if setting, err := queries.GetSetting(context.Background(), "logLevel"); err == nil {
		persistedLogLevel = setting.Value
		if err := logging.SetLevel(setting.Value); err != nil {
			slog.Warn("invalid persisted log level, keeping default", "value", setting.Value, "error", err)
		}
	}
	publicAccess := ""
	if setting, err := queries.GetSetting(context.Background(), "publicAccess"); err == nil {
		publicAccess = setting.Value
	}
	autoPopulateSystems := ""
	if setting, err := queries.GetSetting(context.Background(), "autoPopulateSystems"); err == nil {
		autoPopulateSystems = setting.Value
	}
	whisperConfigured := false
	if setting, err := queries.GetSetting(context.Background(), "transcriptionEnabled"); err == nil && setting.Value == "true" {
		whisperConfigured = true
	}

	// Human-readable startup banner — printed FIRST so it is visible above
	// any subsequent JSON log output.
	printStartupBanner(startupBannerData{
		Version:             config.Version,
		URL:                 scheme + "://" + listenURL,
		Database:            cfg.DBFile,
		Recordings:          cfg.RecordingsDir,
		Timezone:            cfg.Timezone,
		LogLevel:            logging.GetLevel(),
		SSL:                 cfg.SSLAutoCert != "" || (cfg.SSLCert != "" && cfg.SSLKey != ""),
		EncryptionAtRest:    cfg.EncryptionKey != "",
		JWTSecretExternal:   os.Getenv("SQUELCH_JWT_SECRET") != "",
		FFmpeg:              hasFFmpeg,
		FDKAAC:              hasFDKAAC,
		Whisper:             whisperConfigured,
		PublicAccess:        publicAccess == "true",
		AutoPopulateSystems: autoPopulateSystems == "true",
	})

	slog.Debug("server: loaded settings from db",
		"log_level", persistedLogLevel,
		"public_access", publicAccess,
		"auto_populate_systems", autoPopulateSystems,
	)

	// Before touching any secret, confirm they can all still be read.
	// Runs first so that an unmigrated v2 database is reported as such,
	// rather than as the "wrong key?" migrateSecrets would otherwise
	// blame it on.
	if err := secrets.CheckReadable(context.Background(), queries, cfg.EncryptionKey); err != nil {
		fmt.Fprintf(os.Stderr, "\nsquelch: %v\n\n", err)
		os.Exit(1)
	}

	// Run secrets-at-rest encryption migration.
	if err := migrateSecrets(context.Background(), queries, sqlDB, cfg.EncryptionKey); err != nil {
		slog.Error("secrets encryption migration failed", "error", err)
		os.Exit(1)
	}

	// Initialise persistent JWT signing secret. Must run AFTER migrateSecrets so
	// any pre-existing plaintext value gets encrypted, and AFTER the encryption
	// key has been resolved.
	if err := auth.InitJWTSecret(context.Background(), &jwtSecretStore{q: queries}, cfg.EncryptionKey); err != nil {
		slog.Error("failed to initialise JWT secret", "error", err)
		os.Exit(1)
	}

	// Set up Gin router with registered routes.
	router := gin.New()
	// Multipart parts beyond this are spooled to temp files rather than held
	// in memory. Legacy uploads may carry the API key as a form field, so the
	// form is parsed before the key is checked; a small threshold keeps an
	// unauthenticated body from costing more than a few MiB of heap. Request
	// size itself is capped per route by MaxBodySize.
	router.MaxMultipartMemory = 8 << 20
	// Only honour X-Forwarded-For from configured proxies, so a direct client
	// cannot pick the IP that login lockout and rate limits are keyed on.
	if err := router.SetTrustedProxies(cfg.TrustedProxyList()); err != nil {
		slog.Error("invalid trusted proxies", "value", cfg.TrustedProxies, "error", err)
		os.Exit(1)
	}
	router.Use(gin.Recovery())

	// Create the shutdown context early so it can be passed to long-lived components
	// (e.g. RateLimiter cleanup goroutine) to enable clean shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	p.stop = stop

	rateLimiter := auth.NewRateLimiter(ctx)

	// Set up bounded FFmpeg worker pool and audio processor.
	pool := audio.NewWorkerPool(ctx)
	processor := audio.NewProcessor(cfg.RecordingsDir, pool)

	// If ffmpeg is not available, force audioConversion to disabled in the DB.
	if !hasFFmpeg {
		if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{
			Key: "audioConversion", Value: "0",
		}); err != nil {
			slog.Error("failed to force-disable audioConversion", "error", err)
		}
	}

	// Set up transcription pool (go-whisper HTTP API).
	// Set up transcription manager (go-whisper HTTP API, hot-reloadable).
	var initialPool *audio.TranscriberPool
	var poolCancel context.CancelFunc
	hasWhisper := false
	if tEnabled, _ := queries.GetSetting(context.Background(), "transcriptionEnabled"); tEnabled.Value == "true" {
		tURL, _ := queries.GetSetting(context.Background(), "transcriptionUrl")
		tModel, _ := queries.GetSetting(context.Background(), "transcriptionModel")
		tLang, _ := queries.GetSetting(context.Background(), "transcriptionLanguage")
		tDiarize, _ := queries.GetSetting(context.Background(), "transcriptionDiarize")

		baseURL := tURL.Value
		if baseURL == "" {
			baseURL = "http://localhost:8081"
		}
		model := tModel.Value
		if model == "" {
			model = "ggml-base"
		}

		poolCtx, pCancel := context.WithCancel(ctx)
		tp, err := audio.NewTranscriberPool(poolCtx, 2, baseURL, model, tLang.Value, tDiarize.Value == "true")
		if err != nil {
			pCancel()
			slog.Warn("transcription pool creation failed, disabling", "error", err)
		} else if err := tp.Ping(poolCtx); err != nil {
			pCancel()
			slog.Warn("go-whisper unreachable, disabling transcription", "url", baseURL, "error", err)
		} else {
			initialPool = tp
			poolCancel = pCancel
			hasWhisper = true
			slog.Info("transcription enabled", "url", baseURL, "model", model, "diarize", tDiarize.Value == "true")
		}
	}
	transcriberMgr := audio.NewTranscriberManager(ctx, initialPool, poolCancel)

	// Start background call pruner.
	go audio.PruneLoop(ctx, queries, cfg.RecordingsDir)

	// Start background refresh token cleanup (every hour).
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := queries.DeleteExpiredRefreshTokens(ctx, time.Now().Unix()); err != nil {
					slog.Error("failed to cleanup expired refresh tokens", "error", err)
				}
			}
		}
	}()

	// Create and start WebSocket hub.
	// Services are created first so their Reloader interfaces can be injected into the hub.
	dsService := downstream.NewService(queries, processor, cfg.EncryptionKey)
	dsService.Start(ctx)

	hub := ws.NewHub(queries, config.Version, ws.HubDeps{
		SQLDB:             sqlDB,
		DirMonitorReload:  nil, // set below after dwService is created
		DownstreamReload:  dsService,
		TranscriberReload: transcriberMgr,
		FFmpegAvailable:   hasFFmpeg,
		FDKAACAvailable:   hasFDKAAC,
		WhisperAvailable:  hasWhisper,
		RecordingsDir:     cfg.RecordingsDir,
		EncryptionKey:     cfg.EncryptionKey,
	})
	// Every live connection — listener and admin sockets, audio streams —
	// reports here, for the admin's connection list.
	conns := connections.New()
	conns.SetOnChange(func() { hub.BroadcastAdminEvent("connections.updated", nil) })
	hub.SetConnections(conns)
	go hub.Run(ctx)

	// Continuous listener audio stream. Startup shells out to FFmpeg to
	// build the silence filler, so a host without a usable encoder simply
	// leaves the endpoint answering 503 instead of failing to boot.
	streamMgr := streamhandler.NewManager(queries, cfg.RecordingsDir)
	streamMgr.SetConnections(conns)
	if err := streamMgr.Start(ctx); err != nil {
		slog.Warn("stream: continuous audio stream disabled", "error", err)
	} else {
		hub.SetCallNotifier(streamMgr.Notify)
		hub.SetSessionRevoker(streamMgr)
		// Lets a stream listener hold a call's now-playing label until its
		// own playback reaches that call, instead of showing it the moment
		// the call arrives — clients run several seconds behind the head.
		streamMgr.SetCuePublisher(hub.SendStreamCue)
	}

	dwService := dirmonitor.NewService(queries, processor, hub, dsService, transcriberMgr)
	dwService.Start(ctx)
	hub.SetDirMonitorReloader(dwService)

	// trunk-recorder MQTT subscriber. One autopaho client per tr_instances row;
	// supervised reconnect, in-memory snapshot. Events fan out to admin
	// clients via hub.BroadcastAdminEvent under tr.* topic names defined on
	// trmqtt.Event.Type. The payload is the typed frame struct from the
	// trmqtt package — admin WS handlers JSON-encode it as-is.
	trManager := trmqtt.NewManager(queries, cfg.EncryptionKey, nil)
	if err := trManager.Start(ctx); err != nil {
		slog.Error("trmqtt: failed to start manager", "error", err)
	}
	trEvents, trUnsubscribe := trManager.Subscribe()
	go func() {
		defer trUnsubscribe()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-trEvents:
				if !ok {
					return
				}
				// Admin event topic is exactly the trmqtt EventType value.
				// Payload includes instance_id/label so the frontend can
				// route to the right per-instance view.
				hub.BroadcastAdminEvent(string(ev.Type), map[string]any{
					"instanceId": ev.InstanceID,
					"label":      ev.Label,
					"payload":    ev.Payload,
					"error":      formatTRMqttErr(ev.Err),
				})
			}
		}
	}()

	// Start transcription result consumer (stores results in DB, broadcasts TRN).
	go consumeTranscriptionResults(ctx, queries, hub, transcriberMgr)

	routes.RegisterRoutes(router, routes.Deps{
		Queries:            queries,
		RateLimiter:        rateLimiter,
		Processor:          processor,
		Hub:                hub,
		SQLDB:              sqlDB,
		DirMonitorReloader: dwService,
		DownstreamReloader: dsService,
		DownstreamNotifier: dsService,
		Transcriber:        transcriberMgr,
		Version:            config.Version,
		FFmpegAvailable:    hasFFmpeg,
		FDKAACAvailable:    hasFDKAAC,
		WhisperAvailable:   hasWhisper,
		TRMqttManager:      trManager,
		EncryptionKey:      cfg.EncryptionKey,
		StreamManager:      streamMgr,
	})

	// Create HTTP server.
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           router, // may be replaced below when SSL is enabled
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	// Channel to signal fatal server errors to the main goroutine.
	serverErr := make(chan error, 2)

	// When SSL is configured, replace the HTTP handler with a redirect so that
	// plaintext application traffic is never served to clients.
	sslEnabled := cfg.SSLAutoCert != "" || (cfg.SSLCert != "" && cfg.SSLKey != "")
	if sslEnabled {
		srv.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, "https://"+r.Host+r.RequestURI, http.StatusMovedPermanently)
		})
	}

	// Start HTTP server in a goroutine.
	go func() {
		slog.Info("HTTP server listening", "addr", cfg.Listen)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Start TLS server if configured.
	var tlsSrv *http.Server
	if cfg.SSLAutoCert != "" {
		tlsSrv = p.startAutoCertServer(cfg, router, srv, serverErr)
	} else if cfg.SSLCert != "" && cfg.SSLKey != "" {
		tlsSrv = p.startTLSServer(cfg, router, serverErr)
	}

	slog.Info("server: startup complete",
		"version", config.Version,
		"addr", cfg.Listen,
		"ssl_enabled", sslEnabled,
		"db", cfg.DBFile,
		"recordings_dir", cfg.RecordingsDir,
		"log_level", logging.GetLevel(),
		"timezone", cfg.Timezone,
		"encryption_key_loaded", cfg.EncryptionKey != "",
		"ffmpeg_available", hasFFmpeg,
		"fdk_aac_available", hasFDKAAC,
		"whisper_available", hasWhisper,
		"public_access", publicAccess == "true",
		"auto_populate_systems", autoPopulateSystems == "true",
	)

	// Block until signal or server error.
	select {
	case <-ctx.Done():
		slog.Info("shutting down server...")
	case err := <-serverErr:
		slog.Error("server error", "error", err)
		stop()
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server shutdown error", "error", err)
	}

	if tlsSrv != nil {
		if err := tlsSrv.Shutdown(shutdownCtx); err != nil {
			slog.Error("TLS server shutdown error", "error", err)
		}
	}

	dsService.Stop()
	trManager.Stop()
	slog.Info("server: shutdown complete")
}

// startTLSServer starts an HTTPS server with the provided certificate and key files.
func (p *program) startTLSServer(cfg *config.Config, handler http.Handler, errCh chan<- error) *http.Server {
	addr := cfg.SSLListen
	if addr == "" {
		addr = ":443"
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		slog.Info("TLS server listening", "addr", addr, "cert", cfg.SSLCert)
		if err := srv.ListenAndServeTLS(cfg.SSLCert, cfg.SSLKey); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	return srv
}

// startAutoCertServer starts an HTTPS server with Let's Encrypt auto-certificate management.
// httpSrv is the already-started HTTP server whose handler is augmented with the
// ACME HTTP-01 challenge responder for certificate issuance without ALPN.
func (p *program) startAutoCertServer(cfg *config.Config, handler http.Handler, httpSrv *http.Server, errCh chan<- error) *http.Server {
	addr := cfg.SSLListen
	if addr == "" {
		addr = ":443"
	}

	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(cfg.SSLAutoCert),
		Cache:      autocert.DirCache("autocert-cache"),
	}

	// Augment the HTTP listener to handle ACME HTTP-01 challenges.
	// The existing redirect handler is preserved for non-challenge requests.
	httpSrv.Handler = m.HTTPHandler(httpSrv.Handler)

	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		TLSConfig:         m.TLSConfig(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		slog.Info("TLS server listening (auto-cert)", "addr", addr, "domain", cfg.SSLAutoCert)
		if err := srv.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	return srv
}

// checkExternalTools logs warnings if optional external tools are not available.
func checkExternalTools() {
	// Startup-only advisory messages; actual enforcement is in audio.CheckFFmpeg
	// which returns a boolean used to gate features.
}

// startupBannerData carries everything the human-readable startup banner shows.
type startupBannerData struct {
	Version             string
	URL                 string
	Database            string
	Recordings          string
	Timezone            string
	LogLevel            string
	SSL                 bool
	EncryptionAtRest    bool
	JWTSecretExternal   bool
	FFmpeg              bool
	FDKAAC              bool
	Whisper             bool
	PublicAccess        bool
	AutoPopulateSystems bool
}

// printStartupBanner writes a compact, human-readable startup summary to
// stdout. The same information is emitted as structured JSON via
// slog.Info("server: startup complete", ...) for log aggregation.
func printStartupBanner(d startupBannerData) {
	yn := func(b bool) string {
		if b {
			return "yes"
		}
		return "no"
	}
	jwtSource := "in database"
	if d.JWTSecretExternal {
		jwtSource = "external (env)"
	}
	const innerWidth = 55
	border := strings.Repeat("─", innerWidth)
	title := "O P E N S C A N N E R   v" + d.Version
	pad := (innerWidth - len(title)) / 2
	if pad < 0 {
		pad = 0
	}
	rightPad := innerWidth - pad - len(title)
	if rightPad < 0 {
		rightPad = 0
	}
	headerLine := strings.Repeat(" ", pad) + title + strings.Repeat(" ", rightPad)
	fmt.Fprintf(os.Stdout, "\n"+
		"  ┌"+border+"┐\n"+
		"  │"+headerLine+"│\n"+
		"  └"+border+"┘\n"+
		"  URL ............... %s\n"+
		"  Database .......... %s\n"+
		"  Recordings ........ %s\n"+
		"  Timezone .......... %s\n"+
		"  Log level ......... %s\n"+
		"  TLS enabled ....... %s\n"+
		"  Encryption at rest  %s\n"+
		"  JWT secret ........ %s\n"+
		"  Public access ..... %s\n"+
		"  FFmpeg ............ %s\n"+
		"  libfdk_aac ........ %s\n"+
		"  Transcription ..... %s\n\n",
		d.URL,
		d.Database,
		d.Recordings,
		d.Timezone,
		d.LogLevel,
		yn(d.SSL),
		yn(d.EncryptionAtRest),
		jwtSource,
		yn(d.PublicAccess),
		yn(d.FFmpeg),
		yn(d.FDKAAC),
		yn(d.Whisper),
	)

	if !d.EncryptionAtRest {
		fmt.Fprintf(os.Stdout,
			"  ⚠ WARNING: encryption at rest is disabled — the JWT signing secret and\n"+
				"    downstream API keys are stored in plaintext in the database. Anyone\n"+
				"    with read access to the DB file can forge admin tokens.\n"+
				"    Fix: set SQUELCH_ENCRYPTION_KEY (or --encryption-key) to a 32-byte\n"+
				"    random value. See docs/deployment-guide.md#keeping-secrets-safe.\n\n")
	}
}

// formatTRMqttErr renders a trmqtt event error as a string suitable for
// inclusion in admin events. Returns "" for a nil error so the admin event
// payload omits the field cleanly when JSON-encoded by the hub.
func formatTRMqttErr(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// consumeTranscriptionResults reads completed transcription jobs, stores them
// in the database, and broadcasts TRN events to WebSocket clients.
func consumeTranscriptionResults(ctx context.Context, queries *db.Queries, hub *ws.Hub, mgr *audio.TranscriberManager) {
	for {
		select {
		case <-ctx.Done():
			return
		case res, ok := <-mgr.Results():
			if !ok {
				return
			}
			if res.Err != nil {
				slog.Error("transcription failed", "call_id", res.CallID, "error", res.Err)
				continue
			}

			// Serialise segments to JSON.
			var segmentsJSON sql.NullString
			if len(res.Result.Segments) > 0 {
				raw, err := json.Marshal(res.Result.Segments)
				if err != nil {
					slog.Error("transcription: failed to marshal segments", "call_id", res.CallID, "error", err)
					continue
				}
				segmentsJSON = sql.NullString{String: string(raw), Valid: true}
			}

			_, err := queries.CreateTranscription(ctx, db.CreateTranscriptionParams{
				CallID:     res.CallID,
				Text:       res.Result.Text,
				Segments:   segmentsJSON,
				Language:   sql.NullString{String: res.Result.Language, Valid: res.Result.Language != ""},
				Model:      sql.NullString{String: mgr.Model(), Valid: true},
				DurationMs: sql.NullInt64{Int64: res.DurationMs, Valid: true},
				CreatedAt:  time.Now().Unix(),
			})
			if err != nil {
				slog.Error("transcription: failed to store", "call_id", res.CallID, "error", err)
				continue
			}

			slog.Info("transcription stored", "call_id", res.CallID, "language", res.Result.Language, "segments", len(res.Result.Segments))

			// Broadcast TRN to the clients allowed to receive this call. If
			// the call can't be loaded its grants are unknown, so skip the
			// broadcast rather than sending it to everyone.
			call, err := queries.GetCall(ctx, res.CallID)
			if err != nil {
				slog.Error("transcription: call lookup failed; not broadcasting", "call_id", res.CallID, "error", err)
				continue
			}
			hub.BroadcastTRN(res.CallID, call.SystemID, call.TalkgroupID.Int64, res.Result.Text, res.Result.Segments)
		}
	}
}

// jwtSecretStore adapts *db.Queries to the auth.InitJWTSecret loader interface.
type jwtSecretStore struct{ q *db.Queries }

func (s *jwtSecretStore) Get(ctx context.Context, key string) (string, error) {
	row, err := s.q.GetSetting(ctx, key)
	if err != nil {
		return "", err
	}
	return row.Value, nil
}

func (s *jwtSecretStore) Upsert(ctx context.Context, key, value string) error {
	return s.q.UpsertSetting(ctx, db.UpsertSettingParams{Key: key, Value: value})
}

// migrateSecrets handles the transition between encrypted and unencrypted states at startup.
//   - Key set + plaintext values → auto-encrypt
//   - Key removed + encrypted values → fail fast
//   - Key set + already encrypted → no-op (or re-encrypt if decrypt fails with old key)
func migrateSecrets(ctx context.Context, queries *db.Queries, sqlDB *sql.DB, encryptionKey string) error {
	settings, err := queries.ListSettings(ctx)
	if err != nil {
		return fmt.Errorf("list settings: %w", err)
	}

	downstreams, err := queries.ListDownstreams(ctx)
	if err != nil {
		return fmt.Errorf("list downstreams: %w", err)
	}

	instances, err := queries.ListTRInstances(ctx)
	if err != nil {
		return fmt.Errorf("list tr instances: %w", err)
	}

	// Check for encrypted values with no key configured.
	if encryptionKey == "" {
		for _, s := range settings {
			if admin.SensitiveSettingKeys[s.Key] && auth.IsEncrypted(s.Value) {
				return fmt.Errorf("setting %q is encrypted but no encryption key is configured — set --encryption-key or SQUELCH_ENCRYPTION_KEY", s.Key)
			}
		}
		for _, ds := range downstreams {
			if auth.IsEncrypted(ds.ApiKey) {
				return fmt.Errorf("downstream %d API key is encrypted but no encryption key is configured — set --encryption-key or SQUELCH_ENCRYPTION_KEY", ds.ID)
			}
		}
		for _, in := range instances {
			if in.PasswordEnc.Valid && auth.IsEncrypted(in.PasswordEnc.String) {
				return fmt.Errorf("trunk recorder instance %d password is encrypted but no encryption key is configured — set --encryption-key or SQUELCH_ENCRYPTION_KEY", in.ID)
			}
		}
		slog.Warn("no encryption key configured — secrets stored unencrypted in database",
			"impact", "JWT signing secret and downstream API keys are stored in plaintext; anyone with read access to the SQLite file can forge admin tokens",
			"fix", "set SQUELCH_ENCRYPTION_KEY (or --encryption-key) to a 32-byte random value; see docs/deployment-guide.md#keeping-secrets-safe")
		return nil
	}

	// Encryption key is configured — encrypt any plaintext sensitive values.
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	qtx := queries.WithTx(tx)
	migrated := 0

	for _, s := range settings {
		if !admin.SensitiveSettingKeys[s.Key] {
			continue
		}
		if s.Value == "" {
			continue
		}
		if auth.IsEncrypted(s.Value) {
			// Verify we can decrypt with the current key.
			if _, err := auth.DecryptString(s.Value, encryptionKey); err != nil {
				return fmt.Errorf("setting %q: cannot decrypt with current key (wrong key?): %w", s.Key, err)
			}
			continue
		}
		// Plaintext → encrypt it.
		encrypted, err := auth.EncryptString(s.Value, encryptionKey)
		if err != nil {
			return fmt.Errorf("encrypt setting %q: %w", s.Key, err)
		}
		if err := qtx.UpsertSetting(ctx, db.UpsertSettingParams{Key: s.Key, Value: encrypted}); err != nil {
			return fmt.Errorf("update setting %q: %w", s.Key, err)
		}
		migrated++
		slog.Info("secrets: encrypted setting", "key", s.Key)
	}

	for _, ds := range downstreams {
		if ds.ApiKey == "" {
			continue
		}
		if auth.IsEncrypted(ds.ApiKey) {
			if _, err := auth.DecryptString(ds.ApiKey, encryptionKey); err != nil {
				return fmt.Errorf("downstream %d: cannot decrypt API key with current key (wrong key?): %w", ds.ID, err)
			}
			continue
		}
		encrypted, err := auth.EncryptString(ds.ApiKey, encryptionKey)
		if err != nil {
			return fmt.Errorf("encrypt downstream %d API key: %w", ds.ID, err)
		}
		if err := qtx.UpdateDownstream(ctx, db.UpdateDownstreamParams{
			ID:          ds.ID,
			Url:         ds.Url,
			ApiKey:      encrypted,
			SystemsJson: ds.SystemsJson,
			Disabled:    ds.Disabled,
			Order:       ds.Order,
		}); err != nil {
			return fmt.Errorf("update downstream %d: %w", ds.ID, err)
		}
		migrated++
		slog.Info("secrets: encrypted downstream API key", "id", ds.ID)
	}

	// Trunk Recorder broker passwords. Added later than the two loops
	// above and missed when the MQTT integration shipped, so a
	// deployment that enabled encryption after configuring an instance
	// kept its broker password in plaintext — the manager warned about
	// it on every connect and nothing ever fixed it.
	for _, in := range instances {
		if !in.PasswordEnc.Valid || in.PasswordEnc.String == "" {
			continue
		}
		if auth.IsEncrypted(in.PasswordEnc.String) {
			if _, err := auth.DecryptString(in.PasswordEnc.String, encryptionKey); err != nil {
				return fmt.Errorf("trunk recorder instance %d: cannot decrypt password with current key (wrong key?): %w", in.ID, err)
			}
			continue
		}
		encrypted, err := auth.EncryptString(in.PasswordEnc.String, encryptionKey)
		if err != nil {
			return fmt.Errorf("encrypt trunk recorder instance %d password: %w", in.ID, err)
		}
		if err := qtx.UpdateTRInstancePassword(ctx, db.UpdateTRInstancePasswordParams{
			ID:          in.ID,
			PasswordEnc: sql.NullString{String: encrypted, Valid: true},
			UpdatedAt:   time.Now().Unix(),
		}); err != nil {
			return fmt.Errorf("update trunk recorder instance %d password: %w", in.ID, err)
		}
		migrated++
		slog.Info("secrets: encrypted trunk recorder broker password", "id", in.ID)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	if migrated > 0 {
		slog.Info("secrets: encryption migration complete", "migrated", migrated)
	}
	return nil
}
