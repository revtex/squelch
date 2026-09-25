package webhook

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/downstream"
)

func newQueries(t *testing.T) *db.Queries {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db.New(sqlDB)
}

type capture struct {
	mu     sync.Mutex
	bodies [][]byte
	heads  []http.Header
	status int
}

func (c *capture) handler(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	c.mu.Lock()
	c.bodies = append(c.bodies, b)
	c.heads = append(c.heads, r.Header.Clone())
	status := c.status
	c.mu.Unlock()
	if status == 0 {
		status = http.StatusNoContent
	}
	w.WriteHeader(status)
}

func (c *capture) wait(t *testing.T, n int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		got := len(c.bodies)
		c.mu.Unlock()
		if got >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("waited for %d requests", n)
}

func TestService_SignsAndSendsTheCall(t *testing.T) {
	q := newQueries(t)
	cap := &capture{}
	srv := httptest.NewServer(http.HandlerFunc(cap.handler))
	t.Cleanup(srv.Close)
	enc, err := auth.EncryptString("s3cret", "passphrase-passphrase-passphrase")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if _, err := q.CreateWebhook(context.Background(), db.CreateWebhookParams{
		Url: srv.URL, Type: TypeGeneric, Secret: sql.NullString{String: enc, Valid: true}, Label: "Ops",
	}); err != nil {
		t.Fatalf("CreateWebhook: %v", err)
	}
	svc := NewService(q, "passphrase-passphrase-passphrase", "test")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	svc.Start(ctx)
	t.Cleanup(svc.Stop)

	svc.Notify(downstream.CallEvent{CallID: 7, DateTime: 1000, SystemID: 1, System: 1, TalkgroupID: 3204, Talkgroup: 1, TalkgroupLabel: "FD Disp", SystemLabel: "County"})
	cap.wait(t, 1)

	var got CallPayload
	if err := json.Unmarshal(cap.bodies[0], &got); err != nil {
		t.Fatalf("payload: %v", err)
	}
	if got.Event != "call" || got.Call.ID != 7 || got.Call.Talkgroup.Label != "FD Disp" || got.Call.System.Label != "County" {
		t.Fatalf("payload = %+v", got)
	}
	if h := cap.heads[0]; h.Get("X-Squelch-Event") != "call" || h.Get("X-Squelch-Signature") != Sign("s3cret", cap.bodies[0]) {
		t.Fatalf("headers = %v", h)
	}
	deadline := time.Now().Add(2 * time.Second)
	for svc.Stats(1).Sent24h == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if s := svc.Stats(1); !s.Last.OK || s.Sent24h != 1 || s.Last.Status != http.StatusNoContent {
		t.Fatalf("stats = %+v", s)
	}
}

func TestService_FiltersBySystemAndRecordsFailures(t *testing.T) {
	q := newQueries(t)
	cap := &capture{status: http.StatusBadGateway}
	srv := httptest.NewServer(http.HandlerFunc(cap.handler))
	t.Cleanup(srv.Close)
	if _, err := q.CreateWebhook(context.Background(), db.CreateWebhookParams{
		Url: srv.URL, Type: TypeDiscord, SystemsJson: sql.NullString{String: "[5]", Valid: true},
	}); err != nil {
		t.Fatalf("CreateWebhook: %v", err)
	}
	svc := NewService(q, "", "test")
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	svc.Start(ctx)
	t.Cleanup(svc.Stop)

	svc.Notify(downstream.CallEvent{CallID: 1, System: 9, Talkgroup: 1}) // not system 5: skipped
	res, err := svc.Test(ctx, 1)
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if res.OK || res.Status != http.StatusBadGateway || res.Error == "" {
		t.Fatalf("test result = %+v", res)
	}
	cap.wait(t, 1)
	var msg map[string]any
	if err := json.Unmarshal(cap.bodies[0], &msg); err != nil || msg["content"] == nil {
		t.Fatalf("discord test body = %s", cap.bodies[0])
	}
	if h := cap.heads[0]; h.Get("X-Squelch-Signature") != "" {
		t.Fatal("discord posts must not carry a Squelch signature")
	}
	wh, _ := q.GetWebhook(ctx, 1)
	if wh.LastOk != 0 || wh.LastStatus != http.StatusBadGateway || !wh.LastAt.Valid {
		t.Fatalf("row not updated with the failure: %+v", wh)
	}
	if s := svc.Stats(1); s.Failed24h != 1 || s.Sent24h != 1 {
		t.Fatalf("stats = %+v", s)
	}
}
