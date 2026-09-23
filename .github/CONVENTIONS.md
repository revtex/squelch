# Squelch — Conventions

## Project Overview

Squelch is a modern web-based radio call manager — a reimplementation of rdio-scanner using Go + React.

## Tech Stack

- **Backend:** Go 1.26, Gin, coder/websocket, modernc.org/sqlite, sqlc, golang-jwt, bcrypt, golang-migrate, kardianos/service, log/slog, go:embed, webpush-go, swaggo
- **Frontend:** React 18, TypeScript (strict), Vite 6, Tailwind CSS 4 (@tailwindcss/vite), DaisyUI 5 (dark/light themes), Redux Toolkit, RTK Query, React Router 7, @tanstack/react-virtual, lucide-react, Service Worker (PWA + push notifications)
- **Database:** SQLite (WAL mode) — all application configuration is stored in the DB
- **Server config:** CLI flags, environment variables, or an optional JSON config file (for listen address, DB path, TLS, encryption key). The encryption key is the exception: flag, key file, or environment variable only — never the config file.
- **Audio:** Files stored on filesystem, FFmpeg for conversion (4 modes: disabled/enabled/norm/loudnorm), bounded worker pool
- **Transcription:** go-whisper HTTP API sidecar (whisper.cpp, CPU or GPU); supports diarization via tinydiarize model
- **Dev tooling:** air (Go hot-reload) + Vite proxy (single `make dev`), ripgrep (`rg`) for searching, pnpm for frontend package management

## Project Structure

```
squelch/
  backend/             ← Go backend
  frontend/            ← React frontend
  docs/                ← Documentation (user guides + design plans)
  .github/conventions/ ← Per-domain conventions (go, react, db, docs, reviewer, testing, cleanup)
  .devcontainer/       ← Codespaces / dev container setup (ripgrep, Go, Node, pnpm, sqlc, migrate, swag, air)
```

## Change ordering

Some changes have a required order, because one side generates what the other
consumes:

- **New database column** — migration and query `.sql` first, then `make generate`
  (sqlc types must exist before Go can consume them), then the Go code, then the
  frontend if the column surfaces in the UI.
- **Feature spanning backend and frontend** — settle the API shape first; the
  frontend can then be built against it rather than guessing.
- **Security-sensitive change** — implement it, then review it against the
  Security Rules below as a separate pass. Reviewing while writing misses things.
- **Any non-trivial implementation** — tests come with it, not after the fact.

Per-domain detail lives in `.github/conventions/` (go, react, db, docs, reviewer,
testing, cleanup). Read the relevant one before non-trivial work in that area.

## Coding Conventions (high level)

Full layout, package boundaries, file-split heuristics, and naming rules live in [PROJECT_LAYOUT.md](PROJECT_LAYOUT.md). Detailed per-domain conventions live in the individual agent files. The non-negotiables for every surface of the app:

### Go

- All errors returned, never panicked in HTTP handlers
- Gin handlers use typed response structs
- SQL via sqlc only — no raw string queries
- JWT in `Authorization: Bearer` header; API keys in `X-API-Key` header
- Tests are table-driven, use `httptest` for API tests
- Use `log/slog` for all logging — never `log.Println` or `fmt.Println`
- Use `context.Context` propagation; graceful shutdown via `context.WithCancel`
- External processes: arg slice to `exec.CommandContext` — never shell strings
- HTTP clients that reach external URLs disable redirect following (SSRF defense)
- Every public `/api/*` endpoint has swaggo annotations; regenerate with `make swag`

### TypeScript / React

- Strict mode; no `any`, no `@ts-ignore`
- All imports use `@/` alias for `src/`
- All server data goes through RTK Query slices
- WS events dispatch to Redux; components never parse WS messages directly
- JWT tokens are held in Redux memory only — never in `localStorage`/`sessionStorage`
- No `dangerouslySetInnerHTML`
- DaisyUI 5 classes for UI components; no hand-rolled equivalents

### Database

- One query file per table in `backend/sqlc/queries/`
- Migrations are append-only; never rewrite a committed migration
- After editing `.sql` files: `cd backend/sqlc && sqlc generate`
- Update `backend/sqlc/schema/schema.sql` to match the final-state schema
- Every index must correspond to a real query path

## Security Rules (OWASP Top 10 — always enforce)

