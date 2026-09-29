package routes_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/config"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/routes"
	"github.com/revtex/squelch/internal/ipblock"
	"github.com/revtex/squelch/internal/ws"
)

// newBlockingEngine builds the router the way the server does, with
// 203.0.113.0/24 blocked and 203.0.113.7 on the trusted list, under the
// default trusted proxies (which include private ranges).
func newBlockingEngine(t *testing.T) *gin.Engine {
	t.Helper()
	_, queries := newTestDB(t)
	// The loopback block is one the guards would refuse. It is inserted
	// directly to show that loopback stays exempt only for a request that
	// really arrives over loopback.
	for _, cidr := range []string{"203.0.113.0/24", "127.0.0.0/8"} {
		if _, err := queries.CreateIPBlock(context.Background(), db.CreateIPBlockParams{
			Cidr: cidr, CreatedAt: time.Now().Unix(),
		}); err != nil {
			t.Fatalf("create block: %v", err)
		}
	}
	m := ipblock.New([]netip.Prefix{netip.MustParsePrefix("203.0.113.7/32")})
	if err := m.Reload(context.Background(), queries); err != nil {
		t.Fatalf("reload: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	hub := ws.NewHub(queries, "test")
	go hub.Run(ctx)

	router := gin.New()
	if err := router.SetTrustedProxies((&config.Config{}).TrustedProxyList()); err != nil {
		t.Fatalf("set trusted proxies: %v", err)
	}
	routes.RegisterRoutes(router, routes.Deps{
		Queries:     queries,
		RateLimiter: auth.NewRateLimiter(ctx),
		Hub:         hub,
		IPBlocks:    m,
	})
	return router
}

func TestIPBlock_RefusesEveryKindOfRoute(t *testing.T) {
	engine := newBlockingEngine(t)
	cases := []struct {
		name, method, path string
		header             http.Header
	}{
		{"v1 API", http.MethodGet, "/api/v1/health", nil},
		{"legacy upload", http.MethodPost, "/api/call-upload", nil},
		{"listener WebSocket", http.MethodGet, "/api/v1/ws/listener", http.Header{
			"Connection": {"Upgrade"}, "Upgrade": {"websocket"},
			"Sec-Websocket-Version": {"13"}, "Sec-Websocket-Key": {"dGhlIHNhbXBsZSBub25jZQ=="},
		}},
		{"web app", http.MethodGet, "/scanner", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.RemoteAddr = "203.0.113.9:40000"
			for k, v := range tc.header {
				req.Header[k] = v
			}
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			if w.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403", w.Code)
			}
			var body struct {
				Error struct{ Code, Message string } `json:"error"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode %q: %v", w.Body.String(), err)
			}
			if body.Error.Code != "forbidden" || body.Error.Message != "access from this address is blocked" {
				t.Fatalf("body = %s", w.Body.String())
			}
		})
	}
}

func TestIPBlock_WhoGetsThrough(t *testing.T) {
	engine := newBlockingEngine(t)
	cases := []struct {
		name       string
		remoteAddr string
		forwarded  string
		want       int
	}{
		{"unblocked address", "198.51.100.4:40000", "", http.StatusOK},
		{"trusted address inside a blocked range", "203.0.113.7:40000", "", http.StatusOK},
		{"real loopback", "127.0.0.1:40000", "", http.StatusOK},
		// Through a trusted proxy the forwarded address is the client.
		{"blocked client behind a proxy", "127.0.0.1:40000", "203.0.113.9", http.StatusForbidden},
		// A LAN client can make itself resolve as 127.0.0.1, but the peer is
		// not loopback, so it gets no loopback exemption.
		{"forged loopback from the LAN", "192.168.1.50:40000", "127.0.0.1", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.forwarded != "" {
				req.Header.Set("X-Forwarded-For", tc.forwarded)
			}
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d; body %s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
