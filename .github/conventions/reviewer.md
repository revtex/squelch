# Review conventions

**Applies to:** The whole app — backend, frontend, database, build, and deploy. Security and code quality.

Part of the conventions set — see [CONVENTIONS.md](../CONVENTIONS.md) for the
shared rules and [PROJECT_LAYOUT.md](../PROJECT_LAYOUT.md) for structure.

## Working in this area

Review is an investigation task. Do not assume the codebase matches the checklist — verify each item.

- For each checklist item, run a targeted Grep or read to confirm or disprove it. Prefer the Grep and Glob tools over shell search. Cite file:line for both passes and fails.
- Prefer concrete findings (`backend/internal/api/calls.go:112` builds SQL via string concatenation) over generalizations ("SQL injection risk exists").
- Output format: group findings as `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`. Each finding has: file:line, one-sentence description, one-sentence recommended fix.
- Skip any checklist item that does not apply to the file(s) under review — do not pad the report with N/A entries.
- When asked for a full audit, cover every applicable section. When asked to review a specific file or diff, scope the review to that change and the systems it touches.
- Do not apply fixes unless explicitly asked to.

## Review Scope

This reviewer covers the whole application. Sections below map to subsystems:

1. **Security** — OWASP Top 10 (all 10 categories)
2. **Auth & sessions** — JWT, refresh tokens, API keys, RBAC, rate limiting
3. **Audio pipeline** — FFmpeg, worker pool, duplicate detection, filesystem paths
4. **Transcription pipeline** — go-whisper HTTP client, queue, worker pool
5. **WebSocket hub** — listener/admin WS, compression, broadcast, backpressure
6. **Directory monitor** — fsnotify, per-recorder parsers, auto-ingest
7. **Downstream & webhooks** — fan-out, retries, SSRF, HMAC signing
8. **Push notifications** — VAPID, subscription lifecycle, webpush-go
9. **Database & migrations** — sqlc discipline, indexes, migrations, encryption-at-rest
10. **Configuration & secrets** — CLI/env/JSON-file precedence, encryption key handling, import/export
11. **Concurrency & resources** — goroutine lifecycle, locking, file handles, DB connections
12. **Observability** — slog structured logs, request IDs, error paths, log hygiene
13. **API/HTTP layer** — Gin handlers, middleware order, CORS, timeouts, content-type discipline
14. **Frontend (React/TS)** — XSS, storage of secrets, strict TS, service worker, PWA
15. **Build, deploy, runtime** — Dockerfile, embedded assets, systemd service, graceful shutdown
16. **Testing posture** — coverage of critical paths (see Testing Expert for depth)

## Security Checklist (OWASP Top 10)

### A01 — Broken Access Control

- [ ] All admin endpoints require valid JWT with `role=admin` (via `RequireAdmin` middleware)
- [ ] All call-upload endpoints require valid `X-API-Key` header (or `?key=` query param)
- [ ] Setup endpoints are disabled once `app_state.setup_complete = 1`
- [ ] WebSocket listener auth is enforced via access code PIN OR listener JWT, except when `publicAccess` is enabled
- [ ] `publicAccess` never grants admin WS or admin REST access
- [ ] Per-access-code / per-listener system + talkgroup grants are enforced — calls outside granted scope never reach the client
- [ ] Admin WebSocket requires admin JWT on every connection; role check is not skipped
- [ ] Shared call links (`/call/:token`) validate token and expiry before returning audio/metadata
- [ ] Bookmarks API enforces ownership — a user cannot read or delete another user's bookmark
- [ ] Refresh token rotation endpoints do not accept refresh tokens belonging to another user
- [ ] Audio file download routes sanitise the path and confirm it falls inside the configured audio directory
- [ ] Downstream HTTP client disables redirect following (SSRF protection)
- [ ] Downstream audio path validated via `filepath.Rel` before read
- [ ] DirMonitor delete-after-ingest validates file is inside the watched directory before `os.Remove`
- [ ] Webhook URL validation rejects loopback, link-local, and internal IPs when SSRF protection is configured

