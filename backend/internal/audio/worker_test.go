package audio_test

import (
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/audio"
)

func TestFfmpegArgs_Disabled(t *testing.T) {
	for _, preset := range []audio.EncodingPreset{audio.PresetAACLC32k, audio.PresetHEAAC8k, ""} {
		args := audio.FfmpegArgs("/in.wav", "/out.m4a", audio.ConversionDisabled, preset)
		if args != nil {
			t.Errorf("preset %q: expected nil args for ConversionDisabled, got %v", preset, args)
		}
	}
}

func TestFfmpegArgs_DefaultPreset(t *testing.T) {
	// Empty preset should fall back to mp3_32k via ParseEncodingPreset.
	preset := audio.ParseEncodingPreset("")
	args := audio.FfmpegArgs("/in.wav", "/out.mp3", audio.ConversionEnabled, preset)
	if !containsAll(args, "libmp3lame", "32k") {
		t.Errorf("empty preset: expected libmp3lame/32k in args, got %v", args)
	}
}

func TestFfmpegArgs_FastStartMP4(t *testing.T) {
	// All enabled modes must put the moov atom first (faststart) and must not
	// fragment: a fragmented file keeps its index at the end, and Media3
	// makes three extra range requests per call to fetch it.
	for _, mode := range []audio.ConversionMode{audio.ConversionEnabled, audio.ConversionNorm, audio.ConversionLoudNorm} {
		args := audio.FfmpegArgs("/in.wav", "/out.m4a", mode, audio.PresetAACLC32k)
		if !containsAll(args, "-movflags", "+faststart", "-f", "ipod") {
			t.Errorf("mode %d: expected faststart MP4 flags, got %v", mode, args)
		}
		for _, a := range args {
			if strings.Contains(a, "frag_keyframe") || strings.Contains(a, "empty_moov") {
				t.Errorf("mode %d: expected no fragmented MP4 flags, got %v", mode, args)
			}
		}
	}
}

func TestFfmpegArgs_AACLC_Presets(t *testing.T) {
	cases := []struct {
		preset  audio.EncodingPreset
		bitrate string
	}{
		{audio.PresetAACLC32k, "32k"},
		{audio.PresetAACLC24k, "24k"},
		{audio.PresetAACLC16k, "16k"},
	}
	for _, tc := range cases {
		args := audio.FfmpegArgs("/in.wav", "/out.m4a", audio.ConversionEnabled, tc.preset)
		if !containsAll(args, "aac", tc.bitrate) {
			t.Errorf("preset %q: expected aac/%s in args, got %v", tc.preset, tc.bitrate, args)
		}
		if containsAny(args, "libfdk_aac", "aac_he") {
			t.Errorf("preset %q: unexpected HE-AAC args in LC preset: %v", tc.preset, args)
		}
	}
}

func TestFfmpegArgs_HEAAC_Presets(t *testing.T) {
	cases := []struct {
		preset  audio.EncodingPreset
		bitrate string
	}{
		{audio.PresetHEAAC12k, "12k"},
		{audio.PresetHEAAC8k, "8k"},
	}
	for _, tc := range cases {
		args := audio.FfmpegArgs("/in.wav", "/out.m4a", audio.ConversionEnabled, tc.preset)
		if !containsAll(args, "libfdk_aac", "aac_he", tc.bitrate) {
			t.Errorf("preset %q: expected libfdk_aac/aac_he/%s in args, got %v", tc.preset, tc.bitrate, args)
		}
	}
}

func TestFfmpegArgs_NormModes(t *testing.T) {
	modes := []struct {
		mode   audio.ConversionMode
		filter string
	}{
		{audio.ConversionNorm, "acompressor"},
		{audio.ConversionLoudNorm, "loudnorm"},
	}
	for _, tc := range modes {
		args := audio.FfmpegArgs("/in.wav", "/out.m4a", tc.mode, audio.PresetAACLC32k)
		if !containsAll(args, "-af", tc.filter) {
			t.Errorf("mode %d: expected -af %s in args, got %v", tc.mode, tc.filter, args)
		}
	}
}

func TestFfmpegArgs_OutputIsLast(t *testing.T) {
	out := "/recordings/out.m4a"
	args := audio.FfmpegArgs("/in.wav", out, audio.ConversionEnabled, audio.PresetAACLC32k)
	if len(args) == 0 || args[len(args)-1] != out {
		t.Errorf("expected output path as last arg, got %v", args)
	}
}

