package routes_test

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/revtex/squelch/internal/static"
)

// requireEmbeddedFrontend skips when the binary was built without the SPA
// embedded. serveFrontend returns early in that case and registers no
// NoRoute handler at all, so every unknown path 404s by Gin default and
// these tests would assert nothing. CI runs `go test` without building the
// frontend (the embed directory holds only .gitkeep in a fresh checkout), so
// this is the normal state there, not a broken checkout.
func requireEmbeddedFrontend(t *testing.T) {
	t.Helper()
	distFS, err := fs.Sub(static.DistFS, "dist")
	if err != nil {
		t.Skip("no embedded frontend: SPA fallback is not registered in this build")
	}
	if _, err := fs.Stat(distFS, "index.html"); err != nil {
		t.Skip("no embedded frontend: SPA fallback is not registered in this build")
	}
}

// Well-known documents are fetched by machines, not browsers. The SPA
// fallback used to answer them with index.html and HTTP 200, so an App Links
// or Universal Links verifier saw a malformed association file instead of a
// missing one. They must 404 until the real files are served.
func TestWellKnownPathsDoNotFallBackToSPA(t *testing.T) {
	requireEmbeddedFrontend(t)
	engine, _ := newTestEngine(t)

	paths := []string{
		"/.well-known/assetlinks.json",
		"/.well-known/apple-app-site-association",
		"/apple-app-site-association",
		"/.well-known/anything-else",
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))

			if w.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", w.Code)
			}
			if body := w.Body.String(); strings.Contains(body, "<!doctype html") ||
				strings.Contains(body, "<!DOCTYPE html") {
				t.Errorf("served the SPA shell: %.60q", body)
			}
		})
	}
}

// The guard must stay narrow: client-side routes still need index.html, or
// every shared-call link 404s.
func TestSPARoutesStillServeIndex(t *testing.T) {
	requireEmbeddedFrontend(t)
	engine, _ := newTestEngine(t)

	for _, path := range []string{"/call/sometoken", "/admin", "/"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", w.Code)
			}
			if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
				t.Errorf("content-type = %q, want text/html", ct)
			}
		})
	}
}
