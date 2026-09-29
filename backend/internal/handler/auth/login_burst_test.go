package auth_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/revtex/squelch/internal/config"
)

// A parallel burst of wrong-password logins from one client must not run
// more password checks than the 3-failure lockout allows.
func TestPostLogin_ParallelBurstCappedByLockout(t *testing.T) {
	engine, _ := authFixture(t)
	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "wrong-password"})

	const n = 12
	codes := make(chan int, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			codes <- w.Code
		}()
	}
	wg.Wait()
	close(codes)

	unauthorized := 0
	for code := range codes {
		switch code {
		case http.StatusUnauthorized:
			unauthorized++
		case http.StatusTooManyRequests:
		default:
			t.Errorf("unexpected status %d", code)
		}
	}
	if unauthorized > 3 {
		t.Errorf("%d attempts reached the password check, want at most 3", unauthorized)
	}
}

// With the default trusted-proxy list, a client connecting from a public
// address cannot escape the lockout by rotating X-Forwarded-For.
func TestPostLogin_SpoofedForwardedForDoesNotResetLockout(t *testing.T) {
	engine, _ := authFixture(t)
	if err := engine.SetTrustedProxies(config.DefaultTrustedProxies); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"username": "alice", "password": "wrong-password"})

	unauthorized := 0
	for i := 0; i < 8; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "203.0.113.7:4000"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i+1))
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		if w.Code == http.StatusUnauthorized {
			unauthorized++
		}
	}
	if unauthorized > 3 {
		t.Errorf("%d attempts reached the password check with rotating XFF, want at most 3", unauthorized)
	}
}

// Behind a local reverse proxy, clients are still told apart by the
// forwarded address, so one client's lockout does not lock out the rest.
func TestPostLogin_TrustedProxyKeepsClientsSeparate(t *testing.T) {
	engine, _ := authFixture(t)
	if err := engine.SetTrustedProxies(config.DefaultTrustedProxies); err != nil {
		t.Fatal(err)
	}
	bad, _ := json.Marshal(map[string]string{"username": "alice", "password": "wrong-password"})
	good, _ := json.Marshal(map[string]string{"username": "alice", "password": "password123"})
	send := func(body []byte, client string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "127.0.0.1:5000"
		req.Header.Set("X-Forwarded-For", client)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w.Code
	}
	for i := 0; i < 4; i++ {
		send(bad, "198.51.100.1")
	}
	if code := send(good, "198.51.100.1"); code != http.StatusTooManyRequests {
		t.Errorf("locked-out client got %d, want 429", code)
	}
	if code := send(good, "198.51.100.2"); code != http.StatusOK {
		t.Errorf("other client behind the proxy got %d, want 200", code)
	}
}