### A02 — Cryptographic Failures

- [ ] Admin and user passwords are bcrypt-hashed (cost ≥ 12) — never stored or logged in plaintext
- [ ] JWT signing uses HS256 with a secret of ≥ 32 random bytes
- [ ] JWT tokens have a finite expiry (`exp` claim set) and include `jti`, `userId`, `username`, `role`
- [ ] API keys are stored hashed (never plaintext) and compared in constant time
- [ ] Refresh tokens stored as SHA-256 hashes — plaintext never persisted
- [ ] No sensitive data (tokens, passwords, API keys, VAPID private key) in logs or error responses
- [ ] Secrets at rest (downstream API keys, VAPID private key, webhook secrets) encrypted with AES-256-GCM (`enc::` prefix) when encryption key is configured
- [ ] Encryption key derivation uses HKDF-SHA256 with a fixed salt and info string — no weak KDF
- [ ] Startup migration auto-encrypts plaintext secrets or fails fast on missing/wrong key
- [ ] Config import validates that encrypted values can be decrypted with the current key before applying
- [ ] TLS is terminated at reverse proxy or by the server itself — no plaintext credentials over HTTP in production

### A03 — Injection

- [ ] All SQL is parameterised via sqlc — no `fmt.Sprintf`, `+`, or template-built queries
- [ ] FFmpeg subprocess args are passed as a slice (`exec.Command(bin, arg...)`) — never via shell interpolation or `sh -c`
- [ ] `go-whisper` HTTP requests use typed structs and `json.Marshal` — no string interpolation of user input
- [ ] Audio filenames are sanitised before use as filesystem paths (reject `..`, absolute paths, null bytes)
- [ ] User-controlled input to logging is either field-separated (slog key/value) or escaped — no format string injection
- [ ] JSON array columns (`sources_json`, `systems_json`, `blacklists_json`) are unmarshalled with type assertions; malformed input does not panic

### A04 — Insecure Design

- [ ] First-run setup cannot be re-triggered by a signed-in user to overwrite the admin account
- [ ] Duplicate call detection runs before DB insert, preventing flood on buggy recorders
- [ ] Call pruning respects bookmarks (does not delete bookmarked calls)
- [ ] Audio worker pool is bounded (`runtime.NumCPU()`), so a flood of uploads cannot exhaust FFmpeg processes
- [ ] Transcription queue is bounded; backlog is dropped or rate-limited, not unbounded
- [ ] Per-API-key rate limit on call upload prevents a misconfigured recorder from overwhelming the server
- [ ] WebSocket broadcast is non-blocking; a slow client cannot stall the hub
- [ ] Max clients setting is enforced before accept; over-limit connections are closed with `MAX` message
- [ ] Share tokens are random (crypto/rand) and long enough to resist guessing; expiry is honored

### A05 — Security Misconfiguration

- [ ] CORS is explicitly configured — not `*` with credentials in production
- [ ] Error responses do not expose stack traces or internal paths to clients (check `c.Error`, `c.AbortWithError` usage)
- [ ] Default admin password MUST be changed on first login (`passwordNeedChange` flag enforced on `/api/auth/me` or equivalent)
- [ ] Debug endpoints, profiling routes (`/debug/pprof`), and verbose slog levels are off by default in production
- [ ] Service binds to the configured listen address — no accidental `0.0.0.0` when not intended
- [ ] Embedded frontend assets are served with appropriate cache headers; HTML is not cached aggressively
- [ ] No secrets in the embedded binary, git repo, Dockerfile, or CI config

### A06 — Vulnerable and Outdated Components

