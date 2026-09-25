# React / TypeScript conventions

**Applies to:** `frontend/**` — components, hooks, Redux slices, services, and frontend tests.

Part of the conventions set — see [CONVENTIONS.md](../CONVENTIONS.md) for the
shared rules and [PROJECT_LAYOUT.md](../PROJECT_LAYOUT.md) for structure.

## Working in this area

- Read before writing: read the component you're editing plus any parent that passes props or dispatches actions. Use Grep when tracing symbol usage.
- Implement the requested change directly. State assumptions when ambiguous and proceed.
- Validate changes with `npx tsc --noEmit` from `frontend/`. Run `pnpm test` when you've touched tested code paths.
- Prefer editing existing components and hooks over creating new ones. New files need a clear reason.
- Use DaisyUI component classes, not custom CSS. Use `@/` path alias for imports from `src/`.
- Keep output focused: short summary, files touched as clickable links, any follow-ups. Skip restating the diff.
- Follow the conventions below as hard constraints — strict TS (no `any`), RTK Query for all server data, JWT never in `localStorage`.

## Tech Stack

- React 18 with TypeScript strict mode
- Vite 6 as the build tool
- DaisyUI 5 components (Tailwind CSS 4 component library)
- Tailwind CSS 4 via `@tailwindcss/vite` for styling (seven dark DaisyUI themes, picked per browser)
- Redux Toolkit + RTK Query for state and server data
- React Router DOM 7 for client-side routing
- `@tanstack/react-virtual` for virtual scrolling in large admin lists
- `lucide-react` for icons (stroke-based, tree-shakeable — never ship the full icon pack)
- Service Worker (`frontend/sw.ts`) for PWA app-shell caching + Web Push handling
- Vitest + React Testing Library + `@testing-library/user-event` + jsdom for unit tests
- ESLint 9 with `typescript-eslint`, `react-hooks`, `react-refresh` plugins; `--max-warnings 0` is the bar
- pnpm as the package manager

## Conventions

### General

- All components are function components with named TypeScript props interfaces (`interface FooProps { ... }`)
- Strict TypeScript: no `any`, no `@ts-ignore`; use `unknown` + narrowing instead of `any`
- Use `@/` path alias for imports from `src/`; no relative `../../` chains
- One component per file; filename matches the exported component (`FooPanel.tsx` exports `FooPanel`)
- Prefer editing existing components over creating new ones. New files need a clear reason (new route, new admin panel, or a reusable primitive used by 2+ callers)
- Do not add new dependencies without clear justification — stdlib React + existing deps first

### Styling

- Use DaisyUI component classes (`btn`, `card`, `modal`, `table`, `input input-bordered`, `toggle`, `badge`, `toast`, `menu`, `stats`, `dropdown`, `tooltip`, `range`) — do not hand-roll equivalents
- Compose with Tailwind utilities; never write custom CSS unless a truly unique visual requires it
- The admin restyles DaisyUI in one place, `src/admin.css`, scoped to `.admin-ui` (ADR 0010). Keep writing DaisyUI classes in admin pages and change their look there, not per page. In the admin, use `text-base-content-dim` for secondary text and the `admin-*` colours (`border-admin-line`, `bg-admin-ok-bg`, `text-admin-warn-fg`, …), not `text-base-content/60` or `border-base-300`
- Theming: `data-theme="squelch-<name>"` on `<html>` (`classic` default, plus `midnight`, `graphite`, `ember`, `moss`, `plum`, `ash`); palette tokens (`base-100`, `primary`, `secondary`, `error`, plus the theme-owned `base-content-dim` and `lcd-*` colours) only — no raw hex in components. The palettes are generated from squelch-mobile's `design-tokens/tokens.json`; change them there first and regenerate, so the web and the app stay one palette
- Mobile-first responsive: `sm` (<640px), `md` (640–1023px), `lg` (≥1024px)
- Icons: import from `lucide-react` as individual named imports; never `import * as Icons`

### State and data

