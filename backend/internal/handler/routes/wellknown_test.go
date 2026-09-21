package routes_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Well-known documents are fetched by machines, not browsers. The SPA
// fallback used to answer them with index.html and HTTP 200, so an App Links
// or Universal Links verifier saw a malformed association file instead of a
// missing one. They must 404 until the real files are served.
func TestWellKnownPathsDoNotFallBackToSPA(t *testing.T) {
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
