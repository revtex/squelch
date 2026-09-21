# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Squelch is a web-based radio call manager — a single Go binary with an embedded React SPA that ingests scanner calls from radio recorders (Trunk-Recorder, SDRTrunk, etc.), stores audio on disk and metadata in SQLite, streams live feeds to browsers over WebSocket, and serves a full admin dashboard. It is a from-scratch reimplementation of [rdio-scanner](https://github.com/chuot/rdio-scanner) and keeps its upload API backward-compatible.

## Authoritative conventions

Two existing files are the source of truth for structure and rules — read them before non-trivial work, and keep them in sync if you change conventions:

- **`.github/PROJECT_LAYOUT.md`** — full directory layout, package boundaries, file-split heuristics, naming, and per-domain conventions. When it contradicts the tree, the doc wins and the tree is the bug.
- **`.github/CONVENTIONS.md`** — tech stack, the numbered Security Rules (OWASP-aligned, always enforced), required change ordering, and changelog/release policy.
- **`.github/conventions/*.md`** — seven per-domain convention files (go, react, db, docs, reviewer, testing, cleanup). Read the relevant one before non-trivial work in that area.
- **`CONTEXT.md`** — the domain model: the vocabulary for Calls, Talkgroups, Systems, Listeners, LIVE/BKGND, and the words we deliberately don't use. Read it before naming anything.
- **`docs/adr/`** — numbered, append-only Architecture Decision Records: what was decided and *why*, including the alternatives that lost. Check it before changing something in an area it covers; add one when a decision worth keeping gets made. `docs/adr/README.md` has the format and the index.

Do not duplicate those rules from memory — defer to them.

> **On sub-agents:** the per-domain files are **reference material, not dispatch targets** — read the relevant one rather than spawning an agent to read it for you. Skills under `.claude/skills/` may spawn sub-agents where they say to (`two-axis-review` runs its two axes in parallel, `research` runs in the background, `security-audit` fans out hunters and verifiers in full audit mode); follow the skill.

## Commands

All commands run through Makefiles that delegate to `backend/` and `frontend/`. From the repo root:

```bash
make dev      # air (Go hot-reload) + Vite dev server together — primary dev loop
make build    # frontend build → copy dist into backend embed dir → go build → ./build/squelch
make test     # backend `go test ./...` + frontend `vitest --run`
make lint     # golangci-lint + eslint (--max-warnings 0)
make generate # cd backend/sqlc && sqlc generate (run after any .sql change)
make migrate  # apply DB migrations (go run ./cmd/migrate up)
make clean    # remove build artifacts, generated swagger, local data/db
```

Run a single test:

```bash
# Backend (Go) — scope to a package and a test name
cd backend && go test ./internal/handler/auth/ -run TestLogin -v

# Frontend (Vitest) — by file or test name
cd frontend && pnpm test src/features/auth/Login.test.tsx
cd frontend && pnpm test -t "renders empty state"
```

Validate after a change (cheaper than full test runs):

```bash
cd backend  && go vet ./... && go build ./...
cd frontend && npx tsc --noEmit
```

**Swagger:** there is no `make swag` target — `swag init` runs automatically as part of `make build` (backend Makefile). `backend/docs/` is **generated and gitignored** (`.gitignore:13`), so there is nothing to commit: the annotations in the handler source are the only tracked copy. After editing Swaggo annotations, run `make build` (or the `swag init` line from `backend/Makefile`) to confirm they parse.

**Dev tools** (`sqlc`, `golang-migrate`, `swag`, `air`, `golangci-lint`, `pnpm`) are provisioned by `.devcontainer/`. The frontend uses **pnpm**, not npm.

## Skills

Packaged workflows live in `.claude/skills/` and are invoked as `/<name>`:

- **`diagnosing-bugs`** — the loop for hard bugs. Its Phase 1 rule is the point: build a tight, red-capable feedback loop and paste the command that produced it **before** forming any hypothesis. No red loop, no theory.
- **`two-axis-review`** — reviews a diff since a fixed point along Standards and Spec separately, in parallel sub-agents, so neither masks the other. Named to avoid colliding with the built-in `/code-review`.
- **`research`** — background agent, primary sources only, writes a committed note to `docs/research/`.
- **`grilling`** — stress-tests a plan one question at a time.
- **`resolving-merge-conflicts`** — for an in-progress merge or rebase.
- **`security-audit`** — Cloudflare's source-first vulnerability audit, vendored from [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) at `c1c8a8c` (MIT; `LICENSE` travels with it). **Guidance mode by default** — security questions and focused reviews use only the relevant parts. **Full audit mode** (an explicit audit/pen-test request, or asking for report artifacts) runs six phases with many isolated sub-agents; pass a budget to cap it. Output goes **outside the repo** by default (`~/security-audit-skill/<repo>/run-<N>`), and target code only ever runs in a sandbox. Distinct from the built-in `/security-review`, which reviews the pending diff; this covers the whole codebase. Vendored, so it never auto-updates — re-copy from upstream deliberately.

## Architecture (big picture)

**Single-binary deployment.** `make build` compiles the React app, embeds `frontend/dist/` into the Go binary via `go:embed` (`backend/internal/static`), and links it into one executable. There is no separate web server in production — the Go process serves both the API and the SPA.

