// Package geoiptest builds small country databases for tests, in the shape
// DB-IP and GeoLite2 use, so no vendor file is needed. Import it from tests
// only.
package geoiptest

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/maxmind/mmdbwriter"
	"github.com/maxmind/mmdbwriter/mmdbtype"
)

// Country is a record with just a country code.
func Country(code string) mmdbtype.Map {
	return mmdbtype.Map{"country": mmdbtype.Map{"iso_code": mmdbtype.String(code)}}
}

// RegisteredCountry is a record with only the registered country, as
// GeoLite2 has for some networks.
func RegisteredCountry(code string) mmdbtype.Map {
	return mmdbtype.Map{"registered_country": mmdbtype.Map{"iso_code": mmdbtype.String(code)}}
}

// Write builds a database at path, replacing any file there rather than
// rewriting it (a reader may have it memory-mapped).
func Write(t testing.TB, path, dbType string, records map[string]mmdbtype.Map) {
	t.Helper()
	tree, err := mmdbwriter.New(mmdbwriter.Options{DatabaseType: dbType, RecordSize: 24})
	if err != nil {
		t.Fatalf("new tree: %v", err)
	}
	for cidr, rec := range records {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			t.Fatalf("parse %s: %v", cidr, err)
		}
		if err := tree.Insert(network, rec); err != nil {
			t.Fatalf("insert %s: %v", cidr, err)
		}
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := tree.WriteTo(f); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		t.Fatalf("rename: %v", err)
	}
}

// Countries writes a database of whole-network country records to a temp
// dir and returns its path.
func Countries(t testing.TB, dbType string, codes map[string]string) string {
	t.Helper()
	recs := make(map[string]mmdbtype.Map, len(codes))
	for cidr, code := range codes {
		recs[cidr] = Country(code)
	}
	path := filepath.Join(t.TempDir(), "country.mmdb")
	Write(t, path, dbType, recs)
	return path
}
