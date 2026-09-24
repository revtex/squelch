package routes_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/config"
	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/routes"
	"github.com/revtex/squelch/internal/ws"
)

// The access token names the refresh family it came from, at login and
// after every refresh, so a live connection can be traced to its device.
func TestSessionToken_CarriesRefreshFamily(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	access, refresh, _ := nativeLogin(t, engine, "alice", "password123")
	family := familyOf(t, queries, refresh)
	if got := famClaim(t, access); got != family {
		t.Fatalf("login token fam = %q, want refresh family %q", got, family)
	}

	rec, rotated := nativeRefresh(t, engine, refresh)
	if rec.Code != http.StatusOK {
		t.Fatalf("refresh status = %d; body: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode refresh body: %v", err)
	}
	if got := famClaim(t, body.Token); got != family {
		t.Fatalf("refreshed token fam = %q, want the same family %q", got, family)
	}
	if got := familyOf(t, queries, rotated); got != family {
		t.Fatalf("rotated refresh family = %q, want %q", got, family)
	}
}

func famClaim(t *testing.T, token string) string {
	t.Helper()
	claims, err := auth.ParseToken(token)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}
	return claims.FamilyID
}

func familyOf(t *testing.T, queries *db.Queries, rawRefresh string) string {
	t.Helper()
	rt, err := queries.GetRefreshTokenByHash(context.Background(), auth.HashRefreshToken(rawRefresh))
	if err != nil {
		t.Fatalf("look up refresh token: %v", err)
	}
	return rt.FamilyID
}

// A WebSocket's address comes from the same trusted-proxy rules as every
// other request: a forwarded address is believed only from a trusted proxy,
// and the socket peer is always kept alongside it.
func TestWebSocket_ClientAddressFollowsTrustedProxies(t *testing.T) {
	tests := []struct {
		name           string
		trustedProxies string
		wantIP         string
	}{
		{name: "loopback proxy trusted by default", trustedProxies: "", wantIP: "203.0.113.9"},
		{name: "no proxies trusted", trustedProxies: "none", wantIP: "127.0.0.1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, queries := newTestDB(t)
			if err := queries.UpsertSetting(context.Background(), db.UpsertSettingParams{
				Key: "publicAccess", Value: "true",
			}); err != nil {
				t.Fatalf("enable public access: %v", err)
			}

			hub := ws.NewHub(queries, "test")
			reg := connections.New()
			hub.SetConnections(reg)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			go hub.Run(ctx)

			router := gin.New()
			cfg := config.Config{TrustedProxies: tc.trustedProxies}
			if err := router.SetTrustedProxies(cfg.TrustedProxyList()); err != nil {
				t.Fatalf("set trusted proxies: %v", err)
			}
			routes.RegisterRoutes(router, routes.Deps{
				Queries:     queries,
				RateLimiter: auth.NewRateLimiter(ctx),
				Hub:         hub,
				Version:     "test",
			})
			srv := httptest.NewServer(router)
			defer srv.Close()

			header := http.Header{}
			header.Set("X-Forwarded-For", "203.0.113.9")
			header.Set("User-Agent", "squelch-test")
			conn, _, err := websocket.Dial(ctx, "ws"+srv.URL[len("http"):]+"/api/v1/ws/listener",
				&websocket.DialOptions{HTTPHeader: header})
			if err != nil {
				t.Fatalf("dial: %v", err)
			}
			defer func() { _ = conn.CloseNow() }()

			deadline := time.Now().Add(2 * time.Second)
			for reg.Len() != 1 {
				if time.Now().After(deadline) {
					t.Fatalf("registry Len = %d, want 1", reg.Len())
				}
				time.Sleep(5 * time.Millisecond)
			}
			got := reg.List()[0]
			if got.IP != netip.MustParseAddr(tc.wantIP) {
				t.Errorf("IP = %v, want %s", got.IP, tc.wantIP)
			}
			if got.Peer != netip.MustParseAddr("127.0.0.1") {
				t.Errorf("Peer = %v, want the socket peer 127.0.0.1", got.Peer)
			}
			if got.UserAgent != "squelch-test" || got.Kind != connections.KindListener {
				t.Errorf("entry = %+v", got)
			}
		})
	}
}
