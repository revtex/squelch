// Package audio — bounded FFmpeg worker pool using a channel-based job queue.
package audio

import (
	"context"
	"log/slog"
	"os/exec"
	"runtime"
	"strings"
)

// ConversionMode controls how FFmpeg processes audio (normalization filter).
type ConversionMode int

const (
	ConversionDisabled ConversionMode = 0 // keep original
	ConversionEnabled  ConversionMode = 1 // encode only, no filter
	ConversionNorm     ConversionMode = 2 // encode + acompressor
	ConversionLoudNorm ConversionMode = 3 // encode + loudnorm
)

// EncodingPreset selects the codec/bitrate combination used during conversion.
type EncodingPreset string

const (
	PresetAACLC32k EncodingPreset = "aac_lc_32k" // AAC-LC 32 kbps
	PresetAACLC24k EncodingPreset = "aac_lc_24k" // AAC-LC 24 kbps
	PresetAACLC16k EncodingPreset = "aac_lc_16k" // AAC-LC 16 kbps
	PresetHEAAC12k EncodingPreset = "he_aac_12k" // HE-AAC 12 kbps
	PresetHEAAC8k  EncodingPreset = "he_aac_8k"  // HE-AAC  8 kbps
	PresetMP3_32k  EncodingPreset = "mp3_32k"    // MP3  32 kbps (default)
	PresetMP3_24k  EncodingPreset = "mp3_24k"    // MP3  24 kbps
	PresetMP3_16k  EncodingPreset = "mp3_16k"    // MP3  16 kbps
)

// validPresets is the set of accepted EncodingPreset values.
var validPresets = map[EncodingPreset]bool{
	PresetAACLC32k: true,
	PresetAACLC24k: true,
	PresetAACLC16k: true,
	PresetHEAAC12k: true,
	PresetHEAAC8k:  true,
	PresetMP3_32k:  true,
	PresetMP3_24k:  true,
	PresetMP3_16k:  true,
}

// IsValidEncodingPreset reports whether s is a known preset value.
func IsValidEncodingPreset(s string) bool {
	return validPresets[EncodingPreset(s)]
}

// ParseEncodingPreset returns the preset for s, falling back to the default
// if s is empty or unrecognised.
func ParseEncodingPreset(s string) EncodingPreset {
	p := EncodingPreset(s)
	if validPresets[p] {
		return p
	}
	return PresetMP3_32k
}

// IsHEEncodingPreset reports whether s selects an HE-AAC preset.
func IsHEEncodingPreset(s string) bool {
	switch EncodingPreset(s) {
	case PresetHEAAC12k, PresetHEAAC8k:
		return true
	default:
		return false
	}
}

// IsMP3EncodingPreset reports whether s selects an MP3 preset.
func IsMP3EncodingPreset(s string) bool {
	switch EncodingPreset(s) {
	case PresetMP3_32k, PresetMP3_24k, PresetMP3_16k:
		return true
	default:
		return false
	}
}

// OutputExt returns the file extension (with dot) for the given preset.
func OutputExt(preset EncodingPreset) string {
	if IsMP3EncodingPreset(string(preset)) {
		return ".mp3"
	}
	return ".m4a"
}

// OutputMIME returns the MIME type for the given preset.
func OutputMIME(preset EncodingPreset) string {
	if IsMP3EncodingPreset(string(preset)) {
		return "audio/mpeg"
	}
	return "audio/mp4"
}

// presetCodecArgs returns the FFmpeg codec/bitrate/channel args for the preset.
func presetCodecArgs(preset EncodingPreset) []string {
	switch preset {
	case PresetAACLC24k:
		return []string{"-c:a", "aac", "-b:a", "24k", "-ac", "1"}
	case PresetAACLC16k:
		return []string{"-c:a", "aac", "-b:a", "16k", "-ac", "1"}
	case PresetHEAAC12k:
		return []string{"-c:a", "libfdk_aac", "-profile:a", "aac_he", "-b:a", "12k", "-ac", "1"}
	case PresetHEAAC8k:
		return []string{"-c:a", "libfdk_aac", "-profile:a", "aac_he", "-b:a", "8k", "-ac", "1"}
	case PresetMP3_32k:
		return []string{"-c:a", "libmp3lame", "-b:a", "32k", "-ac", "1"}
	case PresetMP3_24k:
		return []string{"-c:a", "libmp3lame", "-b:a", "24k", "-ac", "1"}
	case PresetMP3_16k:
		return []string{"-c:a", "libmp3lame", "-b:a", "16k", "-ac", "1"}
	default: // PresetAACLC32k
		return []string{"-c:a", "aac", "-b:a", "32k", "-ac", "1"}
	}
}

