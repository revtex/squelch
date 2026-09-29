package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kardianos/service"
	"github.com/revtex/squelch/internal/config"
)

type fakeService struct {
	status service.Status
}

func (f *fakeService) Run() error                                  { return nil }
func (f *fakeService) Start() error                                { return nil }
func (f *fakeService) Stop() error                                 { return nil }
func (f *fakeService) Restart() error                              { return nil }
func (f *fakeService) Install() error                              { return nil }
func (f *fakeService) Uninstall() error                            { return nil }
func (f *fakeService) Logger(chan<- error) (service.Logger, error) { return nil, nil }
func (f *fakeService) SystemLogger(chan<- error) (service.Logger, error) {
	return nil, nil
}
func (f *fakeService) String() string                  { return "squelch" }
func (f *fakeService) Platform() string                { return "test" }
func (f *fakeService) Status() (service.Status, error) { return f.status, nil }

func TestRunConfigValidate_CustomPathValid(t *testing.T) {
	temp := t.TempDir()
	dbFile := filepath.Join(temp, "squelch.db")
	recDir := filepath.Join(temp, "recordings")
	cfgPath := filepath.Join(temp, "squelch.json")

	cfg := &config.Config{
		Listen:        "127.0.0.1:3022",
		DBFile:        dbFile,
		RecordingsDir: recDir,
		ConfigFile:    cfgPath,
	}
	if err := cfg.SaveJSON(); err != nil {
		t.Fatalf("SaveJSON failed: %v", err)
	}

	if code := runConfigValidate([]string{"--config", cfgPath}); code != 0 {
		t.Fatalf("runConfigValidate returned %d, want 0", code)
	}
}

func TestRunConfigValidate_DefaultPathMissing(t *testing.T) {
	if _, err := os.Stat(config.DefaultConfigFile); err == nil {
		t.Skipf("default config path exists on this host: %s", config.DefaultConfigFile)
	}

	if code := runConfigValidate(nil); code != 1 {
		t.Fatalf("runConfigValidate returned %d, want 1", code)
	}
}

func TestRunSetup_AlreadyConfigured_NoForce(t *testing.T) {
	origNew := newServiceControllerFn
	origControl := serviceControlFn
	origExe := executablePathFn
	defer func() {
		newServiceControllerFn = origNew
		serviceControlFn = origControl
		executablePathFn = origExe
	}()

	temp := t.TempDir()
	cfgPath := filepath.Join(temp, "squelch.json")
	dbPath := filepath.Join(temp, "squelch.db")
	recDir := filepath.Join(temp, "recordings")

	if err := os.WriteFile(cfgPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("write config stub: %v", err)
	}
	if err := os.WriteFile(dbPath, []byte("db"), 0o644); err != nil {
		t.Fatalf("write db stub: %v", err)
	}

	newServiceControllerFn = func(_ []string, _ string) (service.Service, error) {
		return &fakeService{status: service.StatusRunning}, nil
	}
	executablePathFn = func() (string, error) {
		return filepath.Join(temp, "squelch"), nil
	}
	called := false
	serviceControlFn = func(_ service.Service, _ string) error {
		called = true
		return nil
	}

	args := []string{
		"--config", cfgPath,
		"--db-file", dbPath,
		"--recordings-dir", recDir,
		"--install-binary", filepath.Join(temp, "installed", "squelch"),
	}
	if code := runSetup(args); code != 0 {
		t.Fatalf("runSetup returned %d, want 0", code)
	}
	if called {
		t.Fatalf("service control should not be called when setup already exists and --force is not used")
	}
}

