package middleware

import (
	"net"
	"net/http"
	"net/netip"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/handler/shared"
	"github.com/revtex/squelch/internal/ipblock"
)

// IPBlock refuses every request from a blocked address with 403 — API,
// uploads, WebSocket upgrades and the web app alike. It must run before any
// other middleware so a blocked client costs one lookup and nothing else.
// A nil matcher lets everything through.
func IPBlock(m *ipblock.Matcher) gin.HandlerFunc {
	return func(c *gin.Context) {
		if m == nil {
			c.Next()
			return
		}
		ip := parseClientAddr(c.ClientIP())
		peer := parseClientAddr(c.Request.RemoteAddr)
		if !ip.IsValid() {
			ip = peer
		}
		if m.Refuse(ip, peer, c.Request.URL.Path) {
			shared.WriteAPIError(c, http.StatusForbidden, shared.CodeForbidden,
				"access from this address is blocked", nil)
			return
		}
		c.Next()
	}
}

func parseClientAddr(s string) netip.Addr {
	if host, _, err := net.SplitHostPort(s); err == nil {
		s = host
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}
	}
	return a.Unmap()
}
