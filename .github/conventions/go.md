# Go backend conventions

**Applies to:** `backend/**` — Gin handlers, sqlc queries, the WebSocket hub, audio pipeline, dirmonitor, downstream, auth, middleware, and Go tests.

Part of the conventions set — see [CONVENTIONS.md](../CONVENTIONS.md) for the
shared rules and [PROJECT_LAYOUT.md](../PROJECT_LAYOUT.md) for structure.

## Working in this area

- Read before writing: for any non-trivial change, read the handler/package you're modifying and any callers, and Grep the symbols you'll touch. Prefer the Grep and Glob tools over shell search.
- Implement the requested change directly. Do not ask clarifying questions for ambiguities you can resolve yourself — state your assumption and proceed.
- Use `sqlc generate` after editing `backend/sqlc/queries/*.sql`. Use `go vet ./...` and `go build ./...` to validate changes before reporting done. If `docs/` is missing, create the stub: `mkdir -p docs && echo 'package docs' > docs/docs.go`.
- Add or update tests alongside code changes. Do not defer tests unless the user explicitly says so.
- Keep output focused: a short summary of what changed, the files touched as clickable links, and any follow-ups. Skip restating the plan or the diff.
- Follow the conventions below exactly — e.g., `log/slog` only, sqlc only, no panics in handlers. These are not guidelines; they are hard constraints.

## Tech Stack

- Go 1.26
- Gin HTTP framework
- modernc.org/sqlite (pure Go SQLite driver, no CGO)
- sqlc for type-safe query generation
- github.com/coder/websocket for WebSocket hub (permessage-deflate compression enabled)
- golang-jwt/jwt v5 for JWT auth
- golang.org/x/crypto/bcrypt for password hashing
- golang-migrate for SQL migrations (runner lives in `internal/db/open.go`; migrations embedded via `go:embed`)
- kardianos/service for system service (daemon) support
- log/slog for structured logging (no `log.Println` — use `slog.Info/Warn/Error` with key-value pairs)
- go:embed for embedding frontend dist/ into the binary
- FFmpeg invoked as an external subprocess for audio conversion (bounded worker pool)
- go-whisper HTTP API sidecar for speech-to-text transcription (whisper.cpp, CPU or GPU); supports diarization via tinydiarize model
- github.com/SherClockHolmes/webpush-go for Web Push notifications
- swaggo/swag for OpenAPI/Swagger generation (run via `make swag` from `backend/`)

## Conventions

### General

- All packages use lowercase names matching their directory name
- Return `(T, error)` from all functions that can fail — never panic in handlers
- Wrap errors with context: `fmt.Errorf("doing X: %w", err)`. Use `errors.Is`/`errors.As` at the call site, not string comparison
- Use sentinel errors (`var ErrNotFound = errors.New(...)`) for conditions callers need to distinguish
- Use `context.Context` as the first parameter of any function that does I/O, and propagate it to every downstream call
- No global mutable state outside explicitly locked structures or `sync.Once` initialization

### Logging

- Use `log/slog` for all logging — structured key-value pairs, never `fmt.Println`, `log.Println`, or `log.Printf`
- Use stable field names: `user_id`, `request_id`, `call_id`, `system_id`, `talkgroup_id`, `error`
- Never log admin passwords, JWT tokens, API keys, refresh tokens, or decrypted secrets
- Request ID middleware injects UUID v4 into every request's slog context and `X-Request-ID` response header; use `slog.InfoContext(ctx, ...)` from handlers so the request ID is attached automatically

### HTTP / Gin handlers

- Handlers write JSON with typed response structs (preferred) or `c.JSON(status, gin.H{...})` — never naked strings
- Request body and response types live in the same file as the handler; if reused, move to `internal/api/swagger_models.go`
- Validate input early; return `400` with a clear error message on bad input
- Use `c.AbortWithStatusJSON(status, gin.H{"error": "..."})` to terminate the request cleanly; `return` immediately after
- All routes are registered in `internal/api/routes.go` — keep route declarations grouped by feature and middleware
- Every public endpoint must have swaggo annotations (`// @Summary`, `// @Tags`, `// @Router`, `// @Success`, `// @Failure`, `// @Security`)
- API keys are validated via `X-API-Key` header OR `?key=` query param
- JWT tokens are validated in `internal/middleware/middleware.go` (`JWTAuth` + `RequireAdmin`)

