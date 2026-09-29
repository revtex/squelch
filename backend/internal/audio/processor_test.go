package audio_test

import (
	"bytes"
	"context"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/audio"
)

// makeFileHeader builds a *multipart.FileHeader with the given filename and content.
func makeFileHeader(t *testing.T, filename string, content []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	fw, err := w.CreateFormFile("audio", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	_, _ = fw.Write(content)
	w.Close()

	mr := multipart.NewReader(&body, w.Boundary())
	form, err := mr.ReadForm(1 << 20)
	if err != nil {
		t.Fatalf("ReadForm: %v", err)
	}
	t.Cleanup(func() { _ = form.RemoveAll() })
	return form.File["audio"][0]
}

// newTestProcessor creates a Processor backed by t.TempDir() with a
// background worker pool that is cancelled when the test ends.
func newTestProcessor(t *testing.T) (*audio.Processor, string) {
	t.Helper()
	tmpDir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	pool := audio.NewWorkerPool(ctx)
	return audio.NewProcessor(tmpDir, pool), tmpDir
}

// TestStore_PathSanitisation verifies that directory components and dangerous
// filename patterns are stripped or rejected before writing to disk.
func TestStore_PathSanitisation(t *testing.T) {
	fakeWAV := []byte("RIFF\x24\x00\x00\x00WAVEfmt ")

	cases := []struct {
		name     string
		filename string
		wantErr  bool
		// wantBase is the expected filepath.Base of the returned relPath (only
		// checked when wantErr=false).
		wantBase string
	}{
		// Path traversal components are stripped by filepath.Base; no error is
		// returned, but the file lands safely inside the base directory.
		{"traversal stripped to basename", "../../../etc/passwd", false, "passwd"},
		{"subdir stripped to basename", "subdir/audio.wav", false, "audio.wav"},
		{"simple filename", "audio.wav", false, "audio.wav"},
		// The following filenames remain dangerous after filepath.Base and must
		// be rejected with an error.
		{"dotdot literal", "..", true, ""},
		{"dot literal", ".", true, ""},
		{"embedded dotdot in name", "bad..file.wav", true, ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			proc, recordingsDir := newTestProcessor(t)
			fh := makeFileHeader(t, tc.filename, fakeWAV)

			relPath, err := proc.Store(context.Background(), fh, audio.ConversionDisabled, audio.PresetAACLC32k)

			if tc.wantErr {
				if err == nil {
					t.Errorf("expected error for filename %q, got nil (relPath=%q)", tc.filename, relPath)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for filename %q: %v", tc.filename, err)
			}

			// relPath must never contain ".." (path traversal prevented).
			if strings.Contains(relPath, "..") {
				t.Errorf("relPath %q contains '..'; path traversal not prevented", relPath)
			}

			// The base filename component must match expected.
			if got := filepath.Base(relPath); got != tc.wantBase {
				t.Errorf("filepath.Base(relPath) = %q, want %q", got, tc.wantBase)
			}

			// File must actually exist on disk inside the recordings directory.
			absPath := filepath.Join(recordingsDir, relPath)
			if _, statErr := os.Stat(absPath); statErr != nil {
				t.Errorf("file not found at %s: %v", absPath, statErr)
			}
		})
	}
}

// TestStore_ConversionDisabled verifies that with ConversionDisabled the file
// is written to a dated subdirectory with its original extension preserved.
func TestStore_ConversionDisabled(t *testing.T) {
	proc, recordingsDir := newTestProcessor(t)
	content := []byte("RIFF\x24\x00\x00\x00WAVEfmt ")
	fh := makeFileHeader(t, "recording.wav", content)

	relPath, err := proc.Store(context.Background(), fh, audio.ConversionDisabled, audio.PresetAACLC32k)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	// relPath must be relative (not an absolute path).
	if filepath.IsAbs(relPath) {
		t.Errorf("relPath is absolute: %s", relPath)
	}

	// Original extension must be preserved (.wav, not .m4a).
	if ext := filepath.Ext(relPath); ext != ".wav" {
		t.Errorf("extension = %q, want .wav", ext)
	}

	// File must exist at recordingsDir/relPath.
	absPath := filepath.Join(recordingsDir, relPath)
	info, statErr := os.Stat(absPath)
	if statErr != nil {
		t.Fatalf("stored file not found at %s: %v", absPath, statErr)
	}
	if info.Size() == 0 {
		t.Errorf("stored file is empty; content was not written")
	}
}

// TestFfmpegArgs verifies the exact argument slices produced for each
// ConversionMode, including structural invariants.
func TestFfmpegArgs(t *testing.T) {
	const in = "/tmp/in.wav"
	const out = "/tmp/out.m4a"
	const outMP3 = "/tmp/out.mp3"

	cases := []struct {
		name     string
		mode     audio.ConversionMode
		preset   audio.EncodingPreset
		output   string
		wantNil  bool
		wantArgs []string
	}{
		{
			name:    "disabled returns nil",
			mode:    audio.ConversionDisabled,
			preset:  audio.PresetAACLC32k,
			output:  out,
			wantNil: true,
		},
		{
			name:     "enabled — plain aac 32k",
			mode:     audio.ConversionEnabled,
			preset:   audio.PresetAACLC32k,
			output:   out,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-movflags", "+faststart", "-f", "ipod", out},
		},
		{
			name:     "norm — aac 32k + acompressor",
			mode:     audio.ConversionNorm,
			preset:   audio.PresetAACLC32k,
			output:   out,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-af", "acompressor", "-movflags", "+faststart", "-f", "ipod", out},
		},
		{
			name:     "loudnorm — aac 32k + loudnorm filter",
			mode:     audio.ConversionLoudNorm,
			preset:   audio.PresetAACLC32k,
			output:   out,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "aac", "-b:a", "32k", "-ac", "1", "-af", "loudnorm", "-movflags", "+faststart", "-f", "ipod", out},
		},
		{
			name:     "enabled — mp3 32k (no iPod flags)",
			mode:     audio.ConversionEnabled,
			preset:   audio.PresetMP3_32k,
			output:   outMP3,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "libmp3lame", "-b:a", "32k", "-ac", "1", outMP3},
		},
		{
			name:     "norm — mp3 24k + acompressor",
			mode:     audio.ConversionNorm,
			preset:   audio.PresetMP3_24k,
			output:   outMP3,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "libmp3lame", "-b:a", "24k", "-ac", "1", "-af", "acompressor", outMP3},
		},
		{
			name:     "loudnorm — mp3 16k + loudnorm filter",
			mode:     audio.ConversionLoudNorm,
			preset:   audio.PresetMP3_16k,
			output:   outMP3,
			wantArgs: []string{"ffmpeg", "-y", "-i", in, "-c:a", "libmp3lame", "-b:a", "16k", "-ac", "1", "-af", "loudnorm", outMP3},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := audio.FfmpegArgs(in, tc.output, tc.mode, tc.preset)

			if tc.wantNil {
				if got != nil {
					t.Errorf("FfmpegArgs mode=%d: expected nil, got %v", tc.mode, got)
				}
				return
			}

			if len(got) != len(tc.wantArgs) {
				t.Fatalf("len(args) = %d, want %d\n  got:  %v\n  want: %v",
					len(got), len(tc.wantArgs), got, tc.wantArgs)
			}
			for i, want := range tc.wantArgs {
				if got[i] != want {
					t.Errorf("args[%d] = %q, want %q", i, got[i], want)
				}
			}

			// Structural invariants regardless of mode.
			if len(got) < 2 {
				t.Fatal("args slice too short")
			}
			if got[1] != "-y" {
				t.Errorf("args[1] = %q, want \"-y\" (overwrite flag)", got[1])
			}
			if got[len(got)-1] != tc.output {
				t.Errorf("last arg = %q, want output path %q", got[len(got)-1], tc.output)
			}
		})
	}
}