func TestIsValidEncodingPreset(t *testing.T) {
	valid := []string{"aac_lc_32k", "aac_lc_24k", "aac_lc_16k", "he_aac_12k", "he_aac_8k", "mp3_32k", "mp3_24k", "mp3_16k"}
	for _, v := range valid {
		if !audio.IsValidEncodingPreset(v) {
			t.Errorf("expected %q to be valid", v)
		}
	}
	invalid := []string{"", "aac", "he_aac_v2", "mp3_128k", "AACLC32K"}
	for _, v := range invalid {
		if audio.IsValidEncodingPreset(v) {
			t.Errorf("expected %q to be invalid", v)
		}
	}
}

func TestParseEncodingPreset_Fallback(t *testing.T) {
	if got := audio.ParseEncodingPreset(""); got != audio.PresetMP3_32k {
		t.Errorf("empty string should fall back to PresetMP3_32k, got %q", got)
	}
	if got := audio.ParseEncodingPreset("garbage"); got != audio.PresetMP3_32k {
		t.Errorf("unknown string should fall back to PresetMP3_32k, got %q", got)
	}
	if got := audio.ParseEncodingPreset("he_aac_8k"); got != audio.PresetHEAAC8k {
		t.Errorf("expected PresetHEAAC8k, got %q", got)
	}
}

func TestIsHEEncodingPreset(t *testing.T) {
	if !audio.IsHEEncodingPreset("he_aac_12k") {
		t.Error("expected he_aac_12k to be an HE preset")
	}
	if !audio.IsHEEncodingPreset("he_aac_8k") {
		t.Error("expected he_aac_8k to be an HE preset")
	}
	if audio.IsHEEncodingPreset("aac_lc_32k") {
		t.Error("expected aac_lc_32k to not be an HE preset")
	}
}

func TestIsMP3EncodingPreset(t *testing.T) {
	for _, p := range []string{"mp3_32k", "mp3_24k", "mp3_16k"} {
		if !audio.IsMP3EncodingPreset(p) {
			t.Errorf("expected %q to be an MP3 preset", p)
		}
	}
	for _, p := range []string{"aac_lc_32k", "he_aac_12k", ""} {
		if audio.IsMP3EncodingPreset(p) {
			t.Errorf("expected %q to not be an MP3 preset", p)
		}
	}
}

func TestFfmpegArgs_MP3_Presets(t *testing.T) {
	cases := []struct {
		preset  audio.EncodingPreset
		bitrate string
	}{
		{audio.PresetMP3_32k, "32k"},
		{audio.PresetMP3_24k, "24k"},
		{audio.PresetMP3_16k, "16k"},
	}
	for _, tc := range cases {
		args := audio.FfmpegArgs("/in.wav", "/out.mp3", audio.ConversionEnabled, tc.preset)
		if !containsAll(args, "libmp3lame", tc.bitrate) {
			t.Errorf("preset %q: expected libmp3lame/%s in args, got %v", tc.preset, tc.bitrate, args)
		}
		// MP3 must NOT have iPod/fragmented-MP4 flags.
		if containsAny(args, "ipod", "-movflags") {
			t.Errorf("preset %q: unexpected iPod/movflags for MP3: %v", tc.preset, args)
		}
	}
}

func TestOutputExt(t *testing.T) {
	if ext := audio.OutputExt(audio.PresetAACLC32k); ext != ".m4a" {
		t.Errorf("expected .m4a, got %q", ext)
	}
	if ext := audio.OutputExt(audio.PresetMP3_32k); ext != ".mp3" {
		t.Errorf("expected .mp3, got %q", ext)
	}
}

func TestOutputMIME(t *testing.T) {
	if mime := audio.OutputMIME(audio.PresetAACLC32k); mime != "audio/mp4" {
		t.Errorf("expected audio/mp4, got %q", mime)
	}
	if mime := audio.OutputMIME(audio.PresetMP3_32k); mime != "audio/mpeg" {
		t.Errorf("expected audio/mpeg, got %q", mime)
	}
}

// containsAll returns true if all needles appear in haystack.
func containsAll(haystack []string, needles ...string) bool {
	joined := strings.Join(haystack, " ")
	for _, n := range needles {
		if !strings.Contains(joined, n) {
			return false
		}
	}
	return true
}

// containsAny returns true if any needle appears in haystack.
func containsAny(haystack []string, needles ...string) bool {
	joined := strings.Join(haystack, " ")
	for _, n := range needles {
		if strings.Contains(joined, n) {
			return true
		}
	}
	return false
}