func TestRunSetup_ForceReinstallFlow(t *testing.T) {
	origNew := newServiceControllerFn
	origControl := serviceControlFn
	origExe := executablePathFn
	defer func() {
		newServiceControllerFn = origNew
		serviceControlFn = origControl
		executablePathFn = origExe
	}()

	temp := t.TempDir()
	cfgPath := filepath.Join(temp, "squelch.json")
	dbPath := filepath.Join(temp, "squelch.db")
	recDir := filepath.Join(temp, "recordings")

	if err := os.WriteFile(cfgPath, []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("write config stub: %v", err)
	}
	if err := os.WriteFile(dbPath, []byte("db"), 0o644); err != nil {
		t.Fatalf("write db stub: %v", err)
	}

	newServiceControllerFn = func(_ []string, _ string) (service.Service, error) {
		return &fakeService{status: service.StatusStopped}, nil
	}

	exeSource := filepath.Join(temp, "squelch-src")
	if err := os.WriteFile(exeSource, []byte("fake-binary"), 0o755); err != nil {
		t.Fatalf("write fake executable: %v", err)
	}
	executablePathFn = func() (string, error) {
		return exeSource, nil
	}
	installPath := filepath.Join(temp, "installed", "squelch")

	var actions []string
	serviceControlFn = func(_ service.Service, action string) error {
		actions = append(actions, action)
		return nil
	}

	args := []string{
		"--force",
		"--listen", "127.0.0.1:3022",
		"--config", cfgPath,
		"--db-file", dbPath,
		"--recordings-dir", recDir,
		"--install-binary", installPath,
	}
	if code := runSetup(args); code != 0 {
		t.Fatalf("runSetup returned %d, want 0", code)
	}

	wantOrder := []string{"stop", "uninstall", "install", "start"}
	if len(actions) != len(wantOrder) {
		t.Fatalf("service actions count %d, want %d; got=%v", len(actions), len(wantOrder), actions)
	}
	for i, want := range wantOrder {
		if actions[i] != want {
			t.Fatalf("service action[%d]=%q, want %q (all=%v)", i, actions[i], want, actions)
		}
	}

	if _, err := os.Stat(installPath); err != nil {
		t.Fatalf("installed executable missing: %v", err)
	}
	// Source removal is best-effort (Windows locks running binaries),
	// but on this platform (Linux test) it should succeed.
	if _, err := os.Stat(exeSource); !errors.Is(err, os.ErrNotExist) {
		t.Logf("note: source executable still present (expected on Windows): stat err=%v", err)
	}
}

func TestRunUpgrade_RestartsRunningService(t *testing.T) {
	origNew := newServiceControllerFn
	origControl := serviceControlFn
	defer func() {
		newServiceControllerFn = origNew
		serviceControlFn = origControl
	}()

	temp := t.TempDir()
	source := filepath.Join(temp, "squelch-new")
	installPath := filepath.Join(temp, "installed", "squelch")
	if err := os.WriteFile(source, []byte("new-binary"), 0o755); err != nil {
		t.Fatalf("write source binary: %v", err)
	}

	newServiceControllerFn = func(_ []string, executable string) (service.Service, error) {
		if executable != installPath {
			t.Fatalf("unexpected executable path: %s", executable)
		}
		return &fakeService{status: service.StatusRunning}, nil
	}

	var actions []string
	serviceControlFn = func(_ service.Service, action string) error {
		actions = append(actions, action)
		return nil
	}

	code := runUpgrade([]string{"--binary", source, "--install-binary", installPath})
	if code != 0 {
		t.Fatalf("runUpgrade returned %d, want 0", code)
	}

	if len(actions) != 2 || actions[0] != "stop" || actions[1] != "start" {
		t.Fatalf("unexpected service actions: %v", actions)
	}
	if _, err := os.Stat(installPath); err != nil {
		t.Fatalf("installed executable missing after upgrade: %v", err)
	}
}

func TestRunUpgrade_RequiresInstalledService(t *testing.T) {
	origNew := newServiceControllerFn
	defer func() {
		newServiceControllerFn = origNew
	}()

	temp := t.TempDir()
	source := filepath.Join(temp, "squelch-new")
	if err := os.WriteFile(source, []byte("new-binary"), 0o755); err != nil {
		t.Fatalf("write source binary: %v", err)
	}

	newServiceControllerFn = func(_ []string, _ string) (service.Service, error) {
		return &fakeStatusErrorService{err: errors.New("service not installed")}, nil
	}

	if code := runUpgrade([]string{"--binary", source, "--install-binary", filepath.Join(temp, "installed", "squelch")}); code != 1 {
		t.Fatalf("runUpgrade returned %d, want 1", code)
	}
}

func TestServiceState_NotInstalledError(t *testing.T) {
	svc := &fakeStatusErrorService{err: errors.New("service not installed")}
	installed, running, status := serviceState(svc)
	if installed || running || status != "not installed" {
		t.Fatalf("unexpected service state: installed=%t running=%t status=%q", installed, running, status)
	}
}

type fakeStatusErrorService struct {
	err error
}

func (f *fakeStatusErrorService) Run() error                                  { return nil }
func (f *fakeStatusErrorService) Start() error                                { return nil }
func (f *fakeStatusErrorService) Stop() error                                 { return nil }
func (f *fakeStatusErrorService) Restart() error                              { return nil }
func (f *fakeStatusErrorService) Install() error                              { return nil }
func (f *fakeStatusErrorService) Uninstall() error                            { return nil }
func (f *fakeStatusErrorService) Logger(chan<- error) (service.Logger, error) { return nil, nil }
func (f *fakeStatusErrorService) SystemLogger(chan<- error) (service.Logger, error) {
	return nil, nil
}
func (f *fakeStatusErrorService) String() string   { return "squelch" }
func (f *fakeStatusErrorService) Platform() string { return "test" }
func (f *fakeStatusErrorService) Status() (service.Status, error) {
	return service.StatusUnknown, f.err
}

