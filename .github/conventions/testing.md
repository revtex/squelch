# Testing conventions

**Applies to:** Go tests (`net/http/httptest`, table-driven, in-memory SQLite) and frontend tests (Vitest + React Testing Library).

Part of the conventions set — see [CONVENTIONS.md](../CONVENTIONS.md) for the
shared rules and [PROJECT_LAYOUT.md](../PROJECT_LAYOUT.md) for structure.

## Working in this area

- Read the code under test first. read the implementation and any existing sibling `_test.go` or `.test.tsx` so new tests match the existing patterns exactly.
- Use the existing fixture helpers (`backend/internal/handler/routes/testhelpers_test.go` has `newTestDB`, `newTestEngine`, `seedAdminUser`, etc.). Do not invent new harness patterns when one already exists.
- Write tests that would have caught the bug or regression being described. Cover the happy path, one realistic error path, and the edge case the change introduces.
- Run the tests you wrote. Go: `cd backend && go test ./internal/<pkg>/...`. Frontend: `cd frontend && pnpm test <file>`. Report pass/fail with an output snippet.
- Keep tests fast and hermetic: `t.TempDir()` for files, `:memory:` SQLite for DB, `vi.mock` / `msw` for frontend API mocks. Never hit the network or real FS outside `t.TempDir()`.
- Prefer the Grep and Glob tools over shell search.
- Keep output focused: list the tests added as clickable file links and the test run result.

## Tech Stack

