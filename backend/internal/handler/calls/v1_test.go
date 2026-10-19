package calls_test

// Phase N-1 — integration tests for the native /api/v1/* call surface.
//
// Covers:
//   - Happy path POST /api/v1/calls with native field names + Bearer API key.
//   - Each validation failure mode of POST /api/v1/calls (missing fields,
//     unix-timestamp startedAt, RFC 3339 happy path, missing audio).
//   - The connectivity check POST /api/v1/calls/test → 204.
//   - The renamed listener tg-selection endpoint at /api/v1/listener/tg-selection.
//   - The native error envelope shape on at least one 400, 401, 403, and 404
//     response.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/revtex/squelch/internal/audio"
	"github.com/revtex/squelch/internal/auth"
	"github.com/revtex/squelch/internal/db"
	"github.com/revtex/squelch/internal/handler/routes"
	"github.com/revtex/squelch/internal/logging"
)

func init() {
	gin.SetMode(gin.TestMode)
	logging.Configure(true, "")
}

// engineV1 is a v1-flavoured copy of engineWithCalls used by the legacy
// contract tests. Same wiring; only renamed for clarity.
func engineV1(t *testing.T) (*gin.Engine, *db.Queries) {
	t.Helper()
	return engineV1WithTranscriber(t, nil)
}

// engineV1WithTranscriber is engineV1 with transcription wired in.
func engineV1WithTranscriber(t *testing.T, tr audio.Transcriber) (*gin.Engine, *db.Queries) {
	t.Helper()
	sqlDB, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	q := db.New(sqlDB)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	pool := audio.NewWorkerPool(ctx)
	proc := audio.NewProcessor(t.TempDir(), pool)

	r := gin.New()
	rl := auth.NewRateLimiter(context.Background())
	routes.RegisterRoutes(r, routes.Deps{
		Queries:     q,
		RateLimiter: rl,
		Processor:   proc,
		Transcriber: tr,
		Version:     "test",
	})
	return r, q
}

// seedV1Settings enables auto-populate so the upload happy-path doesn't 422.
func seedV1Settings(t *testing.T, q *db.Queries) {
	t.Helper()
	ctx := context.Background()
	for k, v := range map[string]string{
		"autoPopulateSystems":       "true",
		"audioConversion":           "0",
		"disableDuplicateDetection": "true",
	} {
		if err := q.UpsertSetting(ctx, db.UpsertSettingParams{Key: k, Value: v}); err != nil {
			t.Fatalf("UpsertSetting %q: %v", k, err)
		}
	}
}

func seedV1APIKey(t *testing.T, q *db.Queries, raw string) {
	t.Helper()
	if _, err := q.CreateAPIKey(context.Background(), db.CreateAPIKeyParams{
		Key:      auth.HashAPIKey(raw),
		Disabled: 0,
	}); err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
}

// buildV1Upload writes a native-shaped multipart body. Caller adds the audio
// file plus any additional fields they need.
func buildV1Upload(t *testing.T, fields map[string]string, withAudio bool) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := w.WriteField(k, v); err != nil {
			t.Fatalf("WriteField %q: %v", k, err)
		}
	}
	if withAudio {
		fw, err := w.CreateFormFile("audio", "test.wav")
		if err != nil {
			t.Fatalf("CreateFormFile: %v", err)
		}
		_, _ = fw.Write([]byte("RIFF\x24\x00\x00\x00WAVEfmt "))
	}
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