// ConversionJob represents a single FFmpeg conversion task.
type ConversionJob struct {
	InputPath  string
	OutputPath string
	Mode       ConversionMode
	Preset     EncodingPreset
	Done       chan error // written when job completes
}

// WorkerPool runs FFmpeg conversion jobs with bounded concurrency.
type WorkerPool struct {
	jobs chan ConversionJob
}

// NewWorkerPool creates a pool with runtime.NumCPU() workers (minimum 1).
// Workers stop when ctx is cancelled.
func NewWorkerPool(ctx context.Context) *WorkerPool {
	numWorkers := runtime.NumCPU()
	if numWorkers < 1 {
		numWorkers = 1
	}
	p := &WorkerPool{
		jobs: make(chan ConversionJob, numWorkers*4),
	}
	for i := 0; i < numWorkers; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case job, ok := <-p.jobs:
					if !ok {
						return
					}
					runJob(ctx, job)
				}
			}
		}()
	}
	return p
}

// Submit enqueues a conversion job. Returns ctx.Err() if the context is
// cancelled before the job can be queued. Blocks only when the buffer is full.
func (p *WorkerPool) Submit(ctx context.Context, job ConversionJob) error {
	slog.Debug("audio: submitting conversion job", "input", job.InputPath, "output", job.OutputPath, "mode", job.Mode, "preset", job.Preset)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case p.jobs <- job:
		return nil
	}
}

// runJob executes a single FFmpeg conversion using exec.CommandContext.
func runJob(ctx context.Context, job ConversionJob) {
	args := ffmpegArgs(job.InputPath, job.OutputPath, job.Mode, job.Preset)
	if len(args) == 0 {
		job.Done <- nil
		return
	}
	slog.Debug("audio: starting ffmpeg", "input", job.InputPath, "output", job.OutputPath, "mode", job.Mode, "preset", job.Preset)
	// ffmpeg binary path and args are built from server config + sanitised paths.
	cmd := exec.CommandContext(ctx, args[0], args[1:]...) //nolint:gosec // G204: args assembled from trusted server config in ffmpegArgs
	if err := cmd.Run(); err != nil {
		slog.Error("ffmpeg conversion failed", "input", job.InputPath, "output", job.OutputPath, "preset", job.Preset, "error", err)
		job.Done <- err
		return
	}
	slog.Debug("audio: ffmpeg completed", "output", job.OutputPath)
	job.Done <- nil
}

// ffmpegArgs returns the correct arg slice for the given mode and preset.
// input and output must be absolute paths.
func ffmpegArgs(input, output string, mode ConversionMode, preset EncodingPreset) []string {
	if mode == ConversionDisabled {
		return nil
	}
	// Resolve preset; fall back to default if unset.
	if preset == "" {
		preset = PresetAACLC32k
	}
	codec := presetCodecArgs(preset)

	base := append([]string{"ffmpeg", "-y", "-i", input}, codec...)

	switch mode {
	case ConversionNorm:
		base = append(base, "-af", "acompressor")
	case ConversionLoudNorm:
		base = append(base, "-af", "loudnorm")
	}

	// AAC presets use the iPod/M4A muxer with faststart, which moves the
	// moov atom — the complete sample table and duration — in front of the
	// audio, so a player reads the file in one request from the start.
	// Fragmented MP4 is not used: its moov is empty and its index sits in an
	// mfra box at the end, which Media3 always fetches, costing three extra
	// range requests per call. MP3 doesn't need either.
	if !IsMP3EncodingPreset(string(preset)) {
		base = append(base, "-movflags", "+faststart", "-f", "ipod")
	}

	return append(base, output)
}

// CheckFFmpeg reports whether ffmpeg is available on PATH.
func CheckFFmpeg() bool {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		slog.Warn("ffmpeg not found on PATH — audio conversion will fail if enabled")
		return false
	}
	return true
}

// CheckLibFDKAAC reports whether the current ffmpeg build includes
// libfdk_aac. Logs INFO when available and WARN when unavailable.
func CheckLibFDKAAC() bool {
	cmd := exec.Command("ffmpeg", "-hide_banner", "-encoders")
	out, err := cmd.CombinedOutput()
	if err != nil {
		slog.Warn("failed to inspect ffmpeg encoders for libfdk_aac", "error", err)
		return false
	}
	return strings.Contains(strings.ToLower(string(out)), "libfdk_aac")
}