**Backend** (`backend/`, Go 1.25, Gin) follows golang-standards/project-layout:
- `cmd/server/main.go` wires everything; `cmd/migrate` is a separate migration binary.
- `internal/` holds all code (no public Go API). Each subpackage is one feature or cross-cutting concern: `audio` (FFmpeg worker pool), `auth` (JWT + refresh-token rotation), `ws` (WebSocket hub + protocol), `dirmonitor` (filesystem ingest watchers), `downstream`, `radioref`, `safehttp` (hardened outbound HTTP client), `seed`, `db` (sqlc output + connection), etc.
- **Transport vs. business logic split:** HTTP handlers (`internal/handler/`, feature-scoped subpackages, wired in `handler/routes/`) and WebSocket (`internal/ws/`) are thin transports; shared admin business logic lives in `internal/admin/` so both transports call into it.

**Database.** SQLite in WAL mode. **All application configuration is stored in the DB**, not in files — server-level flags (listen addr, db path, TLS, encryption key) come from CLI/env/INI only. SQL is generated by **sqlc**: one query file per table in `backend/sqlc/queries/`, numbered append-only migrations in `backend/migrations/`, and `backend/sqlc/schema/schema.sql` mirrors the final-state schema. Never write raw SQL strings; never rewrite a committed migration.

**Frontend** (`frontend/`, React 18 + TypeScript strict, Vite, RTK Query, DaisyUI 5) follows Bulletproof React — feature-first folders under `src/features/` (`scanner`, `admin`, `auth`, `setup`, `shared-call`), each owning its page, components, hooks, Redux slices, types, and colocated tests. `src/shared/` is the lowest layer (no imports from features). Dependency direction `features → shared → app` is enforced by eslint `no-restricted-imports`; sibling features are opaque and cross only through barrels.

**Server state & realtime.** All server data flows through a **single shared RTK Query `api` object** (`src/app/api.ts`); feature endpoints attach via `api.injectEndpoints`. WebSocket frames are parsed by the WS client + middleware and dispatched into Redux — **components never parse WS messages**. JWT access tokens live in **Redux memory only** (never localStorage/sessionStorage); the refresh token is an httpOnly cookie scoped to `/api`.

**Two WebSocket channels:** `/api/v1/ws/listener` for listener call streaming, `/api/v1/ws/admin` for live admin operations — both JSON-object frames with a `type` discriminator (`backend/internal/ws/messages_v1.go`), and both what the frontend connects to (`src/shared/services/ws/client.ts`, `adminClient.ts`). The legacy `/ws`, `/api/ws` and `/api/admin/ws` aliases still serve the deprecated 3-letter array framing; don't build on them.

**Two HTTP API surfaces.** The canonical surface is **`/api/v1/*`** (what the frontend uses — see `src/app/api.ts`). A **deprecated legacy `/api/*`** surface is kept only for rdio-scanner upload compatibility; it emits RFC 8594 `Deprecation`/`Sunset` headers via `middleware.Deprecated` (see `backend/internal/middleware/deprecation.go` + `v1.go`). New endpoints go on v1 only. The v1 error envelope is `{"error":{"code","message","details"}}` with stable string codes; legacy `{"error":"<string>"}` bodies are auto-rewritten by `middleware.V1ErrorEnvelope`. Silent token refresh is single-flighted through `refreshSession()` in `src/app/api.ts` — don't add a second refresh path.

## Non-negotiables (the ones easy to get wrong)

- **Go:** errors returned not panicked; `log/slog` only (no `log.Println`/`fmt.Println`); external processes via `exec.CommandContext` with an arg slice, never a shell string; outbound HTTP via `safehttp.Client`; every public `/api/*` endpoint carries Swaggo annotations.
- **TypeScript:** no `any`, no `@ts-ignore` (use `unknown` + narrow); no `dangerouslySetInnerHTML`; `@/` alias for all `src/` imports (no `../../` chains); DaisyUI classes over hand-rolled UI.
- **DB:** edit `.sql` → `make generate` (sqlc) → update `schema/schema.sql`; every index must back a real query.
- **Security:** see `CONVENTIONS.md § Security Rules` — secrets-at-rest use the `enc::` AES-256-GCM scheme, refresh tokens are SHA-256 hashed with family rotation, admin routes always require an admin JWT.
- **Accessibility:** interactive controls need accessible names. Watch two patterns that don't expose a label automatically: DaisyUI dropdown triggers (`div[role="button"]`) and bare `<input type="range">` — add `aria-label` (see `features/scanner/components/ControlToolbar.tsx`).

## Changelog & releases

User-visible changes must add a bullet under `[Unreleased]` in `CHANGELOG.md` (Keep a Changelog format) in the same PR — a CI `changelog` job blocks merges into `main` otherwise (use the `skip-changelog` label for pure internal/CI/typo changes). Any user-visible fix or feature ships as a `vX.Y.Z` release in the same session rather than sitting unreleased. See `CONVENTIONS.md § Releases`.

## Local-only planning docs

The entire `docs/plans/` directory is **gitignored** — personal scratchpads. Never reference plan filenames or contents from any tracked file (CHANGELOG, committed docs, commit messages, PR titles/descriptions, code comments). If a tracked file links into `docs/plans/`, that link is a bug; remove it.

## This environment (WSL)

- Prefer Claude Code's built-in **Grep/Glob/Read** tools over shell `grep`/`find` (the canonical docs say "use `rg`, avoid plain `grep`" — the dedicated tools are the better equivalent here).
- **Go 1.26.4** is installed (`/usr/local/go/bin`) and now on PATH, so `go build ./...`, `go vet ./...`, and `go mod tidy` run locally. Node/pnpm are available too, so frontend `tsc`/`vitest` validation works as well.
- Browser automation runs through the **Playwright MCP** (`mcp__playwright__*`), headless in WSL2. The `chrome-devtools` MCP also works (perf/Lighthouse) but only against a native Linux Chrome. Full setup lives in Claude's memory (`wsl-mcp-browser-setup`).
