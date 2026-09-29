package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/middleware"
)

// A validly signed access token issued before this process started (so its
// in-memory revocation state is gone) must be refused; the client refreshes,
// which re-checks the account. A token issued now is still accepted.
func TestJWTAuth_RejectsTokensFromBeforeStartup(t *testing.T) {
	r := gin.New()
	r.GET("/admin", middleware.JWTAuth(), middleware.RequireAdmin(), func(c *gin.Context) { c.Status(http.StatusOK) })

	issued := time.Now().Add(-10 * time.Minute)
	stale := jwt.NewWithClaims(jwt.SigningMethodHS256, auth.Claims{
		UserID: 1, Username: "former-admin", Role: auth.RoleAdmin,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "pre-restart-jti",
			IssuedAt:  jwt.NewNumericDate(issued),
			ExpiresAt: jwt.NewNumericDate(issued.Add(auth.AccessTokenExpiry)),
		},
	})
	staleStr, err := stale.SignedString(auth.JWTSecret())
	if err != nil {
		t.Fatal(err)
	}
	fresh, _, err := auth.GenerateToken(1, "admin", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		name, token string
		want        int
	}{{"pre-startup", staleStr, http.StatusUnauthorized}, {"current", fresh, http.StatusOK}} {
		req := httptest.NewRequest(http.MethodGet, "/admin", nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s token: status %d, want %d", tc.name, w.Code, tc.want)
		}
	}
}
