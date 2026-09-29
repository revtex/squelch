// Package audio handles FFmpeg-based audio conversion and storage.
package audio

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Processor handles storing uploaded audio files and queuing FFmpeg conversion.
type Processor struct {
	recordingsDir string
	pool          *WorkerPool
}

// NewProcessor creates a Processor for the given recordings directory.
func NewProcessor(recordingsDir string, pool *WorkerPool) *Processor {
	return &Processor{recordingsDir: recordingsDir, pool: pool}
}

// RecordingsDir returns the directory used for audio file storage.
func (p *Processor) RecordingsDir() string {
	return p.recordingsDir
}

// Store saves the uploaded file to disk under recordingsDir/<YYYY>/<MM>/<DD>/<filename>
// and returns the relative path (relative to recordingsDir).
// SECURITY: sanitises the filename via filepath.Base — strips directory components,
// rejects paths containing "..".
// If conversion is enabled, submits an FFmpeg job, waits for completion, removes
// the original, and returns the .m4a relative path.
func (p *Processor) Store(ctx context.Context, fh *multipart.FileHeader, mode ConversionMode, preset EncodingPreset) (string, error) {
	slog.Debug("audio: storing uploaded file", "filename", fh.Filename, "size", fh.Size, "mode", mode, "preset", preset)
	safeName := filepath.Base(fh.Filename)
	if safeName == "" || safeName == "." || safeName == ".." || strings.Contains(safeName, "..") {
		return "", fmt.Errorf("invalid filename")
	}

	now := time.Now().UTC()
	dayDir := filepath.Join(p.recordingsDir, now.Format("2006"), now.Format("01"), now.Format("02"))
	if err := os.MkdirAll(dayDir, 0755); err != nil {
		return "", fmt.Errorf("create audio dir: %w", err)
	}

	src, err := fh.Open()
	if err != nil {
		return "", fmt.Errorf("open upload: %w", err)
	}
	defer src.Close()

	// Create the destination atomically with O_EXCL so colliding filenames
	// don't silently overwrite an existing recording. If the name is taken,
	// append a short random suffix and retry up to 5 times.
	destPath, dst, err := createUniqueFile(dayDir, safeName)
	if err != nil {
		return "", fmt.Errorf("create destination file: %w", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(destPath) //nolint:errcheck
		return "", fmt.Errorf("write audio file: %w", err)
	}
	dst.Close()
	slog.Debug("audio: file written", "path", destPath, "size_bytes", fh.Size)

	return p.convertStored(ctx, dayDir, destPath, mode, preset)
}

// StoreFile stores a local file (by path) identically to Store, but reads
// directly from the filesystem rather than from a multipart upload.
func (p *Processor) StoreFile(ctx context.Context, srcPath string, mode ConversionMode, preset EncodingPreset) (string, error) {
	src, err := os.Open(srcPath)
	if err != nil {
		return "", fmt.Errorf("open audio file: %w", err)
	}
	defer src.Close()
	return p.StoreReader(ctx, src, filepath.Base(srcPath), mode, preset)
}

// StoreReader stores audio read from src under the given file name,
// identically to Store. Callers that must confine where the audio comes from
// open the file themselves and pass the handle, so the file that was checked
// is the file that gets copied.
// SECURITY: the name is sanitised via filepath.Base — strips directory
// components and rejects names containing "..".
func (p *Processor) StoreReader(ctx context.Context, src io.Reader, name string, mode ConversionMode, preset EncodingPreset) (string, error) {
	slog.Debug("audio: storing local file", "name", name, "mode", mode, "preset", preset)
	// filepath.Base strips all directory components; the == ".." guard catches
	// the only remaining traversal case.  No further Contains check is needed.
	safeName := filepath.Base(name)
	if safeName == "" || safeName == "." || safeName == ".." {
		return "", fmt.Errorf("invalid filename")
	}

	now := time.Now().UTC()
	dayDir := filepath.Join(p.recordingsDir, now.Format("2006"), now.Format("01"), now.Format("02"))
	if err := os.MkdirAll(dayDir, 0755); err != nil {
		return "", fmt.Errorf("create audio dir: %w", err)
	}

	destPath, dst, err := createUniqueFile(dayDir, safeName)
	if err != nil {
		return "", fmt.Errorf("create destination file: %w", err)
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(destPath) //nolint:errcheck
		return "", fmt.Errorf("copy audio file: %w", err)
	}
	if err := dst.Close(); err != nil {
		os.Remove(destPath) //nolint:errcheck
		return "", fmt.Errorf("close audio file: %w", err)
	}
	slog.Debug("audio: file written", "path", destPath)

	return p.convertStored(ctx, dayDir, destPath, mode, preset)
}

// convertStored runs the configured conversion on a freshly stored file and
// returns the path of the file to keep, relative to recordingsDir. With
// conversion off (or an unknown mode, which would otherwise delete the
// original without producing output) the stored file is kept as is.
//
// The output name is reserved with O_EXCL before FFmpeg runs, because
// FFmpeg is invoked with -y: writing to an unreserved name would overwrite
// another call's recording that happens to share the base name.
func (p *Processor) convertStored(ctx context.Context, dayDir, destPath string, mode ConversionMode, preset EncodingPreset) (string, error) {
	relPath, err := filepath.Rel(p.recordingsDir, destPath)
	if err != nil {
		return "", fmt.Errorf("compute relative path: %w", err)
	}
	if mode != ConversionEnabled && mode != ConversionNorm && mode != ConversionLoudNorm {
		return relPath, nil
	}

	safeName := filepath.Base(destPath)
	ext := filepath.Ext(safeName)
	outExt := OutputExt(preset)
	base := strings.TrimSuffix(safeName, ext)

	// When the stored file already has the target name, FFmpeg cannot read
	// and write the same file: write to a reserved temp file, then rename it
	// over the input. Otherwise FFmpeg writes straight to a reserved name.
	outPath := filepath.Join(dayDir, base+outExt)
	inPlace := outPath == destPath
	reserveName := base + outExt
	if inPlace {
		reserveName = base + ".tmp" + outExt
	}
	ffmpegOut, placeholder, err := createUniqueFile(dayDir, reserveName)
	if err != nil {
		os.Remove(destPath) //nolint:errcheck
		return "", fmt.Errorf("reserve conversion output: %w", err)
	}
	placeholder.Close()
	if !inPlace {
		outPath = ffmpegOut
	}
	fail := func(err error) (string, error) {
		os.Remove(destPath)  //nolint:errcheck
		os.Remove(ffmpegOut) //nolint:errcheck
		return "", err
	}

	done := make(chan error, 1)
	if err := p.pool.Submit(ctx, ConversionJob{
		InputPath:  destPath,
		OutputPath: ffmpegOut,
		Mode:       mode,
		Preset:     preset,
		Done:       done,
	}); err != nil {
		return fail(fmt.Errorf("submit conversion job: %w", err))
	}

	select {
	case <-ctx.Done():
		return fail(ctx.Err())
	case err := <-done:
		if err != nil {
			return fail(fmt.Errorf("audio conversion: %w", err))
		}
	}

	if inPlace {
		if err := os.Rename(ffmpegOut, outPath); err != nil {
			os.Remove(ffmpegOut) //nolint:errcheck
			return "", fmt.Errorf("rename converted file: %w", err)
		}
	} else if err := os.Remove(destPath); err != nil && !os.IsNotExist(err) {
		slog.Warn("audio: failed to remove original after conversion", "path", destPath, "error", err)
	}

	relOut, err := filepath.Rel(p.recordingsDir, outPath)
	if err != nil {
		return "", fmt.Errorf("compute relative output path: %w", err)
	}
	slog.Debug("audio: conversion complete", "input", safeName, "output", relOut)
	return relOut, nil
}

// createUniqueFile creates a new file under dir named filename, failing
// atomically (O_EXCL) if the name already exists. On collision it appends
// a short random suffix before the extension and retries up to 5 times.
// Returns the final path and an open write handle on success.
func createUniqueFile(dir, filename string) (string, *os.File, error) {
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)

	candidate := filepath.Join(dir, filename)
	const flags = os.O_CREATE | os.O_EXCL | os.O_WRONLY
	for attempt := 0; attempt < 5; attempt++ {
		f, err := os.OpenFile(candidate, flags, 0644)
		if err == nil {
			return candidate, f, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return "", nil, err
		}
		suffix, sErr := randomSuffix()
		if sErr != nil {
			return "", nil, sErr
		}
		candidate = filepath.Join(dir, base+"-"+suffix+ext)
	}
	return "", nil, fmt.Errorf("audio: exhausted unique filename attempts for %q", filename)
}

// randomSuffix returns 6 lowercase hex characters from crypto/rand.
func randomSuffix() (string, error) {
	var b [3]byte
	if _, err := cryptorand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
