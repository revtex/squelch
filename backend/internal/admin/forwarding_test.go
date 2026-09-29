package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/revtex/squelch/internal/delivery"
)

// fakeForwarder stands in for the downstream or webhook service.
type fakeForwarder struct {
	stats    map[int64]delivery.Stats
	tested   []int64
	forgot   []int64
	reloads  int
	testErr  error
	testResp delivery.Result
}

func (f *fakeForwarder) Stats(id int64) delivery.Stats { return f.stats[id] }
func (f *fakeForwarder) Test(_ context.Context, id int64) (delivery.Result, error) {
	f.tested = append(f.tested, id)
	return f.testResp, f.testErr
}
func (f *fakeForwarder) Forget(id int64) { f.forgot = append(f.forgot, id) }
func (f *fakeForwarder) Reload()         { f.reloads++ }

func decodeList(t *testing.T, v any) []map[string]any {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out []map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func TestWebhooks_SecretIsWriteOnly(t *testing.T) {
	o, _ := newTestOperations(t, "")
	fw := &fakeForwarder{stats: map[int64]delivery.Stats{}}
	o.Deps.Webhooks = fw
	ctx := context.Background()
	admin := seedSessionUser(t, o.Queries, "admin")

	created, err := o.WebhooksCreate(ctx, params(t, map[string]any{
		"label": " Ops ", "url": "https://example.org/hook", "secret": "s3cret", "systemsJson": "[1]",
	}), admin)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	m := created.(map[string]any)
	if _, leaked := m["secret"]; leaked {
		t.Fatal("secret must not be returned")
	}
	if m["hasSecret"] != true || m["label"] != "Ops" {
		t.Fatalf("created = %v", m)
	}
	if fw.reloads != 1 {
		t.Fatalf("reloads = %d", fw.reloads)
	}
	id := m["id"].(int64)

	// Blank secret keeps it.
	if _, err := o.WebhooksUpdate(ctx, params(t, map[string]any{
		"id": id, "label": "Ops", "url": "https://example.org/hook", "type": "generic", "secret": "",
	}), admin); err != nil {
		t.Fatalf("update: %v", err)
	}
	wh, _ := o.Queries.GetWebhook(ctx, id)
	if !wh.Secret.Valid || wh.Secret.String != "s3cret" {
		t.Fatalf("blank secret should keep the old one, got %+v", wh.Secret)
	}

	// clearSecret removes it.
	res, err := o.WebhooksUpdate(ctx, params(t, map[string]any{
		"id": id, "url": "https://example.org/hook", "clearSecret": true,
	}), admin)
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
	if res.(map[string]any)["hasSecret"] != false {
		t.Fatal("secret should be cleared")
	}

	list, err := o.WebhooksList(ctx, nil, admin)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	rows := decodeList(t, list)
	if len(rows) != 1 || rows[0]["last"] != nil || rows[0]["sent24h"] != float64(0) {
		t.Fatalf("list = %v", rows)
	}

	if _, err := o.WebhooksCreate(ctx, params(t, map[string]any{"url": "https://x.org", "type": "slack"}), admin); err == nil {
		t.Fatal("bad type should be refused")
	}
}

func TestWebhooks_TestAndDeleteUseTheService(t *testing.T) {
	o, _ := newTestOperations(t, "")
	fw := &fakeForwarder{
		stats:    map[int64]delivery.Stats{},
		testResp: delivery.Result{At: 1, OK: false, Status: 502, Error: "the target answered 502 Bad Gateway", Millis: 30},
	}
	o.Deps.Webhooks = fw
	ctx := context.Background()
	admin := seedSessionUser(t, o.Queries, "admin")
	created, err := o.WebhooksCreate(ctx, params(t, map[string]any{"label": "Bot", "url": "https://example.org/hook"}), admin)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := created.(map[string]any)["id"].(int64)

	res, err := o.WebhooksTest(ctx, params(t, map[string]any{"id": id}), admin)
	if err != nil {
		t.Fatalf("test: %v", err)
	}
	if r := res.(map[string]any); r["ok"] != false || r["status"] != 502 {
		t.Fatalf("test result = %v", r)
	}
	if len(fw.tested) != 1 || fw.tested[0] != id {
		t.Fatalf("tested = %v", fw.tested)
	}

	fw.stats[id] = delivery.Stats{Last: delivery.Result{At: 5, OK: true, Status: 204}, LastOKAt: 5, Sent24h: 3, Failed24h: 1}
	rows := decodeList(t, must(o.WebhooksList(ctx, nil, admin)))
	if rows[0]["failed24h"] != float64(1) || rows[0]["last"].(map[string]any)["status"] != float64(204) {
		t.Fatalf("stats not on the row: %v", rows[0])
	}

	if _, err := o.WebhooksDelete(ctx, params(t, map[string]any{"id": id}), admin); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(fw.forgot) != 1 || fw.forgot[0] != id {
		t.Fatalf("forgot = %v", fw.forgot)
	}
	_, err = o.WebhooksTest(ctx, params(t, map[string]any{"id": id}), admin)
	var ue UserError
	if !errors.As(err, &ue) {
		t.Fatalf("testing a deleted webhook should be a user error, got %v", err)
	}
}

func TestDownstreams_LabelAndTest(t *testing.T) {
	o, _ := newTestOperations(t, "")
	fw := &fakeForwarder{stats: map[int64]delivery.Stats{}, testResp: delivery.Result{At: 1, OK: true, Status: 200, Millis: 12}}
	o.Deps.Downstreams = fw
	ctx := context.Background()
	admin := seedSessionUser(t, o.Queries, "admin")

	if _, err := o.DownstreamsCreate(ctx, params(t, map[string]any{"url": "https://mirror.example.org"}), admin); err == nil {
		t.Fatal("a downstream without an API key should be refused")
	}
	created, err := o.DownstreamsCreate(ctx, params(t, map[string]any{
		"label": "Mirror", "url": "https://mirror.example.org", "apiKey": "k",
	}), admin)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	m := created.(map[string]any)
	if m["label"] != "Mirror" || m["hasApiKey"] != true {
		t.Fatalf("created = %v", m)
	}
	id := m["id"].(int64)
	res, err := o.DownstreamsTest(ctx, params(t, map[string]any{"id": id}), admin)
	if err != nil {
		t.Fatalf("test: %v", err)
	}
	if res.(map[string]any)["ok"] != true {
		t.Fatalf("test = %v", res)
	}
	if msg := lastLogMessage(t, o); msg != fmt.Sprintf("admin: downstream %q tested by admin: ok (200 in 12 ms)", "Mirror") {
		t.Fatalf("audit line = %q", msg)
	}
}

func must(v any, err error) any {
	if err != nil {
		panic(err)
	}
	return v
}