1. All admin routes require valid JWT with admin role
2. Call upload routes require valid API key (`X-API-Key` header or `?key=` query)
3. No SQL string concatenation — sqlc only
4. bcrypt cost ≥ 12 for passwords
5. No secrets (tokens, passwords, API keys, decrypted `enc::` values) in logs or error responses
6. Audio file paths sanitised — no `../` traversal; `filepath.Rel` check before any read/delete
7. FFmpeg invoked with arg slice, never shell string; go-whisper accessed via HTTP only (no subprocess)
8. Role-based access: listener JWT cannot access admin endpoints (403)
9. Public access mode (`publicAccess` setting) allows unauthenticated scanner listening; admin routes are never public
10. Webhook secrets use HMAC-SHA256 for payload signing
11. VAPID keys stored encrypted in settings table; push subscriptions validated before delivery
12. Secrets at rest (downstream API keys, VAPID private key, webhook secrets) encrypted with AES-256-GCM using the `enc::` prefix; startup fails fast on missing/wrong encryption key
13. Refresh tokens stored as SHA-256 hashes with family rotation; reuse revokes the entire family; delivered in httpOnly/Secure/SameSite=Lax cookies
14. All outbound HTTP (downstream, webhooks, push) uses `safehttp.Client` — redirects disabled, timeouts enforced, response body capped. Private-address blocking is opt-in via `SQUELCH_BLOCK_INTERNAL_HTTP=1` (default allows LAN/loopback because Squelch is a self-hosted homelab tool)
15. Max 20 concurrent JWT tokens per user (`auth.MaxRefreshFamilies`); 3-strike lockout (10 min) on login; hourly cleanup goroutine for expired refresh tokens

## Tooling Conventions

- Search: prefer the VS Code `grep_search` tool. In the terminal, use `rg` (ripgrep) — never plain `grep`
- File listing: `list_dir` or `file_search` — avoid `find` in the terminal
- Validation after a change: run `go vet ./... && go build ./...` for backend, `npx tsc --noEmit` for frontend
- Do not commit or push unless the user explicitly asks
- Do not delete files as a shortcut; if a file looks unfamiliar, read it first

## Local-only planning docs (`docs/plans/`)

- The entire `docs/plans/` directory is **gitignored** (see [.gitignore](../.gitignore)). Files there are local working notes only.
- **Never** mention plan files, plan filenames, or contents of `docs/plans/*` in:
  - `CHANGELOG.md`
  - committed docs (`docs/*.md` outside `docs/plans/`)
  - commit messages
  - PR titles or PR descriptions
  - code comments
  - any other tracked file
- Treat plan docs the way you'd treat a personal scratchpad: useful while working, invisible to anyone reading the repository.
- When asked to write a plan, place it under `docs/plans/` and do not stage or commit it. Do not link to it from tracked files (the link would 404 for everyone else).
- If you find an existing tracked file that links into `docs/plans/`, treat that link as a bug and remove the reference.

## Changelog

- User-visible changes (new features, fixes, config/schema changes, security patches) **must** add a bullet under the `[Unreleased]` section of `CHANGELOG.md` in the same PR
- Group bullets under `### Added`, `### Changed`, `### Fixed`, `### Security`, `### Removed`, or `### Deprecated` (Keep a Changelog format)
- Pure internal refactors, CI-only tweaks, and typo fixes can skip the CHANGELOG — the PR should be labeled `skip-changelog`
- The `changelog` CI job blocks merges into `main` when `CHANGELOG.md` wasn't touched and the label isn't applied
- CHANGELOG bullets describe **what changed in the product**, never **what plan was followed**. Don't reference plan filenames or phase numbers from `docs/plans/`.

## Releases

- **Any user-visible fix or feature ships as a version release.** Do not merge a user-visible change into `main` and leave it sitting in `[Unreleased]` — cut a tag (`vX.Y.Z`) in the same session so binaries, PDFs, and semver Docker tags (`latest`, `X.Y.Z`, `X.Y`) are published
- Bugs that affect how users install, run, or consume Squelch (Docker pulls, binary availability, install docs, config parsing) count as user-visible even when the diff is only CI/workflow YAML
- Pure CI/tooling/internal-docs changes (e.g. iterating on a cleanup workflow, refactoring an action, tweaking dev-container setup) may batch under `[Unreleased]` and ship with the next real release
- When in doubt, ask the user rather than batching — an unreleased user-visible fix is worse than an extra patch release
