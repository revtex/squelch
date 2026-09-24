// Package geoip resolves a client address to a country from an MMDB file
// the operator supplies. Squelch ships no database: the operator downloads
// one (DB-IP IP to Country Lite, or MaxMind GeoLite2-Country) and is its
// licensee. Lookups are local; no address leaves the server.
package geoip

import (
	"fmt"
	"log/slog"
	"net/netip"
	"os"
	"sync"
	"time"

	maxminddb "github.com/oschwald/maxminddb-golang/v2"
)

// Credit is the attribution the database's licence asks for, shown next to
// the country column.
type Credit struct {
	Text string `json:"text"`
	URL  string `json:"url"`
}

// credits maps an MMDB database_type to its vendor's requested credit.
// The wording is the vendors' own; see docs/research/geoip-database-licensing.md.
var credits = map[string]Credit{
	"DBIP-Country-Lite": {Text: "IP Geolocation by DB-IP", URL: "https://db-ip.com"},
	"GeoLite2-Country": {
		Text: "This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com.",
		URL:  "https://www.maxmind.com",
	},
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// IsLocal reports whether an address belongs to a private, loopback,
// link-local or carrier-grade NAT network, which no database places in a
// country. It needs no database.
func IsLocal(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsUnspecified() || cgnat.Contains(ip)
}

type record struct {
	Country struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"country"`
	// GeoLite2 leaves country empty for some networks (anycast, satellite)
	// but still knows where the block is registered.
	RegisteredCountry struct {
		ISOCode string `maxminddb:"iso_code"`
	} `maxminddb:"registered_country"`
}

// DB is an open country database. A nil *DB is valid and finds nothing,
// so callers need not check whether one is configured.
type DB struct {
	path string

	mu      sync.RWMutex
	reader  *maxminddb.Reader
	modTime time.Time
}

// Open opens the database at path.
func Open(path string) (*DB, error) {
	d := &DB{path: path}
	if err := d.open(); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *DB) open() error {
	st, err := os.Stat(d.path)
	if err != nil {
		return err
	}
	r, err := maxminddb.Open(d.path)
	if err != nil {
		return fmt.Errorf("open %s: %w", d.path, err)
	}
	d.mu.Lock()
	old := d.reader
	d.reader = r
	d.modTime = st.ModTime()
	d.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

// ReloadIfChanged reopens the file when it has been replaced since it was
// opened, so a monthly or twice-weekly download takes effect without a
// restart. The update must replace the file (download elsewhere, then
// move it into place), not rewrite it in place.
func (d *DB) ReloadIfChanged() {
	if d == nil {
		return
	}
	st, err := os.Stat(d.path)
	if err != nil {
		slog.Warn("geoip: database file is unreadable; keeping the open copy", "path", d.path, "error", err)
		return
	}
	d.mu.RLock()
	same := st.ModTime().Equal(d.modTime)
	d.mu.RUnlock()
	if same {
		return
	}
	if err := d.open(); err != nil {
		slog.Warn("geoip: failed to reopen the updated database; keeping the open copy", "error", err)
		return
	}
	slog.Info("geoip: reopened the updated database", "path", d.path, "type", d.Type())
}

// Country returns the ISO 3166-1 alpha-2 code for ip, or "" when the
// address is local or not in the database.
func (d *DB) Country(ip netip.Addr) string {
	if d == nil || !ip.IsValid() {
		return ""
	}
	ip = ip.Unmap()
	if IsLocal(ip) {
		return ""
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.reader == nil {
		return ""
	}
	var rec record
	if err := d.reader.Lookup(ip).Decode(&rec); err != nil {
		return ""
	}
	if rec.Country.ISOCode != "" {
		return rec.Country.ISOCode
	}
	return rec.RegisteredCountry.ISOCode
}

// Type is the database's own name for itself (its database_type).
func (d *DB) Type() string {
	if d == nil {
		return ""
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	if d.reader == nil {
		return ""
	}
	return d.reader.Metadata.DatabaseType
}

// Credit is the attribution to show for the open database, or nil for a
// database this package does not recognise.
func (d *DB) Credit() *Credit {
	if c, ok := credits[d.Type()]; ok {
		return &c
	}
	return nil
}

// Close releases the database.
func (d *DB) Close() error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.reader == nil {
		return nil
	}
	err := d.reader.Close()
	d.reader = nil
	return err
}