- Global state: Redux Toolkit slices in `src/app/slices/`
- Server data: RTK Query endpoints in `src/app/api.ts` — every HTTP call goes through the base API; no raw `fetch` in components or slices
- Component local UI state: `useState` / `useReducer` — not Redux
- Derived state: `useMemo` / reselect `createSelector` — never recompute in render
- Never store JWT tokens in `localStorage` or `sessionStorage`. JWTs live in `authSlice` memory only; session persistence is an httpOnly refresh cookie handled by the server
- `localStorage` is allowed for non-sensitive user preferences (TG selection, theme override, bookmark session ID for public listeners)

### WebSocket

- Listener WS client: `src/services/wsClient.ts` — singleton, dispatches events to Redux
- Admin WS client: `src/services/adminWsClient.ts` — request/response correlation via request IDs, used by `useAdminWsOps.ts`
- Never parse WS JSON in a component — all message handling happens in the service and results flow through Redux
- Reconnect with exponential backoff, refresh JWT via `useTokenRefresh.ts` before reconnecting if token expired
- Unknown WS messages are logged and ignored, not thrown

### Audio

- `src/services/audioPlayer.ts` owns the queue and the single `HTMLAudioElement`. Components never create their own `<audio>` element for queued calls
- `src/services/beepPlayer.ts` owns short scanner beeps (unlock sound, etc.)
- Always initialize audio on a user gesture (playback button click, unlock overlay) — browsers block autoplay otherwise

### Hooks

- Custom hooks in `src/hooks/` — one hook per file, filename starts with `use`
- Hook dependencies listed exhaustively; rely on `eslint-plugin-react-hooks`
- Return stable references (memoized handlers) when values will be passed to child components

### Accessibility

- Every icon-only button has `aria-label` or a visually-hidden label
- Modal open/close moves focus correctly (first focusable in, trigger on close)
- Keyboard navigation works for all interactive elements (Tab order, Enter/Space activation)
- `role=` only when semantic HTML is insufficient

### Security

- Never expose JWT, refresh tokens, API keys, or any `enc::` values in console logs or error UI
- Never use `dangerouslySetInnerHTML`. User-generated content (transcript text, talkgroup labels) is rendered as plain text
- Treat every server response as untrusted: validate shape at the RTK Query layer, not in consumers

### Testing

- Co-locate tests: `Foo.test.tsx` next to `Foo.tsx`
- Render with a Redux `<Provider>` + `MemoryRouter` wrapper
- For RTK Query tests, rely on the real reducer wired to `msw` handlers when network needs mocking (not currently a dep — if you add it, coordinate with the Testing Expert)
- Never hit the real network or real WebSocket in tests
- `vitest --run` is CI; `vitest --ui` is local exploration

## File Layout

```
frontend/
  index.html                        ← Vite entry; PWA manifest link
  sw.ts                             ← Service Worker (PWA cache + Web Push)
  vite.config.ts                    ← Vite config (including @/ alias, proxy for dev, service worker)
  eslint.config.js                  ← flat ESLint config
  public/
    manifest.json                   ← PWA manifest
  src/
    main.tsx                        ← React entry, Router, Redux Provider, theme bootstrap
    index.css                       ← Tailwind directives + DaisyUI theme definitions
    test-setup.ts                   ← Vitest setup (jest-dom matchers, jsdom polyfills)
    app/
      api.ts                        ← RTK Query base API + all endpoints
      store.ts                      ← Redux store configuration
      slices/
        authSlice.ts                ← JWT (in-memory), user info, role
        scannerSlice.ts             ← current/last call, hold, avoid, select state
        activitySlice.ts            ← recent call history buffer
        callsSlice.ts               ← calls list cache for search/virtualized views
        adminSlice.ts               ← admin dashboard UI state
        shareSlice.ts               ← shared-link management
    hooks/
      useAuthInit.ts                ← bootstraps session from refresh cookie on load
      useTokenRefresh.ts            ← schedules proactive JWT refresh before expiry
      useWebSocket.ts               ← listener WS lifecycle
      useAdminWebSocket.ts          ← admin WS lifecycle
      useAdminWsOps.ts              ← typed admin WS request/response hooks (replaces REST for admin CRUD)
      useWsQuery.ts                 ← WS-backed query helper for paginated data
      useAdminActivity.ts           ← live activity feed for admin
      useAdminLogs.ts               ← live log tail for admin
      useScanner.ts                 ← scanner-page compose hook (CAL dispatch, hold/avoid/select)
      useActiveUnit.ts              ← resolves currently-talking unit from CAL payload
      useAudioPlayer.ts             ← React binding to audioPlayer service
      useTGSelectionSync.ts         ← persists SELECT state to localStorage keyed by ?id=
      useTheme.ts                   ← theme list, picker state + persistence
    services/
      wsClient.ts                   ← listener WS singleton
      adminWsClient.ts              ← admin WS singleton (request/response correlation)
      audioPlayer.ts                ← call queue + single HTMLAudioElement
      beepPlayer.ts                 ← scanner UI sound effects
    pages/
      Scanner.tsx                   ← listener page
      Admin.tsx                     ← admin dashboard shell
      Login.tsx                     ← login form
      Setup.tsx                     ← first-run setup wizard
      SharedCall.tsx                ← /call/:token public player
    components/
      scanner/                      ← DisplayPanel, ControlToolbar, HistoryPanel, LEDPanel, TranscriptPanel, SearchPanel, SelectTGPanel, BookmarksPanel, BookmarkButton
      admin/                        ← AdminLayout, ActivityPanel, ApiKeysPanel, DirMonitorPanel, DownstreamsPanel, GroupsTagsPanel, LogsPanel, OptionsPanel, RadioReferenceCard, SharedLinksPanel, SystemsPanel, ToolsPanel, TranscriptionPanel, UsersPanel, WebhooksPanel, NavigationGuardContext
    types/
      index.ts                      ← shared TypeScript types (API responses, admin entities, WS payloads)
```

