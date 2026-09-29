package ipblock

import (
	"context"
	"database/sql"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/db"
	_ "modernc.org/sqlite"
)

func newDB(t *testing.T) (*sql.DB, *db.Queries) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open DB: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return sqlDB, db.New(sqlDB)
}

func addBlock(t *testing.T, q *db.Queries, cidr string, expires *time.Time) {
	t.Helper()
	var exp sql.NullInt64
	if expires != nil {
		exp = sql.NullInt64{Int64: expires.Unix(), Valid: true}
	}
	if _, err := q.CreateIPBlock(context.Background(), db.CreateIPBlockParams{
		Cidr: cidr, CreatedAt: time.Now().Unix(), ExpiresAt: exp,
	}); err != nil {
		t.Fatalf("create block %s: %v", cidr, err)
	}
}

func addr(s string) netip.Addr { return netip.MustParseAddr(s) }

var public = addr("198.51.100.1") // a socket peer that is not loopback

func TestMatcher_BlocksV4AndV6Ranges(t *testing.T) {
	_, q := newDB(t)
	addBlock(t, q, "203.0.113.0/24", nil)
	addBlock(t, q, "2001:db8:1::/48", nil)
	m := New(nil)
	if err := m.Reload(context.Background(), q); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	cases := []struct {
		ip   string
		want bool
	}{
		{"203.0.113.9", true},
		{"::ffff:203.0.113.9", true}, // v4-mapped form of a blocked address
		{"203.0.114.9", false},
		{"2001:db8:1:ffff::1", true},
		{"2001:db8:2::1", false},
	}
	for _, tc := range cases {
		if got := m.Blocked(addr(tc.ip), public); got != tc.want {
			t.Errorf("Blocked(%s) = %v, want %v", tc.ip, got, tc.want)
		}
	}
}

func TestMatcher_ExpiredBlockStopsMatchingBeforeTheSweep(t *testing.T) {
	_, q := newDB(t)
	soon := time.Now().Add(1100 * time.Millisecond)
	addBlock(t, q, "203.0.113.0/24", &soon)
	m := New(nil)
	if err := m.Reload(context.Background(), q); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if !m.Blocked(addr("203.0.113.9"), public) {
		t.Fatal("block not in force before it expires")
	}
	time.Sleep(time.Until(soon) + 50*time.Millisecond)
	if m.Blocked(addr("203.0.113.9"), public) {
		t.Fatal("expired block still matches")
	}
}

func TestMatcher_TrustedAddressesAreNeverBlocked(t *testing.T) {
	_, q := newDB(t)
	// Inserted directly: the guards would refuse these, but a block that
	// somehow covers a trusted address must still not apply.
	addBlock(t, q, "203.0.113.0/24", nil)
	addBlock(t, q, "127.0.0.0/8", nil)
	m := New([]netip.Prefix{netip.MustParsePrefix("203.0.113.7/32")})
	if err := m.Reload(context.Background(), q); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	if m.Blocked(addr("203.0.113.7"), public) {
		t.Error("configured trusted address was blocked")
	}
	if !m.Blocked(addr("203.0.113.8"), public) {
		t.Error("its neighbour was not blocked")
	}
	if m.Blocked(addr("127.0.0.1"), addr("127.0.0.1")) {
		t.Error("a real loopback request was blocked")
	}
}

// A client on a trusted-proxy network can send X-Forwarded-For: 127.0.0.1.
// That resolves to loopback, but the socket peer is not, so it gets no
// loopback exemption.
func TestMatcher_ForgedLoopbackIsNotTrusted(t *testing.T) {
	m := New(nil)
	if m.Trusted(addr("127.0.0.1"), addr("192.168.1.50")) {
		t.Fatal("forwarded loopback from a LAN peer was trusted")
	}
	if !m.Trusted(addr("127.0.0.1"), addr("127.0.0.1")) {
		t.Fatal("real loopback was not trusted")
	}
	if !m.TrustedAddr(addr("::1")) {
		t.Fatal("TrustedAddr(::1) = false")
	}
}

func TestMatcher_ReloadFailureKeepsTheBlocks(t *testing.T) {
	sqlDB, q := newDB(t)
	addBlock(t, q, "203.0.113.0/24", nil)
	m := New(nil)
	if err := m.Reload(context.Background(), q); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	_ = sqlDB.Close()
	if err := m.Reload(context.Background(), q); err == nil {
		t.Fatal("Reload on a closed DB succeeded")
	}
	if !m.Blocked(addr("203.0.113.9"), public) {
		t.Fatal("a failed reload lifted the block")
	}
}

func TestMatcher_WarnsOncePerBlockPerMinute(t *testing.T) {
	_, q := newDB(t)
	addBlock(t, q, "2001:db8:1::/48", nil)
	m := New(nil)
	if err := m.Reload(context.Background(), q); err != nil {
		t.Fatalf("Reload: %v", err)
	}
	for i := 0; i < 50; i++ {
		ip := netip.AddrFrom16([16]byte{0x20, 0x01, 0x0d, 0xb8, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, byte(i)})
		if !m.Refuse(ip, public, "/") {
			t.Fatalf("Refuse(%s) = false", ip)
		}
	}
	if n := len(m.lastWarn); n != 1 {
		t.Fatalf("warn map holds %d entries for one block, want 1", n)
	}
}

func TestCheck(t *testing.T) {
	m := New([]netip.Prefix{netip.MustParsePrefix("198.51.100.7/32")})
	ok := []struct{ in, want string }{
		{"203.0.113.9", "203.0.113.9/32"},
		{"2001:db8::1", "2001:db8::1/128"},
		{"203.0.113.0/24", "203.0.113.0/24"},
		{"10.1.0.0/16", "10.1.0.0/16"},
		{"::ffff:203.0.113.0/120", "203.0.113.0/24"},
		{" 203.0.113.9 ", "203.0.113.9/32"},
	}
	for _, tc := range ok {
		p, err := m.Check(tc.in)
		if err != nil {
			t.Errorf("Check(%q) error: %v", tc.in, err)
			continue
		}
		if p.String() != tc.want {
			t.Errorf("Check(%q) = %s, want %s", tc.in, p, tc.want)
		}
	}
	bad := []struct{ in, mention string }{
		{"not-an-ip", "not an IP address"},
		{"203.0.113.9/24", "the range is 203.0.113.0/24"},
		{"10.0.0.0/8", "too wide"},
		{"0.0.0.0/0", "too wide"},
		{"::/0", "too wide"},
		{"2001:db8::/32", "too wide"},
		{"127.0.0.1", "loopback"},
		{"::1", "loopback"},
		{"198.51.100.0/24", "trusted address 198.51.100.7/32"},
	}
	for _, tc := range bad {
		_, err := m.Check(tc.in)
		var gerr GuardError
		if !errors.As(err, &gerr) {
			t.Errorf("Check(%q) err = %v, want a GuardError", tc.in, err)
			continue
		}
		if !strings.Contains(err.Error(), tc.mention) {
			t.Errorf("Check(%q) = %q, want it to mention %q", tc.in, err, tc.mention)
		}
	}
}

func TestSweep_DeletesExpiredRows(t *testing.T) {
	sqlDB, q := newDB(t)
	past := time.Now().Add(-time.Minute)
	addBlock(t, q, "203.0.113.0/24", &past)
	addBlock(t, q, "198.51.100.0/24", nil)
	m := New(nil)
	m.Sweep(context.Background(), q)
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ip_blocks`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("%d rows after sweep, want 1", n)
	}
	if !m.Blocked(addr("198.51.100.9"), public) {
		t.Fatal("sweep did not reload the remaining block")
	}
}
