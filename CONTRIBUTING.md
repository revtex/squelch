# Contributing to Squelch

Thanks for helping. This page is the entry point: what to install, how to run
the thing, and what a change has to satisfy before it merges.

The detailed rules live elsewhere and are the source of truth. This page is a
way in, not a second copy of them: where it summarises, it summarises, and the
linked file is what a reviewer will hold you to.

| Document | What it governs |
| --- | --- |
| [`.github/CONVENTIONS.md`](.github/CONVENTIONS.md) | Tech stack, the numbered Security Rules, change ordering, changelog and release policy |
| [`.github/PROJECT_LAYOUT.md`](.github/PROJECT_LAYOUT.md) | Directory layout, package boundaries, file-split heuristics, naming |
| [`.github/conventions/`](.github/conventions/) | Per-domain rules: go, react, db, docs, reviewer, testing, cleanup |
| [`CONTEXT.md`](CONTEXT.md) | The domain vocabulary — read before naming anything |
| [`docs/adr/`](docs/adr/) | Decisions already made, and why the alternatives lost |

Read the convention file for the area you are touching before non-trivial work.
Where this page and those disagree, they win.

---

## Setting up

You need **Go 1.26**, **Node 22**, and **pnpm 10**. The frontend uses pnpm, not
npm.

The quickest path is the dev container: open the repo in a container-aware
editor and `.devcontainer/` provisions Go, Node, pnpm, and the tools below.

Working without it, install these yourself:

| Tool | Used for |
| --- | --- |
| [`sqlc`](https://sqlc.dev) | Generating database code from SQL |
| [`golang-migrate`](https://github.com/golang-migrate/migrate) | Applying migrations |
| [`swag`](https://github.com/swaggo/swag) | Generating the Swagger docs — install `v1.16.4`, matching `backend/go.mod` and CI. Never `@latest`; CI fails the build if it finds one. |
| [`air`](https://github.com/air-verse/air) | Go hot-reload during development |
| [`golangci-lint`](https://golangci-lint.run) | Go linting |

Then:

```bash
make dev
```

That runs the Go server with hot-reload and the Vite dev server together, which
is the normal development loop.

---

## Commands

All of these run from the repo root.

```bash
make dev        # air (Go hot-reload) + Vite dev server together
make build      # frontend build → embed into the Go binary → ./build/squelch
make test       # go test ./... + vitest --run
make lint       # golangci-lint + eslint (--max-warnings 0)
make generate   # regenerate database code — run after any .sql change
make migrate    # apply database migrations
make clean      # remove build artifacts, generated swagger, local data/db
```

Running one test:

```bash
cd backend  && go test ./internal/handler/auth/ -run TestLogin -v
cd frontend && pnpm test src/features/auth/Login.test.tsx
cd frontend && pnpm test -t "renders empty state"
```

A faster check than the full suite while iterating:

```bash
cd backend  && go vet ./... && go build ./...
cd frontend && npx tsc --noEmit
```

---

## Making a change

1. **Branch off `dev`.** Work lands on `dev`, and `dev` is what opens a pull
   request against `main`.
2. **Read the conventions for the area** you are changing, and `CONTEXT.md` if
   you are naming anything new.
3. **Write the change and its tests.** New behavior needs a test that fails
   without it.
4. **Database changes are ordered:** edit the `.sql` file → `make generate` →
   update `backend/sqlc/schema/schema.sql`. Never write raw SQL strings in Go,
   and never rewrite a migration that has already been committed — add a new
   one.
5. **Add a `CHANGELOG.md` entry under `[Unreleased]`** for anything a user would
   notice. CI blocks merges into `main` without one; label the PR
   `skip-changelog` for pure internal, CI, or typo changes.
6. **Update `docs/`** if user-facing behavior changed.
7. **Run `make test` and `make lint`** before opening the PR.

### Commit messages

Conventional Commits, with the area in parentheses and the subject saying what
changed for the user rather than which files moved:

```
feat(listener): keypad beeps follow the account, not the browser
feat(auth): let native clients carry the refresh token in the body
docs: correct the recorder and Trunk Recorder MQTT guides
```

### Pull requests

The [template](.github/pull_request_template.md) carries the checklist: tests
pass, docs updated if behavior changed, changelog entry present, and no secrets
or tokens in logs or error messages.

CI runs three jobs — the changelog check (PRs into `main` only), Go tests, and
frontend tests — plus CodeQL and a Docker build.

---

## Things that will fail review

These come up often enough to be worth stating here; the full set is in the
convention files.

- **Go:** errors returned, not panicked. `log/slog` only — no `log.Println` or
  `fmt.Println`. External processes via `exec.CommandContext` with an argument
  slice, never a shell string. Outbound HTTP through `safehttp.Client`. Every
  public `/api/*` endpoint carries Swaggo annotations.
- **TypeScript:** no `any` and no `@ts-ignore` — use `unknown` and narrow. No
  `dangerouslySetInnerHTML`. Import through the `@/` alias, not `../../` chains.
  Prefer DaisyUI classes over hand-rolled UI.
- **Accessibility:** every interactive control needs an accessible name. Two
  patterns do not get one automatically — DaisyUI dropdown triggers
  (`div[role="button"]`) and a bare `<input type="range">`. Add `aria-label`.
- **New endpoints go on `/api/v1/*` only.** The `/api/*` surface is deprecated
  and exists for recorder compatibility.
- **Secrets** at rest use the `enc::` AES-256-GCM scheme; refresh tokens are
  SHA-256 hashed with family rotation; admin routes always require an admin
  token.

---

## Reporting a bug

Open an issue with what you did, what you expected, and what happened —
including the version from the listening screen's **⋮ → About** and anything
the server logged.

For anything with a security impact, do not open an issue. Follow
[SECURITY.md](SECURITY.md).
