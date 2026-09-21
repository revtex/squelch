package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// The per-IP table must stay bounded however many distinct clients appear,
// while clients already tracked keep being served.
func TestRateLimitByIP_BucketTableIsBounded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(rateLimitByIP(5, 3))
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })

	get := func(ip string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = ip + ":1234"
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	for i := 1; i <= 3; i++ {
		if code := get(fmt.Sprintf("198.51.100.%d", i)); code != http.StatusOK {
			t.Fatalf("client %d = %d, want 200", i, code)
		}
	}
	if code := get("198.51.100.9"); code != http.StatusTooManyRequests {
		t.Errorf("new client past the cap = %d, want 429", code)
	}
	if code := get("198.51.100.1"); code != http.StatusOK {
		t.Errorf("tracked client = %d, want 200", code)
	}
}
