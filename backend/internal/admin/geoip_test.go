package admin

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/connections"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/geoip"
	"github.com/revtex/squelch/internal/geoip/geoiptest"
)

func withGeoIP(t *testing.T, ops *Operations, dbType string) {
	t.Helper()
	path := geoiptest.Countries(t, dbType, map[string]string{"81.2.69.0/24": "GB"})
	d, err := geoip.Open(path)
	if err != nil {
		t.Fatalf("open geoip: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ops.Deps.GeoIP = d
}

func TestConnectionsList_CountryAndCredit(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	withGeoIP(t, ops, "DBIP-Country-Lite")
	reg, _ := newRegistry(ops)
	reg.SetCountryLookup(ops.Deps.GeoIP.Country)
	addLive(reg, conn("gb", "81.2.69.160"))
	addLive(reg, conn("lan", "192.168.1.20"))

	res, err := ops.ConnectionsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("ConnectionsList: %v", err)
	}
	out := res.(map[string]any)
	info := out["geoip"].(map[string]any)
	credit, _ := info["credit"].(*geoip.Credit)
	if info["enabled"] != true || credit == nil || credit.Text != "IP Geolocation by DB-IP" {
		t.Fatalf("geoip = %+v", info)
	}
	rows := map[string]map[string]any{}
	for _, c := range out["connections"].([]map[string]any) {
		rows[c["id"].(string)] = c
	}
	if rows["gb"]["country"] != "GB" || rows["gb"]["local"] != false {
		t.Errorf("gb row = %v", rows["gb"])
	}
	if rows["lan"]["country"] != nil || rows["lan"]["local"] != true {
		t.Errorf("lan row = %v", rows["lan"])
	}
}

func TestSessionsAndHistory_Country(t *testing.T) {
	ops, q := newTestOperations(t, "")
	withGeoIP(t, ops, "GeoLite2-Country")
	newRegistry(ops)
	uid := seedSessionUser(t, q, "erin")
	addRefresh(t, q, uid, "fam", "81.2.69.160", time.Now().Unix(), false)

	res, err := ops.SessionsList(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("SessionsList: %v", err)
	}
	s := res.(map[string]any)["sessions"].([]map[string]any)[0]
	if s["country"] != "GB" {
		t.Errorf("session country = %v, want GB (resolved at list time)", s["country"])
	}

	// History keeps what was resolved at the time, even if the database
	// would now say otherwise.
	if _, err := q.InsertConnectionLog(context.Background(), db.InsertConnectionLogParams{
		Kind: string(connections.KindListener), Ip: "8.8.8.8",
		CountryCode: sql.NullString{String: "US", Valid: true}, ConnectedAt: time.Now().Unix(),
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}
	hist, err := ops.ConnectionsHistory(context.Background(), nil, 1)
	if err != nil {
		t.Fatalf("ConnectionsHistory: %v", err)
	}
	h := hist.(map[string]any)
	row := h["items"].([]map[string]any)[0]
	if out := toJSON(t, row); !strings.Contains(out, `"country":"US"`) || !strings.Contains(out, `"local":false`) {
		t.Errorf("history row = %s", out)
	}
	if h["geoip"].(map[string]any)["enabled"] != true {
		t.Errorf("history geoip = %v", h["geoip"])
	}
}

func TestNoGeoIP_HidesTheColumn(t *testing.T) {
	ops, _ := newTestOperations(t, "")
	reg, _ := newRegistry(ops)
	addLive(reg, conn("gb", "81.2.69.160"))
	res, _ := ops.ConnectionsList(context.Background(), nil, 1)
	out := res.(map[string]any)
	if out["geoip"].(map[string]any)["enabled"] != false {
		t.Fatalf("geoip = %v", out["geoip"])
	}
	if c := out["connections"].([]map[string]any)[0]; c["country"] != nil {
		t.Fatalf("country = %v without a database", c["country"])
	}
}
