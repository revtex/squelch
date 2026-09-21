package admin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/revtex/squelch/internal/db"
)

// Admin transcription calls share the hardened outbound client: a redirect
// from the configured go-whisper URL is not followed to another target.
func TestTranscriptionModels_DoesNotFollowRedirects(t *testing.T) {
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"secret":"internal-only"}`))
	}))
	defer internal.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, internal.URL+"/metadata", http.StatusFound)
	}))
	defer redirector.Close()

	o, q := newTestOperations(t, "")
	if err := q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "transcriptionUrl", Value: redirector.URL}); err != nil {
		t.Fatal(err)
	}
	got, err := o.TranscriptionModels(context.Background(), nil, 1)
	if err == nil {
		t.Fatalf("redirect was followed; returned %s", got)
	}
}
