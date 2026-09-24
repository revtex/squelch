package connections

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// maxUserAgentLen caps the stored User-Agent. The header is client-chosen
// text; nothing downstream needs more than this to tell browsers apart.
const maxUserAgentLen = 512

// Client is where a connection came from.
type Client struct {
	// IP is the client address as resolved through the trusted-proxy list
	// (--trusted-proxies): the X-Forwarded-For hop when the request came
	// through a trusted proxy, otherwise the socket peer.
	IP netip.Addr
	// Peer is the raw socket peer, which is the proxy's address when there
	// is one. Kept separately because a forwarded address is only as
	// trustworthy as the proxy list, while the peer cannot be forged.
	Peer      netip.Addr
	UserAgent string
}

type clientKey struct{}

// WithClient returns ctx carrying c.
func WithClient(ctx context.Context, c Client) context.Context {
	return context.WithValue(ctx, clientKey{}, c)
}

// ClientFrom returns the Client stored on ctx, or the zero Client.
func ClientFrom(ctx context.Context) Client {
	c, _ := ctx.Value(clientKey{}).(Client)
	return c
}

// ClientFromRequest describes the client behind r. resolvedIP is the
// proxy-aware address the router worked out (gin's Context.ClientIP); when it
// does not parse, the socket peer stands in for it.
func ClientFromRequest(r *http.Request, resolvedIP string) Client {
	peer := parseAddr(r.RemoteAddr)
	ip := parseAddr(resolvedIP)
	if !ip.IsValid() {
		ip = peer
	}
	return Client{IP: ip, Peer: peer, UserAgent: capUserAgent(r.UserAgent())}
}

// parseAddr accepts a bare address or host:port and unmaps IPv4-in-IPv6, so
// the same client always compares equal however it was written down.
func parseAddr(s string) netip.Addr {
	s = strings.TrimSpace(s)
	if host, _, err := net.SplitHostPort(s); err == nil {
		s = host
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}
	}
	return a.Unmap()
}

func capUserAgent(ua string) string {
	if len(ua) <= maxUserAgentLen {
		return ua
	}
	return strings.ToValidUTF8(ua[:maxUserAgentLen], "")
}