func TestRunInteractiveSetup_UsesDefaultsAndCancels(t *testing.T) {
	listen := "127.0.0.1:3022"
	db := "/var/lib/squelch/squelch.db"
	rec := "/var/lib/squelch/recordings"
	cfg := "/etc/squelch/squelch.json"
	install := "/usr/local/bin/squelch"

	in := strings.NewReader("\n\n\n\n\n\nn\n")
	out := &bytes.Buffer{}

	proceed, err := runInteractiveSetup(in, out, &listen, &db, &rec, &cfg, &install)
	if err != nil {
		t.Fatalf("runInteractiveSetup returned error: %v", err)
	}
	if proceed {
		t.Fatalf("expected setup to be cancelled")
	}
	if listen != "127.0.0.1:3022" || db != "/var/lib/squelch/squelch.db" || rec != "/var/lib/squelch/recordings" || cfg != "/etc/squelch/squelch.json" {
		t.Fatalf("expected defaults to remain unchanged")
	}
	if install != "/usr/local/bin/squelch" {
		t.Fatalf("expected install path default to remain unchanged")
	}
}

func TestRunInteractiveSetup_AppliesOverridesAndConfirms(t *testing.T) {
	listen := "127.0.0.1:3022"
	db := "/var/lib/squelch/squelch.db"
	rec := "/var/lib/squelch/recordings"
	cfg := "/etc/squelch/squelch.json"
	install := "/usr/local/bin/squelch"

	in := strings.NewReader("0.0.0.0:3022\n/tmp/squelch.db\n/tmp/recordings\n/tmp/squelch.json\n/tmp/squelch\ny\n")
	out := &bytes.Buffer{}

	proceed, err := runInteractiveSetup(in, out, &listen, &db, &rec, &cfg, &install)
	if err != nil {
		t.Fatalf("runInteractiveSetup returned error: %v", err)
	}
	if !proceed {
		t.Fatalf("expected setup to proceed")
	}
	if listen != "0.0.0.0:3022" {
		t.Fatalf("listen override not applied: %s", listen)
	}
	if db != "/tmp/squelch.db" {
		t.Fatalf("db override not applied: %s", db)
	}
	if rec != "/tmp/recordings" {
		t.Fatalf("recordings override not applied: %s", rec)
	}
	if cfg != "/tmp/squelch.json" {
		t.Fatalf("config override not applied: %s", cfg)
	}
	if install != "/tmp/squelch" {
		t.Fatalf("install path override not applied: %s", install)
	}
}

func TestServiceArguments_StripsTransientFlags(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want []string
	}{
		{
			name: "strips --service with value",
			args: []string{"--config", "/etc/squelch.json", "--service", "install"},
			want: []string{"--config", "/etc/squelch.json"},
		},
		{
			name: "strips --service=value",
			args: []string{"--config", "/etc/squelch.json", "--service=install"},
			want: []string{"--config", "/etc/squelch.json"},
		},
		{
			name: "strips --admin-password with value",
			args: []string{"--listen", ":3022", "--admin-password", "secret"},
			want: []string{"--listen", ":3022"},
		},
		{
			name: "strips --admin-password=value",
			args: []string{"--listen", ":3022", "--admin-password=secret"},
			want: []string{"--listen", ":3022"},
		},
		{
			name: "strips --config-save",
			args: []string{"--listen", ":3022", "--config-save"},
			want: []string{"--listen", ":3022"},
		},
		{
			name: "strips --version",
			args: []string{"--version", "--listen", ":3022"},
			want: []string{"--listen", ":3022"},
		},
		{
			name: "strips single-dash secret flags",
			args: []string{"-encryption-key", "k", "-admin-password=pw", "-service", "install", "-listen", ":3022"},
			want: []string{"-listen", ":3022"},
		},
		{
			name: "strips single-dash key file and bool flags",
			args: []string{"-encryption-key-file=/root/key", "-config-save", "-version=true", "--config", "/etc/os.json"},
			want: []string{"--config", "/etc/os.json"},
		},
		{
			name: "strips multiple transient flags",
			args: []string{"--service", "install", "--admin-password", "pw", "--config-save", "--config", "/etc/os.json"},
			want: []string{"--config", "/etc/os.json"},
		},
		{
			name: "preserves all persistent flags",
			args: []string{"--listen", ":3022", "--config", "/etc/os.json", "--db-file", "/data/db.sqlite"},
			want: []string{"--listen", ":3022", "--config", "/etc/os.json", "--db-file", "/data/db.sqlite"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := serviceArguments(tc.args)
			if len(got) != len(tc.want) {
				t.Fatalf("serviceArguments(%v) = %v, want %v", tc.args, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Fatalf("serviceArguments(%v)[%d] = %q, want %q (all=%v)", tc.args, i, got[i], tc.want[i], got)
				}
			}
		})
	}
}