// TestPostV1Calls_HappyPath verifies the native upload happy path:
// Authorization: Bearer <key>, native field names, RFC 3339 startedAt.
func TestPostV1Calls_HappyPath(t *testing.T) {
	const apiKey = "v1-bearer-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)
	seedV1Settings(t, q)

	body, ct := buildV1Upload(t, map[string]string{
		"systemId":    "1",
		"talkgroupId": "100",
		"startedAt":   time.Now().UTC().Format(time.RFC3339),
	}, true)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var resp struct {
		ID      int64  `json:"id"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v\nbody: %s", err, w.Body.String())
	}
	if resp.ID <= 0 {
		t.Errorf("id = %d, want > 0", resp.ID)
	}
}

// TestPostV1Calls_RepliesWhileTranscriptionIsStuck — the upload reply must
// not wait on go-whisper. With a sidecar that never answers, one worker and a
// pool queue of four, the handler used to hang on the sixth call; a recorder
// that uploads one call at a time then fell behind for as long as the
// sidecar was down.
func TestPostV1Calls_RepliesWhileTranscriptionIsStuck(t *testing.T) {
	const apiKey = "v1-bearer-key"
	release := make(chan struct{})
	sidecar := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		<-release
	}))
	t.Cleanup(sidecar.Close)
	t.Cleanup(func() { close(release) })
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	poolCtx, stopPool := context.WithCancel(ctx)
	pool, err := audio.NewTranscriberPool(poolCtx, 1, sidecar.URL, "ggml-base", "en", false)
	if err != nil {
		t.Fatal(err)
	}
	engine, q := engineV1WithTranscriber(t, audio.NewTranscriberManager(ctx, pool, stopPool))
	seedV1APIKey(t, q, apiKey)
	seedV1Settings(t, q)

	const calls = 10
	codes := make(chan int, calls)
	go func() {
		for i := 0; i < calls; i++ {
			body, ct := buildV1Upload(t, map[string]string{
				"systemId":    "1",
				"talkgroupId": "100",
				"startedAt":   time.Now().UTC().Add(time.Duration(i) * time.Second).Format(time.RFC3339),
			}, true)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
			req.Header.Set("Content-Type", ct)
			req.Header.Set("Authorization", "Bearer "+apiKey)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)
			codes <- w.Code
		}
	}()
	for i := 0; i < calls; i++ {
		select {
		case code := <-codes:
			if code != http.StatusOK {
				t.Fatalf("upload %d: status = %d, want 200", i+1, code)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("upload %d did not get a reply while transcription was stuck", i+1)
		}
	}
}

// TestPostV1Calls_RejectsLegacyAuthTransports — only Authorization: Bearer is
// honoured on the v1 surface. X-API-Key header, ?key= query param, and form
// field "key" must all 401.
func TestPostV1Calls_RejectsLegacyAuthTransports(t *testing.T) {
	const apiKey = "v1-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)
	seedV1Settings(t, q)

	tests := []struct {
		name  string
		setup func(req *http.Request)
	}{
		{
			name: "X-API-Key header rejected",
			setup: func(req *http.Request) {
				req.Header.Set("X-API-Key", apiKey)
			},
		},
		{
			name: "?key= query rejected",
			setup: func(req *http.Request) {
				req.URL.RawQuery = "key=" + apiKey
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, ct := buildV1Upload(t, map[string]string{
				"systemId":    "1",
				"talkgroupId": "100",
				"startedAt":   time.Now().UTC().Format(time.RFC3339),
			}, true)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
			req.Header.Set("Content-Type", ct)
			tc.setup(req)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401; body: %s", w.Code, w.Body.String())
			}
			assertV1ErrorEnvelope(t, w.Body.Bytes())
		})
	}
}

// TestPostV1Calls_ValidationFailed_StartedAtUnix pins that a unix-timestamp
// startedAt is rejected with the v1 envelope.
func TestPostV1Calls_ValidationFailed_StartedAtUnix(t *testing.T) {
	const apiKey = "v1-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)
	seedV1Settings(t, q)

	body, ct := buildV1Upload(t, map[string]string{
		"systemId":    "1",
		"talkgroupId": "100",
		"startedAt":   strconv.FormatInt(time.Now().Unix(), 10),
	}, true)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] != "validation_failed" {
		t.Errorf("code = %v, want validation_failed", env["code"])
	}
	details, _ := env["details"].(map[string]any)
	if details["field"] != "startedAt" {
		t.Errorf("details.field = %v, want startedAt", details["field"])
	}
	if _, ok := details["got"]; !ok {
		t.Errorf("details.got missing; want the offending value to be echoed back")
	}
}

// TestPostV1Calls_ValidationFailed_MissingFields covers each required-field
// failure path of the native upload.
func TestPostV1Calls_ValidationFailed_MissingFields(t *testing.T) {
	const apiKey = "v1-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)
	seedV1Settings(t, q)

	cases := []struct {
		name      string
		fields    map[string]string
		withAudio bool
		wantField string
	}{
		{
			name:      "missing startedAt",
			fields:    map[string]string{"systemId": "1", "talkgroupId": "100"},
			withAudio: true,
			wantField: "startedAt",
		},
		{
			name:      "missing systemId",
			fields:    map[string]string{"talkgroupId": "100", "startedAt": time.Now().UTC().Format(time.RFC3339)},
			withAudio: true,
			wantField: "systemId",
		},
		{
			name:      "missing talkgroupId",
			fields:    map[string]string{"systemId": "1", "startedAt": time.Now().UTC().Format(time.RFC3339)},
			withAudio: true,
			wantField: "talkgroupId",
		},
		{
			name:      "missing audio",
			fields:    map[string]string{"systemId": "1", "talkgroupId": "100", "startedAt": time.Now().UTC().Format(time.RFC3339)},
			withAudio: false,
			wantField: "audio",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			body, ct := buildV1Upload(t, tc.fields, tc.withAudio)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
			req.Header.Set("Content-Type", ct)
			req.Header.Set("Authorization", "Bearer "+apiKey)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, req)

			if w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body: %s", w.Code, w.Body.String())
			}
			env := assertV1ErrorEnvelope(t, w.Body.Bytes())
			details, _ := env["details"].(map[string]any)
			if details["field"] != tc.wantField {
				t.Errorf("details.field = %v, want %q", details["field"], tc.wantField)
			}
		})
	}
}

// TestPostV1Calls_SystemNotFound returns 422 when auto-populate is disabled.
func TestPostV1Calls_SystemNotFound(t *testing.T) {
	const apiKey = "v1-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)
	// Don't seed autoPopulateSystems=true.
	_ = q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "audioConversion", Value: "0"})

	body, ct := buildV1Upload(t, map[string]string{
		"systemId":    "999",
		"talkgroupId": "100",
		"startedAt":   time.Now().UTC().Format(time.RFC3339),
	}, true)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] != "system_not_found" {
		t.Errorf("code = %v, want system_not_found", env["code"])
	}
}

// TestPostV1Calls_RejectJWTBearer pins that a JWT-shaped Bearer token sent to
// an API-key endpoint returns invalid_credentials, not "API key required".
func TestPostV1Calls_RejectJWTBearer(t *testing.T) {
	engine, q := engineV1(t)
	seedV1APIKey(t, q, "real-key")
	seedV1Settings(t, q)

	// Mint a real user JWT — the same shape an interactive client would
	// use. Should be refused on this Bearer-API-key route.
	hash, _ := auth.HashPassword("pw")
	uid, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: "alice", PasswordHash: hash, Role: auth.RoleAdmin,
		CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	tok, _, err := auth.GenerateToken(uid, "alice", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	body, ct := buildV1Upload(t, map[string]string{
		"systemId":    "1",
		"talkgroupId": "100",
		"startedAt":   time.Now().UTC().Format(time.RFC3339),
	}, true)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls", body)
	req.Header.Set("Content-Type", ct)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] != "invalid_credentials" {
		t.Errorf("code = %v, want invalid_credentials", env["code"])
	}
}

// TestPostV1Calls_TestEndpoint_204 — connectivity check returns 204 with no
// body when the Bearer key is valid, 401 otherwise.
func TestPostV1Calls_TestEndpoint(t *testing.T) {
	const apiKey = "v1-key"
	engine, q := engineV1(t)
	seedV1APIKey(t, q, apiKey)

	// Valid: 204.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls/test", nil)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body: %s", w.Code, w.Body.String())
	}
	if w.Body.Len() != 0 {
		t.Errorf("body = %q, want empty", w.Body.String())
	}

	// Missing auth: 401 with v1 envelope.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/calls/test", nil)
	w = httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body: %s", w.Code, w.Body.String())
	}
	assertV1ErrorEnvelope(t, w.Body.Bytes())
}

// TestV1ErrorEnvelope_403_AdminRequired pins the v1 forbidden envelope shape.
func TestV1ErrorEnvelope_403_AdminRequired(t *testing.T) {
	engine, q := engineV1(t)
	hash, _ := auth.HashPassword("pw")
	uid, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: "bob", PasswordHash: hash, Role: auth.RoleListener,
		CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	tok, _, err := auth.GenerateToken(uid, "bob", auth.RoleListener, 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/transcriptions/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] != "forbidden" {
		t.Errorf("code = %v, want forbidden", env["code"])
	}
}

// TestV1ErrorEnvelope_401_MissingJWT pins the v1 unauthorized envelope on a
// JWT-protected route reached without credentials.
func TestV1ErrorEnvelope_401_MissingJWT(t *testing.T) {
	engine, _ := engineV1(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] != "invalid_credentials" {
		t.Errorf("code = %v, want invalid_credentials", env["code"])
	}
}

// TestV1ListenerTGSelection_RenamedPath — the renamed v1 endpoint reaches the
// same handler body as the legacy /api/auth/tg-selection.
func TestV1ListenerTGSelection_RenamedPath(t *testing.T) {
	engine, q := engineV1(t)
	hash, _ := auth.HashPassword("pw")
	uid, err := q.CreateUser(context.Background(), db.CreateUserParams{
		Username: "carol", PasswordHash: hash, Role: auth.RoleAdmin,
		CreatedAt: time.Now().Unix(), UpdatedAt: time.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	tok, _, err := auth.GenerateToken(uid, "carol", auth.RoleAdmin, 0)
	if err != nil {
		t.Fatalf("GenerateToken: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/listener/tg-selection", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
}

// TestV1Health_Unauthenticated pins that GET /api/v1/health is reachable
// without auth and returns the same shape as the legacy health route.
func TestV1Health_Unauthenticated(t *testing.T) {
	engine, _ := engineV1(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Status != "ok" {
		t.Errorf("status = %q, want ok", resp.Status)
	}
}

// TestV1Calls_GetSearch_NotFound — GET /api/v1/calls/{id}/audio for a
// non-existent id surfaces a v1 envelope from the shared handler via the
// rewriter middleware.
func TestV1Calls_GetAudio_NotFound(t *testing.T) {
	engine, q := engineV1(t)
	_ = q.UpsertSetting(context.Background(), db.UpsertSettingParams{Key: "publicAccess", Value: "true"})

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/calls/%d/audio", 9999999), nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body: %s", w.Code, w.Body.String())
	}
	env := assertV1ErrorEnvelope(t, w.Body.Bytes())
	if env["code"] == nil {
		t.Errorf("v1 404 envelope missing code: %v", env)
	}
}

// assertV1ErrorEnvelope decodes a body that is expected to match
// {"error": {"code":..., "message":..., "details"?:...}}, returning the
// inner error object for further assertions.
func assertV1ErrorEnvelope(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("envelope decode: %v\nbody: %s", err, body)
	}
	errVal, ok := resp["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing/non-object error field; body: %s", body)
	}
	if _, ok := errVal["code"].(string); !ok {
		t.Fatalf("envelope missing string code; got %v", errVal)
	}
	if _, ok := errVal["message"].(string); !ok {
		t.Fatalf("envelope missing string message; got %v", errVal)
	}
	// details is optional and may be a map or absent.
	if d, ok := errVal["details"]; ok {
		if _, isMap := d.(map[string]any); !isMap && d != nil {
			t.Fatalf("details must be object or absent; got %T", d)
		}
	}
	return errVal
}

// silence unused-imports lint when test compilation skips a branch above
var _ = sql.ErrNoRows