- [ ] `go.mod` has no unmaintained or known-vulnerable dependencies (check `go list -m -u all`, watch for deprecated modules)
- [ ] `package.json` dependencies are current; no high/critical advisories in `pnpm audit`
- [ ] Dependencies pinned to exact or compatible ranges — no `latest` tags
- [ ] FFmpeg and whisper binaries used are from a trusted source (Dockerfile base image or documented install)

### A07 — Identification & Authentication Failures

- [ ] Login rate limiter: 3 failures → 10-minute lockout per IP
- [ ] Max `auth.MaxRefreshFamilies` (20) concurrent JWT tokens per user enforced (oldest invalidated on overflow)
- [ ] JWT tokens are invalidated on logout (server-side token tracker)
- [ ] Refresh token family rotation: reuse of an old token revokes the entire family
- [ ] Refresh cookie flags: `HttpOnly`, `Secure` in production, `SameSite=Lax`
- [ ] Refresh tokens have a finite expiry (30 days) with hourly cleanup goroutine
- [ ] Password change flow requires the current password (no silent reset)
- [ ] Access code (listener PIN) comparison is constant time

### A08 — Software and Data Integrity Failures

- [ ] Audio uploads validate size and content-type before persisting
- [ ] Uploaded filenames are stored in DB as the resolved path, not the raw client-provided path
- [ ] sqlc generation is committed to the repo — no ad-hoc hand-edits to `internal/db/*.sql.go`
- [ ] Migrations are append-only once released; no in-place edits of historical migrations
- [ ] Embedded frontend assets (`go:embed dist`) match the committed frontend build (CI build step verified)
- [ ] Encrypted secrets import path validates decryption before committing to DB

### A09 — Security Logging and Monitoring

- [ ] All login attempts (success and failure) are written to the `logs` table
- [ ] API key usage errors (401/403) are logged with request ID
- [ ] WebSocket auth failures are logged (with reason, without the attempted credential)
- [ ] Downstream push success/failure logged to `logs` table
- [ ] Webhook delivery attempts (success and failure with status code) are logged
- [ ] Push notification delivery failures and auto-removed expired subscriptions are logged
- [ ] Rate limit hits are logged (per IP, per API key)
- [ ] Setup completion, password changes, API key creation/revocation are logged as audit events
- [ ] Log entries include request ID for correlation

### A10 — Server-Side Request Forgery (SSRF)

- [ ] Downstream HTTP client disables redirect following
- [ ] Webhook HTTP client disables redirect following
- [ ] Push notification endpoint URLs from subscriptions are validated — no file://, no localhost unless explicitly configured
- [ ] go-whisper sidecar URL is operator-configured only, not user-controllable
- [ ] Any future user-supplied URL (OAuth callback, remote config fetch) must be validated against an allowlist or at minimum reject private IP ranges

## Auth & Sessions

