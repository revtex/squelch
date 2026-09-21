package calls_test

import (
	"bytes"
	"context"
	"database/sql"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
)

// scopeFixture has system A (radio 11) and system B (radio 22), each with an
// unlabeled talkgroup 300, and auto-populate turned on.
type scopeFixture struct {
	engine *gin.Engine
	q      *db.Queries
	sysA   int64
	sysB   int64
}

func newScopeFixture(t *testing.T) scopeFixture {
	t.Helper()
	engine, q, _ := engineWithCalls(t)
	enableAutoPopulate(t, q)
	ctx := context.Background()
	sysA, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 11, Label: "A"})
	if err != nil {
		t.Fatal(err)
	}
	sysB, err := q.CreateSystem(ctx, db.CreateSystemParams{SystemID: 22, Label: "B"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sys := range []int64{sysA, sysB} {
		if _, err := q.CreateTalkgroup(ctx, db.CreateTalkgroupParams{TalkgroupID: 300, SystemID: sys}); err != nil {
			t.Fatal(err)
		}
	}
	return scopeFixture{engine: engine, q: q, sysA: sysA, sysB: sysB}
}

func (f scopeFixture) key(t *testing.T, raw, systems string, valid bool) string {
	t.Helper()
	if _, err := f.q.CreateAPIKey(context.Background(), db.CreateAPIKeyParams{
		Key:         auth.HashAPIKey(raw),
		SystemsJson: sql.NullString{String: systems, Valid: valid},
	}); err != nil {
		t.Fatal(err)
	}
	return raw
}

// upload posts one call for radio system systemID through the legacy
// trunk-recorder alias or the v1 route and returns the status code.
func (f scopeFixture) upload(t *testing.T, v1 bool, key string, systemID int64) int {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fields := map[string]string{
		"systemId":       strconv.FormatInt(systemID, 10),
		"talkgroupId":    "300",
		"talkgroupLabel": "INJECTED-LABEL",
		"systemLabel":    "Rogue",
	}
	path := "/api/trunk-recorder-call-upload"
	if v1 {
		path = "/api/v1/calls"
		fields["startedAt"] = time.Now().UTC().Format(time.RFC3339)
	} else {
		fields["dateTime"] = strconv.FormatInt(time.Now().Unix(), 10)
	}
	for k, v := range fields {
		_ = w.WriteField(k, v)
	}
	fw, _ := w.CreateFormFile("audio", "test.wav")
	_, _ = fw.Write([]byte("RIFF\x24\x00\x00\x00WAVEfmt "))
	_ = w.Close()

	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if v1 {
		req.Header.Set("Authorization", "Bearer "+key)
	} else {
		req.Header.Set("X-API-Key", key)
	}
	rec := httptest.NewRecorder()
	f.engine.ServeHTTP(rec, req)
	return rec.Code
}

func TestUpload_ScopedAPIKeyCannotReachOtherSystems(t *testing.T) {
	scopes := map[string]string{
		"flat UI form": "[{A}]",
		"object form":  `[{"id":{A}}]`,
		"malformed":    "{not json",
	}
	for name, scope := range scopes {
		for _, v1 := range []bool{false, true} {
			t.Run(name+"/v1="+strconv.FormatBool(v1), func(t *testing.T) {
				f := newScopeFixture(t)
				scope := replaceA(scope, f.sysA)
				k := f.key(t, "scoped-key", scope, true)
				ctx := context.Background()

				if code := f.upload(t, v1, k, 22); code != http.StatusForbidden {
					t.Errorf("upload to out-of-scope system = %d, want 403", code)
				}
				if code := f.upload(t, v1, k, 999); code != http.StatusForbidden {
					t.Errorf("upload to unknown system = %d, want 403", code)
				}
				if _, err := f.q.GetSystemBySystemID(ctx, 999); err == nil {
					t.Error("scoped key auto-created a system")
				}
				tg, err := f.q.GetTalkgroupBySystemAndTGID(ctx, db.GetTalkgroupBySystemAndTGIDParams{SystemID: f.sysB, TalkgroupID: 300})
				if err != nil {
					t.Fatal(err)
				}
				if tg.Label.String != "" {
					t.Errorf("out-of-scope talkgroup was backfilled: label %q", tg.Label.String)
				}
				if n, _ := f.q.CountCalls(ctx); n != 0 {
					t.Errorf("%d calls stored after refused uploads", n)
				}

				want := http.StatusOK
				if name == "malformed" {
					want = http.StatusForbidden
				}
				if code := f.upload(t, v1, k, 11); code != want {
					t.Errorf("upload to system A = %d, want %d", code, want)
				}
			})
		}
	}
}

func TestUpload_UnscopedAPIKeyReachesAllSystems(t *testing.T) {
	for _, tc := range []struct {
		name    string
		systems string
		valid   bool
	}{{"null", "", false}, {"empty array", "[]", true}} {
		for _, v1 := range []bool{false, true} {
			t.Run(tc.name+"/v1="+strconv.FormatBool(v1), func(t *testing.T) {
				f := newScopeFixture(t)
				k := f.key(t, "open-key", tc.systems, tc.valid)
				for _, sys := range []int64{11, 22, 999} {
					if code := f.upload(t, v1, k, sys); code != http.StatusOK {
						t.Errorf("upload to system %d = %d, want 200", sys, code)
					}
				}
			})
		}
	}
}

func replaceA(s string, id int64) string {
	return string(bytes.ReplaceAll([]byte(s), []byte("{A}"), []byte(strconv.FormatInt(id, 10))))
}
