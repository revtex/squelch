package audio_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/revtex/squelch/internal/audio"
)

// fakeFFmpeg puts an "ffmpeg" on PATH that copies its input to its output,
// so conversion runs without the real binary.
func fakeFFmpeg(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell-script ffmpeg stand-in needs a POSIX shell")
	}
	bin := t.TempDir()
	script := "#!/bin/sh\nin=\"\"\nprev=\"\"\nfor a in \"$@\"; do\n  [ \"$prev\" = \"-i\" ] && in=\"$a\"\n  prev=\"$a\"\n  out=\"$a\"\ndone\ncp \"$in\" \"$out\"\n"
	if err := os.WriteFile(filepath.Join(bin, "ffmpeg"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}

// Converting a file whose name matches an earlier converted recording must
// not overwrite that recording.
func TestStoreFile_ConversionNeverOverwritesEarlierRecording(t *testing.T) {
	fakeFFmpeg(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	recordings := t.TempDir()
	p := audio.NewProcessor(recordings, audio.NewWorkerPool(ctx))

	src := t.TempDir()
	write := func(name, content string) string {
		path := filepath.Join(src, name)
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return path
	}

	stored := map[string]string{}
	for _, tc := range []struct{ name, content string }{
		{"call.wav", "FIRST"},
		{"call.wav", "SECOND"},
		{"call.flac", "THIRD"},
		{"call.mp3", "FOURTH"},
	} {
		rel, err := p.StoreFile(ctx, write(tc.name, tc.content), audio.ConversionEnabled, audio.PresetMP3_32k)
		if err != nil {
			t.Fatalf("StoreFile(%s): %v", tc.name, err)
		}
		if prev, dup := stored[rel]; dup {
			t.Fatalf("%s (%s) was stored at %s, already used by %s", tc.name, tc.content, rel, prev)
		}
		stored[rel] = tc.content
	}
	for rel, want := range stored {
		got, err := os.ReadFile(filepath.Join(recordings, rel))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != want {
			t.Errorf("%s holds %q, want %q", rel, got, want)
		}
	}
}