- [ ] JWT middleware checks token signature, expiry, and revocation list in that order
- [ ] Role mismatch returns 403 with no information leak (don't reveal admin route exists)
- [ ] `TokenTracker` eviction on 6th login actually invalidates the oldest token (verify in test)
- [ ] Rate limiter state is per-IP with proper proxy header handling (or documented as requiring trusted proxy)
- [ ] Logout revokes both the JWT (token tracker) and the refresh token family
- [ ] Refresh token reuse detection covers both the rotation and logout paths

## Audio Pipeline

- [ ] Duplicate detection query uses index and time window correctly
- [ ] FFmpeg conversion has per-job timeout — no runaway processes
- [ ] Worker pool shutdown drains in-flight jobs on context cancel
- [ ] Failed conversions are logged and do not leak tmp files
- [ ] Audio file storage path construction is deterministic and cannot escape the audio root
- [ ] Audio serving uses streaming (`c.File` or `io.Copy`) — not full buffering

## Transcription Pipeline

- [ ] go-whisper HTTP client has configurable timeout
- [ ] Transcription worker pool size is bounded and configurable
- [ ] Failed transcriptions are retried with bounded attempts, then logged and skipped
- [ ] `TRN` WS broadcast is non-blocking
- [ ] Transcript text storage uses the `transcriptions` table with FK to `calls.id` ON DELETE CASCADE

## WebSocket Hub

- [ ] Broadcast uses `select { case ch <- msg: default: drop }` or per-client goroutines — never a direct blocking send
- [ ] Client disconnect cleans up all hub references (no goroutine leaks)
- [ ] Compression (permessage-deflate context-takeover) is enabled and tested
- [ ] Max frame size is bounded to prevent memory exhaustion
- [ ] LSC debounce (3s max) is enforced on listener count changes
- [ ] Admin WS protocol (`ADM_REQ` / `ADM_RES` / `ADM_EVT`) validates op names and payloads before dispatch
- [ ] Unknown ops return an error response, never panic

## Directory Monitor

- [ ] `fsnotify` watcher handles watcher errors and restarts cleanly
- [ ] Parser errors log the offending file and continue — one bad file does not stop the watcher
- [ ] Symlinks inside watched directories are either followed safely or rejected
- [ ] File size limit (if any) rejects unreasonably large uploads before parse
- [ ] Delete-after-ingest fails closed: if the file cannot be confirmed inside the watched dir, it is not deleted

## Downstream & Webhooks

- [ ] Downstream pusher: buffered channel (default 1000) drops with log when full — no unbounded growth
- [ ] Exponential backoff honors context cancellation
- [ ] System/talkgroup grant filter evaluated before each push — changes via admin take effect on Reload
- [ ] HMAC-SHA256 signing uses the webhook secret; signature header format documented
- [ ] Webhook payload schema is versioned or at minimum consistent

## Push Notifications

- [ ] VAPID keys stored encrypted at rest
- [ ] Expired or invalid push subscriptions are deleted from DB after delivery failure
- [ ] Push payload size fits within webpush-go limits (4 KB typical)
- [ ] Subscription matching honors talkgroup filters

## Database & Migrations

- [ ] All queries go through sqlc — no `db.Exec` / `db.Query` with hand-written SQL in handlers
- [ ] Composite indexes exist for hot query paths (`calls(date_time, system_id, talkgroup_id)`, `refresh_tokens(token_hash)`, etc.)
- [ ] `PRAGMA journal_mode=WAL; busy_timeout=5000; foreign_keys=ON` set on every connection
- [ ] Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- [ ] New migrations are append-only; no rewriting historical migrations
- [ ] Multi-row operations that must be atomic are wrapped in a transaction
- [ ] Foreign keys use `ON DELETE CASCADE` where child rows have no meaning without the parent

## Configuration & Secrets

- [ ] Config precedence is documented and enforced: CLI flag > env var > JSON config file > default
- [ ] Missing encryption key with encrypted values in DB fails fast with a clear error (never silently degrades)
- [ ] Wrong encryption key cannot decrypt — error message does not reveal plaintext length or content
- [ ] Config export does not include decrypted secrets unless explicitly requested
- [ ] Log level, listen address, DB path, audio path are all operator-configurable

## Concurrency & Resource Management

- [ ] Every spawned goroutine has a defined lifecycle (bound to context, loop terminates on cancel, or joined by sync.WaitGroup)
- [ ] All locks are released in defer — no early return paths that hold a lock
- [ ] Channels are closed by the sender, not the receiver
- [ ] `sync.Once` or atomic flags used where appropriate — not ad-hoc boolean guards
- [ ] File handles from `os.Open` are always closed (defer, or moved into a helper)
- [ ] HTTP response bodies are always closed (defer on `resp.Body`)
- [ ] DB rows from queries are iterated to completion or closed
- [ ] No global mutable state outside explicitly locked structures

## Observability

- [ ] Every log line uses `log/slog` with key/value pairs — no `log.Println`, `fmt.Println`
- [ ] Request ID middleware injects a UUID into the context and the `X-Request-ID` response header
- [ ] Error log lines include the request ID, user ID (if authenticated), and the affected resource ID
- [ ] Health check endpoint (`/api/v1/health`) returns version and does not require auth
- [ ] Structured log fields are stable (`user_id`, `request_id`, `call_id`) — not ad-hoc names per handler
- [ ] Log level is controlled by config, not hardcoded

## API / HTTP Layer

- [ ] Handlers return typed response structs or `gin.H{}` — never naked strings for JSON responses
- [ ] Request body size is limited (Gin `MaxMultipartMemory` for uploads; body limit middleware for JSON)
- [ ] `Content-Type` is validated on uploads — unexpected types rejected
- [ ] HTTP read/write/idle timeouts are set on the server
- [ ] Graceful shutdown drains in-flight requests before closing
- [ ] Middleware order: RequestID → Recovery → CORS → Auth → RateLimit → handler
- [ ] Panics in handlers are caught by recovery middleware and logged with request ID
- [ ] OpenAPI/Swagger annotations are accurate for every public endpoint

## Frontend (React/TypeScript)

- [ ] No `any` types (TS strict mode enforced)
- [ ] No `dangerouslySetInnerHTML`
- [ ] JWT tokens held in Redux state only — never in `localStorage` or `sessionStorage`
- [ ] Refresh flow relies on httpOnly cookie — no client-side refresh token handling
- [ ] RTK Query used for all server data — no raw `fetch` calls outside `src/app/api.ts`
- [ ] WebSocket client handles reconnect with exponential backoff and auth refresh
- [ ] Service worker does not cache authenticated API responses
- [ ] PWA manifest icons and theme color match current branding
- [ ] Long lists (admin tables with 1000+ rows) use `@tanstack/react-virtual`
- [ ] Keyboard shortcuts respect input focus and the `keyboardShortcuts` setting
- [ ] Accessibility: semantic HTML, ARIA labels on icon-only buttons, focus management on modal open/close
- [ ] No secrets, API keys, or JWT logged to console
- [ ] Error boundaries wrap major route trees

## Build, Deploy, Runtime

- [ ] Dockerfile builds frontend then backend; embeds `dist/` via `go:embed`
- [ ] Dockerfile runs as non-root user
- [ ] Dockerfile exposes only the intended port
- [ ] Multi-stage build — final image does not contain Go or Node toolchain
- [ ] FFmpeg and any whisper dependencies present in the runtime image and documented
- [ ] Systemd unit (via kardianos/service) supports start/stop/status
- [ ] Graceful shutdown: context cancellation → `srv.Shutdown(ctx)` → WS hub drain → DB close
- [ ] Data volumes (DB, audio) are configurable, documented, and outside the binary dir
- [ ] Versioning: binary reports semver + git SHA on `/api/v1/health` and startup log

## Testing Posture

- [ ] Critical paths have tests (see Testing Expert agent for the full matrix)
- [ ] Auth, refresh token rotation, rate limiter, duplicate detection, audio path sanitiser, downstream pusher, crypto round-trip all tested
- [ ] Tests use `t.TempDir()` and in-memory SQLite — never the developer's real DB or audio dir
- [ ] No test leaves goroutines running past the test (verify with `leaktest` or explicit shutdown)

## Red Flags That Always Warrant a Finding

- Raw SQL strings outside sqlc
- `exec.Command` with a single string (shell interpolation)
- `fmt.Sprintf` building a URL, SQL, or file path from user input
- `panic()` in any handler or middleware
- A goroutine spawned without a clear shutdown path
- A channel receive or send without `select` + `ctx.Done()` in a long-lived loop
- A password, token, or API key logged (even at debug level)
- A new migration that modifies or drops data from a historical migration
- `cors.AllowAll()` or `Access-Control-Allow-Origin: *` with credentials
- `localStorage.setItem('token', ...)` or equivalent in TS
- `dangerouslySetInnerHTML` anywhere
- `// TODO: security` or `// FIXME: auth` left in the code
