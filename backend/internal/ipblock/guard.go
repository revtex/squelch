package ipblock

import (
	"fmt"
	"net/netip"

	"github.com/revtex/squelch/internal/config"
)

// GuardError is a block the guards refuse. Its message is written for the
// admin who typed the address.
type GuardError string

func (e GuardError) Error() string { return string(e) }

var loopbackRanges = []netip.Prefix{
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("::1/128"),
}

// Check turns what an admin typed into the prefix to block, or says why it
// cannot be blocked. It does not know who is asking; the caller checks
// whether the range contains the admin's own address.
func (m *Matcher) Check(input string) (netip.Prefix, error) {
	p, err := config.ParsePrefix(input)
	if err != nil {
		return netip.Prefix{}, GuardError(fmt.Sprintf("%q is not an IP address or CIDR range", input))
	}
	if canon := p.Masked(); canon != p {
		return netip.Prefix{}, GuardError(fmt.Sprintf(
			"%s has host bits set; the range is %s", p, canon))
	}
	minBits := MinBitsV6
	if p.Addr().Is4() {
		minBits = MinBitsV4
	}
	if p.Bits() < minBits {
		return netip.Prefix{}, GuardError(fmt.Sprintf(
			"%s is too wide; the widest block allowed is /%d. Block wider ranges at your firewall or reverse proxy", p, minBits))
	}
	for _, lb := range loopbackRanges {
		if lb.Overlaps(p) {
			return netip.Prefix{}, GuardError(fmt.Sprintf("%s is loopback, which can never be blocked", p))
		}
	}
	for _, t := range m.TrustedList() {
		if t.Overlaps(p) {
			return netip.Prefix{}, GuardError(fmt.Sprintf(
				"%s overlaps the trusted address %s, which can never be blocked", p, t))
		}
	}
	return p, nil
}
