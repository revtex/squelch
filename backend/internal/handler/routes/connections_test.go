package routes_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/admin"
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

// A signed-in device records where it signed in from and whether it is the
// app; each refresh records where it is now and keeps the sign-in time.
func TestSessionMetadata_RecordedAtLoginAndRefresh(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	_, refresh, _ := nativeLogin(t, engine, "alice", "password123")
	first, err := queries.GetRefreshTokenByHash(context.Background(), auth.HashRefreshToken(refresh))
	if err != nil {
		t.Fatalf("look up login token: %v", err)
	}
	// httptest requests come from 192.0.2.1; newTestEngine trusts every proxy
	// (gin's default), which does not matter without a forwarded header.
	if first.Ip.String != "192.0.2.1" || first.Native != 1 || !first.SignedInAt.Valid {
		t.Fatalf("login row = ip %v native %d signedIn %v", first.Ip, first.Native, first.SignedInAt)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh",
		strings.NewReader(`{"refreshToken":"`+refresh+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "squelch-app/1.0")
	req.RemoteAddr = "198.51.100.7:4000"
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("refresh status = %d; body: %s", w.Code, w.Body.String())
	}
	var body struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	second, err := queries.GetRefreshTokenByHash(context.Background(), auth.HashRefreshToken(body.RefreshToken))
	if err != nil {
		t.Fatalf("look up rotated token: %v", err)
	}
	if second.Ip.String != "198.51.100.7" || second.UserAgent.String != "squelch-app/1.0" || second.Native != 1 {
		t.Errorf("rotated row = ip %v ua %v native %d", second.Ip, second.UserAgent, second.Native)
	}
	if second.SignedInAt != first.SignedInAt {
		t.Errorf("signed-in time = %v after refresh, want it carried from %v", second.SignedInAt, first.SignedInAt)
	}
}

// Signing one device out from the admin must stop that device's refresh
// token and access token, and leave the account's other devices alone.
func TestSessionsRevoke_OnlyThatDeviceLosesAccess(t *testing.T) {
	engine, queries := newTestEngine(t)
	seedAdminUser(t, queries, "alice", "password123")

	phoneAccess, phoneRefresh, _ := nativeLogin(t, engine, "alice", "password123")
	laptopAccess, laptopRefresh, _ := nativeLogin(t, engine, "alice", "password123")
	phone, err := queries.GetRefreshTokenByHash(context.Background(), auth.HashRefreshToken(phoneRefresh))
	if err != nil {
		t.Fatalf("look up phone token: %v", err)
	}

	ops := admin.New(queries, admin.Deps{}, nil)
	p, _ := json.Marshal(map[string]string{"familyId": phone.FamilyID})
	if _, err := ops.SessionsRevoke(context.Background(), p, phone.UserID); err != nil {
		t.Fatalf("SessionsRevoke: %v", err)
	}

	refresh := func(token string) int {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/refresh",
			strings.NewReader(`{"refreshToken":"`+token+`"}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w.Code
	}
	me := func(access string) int {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+access)
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, req)
		return w.Code
	}

	if code := me(phoneAccess); code != http.StatusUnauthorized {
		t.Errorf("signed-out device's access token: status %d, want 401", code)
	}
	if code := me(laptopAccess); code != http.StatusOK {
		t.Errorf("other device's access token: status %d, want 200", code)
	}
	if code := refresh(phoneRefresh); code != http.StatusUnauthorized {
		t.Errorf("signed-out device's refresh: status %d, want 401", code)
	}
	if code := refresh(laptopRefresh); code != http.StatusOK {
		t.Errorf("other device's refresh: status %d, want 200", code)
	}
}