### Database / sqlc

- All database queries go through sqlc-generated interfaces in `internal/db` — never hand-written `db.Exec` or `db.Query`
- One `.sql` query file per table under `backend/sqlc/queries/`, named to match the table
- After editing any `.sql` query file: `cd backend/sqlc && sqlc generate`. After editing migrations: add a new file, do not rewrite historical ones
- SQLite connection opens with WAL mode: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON`
- Multi-row mutations that must be atomic: wrap in `db.BeginTx` / `tx.Commit()` / `defer tx.Rollback()`
- Timestamps: `INTEGER` (Unix epoch seconds) unless human-readable is required, then `TEXT` RFC3339
- JSON columns use the `_json` suffix and store as `TEXT`

### Concurrency

- Every goroutine has a documented lifecycle: bound to a `ctx`, terminated on cancel, or joined by a `sync.WaitGroup`
- Long-lived loops use `select { case <-ctx.Done(): return; ... }` — never bare `for { ... }`
- All broadcasts from the WS hub are non-blocking (`select` with `default` drop) — a slow client cannot stall others
- File handles and HTTP response bodies: always `defer f.Close()` / `defer resp.Body.Close()` right after the error check
- DB rows are iterated to completion or closed; sqlc-generated `:many` queries already handle this

### External processes and HTTP clients

- FFmpeg: build args as a `[]string` slice, pass to `exec.CommandContext(ctx, bin, args...)` — never `sh -c` or shell interpolation
- go-whisper: use `http.Client` with a configured timeout; send/receive typed JSON structs
- Downstream push, webhooks, push notifications: `http.Client` must set `CheckRedirect` to block redirects (SSRF defense) and honor `ctx`
- Any long-running external call must have a per-call timeout, not just a global client timeout

### Config and secrets

- Precedence: CLI flag > environment variable > JSON config file > default — documented in `internal/config`
- Application config (talkgroups, systems, api keys, etc.) lives in the `settings` table, not files
- Encryption key (`SQUELCH_ENCRYPTION_KEY` or `--encryption-key`) is required when `enc::` values exist in the DB; startup fails fast on missing/wrong key
- Never log decrypted secret values; never return decrypted secrets from API responses unless the route is explicitly for export/reveal and authorized

### Testing

- Write table-driven tests in `_test.go` files alongside implementation files
- API tests use `net/http/httptest` + in-memory SQLite — see the Testing Expert agent for the full matrix
- Use `t.TempDir()` for any filesystem work; never touch the developer's real DB or audio dir
- Tests must not leave goroutines running past completion; cancel contexts and join before returning

### Dependencies

- Do not add new modules without clear justification. Prefer stdlib or existing deps
- After adding or removing an import: `go mod tidy` to keep `go.sum` clean
- Check licence compatibility for any new dependency (MIT / Apache-2.0 / BSD are fine; AGPL is not)

## File Layout

```
backend/
  cmd/server/main.go         ← config loading, server startup, graceful shutdown
  cmd/migrate/main.go        ← standalone migration runner
  docs/                      ← swaggo-generated OpenAPI artifacts (regenerate with `make swag`)
  internal/api/              ← Gin route handlers
    routes.go                ← all route registration
    setup.go                 ← first-run setup flow
    auth_test.go             ← login / refresh / logout tests
    calls.go                 ← call upload + list/search/get/delete
    admin.go                 ← admin-only operations
    share.go                 ← shareable call links
    bookmarks.go             ← per-user call bookmarks
    import.go                ← config import/export
    radioreference.go        ← optional RadioReference.com lookups for talkgroup/system metadata
    health.go                ← /api/v1/health (+ legacy /api/health alias)
    swagger_models.go        ← shared request/response types for swaggo
  internal/ws/               ← WebSocket hub + listener client + admin client + protocol messages
    hub.go                   ← broadcast, client registry
    client.go                ← per-connection lifecycle, compression, auth
    messages.go              ← command constants, message builders
    admin_ops.go             ← admin WS op handlers
  internal/db/               ← sqlc-generated (do not edit manually); plus open.go (connection + migration runner)
  internal/audio/            ← FFmpeg pipeline, duplicate detection, bounded worker pool, Whisper transcriber, pruner
  internal/dirmonitor/       ← fsnotify watcher + per-recorder parsers (trunk-recorder, SDRTrunk, etc.)
  internal/downstream/       ← call push to remote Squelch instances
  internal/auth/             ← JWT + bcrypt + rate limiter + TokenTracker (max-5-token per user) + refresh tokens (family rotation, httpOnly cookies) + AES-256-GCM encryption-at-rest (crypto.go)
  internal/seed/             ← first-run DB seed (settings, groups, tags)
  internal/logging/          ← slog handler configuration
  internal/cli/              ← CLI flag parsing and help
  internal/config/           ← server startup config (flags, env vars, JSON file, encryption key)
  internal/static/           ← embedded frontend assets (go:embed)
  internal/middleware/       ← Gin middleware (JWTAuth, APIKeyAuth, RateLimit, RequestID, Recovery)
  migrations/                ← numbered .sql files (embedded via go:embed)
  sqlc/queries/              ← .sql query files (source of truth for internal/db)
  sqlc/schema/               ← reference schema for sqlc type inference
