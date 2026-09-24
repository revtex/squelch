package geoip

import (
	"net/netip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/maxmind/mmdbwriter/mmdbtype"
	"github.com/revtex/squelch/internal/geoip/geoiptest"
)

func testDB(t *testing.T, dbType string) (*DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "country.mmdb")
	geoiptest.Write(t, path, dbType, map[string]mmdbtype.Map{
		"81.2.69.0/24":   geoiptest.Country("GB"),
		"2a02:ff80::/32": geoiptest.Country("DE"),
		// Registered country only, as GeoLite2 has for some networks.
		"2.125.160.0/24": geoiptest.RegisteredCountry("FR"),
	})
	d, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d, path
}

func TestCountry(t *testing.T) {
	d, _ := testDB(t, "DBIP-Country-Lite")
	cases := map[string]string{
		"81.2.69.160":        "GB",
		"::ffff:81.2.69.160": "GB",
		"2a02:ff80::1":       "DE",
		"2.125.160.216":      "FR",
		"8.8.8.8":            "", // not in the file
		"192.168.1.10":       "", // local: never looked up
		"100.64.3.4":         "",
		"127.0.0.1":          "",
	}
	for ip, want := range cases {
		if got := d.Country(netip.MustParseAddr(ip)); got != want {
			t.Errorf("Country(%s) = %q, want %q", ip, got, want)
		}
	}
}

func TestIsLocal(t *testing.T) {
	for _, ip := range []string{"10.1.2.3", "172.18.0.1", "192.168.0.5", "127.0.0.1", "::1", "fd00::5", "fe80::1", "169.254.1.1", "100.100.1.1", "::ffff:10.0.0.1"} {
		if !IsLocal(netip.MustParseAddr(ip)) {
			t.Errorf("IsLocal(%s) = false", ip)
		}
	}
	for _, ip := range []string{"81.2.69.160", "2a02:ff80::1", "100.128.0.1"} {
		if IsLocal(netip.MustParseAddr(ip)) {
			t.Errorf("IsLocal(%s) = true", ip)
		}
	}
}

func TestCredit(t *testing.T) {
	dbip, _ := testDB(t, "DBIP-Country-Lite")
	if c := dbip.Credit(); c == nil || c.Text != "IP Geolocation by DB-IP" || c.URL != "https://db-ip.com" {
		t.Errorf("DB-IP credit = %+v", c)
	}
	maxmind, _ := testDB(t, "GeoLite2-Country")
	if c := maxmind.Credit(); c == nil || c.URL != "https://www.maxmind.com" {
		t.Errorf("GeoLite2 credit = %+v", c)
	}
	other, _ := testDB(t, "Something-Else")
	if c := other.Credit(); c != nil {
		t.Errorf("unknown database credit = %+v, want none", c)
	}
}

func TestNilDB(t *testing.T) {
	var d *DB
	if d.Country(netip.MustParseAddr("81.2.69.160")) != "" || d.Credit() != nil || d.Type() != "" {
		t.Fatal("nil DB found something")
	}
	d.ReloadIfChanged()
	if err := d.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func TestOpen_MissingFile(t *testing.T) {
	if _, err := Open(filepath.Join(t.TempDir(), "absent.mmdb")); err == nil {
		t.Fatal("Open of a missing file succeeded")
	}
}

func TestReloadIfChanged_PicksUpAReplacedFile(t *testing.T) {
	d, path := testDB(t, "DBIP-Country-Lite")
	ip := netip.MustParseAddr("81.2.69.160")
	if got := d.Country(ip); got != "GB" {
		t.Fatalf("before = %q", got)
	}
	geoiptest.Write(t, path, "DBIP-Country-Lite", map[string]mmdbtype.Map{"81.2.69.0/24": geoiptest.Country("IE")})
	// Make the change visible even on filesystems with coarse timestamps.
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(path, later, later); err != nil {
		t.Fatalf("chtimes: %v", err)
	}
	d.ReloadIfChanged()
	if got := d.Country(ip); got != "IE" {
		t.Fatalf("after replace = %q, want IE", got)
	}
}