- **Go:** stdlib `testing`, `net/http/httptest`, table-driven style, `modernc.org/sqlite` `:memory:`, `github.com/gin-gonic/gin` (set to `gin.TestMode` in `init()`)
- **Frontend:** Vitest 3, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom` environment (see `frontend/vite.config.ts`), setup file `frontend/src/test-setup.ts`
- **Mocks:** `vi.mock` for hooks and modules; `vi.fn()` for spies; test components rendered inside a `<Provider store={...}>` + `<MemoryRouter>` wrapper

## Go Testing Conventions

- File alongside implementation: `processor_test.go` next to `processor.go`
- Prefer external test package: `package api_test` (forces tests to use the public API; catches accidental exports)
- Use internal package (`package api`) only when exercising unexported helpers
- Table-driven style:
  ```go
  tests := []struct{ name string; input X; want Y; wantErr bool }{ ... }
  for _, tc := range tests {
      t.Run(tc.name, func(t *testing.T) { ... })
  }
  ```
- Use `t.TempDir()` for every filesystem test — never `/tmp` directly
- Use `t.Cleanup(func(){ ... })` for teardown; do not rely on `defer` for shared fixtures
- Use `t.Helper()` in every fixture builder
- Integration tests hit the real Gin router via `httptest.NewRecorder()` + `engine.ServeHTTP(w, req)`
- Seed DB state via the sqlc `Queries` object (not raw SQL)
- Assert JSON response bodies by unmarshaling into typed structs, not string comparison
- For JWT-guarded endpoints, generate a token via `auth.GenerateToken` and set `Authorization: Bearer <token>`
- For API-key-guarded endpoints, seed a key row with `auth.HashAPIKey` and send the raw key as `X-API-Key`
- Concurrency tests must use `t.Parallel()` only when safe (no shared DB/HTTP state)
- Always test the error path — at minimum, one "not found" and one "unauthorized" case per endpoint
- Never sleep for timing — use `context.WithTimeout`, channels, or `<-time.After`. Prefer deterministic fakes over wall-clock

### Go Fixture Helpers (already in the repo)

Located in [backend/internal/handler/routes/testhelpers_test.go](../../backend/internal/handler/routes/testhelpers_test.go):

- `newTestDB(t)` — returns `(*sql.DB, *db.Queries)` with all migrations applied in `:memory:`
- `newTestEngine(t)` — returns `(*gin.Engine, *db.Queries)` with all routes registered
- `seedAdminUser(t, queries, username, password)` — returns `int64` user ID
- Similar helpers exist for API keys, systems, talkgroups, and calls — read the file before adding new ones

## Frontend Testing Conventions (Vitest + RTL)

- Test files co-located: `LEDPanel.test.tsx` next to `LEDPanel.tsx`
- Test rendering, user interactions (`userEvent`), and Redux state transitions
- Render with a real store from `configureStore`, wrapped in `<Provider>` and `<MemoryRouter>`:
  ```tsx
  const store = configureStore({
    reducer: {
      scanner: scannerSlice.reducer,
      auth: authSlice.reducer,
      calls: callsSlice.reducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (gdm) => gdm().concat(api.middleware),
    preloadedState: {
      /* ... */
    },
  });
  render(
    <Provider store={store}>
      <MemoryRouter>{ui}</MemoryRouter>
    </Provider>,
  );
  ```
- Mock hooks that touch the outside world: `vi.mock("@/shared/hooks/useTheme", () => ({ useTheme: () => ({ isDark: true, toggle: vi.fn() }) }))`
- Mock the WebSocket client in `src/shared/services/ws/client.ts` (or `adminClient.ts` for admin surfaces) for any test whose component subscribes to WS events
- Mock RTK Query via `vi.mock("@/app/api")` or by pre-seeding the RTK Query cache in `preloadedState`
- Assertions: prefer `screen.getByRole`, `screen.getByLabelText`, `screen.getByText` over container queries or test IDs
- Never use `findBy*` without an `await`
- Clean up: RTL auto-unmounts after each test; only add custom cleanup if a global mock was installed
- Strict TypeScript: test files follow the same strict rules as production code — no `any`, no `@ts-ignore`

## Where Tests Live

Tests sit next to the code they cover, so the layout in
[PROJECT_LAYOUT.md](../PROJECT_LAYOUT.md) is also the test layout. Find the
current ones rather than working from a list here — an enumerated inventory
goes stale the moment a package moves.

```bash
find backend -name '*_test.go'          # Go
find frontend/src -name '*.test.ts*'    # Vitest
```

Where to look for a pattern to copy:

- **HTTP endpoints** — `backend/internal/handler/routes/`. This is where the
  full-engine tests live, along with the shared fixtures. A feature package
  under `handler/` may also hold its own focused tests (contract tests for the
  legacy surface, internal limiter tests).
- **Cross-cutting middleware** — `backend/internal/middleware/`.
- **Domain packages** — beside the code: `auth`, `audio`, `dirmonitor`,
  `downstream`, `ws`, `stream`, `safehttp`, `secrets`, `config`, `trmqtt`.
- **React components and hooks** — colocated inside the owning feature, e.g.
  `frontend/src/features/scanner/components/LEDPanel.test.tsx`. Shared code is
  tested under `frontend/src/shared/`.
- **Redux slices and RTK Query** — beside the slice, e.g.
  `frontend/src/features/auth/authSlice.test.ts`.

## Coverage Gaps

Measure before guessing. On the Go side:

```bash
cd backend && go test -cover ./...
```

The frontend has no coverage provider installed, so `--coverage` fails; add
`@vitest/coverage-v8` first if you want the numbers.

Prioritise by blast radius, not by percentage: anything that decides access
(grants, middleware, token handling), anything that touches the filesystem or
an external process, and anything concurrent.

These surfaces have implementation and no test file of their own. Re-derive the
list rather than trusting it — it is a snapshot, not a contract.

```bash
# Go packages with no *_test.go
for d in $(find backend/internal backend/cmd -type d); do
  ls "$d"/*.go >/dev/null 2>&1 || continue
  ls "$d"/*_test.go >/dev/null 2>&1 || echo "$d"
done
```

**Backend:** `internal/cli`, `internal/logging`, `internal/seed`,
`internal/handler/health`, `internal/handler/setup`, `cmd/migrate`. Some of
these are exercised indirectly through `internal/handler/routes` — check before
concluding a path is untested.

**Frontend:** `features/scanner/components/DisplayPanel.tsx`,
`features/scanner/hooks/useAudioPlayer.ts`,
`features/scanner/hooks/useScanner.ts`, and the admin sub-features
`dir-monitor`, `downstreams`, `groups-tags`, `logs`, `options`,
`radio-reference`, `shared-links`, `tools`, `transcription`, `webhooks`, plus
the `_shell` chrome.

## Coverage Expectations for New Work

When adding tests, target the following minima per surface:

- **New HTTP endpoint:** 200/201 happy path + 400 validation + 401 unauthorised + 403 forbidden (if role-gated) + 404 not found
- **New middleware:** passes valid request, rejects invalid with correct status, does not leak state between requests
- **New sqlc query:** at least one `:one`/`:many`/`:exec` smoke test through the real `Querier`
- **New Go concurrency primitive (worker, hub, pool):** one success test + one context-cancel test + one backpressure/full-channel test
- **New React component:** render without error + the primary user interaction + one error/empty state
- **New Redux reducer:** each action type + one selector if non-trivial
- **New RTK Query endpoint:** at minimum, verify the request shape (URL, method, headers) via `vi.spyOn(fetch)` or the existing mock patterns

## Build and Validation Commands

- Go all tests: `cd backend && go test ./...`
- Go single package: `cd backend && go test ./internal/<pkg>/...`
- Go with race detector (for concurrency changes): `cd backend && go test -race ./...`
- Go with coverage: `cd backend && go test -cover ./...`
- Frontend all tests: `cd frontend && pnpm test`
- Frontend single file: `cd frontend && pnpm test src/features/scanner/components/LEDPanel.test.tsx`
- Frontend with coverage: needs a provider — `pnpm add -D @vitest/coverage-v8` first, then `cd frontend && pnpm test -- --coverage`

## When You Should Push Back

- Asked to write a test that depends on the network, a real audio codec, or a non-`t.TempDir()` path → refuse, use a fake/mock
- Asked to write a test that sleeps for timing → refuse, use deterministic synchronisation (channels, `context.WithTimeout`, events)
- Asked to write a test that directly queries the DB with raw SQL → refuse, go through sqlc `Queries`
- Asked to skip the error path "for speed" → push back, the error path is where regressions hide
- Asked to test implementation detail (private field, exact slog string) → push back, test behaviour instead
- Asked to make a flaky test pass by retrying → refuse, find and fix the race or ordering bug
- Asked to delete a test that "doesn't seem useful" without a replacement → push back, explain coverage before removal