## UI Design Principles

Local-only design notes (in the gitignored `docs/plans/` working directory) may contain extended ASCII wireframes and palette spec. The canonical, in-repo summary follows. Key points:

- **Dark only** — seven DaisyUI themes shared with the mobile app (Squelch classic default). Block themes draw the display's head (clock, tag, talkgroup name) as a solid ink block over a dithered edge; `squelch-classic` keeps the original pale LCD with scanlines. Fonts are bundled (SIL OFL, licences in `src/assets/fonts/`): Selawik for chrome, JetBrains Mono for the display, Big Shoulders Display Black for the talkgroup name, and IBM Plex Sans and Mono for the admin only
- **Scanner page** — vertically-stacked single column, max-width 672px, 24px padding, laid out like the mobile app:
  - LED bar: branding (left), LED, ⋮ menu (Theme, Display brightness, Bookmarks, Admin, Change password, About, Sign in/out)
  - Display panel: ink-block head (clock, counts, system + tag chip, group · label, auto-sized TG name), dither strip, then frequency/TGID, site/unit, and a badge row (HOLD/AVOID/PATCH, E/S chip, bookmark/share, call clock). Type steps up from the phone sizes at `sm`
  - Transcript: inside the display (when `liveTranscriptDisplay` is on) — header with line/speaker count, a duration-weighted timeline, and a three-line window that follows playback
  - Transport: volume (left), replay / play-pause (primary, 64px) / skip, centred
  - Mode row: LIVE (+ BKGND on mobile, joined), HOLD▾, AVOID▾, SELECT, SEARCH — equal cells, wrapping 3 + 2 when narrow; "on" is `success` for LIVE, `primary` otherwise
  - RECENT: up to five one-line rows below the controls, each a button that replays the Call; the Call on the air gets the accent rail, and a talkgroup LED colour becomes its rail
- **Side panels** — SelectTG slides from right, Search slides from left, Bookmarks slides from right
- **Admin dashboard** — sidebar (icons on `md`, icons+labels on `lg`, drawer on `sm`) + content area (max-width 1200px)
- **Login/Setup** — centered DaisyUI card (max-width 400px) on `base-100` background
- **Shared call page** — standalone card at `/call/:token` with audio player, transcript, download
- Control toolbar uses DaisyUI `btn`, `btn-circle`, `dropdown`, `tooltip`, `range` — no custom beveled/hardware-style buttons
- Admin UI uses DaisyUI: `table table-zebra`, `card`, `modal`, `toast`, `input input-bordered`, `btn`, `badge`, `toggle`, `menu`, `stats`

## Build and Validation Commands

Before reporting a task done, run the validation loop from `frontend/`:

- `npx tsc --noEmit` — full type-check (must be clean)
- `pnpm lint` — ESLint at `--max-warnings 0`
- `pnpm test` — Vitest when touching tested code paths
- `pnpm build` — run before any change that might affect bundling, PWA manifest, or Service Worker registration

## Key Behaviours

- On app load: `GET /api/setup/status`; if `needsSetup=true` redirect to `/setup`; `publicAccess` flag determines auth behavior
- Login: `POST /api/auth/login` with username + password; JWT stored in memory (Redux state only); httpOnly refresh cookie enables session persistence; role determines route access
- RBAC: admin role → full dashboard access; listener role → scanner UI only; non-admin users are rejected from admin routes
- Refresh tokens: `useAuthInit.ts` bootstraps session on page load via `POST /api/auth/refresh`; `useTokenRefresh.ts` schedules proactive refresh before JWT expiry; refresh cookie is httpOnly, Secure (prod), SameSite=Lax
- Public access mode: when `publicAccess=true`, scanner opens directly — no login or access code needed; admin routes still require auth
- Listener WebSocket: `useWebSocket.ts` connects `wsClient`; CAL events dispatch to `scannerSlice` + `callsSlice`; binary frames carry audio data sent straight to `audioPlayer`
- Admin WebSocket: `useAdminWebSocket.ts` + `useAdminWsOps.ts` use the ADM_REQ/ADM_RES protocol for CRUD and live admin events (`ADM_EVT`); most admin operations go through WS, not REST, for lower latency
- Listener auth: JWT token (listener user) or PIN command (anonymous access code); public-access mode skips auth entirely
- Audio: `HTMLAudioElement` in `audioPlayer.ts`; queue managed in service; preloads next queued call for gapless playback; LIVE mode plays latest, HOLD/SELECT filter queue
- TG selection state persists in `localStorage` keyed by `?id=` URL param — enables multiple browser instances with independent selections
- Avoid talkgroup: 30/60/120 min countdown tracked in Redux, LED flashes for avoided TGs
- HOLD SYS / HOLD TG: filter CAL events so only the held system/talkgroup enters the queue
- Theme: `applyStoredTheme()` in `main.tsx` sets `data-theme` on `<html>` before first render so every route uses the chosen palette; `useTheme.ts` holds the choice (localStorage `squelch-theme`, per browser) and the picker lives in the scanner's ⋮ menu. Retired `squelch-dark`/`squelch-light` values fall back to the default
- Bookmarks: star icon on calls; authenticated users persist to DB via RTK Query, public listeners use localStorage + generated session ID
- Shareable links: share button creates a token via RTK Query and copies `/call/<token>` URL; `SharedCall.tsx` renders a minimal public player for the token
- Transcripts: `TranscriptPanel.tsx` shows the transcript inside the display; `TRN` WS event updates live; search panel supports transcript text search
- Push notifications: request permission, subscribe to TGs; Service Worker handles `push` and `notificationclick` events in `sw.ts`
- Admin panels with large lists (1000+ rows) use `@tanstack/react-virtual` for smooth scrolling (LogsPanel, SystemsPanel, SearchPanel)
- Service Worker caches app shell (HTML, JS, CSS, fonts); network-first for API calls; never caches authenticated API responses
- PWA manifest enables mobile home screen install with standalone display mode
- Navigation guard (`NavigationGuardContext`) warns admins before leaving a panel with unsaved form state

## When You Should Push Back

- Asked to use `localStorage` for a JWT or refresh token → refuse, keep JWT in Redux and rely on httpOnly refresh cookie
- Asked to use `dangerouslySetInnerHTML` → refuse, render as text
- Asked to add `any` or `@ts-ignore` → push back, narrow the type properly
- Asked to add a raw `fetch` call outside `src/app/api.ts` → refuse, add an RTK Query endpoint
- Asked to hand-roll a DaisyUI-equivalent component → refuse, use the existing DaisyUI class
- Asked to add a CSS file for a one-off style → refuse, use Tailwind utilities
- Asked to cache authenticated API responses in the Service Worker → refuse, SW only caches app shell
- Asked to add a heavy dependency for functionality that already exists in stdlib React, Redux Toolkit, or the existing deps → push back