```

## Build and Validation Commands

Before reporting a task done, run the validation loop:

- `cd backend && go vet ./...` — catches most obvious issues
- `cd backend && go build ./...` — compiles the whole tree
- `cd backend && go test ./...` — when touching tested code paths
- `cd backend/sqlc && sqlc generate` — after any `.sql` query file edit
- `cd backend && make swag` — after adding or changing swaggo annotations on a handler
- If `backend/docs/` is missing (gopls import error), create the stub: `mkdir -p docs && echo 'package docs' > docs/docs.go`

## Swagger / OpenAPI

- Every public `/api/*` endpoint must have swaggo annotations
- Run `make swag` from `backend/` after annotation changes — this regenerates `backend/docs/`
- Warnings about `mProfCycleWrap` from swag are upstream Go artifacts; harmless
- The generated `docs.go` is committed; `docs/swagger.json` and `docs/swagger.yaml` are the artifacts consumed by the frontend/admin API explorer (if enabled)

## Migration Workflow

1. Pick the next sequential number: `NNN_short_snake_case_description.sql` (e.g., `028_add_call_retention_days.sql`)
2. Write idempotent SQL: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN` guarded by sqlite feature checks if needed
3. Migrations are embedded via `go:embed` in `backend/migrations/migrations.go`; no extra registration needed
4. Never modify a committed migration file; add a new one to correct or extend
5. Update `backend/sqlc/schema/` to match the new final-state schema so sqlc type inference stays correct
6. Run `sqlc generate` and `go build ./...` to verify

## Key Behaviours

- First run: `app_state.setup_complete = 0` → `/api/setup/status` returns `{needsSetup: true}`; setup creates the initial admin user and marks setup complete
- RBAC: two roles (`admin`, `listener`); JWT payload includes `userId`, `username`, `role`, `jti` (UUID v4); `RequireAdmin` middleware on admin-only routes
- Max 5 active tokens per user enforced by in-memory `TokenTracker`; oldest token evicted on 6th login; revoked tokens checked in `JWTAuth` middleware
- Admin login rate limit: 3 failed attempts → 10-minute lockout (in-memory, per IP)
- Refresh tokens: 30-day expiry, family-based rotation (reuse detection revokes entire family), stored as SHA-256 hashed values, delivered in httpOnly/Secure/SameSite=Lax cookies, hourly cleanup goroutine purges expired tokens
- Duplicate detection: query last call per talkgroup within `duplicateDetectionTimeFrame` ms setting
- Call pruning: background goroutine on 1-hour ticker deletes calls older than `pruneDays` in batches of 500; skips calls with bookmarks
- Audio conversion: 4 modes (0=disabled, 1=enabled, 2=enabled+norm, 3=enabled+loudnorm); mode 3: `ffmpeg -i <input> -c:a aac -b:a 32k -af loudnorm <output.m4a>`; jobs run through a bounded worker pool (`runtime.NumCPU()` workers)
- Transcription: after audio conversion, queue call for go-whisper HTTP transcription if `transcriptionEnabled` is true; worker pool (default 1 for GPU); broadcast `TRN` event on completion
- Directory monitor: fsnotify watches configured directories; per-recorder parsers (trunk-recorder JSON sidecar, SDRTrunk filename mask, etc.); delete-after-ingest only after validating the file is inside the watched dir
- Downstream pusher: fan-out — one goroutine per active downstream with buffered channel (1000 events); grant filtering via `systems_json`; multipart POST to remote `/api/call-upload` with `X-API-Key` header; exponential backoff retry (1s→30s cap, max 5, jitter); HTTP client disables redirects (SSRF); audio path traversal check; `Reload` triggered by admin CRUD; graceful `Stop` on shutdown
- Webhook delivery: after call ingest, match webhooks by TG filter, deliver via goroutine pool; generic (JSON + HMAC-SHA256) or Discord (embed); retry 3× with backoff
- Push notifications: on call ingest, match `push_subscriptions` by TG filter; deliver via webpush-go; auto-delete expired subscriptions
- WS commands are JSON arrays: `[command, payload?, flags?]`; audio is sent as binary frames after the CAL JSON
- WS compression: `CompressionContextTakeover` enabled via coder/websocket (configured in `ws/client.go`)
- WS listener auth: PIN command (access code) or JWT token (listener user) or unauthenticated when `publicAccess` setting is enabled; admin WS always requires JWT with admin role
- Public access mode: when `publicAccess` setting is `true`, WS listeners connect without auth and receive all systems/TGs; admin routes are never public
- Admin WS protocol: `ADM_REQ` (client→server) / `ADM_RES` (server→client, keyed by request id) / `ADM_EVT` (server-initiated); ops dispatched from `admin_ops.go`
- LSC broadcasts are debounced (max once per 3 seconds)
- Health check: `GET /api/v1/health` returns `{status: "ok", version: "..."}` — no auth required (legacy `/api/health` alias still served, with deprecation headers)
- Graceful shutdown: `context.WithCancel` root context; `srv.Shutdown(ctx)` drains HTTP; hub drains WS connections; audio and transcription workers drain in-flight jobs
- Per-API-key rate limiting on call upload (default 60/min)
- RadioReference integration (`api/radioreference.go`): optional lookups to populate system/talkgroup metadata; requires operator-supplied RR credentials in settings
- Config import/export (`api/import.go`): export full config (settings, systems, talkgroups, api keys, downstreams, webhooks, dirmonitors) as JSON; import validates structure, validates encrypted values can be decrypted with the current key, applies atomically
- Secrets encryption at rest: AES-256-GCM with HKDF-SHA256 key derivation from passphrase; encrypted values prefixed with `enc::`; covers downstream API keys, VAPID private key, webhook secrets; startup migration auto-encrypts plaintext or fails-fast on missing/wrong key; config import validates encrypted values can be decrypted before applying

## When You Should Push Back

- Asked to add a new dependency for something stdlib covers → suggest the stdlib approach first
- Asked to add a raw SQL query in a handler → refuse, add a sqlc query instead
- Asked to `panic()` in any non-startup code → refuse, return an error
- Asked to log a token, password, or decrypted secret → refuse, log an identifier or hash instead
- Asked to rewrite a committed migration → refuse, add a new migration
- Asked to catch an error silently → push back, at minimum log it with context
- Asked to do `exec.Command("sh", "-c", userInput)` or any shell interpolation → refuse, build arg slice
