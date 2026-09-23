# Changelog

All notable changes to Squelch will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A Listener Guide** (`docs/listener-guide.md`), for the person doing the
  listening rather than the one running the server: starting playback, reading
  the display, selection, AVOID and HOLD, transcripts, search, bookmarks,
  sharing, themes and beeps, listening on a locked phone, and what to check
  when nothing plays.

- **A Troubleshooting page** (`docs/troubleshooting.md`) for operators,
  arranged by symptom: the server not starting, uploads rejected or silently
  deduplicated, calls arriving but not reaching listeners, background audio
  failing without FFmpeg, calls pruned after a week by default, and resetting a
  forgotten administrator password.

- **`CONTRIBUTING.md` and `SECURITY.md`.** Contributing covers setup, the make
  targets, running one test, the branch and commit conventions, and the
  changelog gate. Security says which versions get fixes, how to report a
  vulnerability privately, and what is in scope.

- **An Avoids tab under SELECT.** It lists the talkgroups you have avoided
  for a set time, each with the time left counting down, and a Resume button
  that puts one back on the air early. A permanent avoid has no clock to
  show, so it is not listed; it is turned back on from the talkgroup itself
  under Groups, Tags or Systems.

- **Shared-call pages offer "Open in app" on a phone.** A share link opened on
  Android or iOS now shows a button that hands the token to the native app
  through a custom scheme, falling back to the page itself on Android when no
  app is installed. Universal Links and App Links cannot do this job for a
  self-hosted server — both platforms bind the app to a domain at signing
  time, and iOS fetches its association file through an Apple-operated CDN
  that a LAN-only instance is invisible to — so the handoff is explicit. The
  button appears only for a well-formed share token, and only on a phone.

- **Native clients can hold the refresh token themselves.** `POST /auth/login`
  with the header `X-Squelch-Client: native` returns `refreshToken` in the
  response body and sets no cookies, and `POST /auth/refresh` accepts
  `{"refreshToken": "…"}` in the body when no cookie is present, returning the
  rotated token the same way. Browsers are unaffected: the cookie wins
  whenever it is present, and a cookie-authenticated refresh never echoes the
  raw token into the body, so an httpOnly cookie still cannot be read by page
  script. Rotation, family revocation and the replay grace window behave
  identically on both paths. `POST /auth/logout` now also accepts the body
  token, so a client without cookies can revoke its refresh family — before
  this, logging out of such a client left the family valid for its full
  30 days.

### Changed

- **Keypad beeps are a listener's own setting now, and they follow the
  account.** The button-press sound moved out of the admin options panel and
  into the scanner's ⋮ menu — Off, Uniden or Whistler, and picking one plays
  it. The person listening is the one in the quiet room, and they are not
  always the admin. A signed-in listener's choice is stored against their
  account and applies on every browser they sign in on; an anonymous listener
  keeps it in that browser, which is also where a choice made before signing
  in is held. The instance's `keypadBeeps` setting is still the starting
  point, so nobody has to choose twice, and the listener's own choice wins
  from then on — including Off. Operators set the default with
  `squelch config-set keypadBeeps <style>`.
  New: `GET`/`PUT /api/v1/listener/preferences`.

- **The scanner looks like the mobile app.** The web scanner page now uses the
  app's design: the display's clock, tag and talkgroup name sit in a solid ink
  block over a dithered edge, with the name in a condensed display face sized
  to fit. The transport is a large play/pause between replay and skip, and the
  mode buttons are an even row that wraps on narrow screens. Recent calls are
  one-line rows below the controls; tap one to replay it, and a talkgroup's LED
  colour shows as a rail. The live transcript follows playback in a three-line
  window with a timeline above it. The menu (⋮) now holds the theme, display
  brightness, bookmarks, admin, password and sign-in/out.
- **Seven dark themes, chosen per browser.** Squelch classic (the default,
  the original pale LCD), Midnight, Graphite, Ember, Moss, Plum and Ash — the
  same set the mobile app offers, from the same palette. Pick one from
  ⋮ → Theme. It applies to every page, admin included, and is remembered in
  that browser. The light theme is retired; a browser that had it selected
  moves to Squelch classic.
- **Bundled fonts.** Selawik, JetBrains Mono and Big Shoulders Display now ship
  with the app (SIL Open Font License), so the display looks the same on every
  machine and no font is fetched from a third party.

### Fixed

- **A pause no longer outlives the session that made it.** Pausing is about
  the call playing right now, so turning LIVE off and on resets it, and a
  reloaded page always comes back playing. Previously the pause was kept in
  the browser and restored on load, so a page could come up silent with no
  sign of why — the only clue was a transport button sitting on Resume.

- **Resume starts the call playing again.** Pausing a call and pressing resume
  left the audio stopped: the player still considered the call "playing" while
  it was paused, and resume used that flag to decide whether there was anything
  to start. Backgrounding the browser and coming back was the only way to get
  it going again, because the stall recovery that runs on returning to the
  foreground re-issued playback. The call now resumes from where it stopped.

- **The deployment guide no longer tells you to put the encryption key in the
  config file.** It showed an `encryption_key` field in the saved JSON and said
  the resolved key was written there — the opposite of what the server does. A
  key actually written into that file stops the server from starting. The
  example now matches what `--config-save` really writes, and the guide says
  what the refusal looks like and how to clear the field from an older config
  file.

- **Replay works after a call has finished.** It did nothing unless a call
  was still playing, which is the opposite of when it is reached for. It now
  replays the last call played, and is greyed out only when nothing has
  played yet.
- **The display no longer bounces as calls come in.** Every row of the
  readout now has a fixed height — including the talkgroup name, which is
  sized down to fit — so the panel keeps one height whether a call is on the
  air, idle, tagged, or has a transcript arriving under it.
- **Squelch classic keeps to its own palette.** The transcript timeline and
  the HOLD/AVOID/PATCH badges were drawn in the blue accent and the tag chip
  in orange, neither of which belongs on the pale LCD; they now use the
  panel's own ink, as the mobile app does.
- **The display's bookmark and share buttons stop growing a background.**
  They now dim and brighten under the pointer with nothing behind them, in
  every theme, and both carry a tooltip that opens above them. On the
  classic theme the pointer used to repaint them near-white on the pale
  panel, which all but erased them; they keep the panel's ink now.
- **One tooltip style throughout.** The last few controls that showed the
  browser's own tooltip — share in the search and bookmark lists, and Copy
  and Open in the share popup — now use the same one as everything else,
  and a tip anchored at a panel's edge no longer has its first or last
  words clipped. HOLD and AVOID have tooltips too.
- **The transcript window scrolls without a scrollbar.** The bar is gone;
  the wheel and touch still scroll it.
- **HOLD and AVOID sit to the right of the error and spike counts**, rather
  than pushing them along the row.

- **`/.well-known/*` and `/apple-app-site-association` returned the web app
  with HTTP 200.** Those paths are fetched by machines — App Links and
  Universal Links verifiers, ACME clients, `security.txt` readers — and the
  SPA fallback answered every one of them with `index.html` and a
  `text/html` content type. A verifier reads that as a malformed association
  file rather than a missing one, which is the harder failure to diagnose.
  They now return a clean 404. Client-side routes such as `/call/<token>`
  are unaffected.

### Security

- **Hardening from an internal security review.** Access checks, session
  handling and file handling were tightened across the server. The changes
  operators may notice:
  - **System restrictions are applied everywhere.** Per-listener, per-API-key
    and per-downstream system selections made in the admin UI now govern
    every path that serves or accepts calls — search, transcripts, share
    links, bookmarks, the audio stream, the live feed and the scanner's
    system list. A listener restricted to some systems may see less than
    before; an API key limited to some systems gets `403` when it uploads to
    any other, and can no longer auto-create systems. Keys and users with no
    selection are unaffected.
  - **New `--trusted-proxies` / `SQUELCH_TRUSTED_PROXIES` option.**
    `X-Forwarded-For` is honoured only from trusted proxies — by default
    loopback and private addresses, which covers a reverse proxy on the same
    host, LAN or Docker network. List your proxy if it connects from
    anywhere else, or set `none` when Squelch faces clients directly.
  - **`--admin-password` / `SQUELCH_ADMIN_PASSWORD` now resets the first
    admin's password**, as documented, and signs that account out
    everywhere. Remove it again after use.
  - **The database and log file are created owner-only**, and existing ones
    are tightened on startup. A backup job that reads the database as a
    different user will need its permissions adjusted.
  - After a restart, clients silently refresh their session once.
  - Talkgroup selections are capped at 50,000 entries per list.

## [3.0.0] — 2026-09-19

### Fixed

- **Documentation corrections found by checking the docs against the code.**
  The admin guide described four Scanner Behavior settings and one Call
  Processing setting that do not exist in the Options panel, named the first
  sidebar item "Activity" when it is "Dashboards", said the default audio
  preset was AAC-LC when it is MP3 32 kbps, pointed at the pre-v1 Swagger path,
  and did not document the Integrations section at all. The deployment guide
  claimed that externalizing the login signing key leaves only downstream API
  keys encrypted, which has not been true since the web push key and Trunk
  Recorder passwords joined the set. Two links pointed at a
  `#secrets-encryption` anchor that has never existed.
- The bundled compose file told operators to `chmod 600` the encryption key
  file. Squelch runs as uid/gid 1001, so a key file readable only by the
  invoking user makes the container restart-loop; it now says to make the file
  group-readable by 1001.
- **The Trunk Recorder MQTT guide said the bundled broker starts locked down.**
  It described the auto-generated `mosquitto.conf` as having
  `allow_anonymous false` with a password file. The entrypoint actually writes
  `allow_anonymous true` — on purpose, so the broker boots before a `passwd`
  file exists — which means an operator following the guide would believe the
  broker required credentials when anything on the host could connect without
  them. Both broker options now say so plainly, and say to lock it down before
  exposing it beyond loopback.
- **RTLSDR-Airband and ProScan can now be selected as directory monitor
  types.** Both parsers have been in the server the whole time, but the admin
  dropdown only offered four types, so the only way to reach them was the API
  or a JSON config import — and the recorder guide documented steps that could
  not be carried out in the UI. They are now in the dropdown, and the form
  reveals the fields each one actually reads: System and Talkgroup for both,
  Frequency for RTLSDR-Airband, and a filename Mask for ProScan (the watcher
  has always applied masks after the type parser, for every type).
- The recorder guide pointed at "Directory Monitors" in the sidebar, which is
  called "Monitors", and listed API Key Call Rate under Options, where it does
  not appear.
- **Trunk Recorder broker passwords are now encrypted at rest like every other
  secret.** The startup pass that encrypts plaintext secrets once an encryption
  key is configured covered settings and downstream API keys, but was never
  extended to cover Trunk Recorder instances when the MQTT integration shipped.
  A deployment that configured an instance and then enabled encryption kept its
  broker password in plaintext indefinitely — warned about on every connect,
  and fixed by nothing. It is now encrypted on the next start.

### Changed

- **The README is now an introduction rather than a feature inventory.** It
  opens with who Squelch is for and what you need, puts the quick start near
  the top, and links out to the guides instead of restating them. The
  Trunk Recorder MQTT integration and its guide were missing entirely.
- **Breaking: upgrading requires one manual step.** The secrets-at-rest
  encryption scheme changed, so secrets written by v2.x or earlier have to be
  re-encrypted once, with the server stopped, using the new `squelch-rekey`
  tool that ships beside the binary and inside the image:

  ```
  squelch-rekey -db /var/lib/squelch/squelch.db            # report only
  squelch-rekey -db /var/lib/squelch/squelch.db -apply     # re-encrypt
  ```

  It reports and exits unless given `-apply`, takes a backup before writing,
  and rewrites everything in one transaction or not at all. Squelch refuses to
  start until it has been run, naming the secrets it cannot read — it does not
  migrate anything itself. See
  [Upgrading to v3.0.0](docs/deployment-guide.md#upgrading-to-v300).
- **Breaking: `OPENSCANNER_*` environment variables are no longer read.** Only
  `SQUELCH_*`. A compose file still using the old names will fall back to
  defaults rather than erroring, so check it before upgrading.
- **Breaking: the pre-rename compatibility shims are gone.** The CLI no longer
  reads `~/.openscanner-token` (log in once more), the browser no longer reads
  pre-rename storage keys (theme and paused state reset once per browser;
  talkgroup selection is unaffected, being stored server-side), and the server
  no longer refuses to start on an `openscanner.db` data directory. Upgrading
  from v1.x goes v1 → v2 → v3, or rename the database file by hand.
- The old product name is now absent from everything except one file in the
  migration tool, which needs it to read what earlier versions wrote.

## [2.0.0] — 2026-09-18

### Changed

- **OpenScanner is now Squelch.** Same project, same data, new name — a self-hosted radio call archive rather than something that does the scanning itself. The app, README, and guides all say Squelch; the Go module path is now `github.com/revtex/squelch`.
- **Breaking: the binary, image, default paths, and environment prefix are renamed.** The binary is `squelch`, the image is `ghcr.io/revtex/squelch`, the database defaults to `squelch.db` under `/var/lib/squelch`, and configuration is read from `SQUELCH_*`. See [Upgrading from OpenScanner](docs/deployment-guide.md#upgrading-from-openscanner) — it is a file rename and an environment-variable rename, with no schema migration.
- `OPENSCANNER_*` environment variables are still honoured, with one startup warning naming each one used, and will be removed in a future release. `SQUELCH_*` wins when both are set.
- **Squelch refuses to start on an OpenScanner data directory** rather than creating an empty database beside the old one. Starting fresh is indistinguishable from total data loss at a glance, and silently renaming files leaves no way back, so it stops and prints the exact `mv` command — including the `-wal` and `-shm` files, but only when they actually exist.
- Saved browser state — theme, paused state, and your talkgroup selection — is read from its pre-rename key once and migrated forward, so nothing needs re-selecting. The DaisyUI theme names moved from `openscanner-dark`/`-light` to `squelch-dark`/`-light`, and a stored old value is mapped forward too.
- The CLI's stored login token moved to `~/.squelch-token`; the old file is still read, so existing sessions survive.
- **The secrets encryption scheme is deliberately unchanged.** Its HKDF salt and info string still contain the old name because they are key-derivation inputs, not labels: renaming them would derive a different key and make every stored `enc::` secret — the JWT secret, downstream API keys, Trunk Recorder broker passwords — permanently undecryptable. A test now pins those constants so a future global rename cannot quietly break them.

## [1.4.0] — 2026-09-18

### Added

- **Trunk Recorder MQTT integration.** OpenScanner can now subscribe to one or more [trunk-recorder MQTT status plugin](https://github.com/taclane/trunk-recorder-mqtt-status) feeds and surface a live admin dashboard covering control-channel decode rates, recorder states, active calls, system tables, unit affiliation, and trunking-message debugging. The integration is opt-in (`trMqttEnabled` setting) and ships with multi-instance support out of the box — one OpenScanner can consume many trunk-recorders, optionally on the same broker. New REST surface under `/api/v1/admin/tr/*` (legacy mirror under `/api/admin/tr/*` with the standard deprecation headers), new admin WebSocket events under the `tr.*` topic namespace, and a new **Dashboards → Trunk Recorder** sub-panel with Instances / Dashboard / Units / Messages views. Audio is **not** consumed via MQTT — calls keep flowing through `dirmonitor` / `/api/v1/calls`. See [Trunk Recorder MQTT guide](docs/tr-mqtt-guide.md).
- Trunk Recorder MQTT dashboard expanded to surface every plugin field. New tabs for **Calls** (Active + Recent sub-tabs, fed by `tr.callStart` / `tr.callEnd`), **Recorders** (driver/freq/state/duration/call count), **Systems** (sys_num/sysid/wacn/nac/rfss/site_id), and **Config** (SDR sources + capture/upload settings). The existing Dashboard, Units, and Messages views are enriched with talkgroup alpha/group/tag, unit alpha tag, decoded message meta, opcode type, per-system decode rates, and a plugin connect/disconnect badge sourced from `tr.pluginStatus`.
- **Continuous listener audio stream, for background playback on mobile.** A new opt-in `GET /api/v1/listener/stream` serves one never-ending MPEG audio response — silence padded with calls as they arrive — instead of one HTTP request per call. iOS only keeps a backgrounded page alive while audio is actively playing, and a scanner is silent between calls, so a locked phone gets suspended in the gap and never plays the next call; a stream that never stops keeps the audio session open, which is how native scanner apps behave. The server applies the listener's saved talkgroup selection, AVOID entries and system grants per call, so the stream carries exactly what that listener would otherwise have heard. Calls are transcoded once and the resulting frames shared across listeners rather than running an encoder per connection, and a listener that falls behind drops its oldest queued audio rather than growing without bound. Requires an FFmpeg build with `libmp3lame`; where that is missing the endpoint answers 503 and everything else is unaffected. Two caveats: HOLD is not applied, because it is transient UI state the server never sees, and while backgrounded the call list and transcripts still catch up only when you return to the page — the stream fixes audio continuity, not the UI's.

- **BKGND, the scanner control that hands playback to that stream.** It sits beside LIVE as a joined pair, because the two are alternative ways of listening rather than a control plus a switch — pick LIVE to play in this tab, pick BKGND to keep playing when the screen locks — and choosing one releases the other. It is offered on phones and tablets only, where a backgrounded page gets suspended; a desktop browser keeps playing a background tab by itself. Detection uses the user agent *and* the primary pointer, so Chrome's "Desktop site" option cannot hide the control on a phone that needs it. Background audio always starts from a tap, because autoplay policy refuses a stream opened without a user gesture, and the control reports what is actually happening: amber while a stream is waiting for that tap, coloured once it is playing. The controls that cannot work in this mode say so rather than looking available — pause, skip, replay and HOLD grey out (they act on the local player, or on state the server never receives), and the queue counter reads `Q: —` since the server does the queueing. The volume slider drives the stream (iOS ignores software volume entirely; this covers Android and desktop), and playing a call from search or bookmarks pauses the stream for its duration and re-opens at live afterwards instead of fighting it for the audio session.

- **Lock-screen now-playing info and artwork.** In background-audio mode the server owns playback, so nothing on the page was starting a call and the OS media session sat blank — on iOS that meant no talkgroup name and a grey tile. Incoming calls now label the media session (talkgroup, system, group/tag) after the same selection and AVOID filtering the server applies, and the scanner's own display is driven from the same source rather than sitting on "Tap LIVE to start listening". Labels are held until the stream's own clock reaches the call they describe, so the lock screen changes in step with the audio instead of several seconds ahead of it — a call queued behind a long one waits for its turn rather than replacing a call you are still hearing. The title shows the talkgroup **name** ("Mentor Police") rather than its terse radio alias ("43-ME PD"), falling back to the alias where there is no name. The lock-screen play/pause transport drives the stream rather than the idle local player, and resuming re-opens it rather than continuing from a stale buffered position. OpenScanner also ships app icons for the first time (192px and 512px), used both as the media-session artwork and to fill in the previously empty `icons` array in `manifest.json`, so installing to a home screen gets a real icon too.
- Bundled `eclipse-mosquitto:2` broker as an opt-in Docker Compose profile (`docker compose --profile mqtt up -d`). On first start the entrypoint generates a default `mosquitto.conf` bound to `127.0.0.1:1883` with anonymous access disabled and an empty `passwd` file ready for `mosquitto_passwd`.

### Security

- Backend dependency advisories cleared ahead of the release: `golang.org/x/crypto` 0.53.0 → 0.56.0 (GO-2026-6355, GO-2026-6354, GO-2026-6303) and `golang.org/x/text` 0.37.0 → 0.41.0 (GO-2026-5970), pulling `x/net` 0.57.0, `x/sys` 0.47.0, `x/term` 0.45.0 and `x/tools` 0.48.0 along with them. One advisory has no fix upstream — GO-2026-5932, which deprecates `x/crypto/openpgp`; that package is not in OpenScanner's build graph. Go standard-library advisories are covered by the toolchain: the CI and Docker builds request Go `1.26`, which resolves to the current patch release.
- Trunk Recorder broker passwords are encrypted at rest when an OpenScanner encryption key is configured (`enc::` prefix, AES-256-GCM); when encryption-at-rest is disabled the password is stored in plaintext alongside the existing JWT secret and downstream API keys (the startup banner already warns about this case). The REST API never echoes either form, only a `hasPassword: bool` flag. The PATCH endpoint accepts a tri-state password field — omit to keep, send `""` to clear, send a string to re-encrypt — so passwords can be rotated without ever round-tripping through the browser.
- All trunk-recorder admin routes require admin JWT; the kill-switch returns 404 (not 403) when `trMqttEnabled=false`, hiding the surface entirely from disabled deployments. The MQTT subscriber never subscribes to the broker's `audio` topic.
- **Dependency security sweep — all 39 open Dependabot alerts cleared.** Backend: `golang.org/x/crypto` 0.50.0 → 0.52.0 (13 alerts, 7 of them critical) and `golang.org/x/net` 0.52.0 → 0.55.0. Frontend: `react-router` → 7.18.4, which is the only one of these that ships in the browser bundle (RSC-mode CSRF bypass, high). The rest are build- and test-time only and never reach the binary: `undici` → 7.29.1 (9 alerts), `vitest` + `@vitest/mocker` → 4.1.11, `js-yaml` → 4.3.2, `postcss` → 8.5.28, `brace-expansion` → 1.1.21/5.0.12, `browserslist` → 4.29.0, `baseline-browser-mapping` → 2.11.25, `@humanfs/node` → 0.17.0. Transitive versions are held down by pinned pnpm overrides. Vitest needed a major upgrade (3.2.6 → 4.1.11) because the `@vitest/mocker` path-traversal fix was not backported to 3.x; all 248 tests pass on it unchanged.

### Fixed

- **The API docs now report the running version** instead of a hardcoded `1.0`. The Swagger `@version` annotation is a build-time literal that went stale the moment a release was cut, so `/api/v1/admin/docs` claimed `1.0` on every build through v1.3.3; it is now set from the binary's real version, the same value `--version` and `/api/v1/health` report. The frontend's `package.json` carried a second, separately hand-maintained version (last bumped at 1.2.1) that nothing read — removed, so the git tag is the single source of truth.
- **The scanner's mode buttons now look like buttons before you press them.** HOLD, AVOID, SELECT, SEARCH and the unselected half of LIVE/BKGND were drawn with no background at all, so they read as plain text until tapped. They now carry a faint background and border at rest — the selected one stays boldly coloured, so which mode is active is still the obvious difference.
- Gesture-time audio unlock no longer throws when `HTMLMediaElement.play()` returns `undefined` rather than a promise. Browsers always return one, so this never affected a real deployment, but jsdom does not — and since the unlock runs on every stray interaction, it produced 85 uncaught exceptions across the component tests and failed the frontend test job.
- **Streaming and large `/api/v1/*` responses are no longer buffered in memory before being sent.** The middleware that rewrites legacy error bodies into the v1 envelope wrapped every response in a buffering writer, even though — as its own documentation said — it only ever rewrites 4xx/5xx. For ordinary responses that just meant a needless copy of every body, including call audio. For a response that never ends it was fatal: the new listener audio stream returned `200 audio/mpeg` and then zero bytes forever, while the buffer grew unbounded. Buffering now stops as soon as the status is known to be non-error, and the wrapper exposes the writer underneath so a streaming handler can clear the server's 60-second write deadline instead of being cut off mid-response.
- **iOS: audio no longer dies when the screen locks, and keeps playing when Safari is backgrounded.** Call audio was routed through the Web Audio graph (`MediaElementAudioSourceNode` → `GainNode` → `destination`). iOS suspends that graph when the page is backgrounded and *interrupts* it on screen lock, and an interrupted context generally cannot be resumed programmatically — which is why playback stopped dead and only a page reload brought it back. On iOS the call audio now comes straight out of the media element, which iOS permits to continue while Safari is in the background or the screen is locked. The page also publishes the playing call to the OS media session, so it shows up on the lock screen and in Control Center with working play/pause/skip controls. Trade-off on iOS only: the in-app volume slider no longer changes playback volume, because iOS ignores `HTMLMediaElement.volume` and reserves volume for the hardware buttons. Every other platform keeps the gain node and the slider. Note that this covers the call that is already playing; continuing to receive and play *new* calls while backgrounded is a separate problem, since iOS suspends the page during the silence between calls.
- **OpenScanner now works on iOS Safari.** The page loaded and login succeeded, but the listener WebSocket died after 0.4–3 s and reconnected in a roughly 4-second loop forever, so no calls, no listener count, and no LIVE state ever appeared. The listener and admin sockets negotiated `permessage-deflate` with *context takeover*, which makes every compressed message after the first depend on the LZ77 sliding window left by the previous one. Confirmed on the wire: the first compressed frame (`scanner.config`) is self-contained and decodes standalone, but every `call.new` and `call.transcript` after it fails with `invalid distance too far back` unless the previous window is carried over — so a client whose inflater does not do that completes the handshake, renders the config, then drops the TCP connection with no close frame the moment the first call arrives (the server logged only `read error: EOF`). Desktop Chrome and Firefox carry the window correctly, which is why this looked platform-specific. WebSocket compression is now disabled, which is the library's own default and carries an explicit Safari caveat. Side effect: one 117 KB config was being split into 209 tiny continuation frames and is now a single frame. The trade-off is bandwidth — the config costs 117 KB per connection instead of 25 KB, and each call frame about 1.2 KB instead of 350 bytes.
- **Audio on iOS no longer stays blocked for the entire session**, including calls played from history. The gesture handler that unlocks playback awaited the AudioContext resume before touching the media element, and WebKit — unlike Chrome's sticky activation model — does not carry user activation across an `await`. The element unlock therefore ran in a microtask that iOS no longer counted as a user gesture, so every later `play()` was refused by autoplay policy. The unlock is now issued synchronously inside the gesture, before anything is awaited.
- **Live audio no longer silently queues instead of playing when the browser is backgrounded right after going LIVE.** Playback waited for the media element's `canplay` event before calling `play()`, and a hidden tab can defer buffering indefinitely — so that event never fired, the call stayed "current" forever, and every subsequent call piled up in the queue until the tab was foregrounded (at which point the whole backlog played). The element is now asked to play as soon as its source is set, which is also what keeps a background tab loading; a `visibilitychange` handler recovers a stalled or autoplay-blocked call on return to the foreground (matching the wake handling the WebSocket clients already use), and a `play()` rejected by autoplay policy keeps its call queued instead of skipping it — previously a single policy rejection could drain the queue. Also fixed the gesture-time audio unlock, which awaited `play()` on a source-less element: that promise never settles, so everything sequenced after it (including creating the keypad-beep AudioContext inside the user gesture, as mobile autoplay policy requires) was skipped until a real call replaced the source ~30 s later.
- **Container health check now probes `/api/v1/health`** instead of the deprecated `/api/health`, so the image's built-in `HEALTHCHECK` (and the shipped Compose examples) stop logging a `legacy endpoint hit` warning every 30 seconds. The legacy alias still works for anyone who has it wired into external monitoring; only the defaults moved. `README.md` and the deployment guide were updated to match.
- **Talkgroup selection no longer resets to "everything enabled" on page load.** The listener WebSocket sends `connection.welcome` before `scanner.config`, and the welcome handler fabricated a config object with an empty `systems` array. If the saved-selection GET resolved inside that window, the restore mapped every saved talkgroup id onto a talkgroup list that wasn't there yet, marked itself "restored" with an empty selection, and the persist effect then wrote that back as `disabledTGs: []` — silently wiping the selection server-side about half a second after load. The real config arrived moments later but restore-only-runs-once had already happened, so everything showed enabled. The gap is normally ~15 ms, which is why it looked intermittent; a slow WebSocket handshake or a busy server widens it. Talkgroup state now keys off a `configReceived` flag set only by a real config frame, in both the restore and persist paths, with the reducers refusing to mark an empty selection ready as a backstop.
- **Talkgroup selection no longer resets to "everything enabled."** Saving the listener's talkgroup selection was an unconditional overwrite: a second tab, phone, or browser left open from before a filtering session still held the old "all enabled" state in memory, and the next thing that changed there (including a timed AVOID expiring on its own, with nobody touching the page) blind-wrote `disabledTGs: []` over the freshly saved selection. `GET /api/v1/listener/tg-selection` now returns a `version` fingerprint that clients echo back on `PUT`; a stale version is rejected with `409 conflict`. A session whose selection hasn't moved since the rejected write adopts the newer one (it is the stale side); a session where you are still clicking keeps your edits and re-sends them against the current version, so an active tab never loses its own work. A save that never lands (conflict retries exhausted, server error) is re-attempted instead of being dropped until the next click. Unversioned writes (legacy `/api/auth/tg-selection` clients) keep the old overwrite behaviour, and saves are now logged with their disabled/avoid counts so a future occurrence is traceable.
- **Group/tag LED toggles in Select Talkgroups now work for `(No Group)` and `(No Tag)`.** Those two sections are placeholder labels for talkgroups the server sends with no group/tag at all, and the bulk toggle was matching the literal string `"(No Group)"` against the talkgroup's own (absent) group — so clicking the LED did nothing and every talkgroup had to be unchecked by hand. Section toggles now act on exactly the talkgroups the section rendered, which also fixes a search-filtered section silently flipping every talkgroup in the whole group rather than the handful shown.
- **First click on a talkgroup checkbox** no longer does nothing. A talkgroup with no stored preference reads as enabled everywhere in the UI, but the toggle treated "no preference" as off and flipped it to on, wasting the first click on any talkgroup added since the selection was last saved.
- **"All Talkgroups" LED** now confirms before re-enabling everything (it can discard a long filtering session in one misclick, and sits one row above the group list in the same click column), clears active AVOIDs when it does, and picks its direction from the same count the LED colour shows — with avoids present the dot could read red while the click enabled all.
- A bulk **turn-on** of a section now clears active AVOIDs for those talkgroups, so the section LED can actually reach green instead of staying yellow and re-arming the same click forever.
- **AVOID no longer leaks into the saved selection.** Avoiding a talkgroup also switched it off in the stored talkgroup selection, so a *timed* avoid became a permanent disable if the tab was closed before it expired — the talkgroup stayed silent with no badge left to explain why. Avoids are now tracked purely as avoids (they are persisted separately and already mute playback on their own), an expiring or cleared avoid no longer force-enables a talkgroup the user had deliberately turned off, and the checkbox renders unchecked while an avoid is active. This also removes a spurious save fired on every login that had an active avoid.

- **Accessibility:** Added `aria-label` to the HOLD and AVOID toolbar buttons (both use `div[role="button"]` and their text wasn't reliably exposed as an accessible name) and to both volume range inputs (md+ and mobile dropdown variants), which had no label at all.

- **Search call duration** now displays as `m:ss` (e.g. `1:23`) instead of raw seconds (e.g. `83s`), matching the format used elsewhere in the UI.
- **iOS WebSocket reconnection.** The listener and admin WebSocket clients now reconnect immediately when the page returns to the foreground (`visibilitychange`), regains network (`online`), or refocuses (`focus`). iOS Safari (and every iOS browser, since they all use WebKit) aggressively suspends background pages, throttles `setTimeout` to ~1/min, and silently closes WebSockets — which left the scanner unable to deliver live calls and the admin Activity / Trunk Recorder panels showing no data after the screen briefly slept. The pending exponential-backoff timer is now cancelled and the backoff reset to 1 s whenever a wake event fires, so reconnection is instant rather than waiting out a possibly maxed-out 30 s delay.
- **Add TR instance** form: fixed broken label/input spacing on DaisyUI 5 (the legacy `form-control` class no longer applies `flex-direction: column`), default the password mode to **Set new** for new instances (was misleadingly defaulting to **Keep existing**), and surface backend validation errors inline in the dialog instead of only logging them to the console.
- **Add TR instance** form auto-fills the **Unit topic** and **Message topic** with `<base>/units` and `<base>/messages` while typing the base topic, so unit affiliation and trunking-message panes light up without extra setup. Existing values are never overwritten.
- Trunk Recorder dashboard **Active calls** table now falls back to `sys_name`/`sys_num`/`system` when the plugin's `calls_active` payload omits `shortname`, so the System column populates with the legacy taclane plugin field set.
- Trunk Recorder **Test connection** button now uses a 10-second deadline (was 5 s) so the one-shot connect+CONNACK round-trip has time to complete on slower brokers and fresh DNS lookups; stable instances were reporting `connection timed out` despite the persistent client being healthy.
- Trunk Recorder **Trunking messages** pane now actually populates. The MQTT plugin publishes trunking messages to `<message_topic>/<shortname>/message` (singular) per the source in `mqtt_status_plugin.cc` — the upstream README mistakenly documents the suffix as `/messages`. OpenScanner had been subscribing to the documented suffix and dropping every frame on the floor. The `MessageFrame` decoder also expected the message body at the top level when the plugin actually nests it under a `"message"` key (`{type, message:{sys_num, sys_name, trunk_msg_type, opcode, opcode_desc, …}, timestamp, instance_id}`), so even matching frames decoded to empty rows. Both bugs fixed; the Messages view now shows opcode, description, type, and shortname for every received frame.
- Trunk Recorder **Units** pane now shows shortname / unit ID / talkgroup for every event instead of three blank columns. The TR plugin envelopes unit payloads as `{type, <kind>:{body}, timestamp, instance_id}` (where `<kind>` is `on`/`off`/`call`/`join`/`data`/`location`/`end`/`ackresp`/`ans_req`) and uses the field names `sys_name`, `unit`, `unit_alpha_tag` — OpenScanner was decoding the wrong shape (`shortname`, `unit_id`, `unit_alpha` at top level) and silently zero-filling every column. The decoder now flattens the nested body and matches the plugin's actual JSON keys.
- Trunk Recorder dashboard **plugin badge** no longer gets stuck on `plugin: disconnected` after a broker reconnect. The MQTT plugin's `pluginStatus` topic only re-publishes `connected` on plugin start, so a flapping broker would leave the badge wrongly red forever; now any incoming data frame (rates / recorders / calls / units / messages) refreshes the badge to "connected", and a broker disconnect clears the stale value entirely so the next retained `pluginStatus` becomes the source of truth on reconnect.
- Trunk Recorder dashboard **Recorders** stat now shows `active / total` (e.g. `3 / 16`) so you can tell at a glance how many recorders are actually recording vs. how many are configured. Previously it only showed the configured count.
- Trunk Recorder dashboard dropped the **Recent units** and **Trunking msgs** stat cards — both saturated at their internal cap (200 / 500) within seconds on a busy P25 system and conveyed no useful information. The Units and Messages tabs already surface live counts and the actual feeds.
- Activity dashboard now honors the **12-Hour Time Format** option for chart axis labels and Peak Hour, instead of always rendering 24-hour clock times. The setting is read from the admin config (always available on the admin route) so it works even before the scanner WebSocket has delivered `scanner.config`.
- **Trunk Recorder** panel now lands on the **Dashboard** tab when at least one instance is configured — first-time visitors with no instances still land on **Instances** so setup is the obvious next step. Previously every visit defaulted to Instances even after setup.

### Removed

- Removed seven planned-but-unwired settings that had no runtime consumers: `pushNotifications`, `webhooksEnabled`, `sortTalkgroups`, `tagsToggle`, `playbackGoesLive`, `searchPatchedTalkgroups`, and `afsSystems`. The Options panel no longer shows the "Planned" badge machinery, and migration `021_remove_planned_settings.sql` deletes the rows from existing databases. Future features will reintroduce these (or replacements) with proper plans.

### Changed

- **Options** panel switched to a CSS-columns masonry layout (`columns-1 md:columns-2 xl:columns-3`) so the variable-height sections pack tightly with no large blank voids on wide screens. Sections use `break-inside-avoid` so each card stays whole. Single-toggle "Webhooks", "Trunk Recorder MQTT", and "Push Notifications" sections were merged into a unified **Integrations** group so the bottom of the page is no longer dominated by mostly-empty cards.
## [1.3.3] — 2026-06-18

### Fixed

- Docker image build no longer fails at the frontend `pnpm install --frozen-lockfile` step. Corepack was provisioning the latest pnpm (11.x), which stopped reading the `pnpm` field (`overrides`, `onlyBuiltDependencies`) from `package.json`, so the empty override set no longer matched the lockfile and the frozen install aborted with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Pinned pnpm to 10.33.0 via the `packageManager` field so Corepack provisions a pnpm that still honors those settings.

### Security

- Updated frontend dependencies to clear all known npm advisories reported by Dependabot. `react-router` is bumped past 7.15.1 (fixes the vendored `turbo-stream` RCE, the `__manifest` DoS, the protocol-relative open redirect, and the PUT/PATCH/DELETE CSRF), and pinned overrides force patched `vite` (≥6.4.3, `server.fs.deny` bypass + `launch-editor` NTLM hash disclosure), `vitest` (≥3.2.6, UI-server arbitrary file read), `@babel/core` (≥7.29.6), `js-yaml` (≥4.2.0), and `brace-expansion` (≥5.0.6). No runtime behavior changes; `vite`/`vitest` stay on their existing majors.

## [1.3.2] — 2026-04-29

### Fixed

- Refresh-token cookie is now scoped to `/api` instead of `/api/auth`, so the browser actually sends it to the native `/api/v1/auth/refresh` endpoint introduced in 1.3.0. Per RFC 6265 §5.1.4 path-matching, a `/api/auth`-scoped cookie does NOT match `/api/v1/auth/refresh`, which silently broke every silent refresh on the v1 surface — the moment the 15-minute access JWT expired the server returned 401 "no refresh token" and the user was bounced to the login screen. **This is the primary cause of the ~15-minute logoffs reported against 1.3.0/1.3.1.**
- Audio-element auth recovery now shares the same single-flighted `/api/v1/auth/refresh` promise as the rest of the app. Previously, a 401 on an `<audio>` fetch fired a parallel refresh that bypassed the RTK Query coalescing introduced in 1.3.1; if it raced the scheduled refresh it would replay the single-use refresh cookie and revoke the token family.

### Security

- Refresh-token rotation now tolerates a 30-second replay grace window for already-rotated tokens (per OAuth 2.0 Security BCP §4.13). When the same refresh cookie is presented twice within the window — parallel browser tabs, service-worker retries, page reload mid-rotation, or any scenario the per-tab single-flight cannot cover — the server returns the cached successor tokens issued on the original rotation instead of revoking the entire token family. Replays after the grace window still revoke the family, preserving the theft-detection signal.

## [1.3.1] — 2026-04-29

### Fixed

- Idle browser tabs no longer get logged out when the access JWT expires. The frontend now single-flights `POST /api/v1/auth/refresh` so simultaneous 401s on tab wake (config, calls list, listener TG selection, WebSocket reauth, scheduled refresh, etc.) coalesce onto one network request. Previously, parallel refresh attempts presented the same single-use refresh token; the server treated the second attempt as a replay and revoked the entire token family, forcing a re-login despite the 30-day refresh cookie.
- Release workflow now creates the GitHub Release when a tag is pushed without one, instead of failing with `release not found` when uploading binaries. Future `git push --tags` releases publish artifacts without a manual `gh release create` step.

## [1.3.0] — 2026-04-29

### Added

- Native `/api/v1/*` REST surface alongside the existing legacy routes. All v1 responses use a structured error envelope (`{"error":{"code","message","details"}}`) with stable string codes (`validation_failed`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unprocessable`, `rate_limited`, `internal`); 5xx envelopes include the request ID under `details.requestId`.
- v1 call-upload endpoint (`POST /api/v1/calls`) with native multipart field names (`systemId`, `talkgroupId`, `startedAt`, `frequencyHz`, `durationMs`, `unitId`) and RFC 3339 `startedAt` enforcement (unix timestamps no longer accepted on v1). Companion `POST /api/v1/calls/test` returns 204 on a valid API key.
- v1 listener endpoints: `GET/PUT /api/v1/listener/tg-selection` (renamed from `/api/auth/tg-selection`), `GET /api/v1/calls`, `GET /api/v1/calls/:id/audio`, `GET /api/v1/calls/:id/transcript`, share/bookmark endpoints, and unauthenticated `/api/v1/health`, `/api/v1/setup/*`, `/api/v1/auth/{login,refresh,logout,password,me}`.
- v1 admin endpoints under `/api/v1/admin/*` for talkgroup/unit/group/tag imports, RadioReference preview (path simplified — no `/csv` suffix), transcription status, and Swagger session bootstrap.
- Native JSON-object framed WebSocket protocol on `GET /api/v1/ws/listener` and `GET /api/v1/ws/admin`. Frames carry a `type` discriminator (`connection.welcome`, `scanner.config`, `call.new`, `call.transcript`, `listener.count`, `listener.feedMap.snapshot`/`update`, `session.expired`, `connection.rejected`, `admin.event`, `admin.request`, `admin.response`) instead of the legacy 3-letter array opcodes. Admin error responses mirror the REST `{code,message,details?}` envelope. The frontend connects to the v1 paths; legacy `/ws`, `/api/ws`, and `/api/admin/ws` keep emitting the array-framed protocol unchanged for in-the-wild clients.
- RFC 8594 deprecation headers (`Deprecation: true`, `Sunset`, `Link: <successor>; rel="successor-version"`, `Cache-Control: no-store`) on every legacy `/api/*` and legacy WebSocket route, pointing at the native `/api/v1/*` successor. Per-request structured warn log (`legacy endpoint hit`) records method, path, and a truncated API-key identifier — never the raw key.
- Admin endpoint `GET /api/v1/admin/legacy-usage` returning a 24-hour aggregate of legacy-endpoint hits (`{method, path, apiKeyIdent, count, lastSeen}`), backed by an in-memory ring buffer (no schema change).
- Admin dashboard banner that surfaces legacy-API usage from the new endpoint, with an expandable details table (method, path, API key, count, last seen) and per-session dismiss.

### Changed

- Frontend now talks to the native `/api/v1/*` surface for every REST call (RTK Query base URL, raw `fetch()` for audio downloads and silent token refresh, the service-worker passthrough rules, the dev-server proxy, and the Swagger UI bootstrap). Tg-selection moves from `/api/auth/tg-selection` to `/api/v1/listener/tg-selection`; RadioReference CSV preview moves to `/api/v1/admin/radioreference/preview`; legacy-usage report is consumed at `/api/v1/admin/legacy-usage`. Legacy `/api/*` routes remain available for non-frontend clients with the existing deprecation headers.
- API-key authentication on `/api/v1/*` upload routes accepts only `Authorization: Bearer <api-key>`; the legacy `X-API-Key` header, `?key=` query parameter, and `key=` form field continue to work on legacy routes only. JWT-shaped Bearer tokens on v1 API-key routes are rejected with `invalid_credentials`.
- Swagger UI now documents every native `/api/v1/*` endpoint, not just the three previously annotated handlers. Legacy `/api/*` annotations remain in place until those routes are retired.

## [1.2.1] — 2026-04-25

### Security

- Pin transitive `postcss` to `>=8.5.10` via a pnpm override to address GHSA / CVE: "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output" (medium). PostCSS is a dev-only dependency pulled in by Vite/Tailwind and never reaches the production runtime, but the override removes the Dependabot alert and ensures contributors building from source pick up the patched version.

## [1.2.0] — 2026-04-25

### Added

- Session cookie (`os_session`) issued on login and refresh, cleared on
  logout. The `GET /api/calls/:id/audio` route now accepts authentication
  via either the existing `Authorization: Bearer` header or the new
  cookie, so `<audio>` element playback can be authenticated without
  client-side header injection. Cookie is httpOnly, Secure when served
  over HTTPS, `SameSite=Strict`, scoped to `/api`. Cross-site requests
  are rejected via a `Sec-Fetch-Site` check; invalid or expired cookies
  fall through to anonymous so existing `publicAccess=true` deployments
  continue to work unchanged.
- Canonical `GET /api/ws` listener WebSocket route. The existing `GET /ws`
  remains as a compatibility alias that delegates to the same handler. The
  frontend now connects to `/api/ws`, and the Vite dev proxy covers both
  paths.

### Changed

- WebSocket `CAL` messages no longer carry embedded base64 audio. Audio
  is fetched on demand from the existing `GET /api/calls/:id/audio` HTTP
  endpoint, authenticated via the `os_session` cookie introduced in the
  previous release entry. Frontend playback rewrite ships as the
  immediately-following release entry.
- HTTP handlers have been decomposed from the monolithic `internal/api`
  package into feature-scoped subpackages under `internal/handler/`
  (`auth`, `calls`, `bookmarks`, `share`, `setup`, `health`,
  `admin/{imports,radioreference,transcriptions}`). Route registration
  now lives in `internal/handler/routes`, and shared swagger DTOs and
  helpers live in `internal/handler/shared`. No route paths, methods,
  middleware ordering, response shapes, or status codes changed.
- Backend file-level cleanup: `internal/handler/calls/calls.go` (~1500 LOC)
  split into `upload.go`, `audio.go`, `search.go`, `transcript.go`, and a
  slim `calls.go` retaining the `Handler` struct and constructor;
  `internal/middleware/middleware.go` split into `cors.go`, `auth.go`,
  `logging.go`, `limits.go`. Same package, same exports, no behaviour
  change.
- Admin CRUD business logic has been extracted from `internal/ws` into a
  new transport-agnostic `internal/admin` package. The WebSocket layer
  now only routes `ADM_REQ` frames to `admin.Operations` methods; the
  wire protocol, action names, and response shapes are unchanged.
- Deployment guide reverse-proxy instructions now list `/api/ws` alongside
  `/ws` and `/api/admin/ws` as paths that need WebSocket-upgrade forwarding.
- Admin Options panel no longer shows an "Active" badge on every wired
  setting; only "Planned" badges are rendered for not-yet-implemented
  options.
- Admin Options "Audio Conversion" description now reads "Convert incoming
  audio with FFmpeg before storing. Select the codec and bitrate below."
  to reflect that MP3 and AAC outputs are both supported via the encoding
  preset.
- Frontend `services/` directory grouped into `services/ws/` (`client.ts`,
  `client.test.ts`, `adminClient.ts`) and `services/audio/` (`player.ts`,
  `beep.ts`). All `@/services/*` imports across components and hooks have
  been updated to the new paths. No runtime behaviour change.
- Frontend `hooks/` directory split into `hooks/shared/` (`useAuthInit`,
  `useTheme`, `useTokenRefresh`, `useWebSocket`), `hooks/scanner/`
  (`useScanner`, `useAudioPlayer`, `useTGSelectionSync`, `useActiveUnit`),
  and `hooks/admin/` (`useAdminWebSocket`, `useAdminWsOps`,
  `useAdminActivity`, `useAdminLogs`, `useWsQuery`), each with a barrel
  `index.ts`. All call sites have been updated to the new specific paths.
  No runtime behaviour change.
- Frontend `types/index.ts` god-file split into topic-scoped modules
  (`call.ts`, `config.ts`, `ws.ts`, `auth.ts`, `api.ts`, `admin.ts`,
  `ui.ts`). The original `index.ts` is now a barrel that re-exports
  everything, so all existing `@/types` imports keep working unchanged.
  New code can also import from a specific module (e.g. `@/types/admin`).
- Frontend layout polish on top of the directory restructure:
  `app/slices/` split into `shared/` (`authSlice`), `scanner/`
  (`scannerSlice`, `callsSlice`, `shareSlice`), and `admin/`
  (`adminSlice`, `activitySlice`); `components/admin/AdminLayout.tsx`
  inlined into `pages/Admin.tsx` (replacing the 5-line shim);
  `components/admin/NavigationGuardContext.tsx` relocated to
  `hooks/admin/useNavigationGuard.tsx`; and `services/downloadFilename.ts`
  moved to `services/util/downloadFilename.ts`. All call sites updated;
  no runtime behaviour change.
- Frontend audio playback now uses the platform `<audio>` element backed
  by `MediaElementAudioSourceNode`. Each call is fetched on demand from
  the existing `/api/calls/:id/audio` endpoint authenticated via the
  session cookie. Drops the WebSocket-embedded base64 path, fixing
  Mobile Edge AAC playback and dramatically reducing per-call memory
  pressure on the client.
- Service worker now passes audio fetches (`/api/calls/:id/audio` and
  `/api/shared/:token/audio`) straight through to the network instead of
  intercepting them. Lets the browser handle Range requests natively for
  the `<audio>` element and avoids buffering full call bodies in the
  worker.

### Fixed

- Swagger UI now opens correctly from the admin Tools panel. The short-lived `os_swagger` session cookie was scoped to `/api/admin/docs`, so the browser refused to send it on the v1 docs URL (`/api/v1/admin/docs/index.html`) and the docs route returned `swagger session required`. The cookie path is now `/api`, covering both legacy and v1 docs routes.
- Lock the primary admin's Allowed Systems selector in the user editor; the first user always has access to every system and the badges are now read-only with all systems shown as allowed.
- Default `audioEncodingPreset` seeded into the settings table is now
  `mp3_32k` (matching the dropdown's "(default)" label and the Go
  `ParseEncodingPreset` fallback) instead of `aac_lc_32k`. New installs
  enabling audio conversion will now default to MP3 32 kbps as the UI
  advertises.
- Audio playback now silently recovers from a 401 on `/api/calls/:id/audio`
  by triggering a single token refresh and retrying the same call. Fixes
  the case where a sibling device login (phone, tablet, second tab) pushes
  a desktop's access JWT out of the per-user concurrent-token cap and
  leaves \<audio\> playback failing until the next scheduled refresh.
- Per-user concurrent JWT cap raised from 5 to 20 (`auth.MaxRefreshFamilies`).
  With a 15-minute access TTL refreshing roughly four times per hour, the
  old limit pushed a desktop's session off the active list within an hour
  of normal multi-device use. 20 leaves headroom for desktop + phone +
  tablet without inflating the deny list.
- WebSocket clients (listener and admin) now detach handlers and wait for
  `open` before closing a still-`CONNECTING` socket during reconnect.
  Suppresses the cosmetic "WebSocket is closed before the connection is
  established" browser console warning that appeared after a token-expiry
  reconnect.

## [1.1.2] — 2026-04-24

### Security

- Call upload now reads audio back through `os.Root` when embedding it in
  the WebSocket broadcast, ensuring the read is confined to the
  recordings directory regardless of the stored path. Addresses a Snyk
  path-traversal taint warning on `os.ReadFile`.
- `GET /api/calls/:id/audio` now opens the recording through `os.Root`
  and streams via `http.ServeContent` instead of letting `c.File` touch
  a joined absolute path. Addresses a Snyk path-traversal taint warning
  where the DB-stored `audio_path` reached `c.File` after only string
  sanitisation.
- `GET /api/shared/:token/audio` uses the same `os.Root` + `ServeContent`
  pattern so the shared-link download path is also confined to the
  recordings directory.
- `openscanner upgrade --binary <path>` now resolves both the source and
  destination paths to absolute cleaned form before any filesystem
  operation, and rejects a source that isn't a regular file before
  opening it. The operator already has full authority here, but the
  validation short-circuits obvious mistakes (directories, device nodes,
  broken symlinks) and addresses Snyk CLI-input path-traversal warnings
  on `os.Open` and `os.Remove`.
- Dirmonitor `delete_after=1` cleanup now deletes via `os.Root.Remove`
  scoped to the watched directory. The existing symlink-resolve + `Rel`
  escape check is retained as defence-in-depth; the structural root
  bound ensures no file outside the watched directory can ever be
  removed regardless of parser output. Addresses Snyk path-traversal
  taint warnings on the dirmonitor cleanup path.
- Dirmonitor ingest now reads the just-ingested audio back through
  `os.Root` when embedding it in the WebSocket broadcast frame,
  confining the read to the recordings directory. Addresses a Snyk
  path-traversal taint warning on `os.ReadFile`.
- The `openscanner` CLI now validates the `--server` /
  `OPENSCANNER_SERVER` URL before it reaches `net/http`: the string
  must parse, use an `http` or `https` scheme, and carry a non-empty
  host. Userinfo and fragments are stripped. The CLI only ever talks to
  a URL the operator supplied, but the explicit validation shuts down
  Snyk SSRF taint warnings and turns typos into a clear error message.
- The bookmarks download button now sanitises the server-supplied
  `audioName` before assigning it to `<a download>` — path separators,
  control characters, quote/angle-bracket characters, and leading dots
  are stripped, and the result is capped at 200 chars. Addresses a Snyk
  DOM-XSS taint warning and also yields safer filenames on Windows.
- The search-panel download button uses the same `sanitizeDownloadFilename`
  helper, extracted to `services/downloadFilename.ts` so both call sites
  share one implementation. Addresses the same Snyk DOM-XSS finding for
  `SearchPanel.tsx`.

## [1.1.1] — 2026-04-24

### Changed

- Docker images are now built for both `linux/amd64` and `linux/arm64`,
  so `docker pull` works on Apple Silicon, Raspberry Pi, and other
  arm64 hosts.
- Docker image tagging no longer produces `sha-<short-sha>` tags on every
  push. Published images now carry only semver (`1.1.1`, `1.1`, `latest`)
  and branch (`main`, `dev`) tags, so `ghcr.io/revtex/openscanner:dev` is
  the canonical pre-release channel.
- New weekly `GHCR cleanup` workflow prunes leftover untagged and
  `sha-*`-only container versions from GHCR.

## [1.1.0] — 2026-04-23

### Added

- Commit GitHub ruleset definitions under `.github/rulesets/` so branch
  and tag protection policy is versioned with the code.
- Release workflow now builds standalone binaries for Linux, macOS, and
  Windows (amd64 + arm64 where applicable) on every `v*` tag and
  attaches them to the GitHub Release alongside a `SHA256SUMS.txt`.
- Release archives ship the user guides (README, admin, deployment,
  recorder) as styled PDFs, and the same PDFs are attached to the
  GitHub Release as standalone downloads.

### Fixed

- PDF user guides rendered code blocks with ~50pt of phantom left
  padding and let long lines overflow the right margin. Pandoc's
  built-in skylighting CSS is now neutralised so code aligns with the
  block's left edge and wraps cleanly.

## [1.0.0] — 2026-04-23

Initial public release. OpenScanner is a ground-up reimplementation of
[rdio-scanner](https://github.com/chuot/rdio-scanner) as a single Go binary
with an embedded React frontend. Backward compatible with existing
rdio-scanner upload clients (Trunk-Recorder `rdioscanner_uploader`, SDRTrunk
Rdio Scanner streaming target).

### Added

- **Scanner interface** — live WebSocket streaming with play/pause, skip,
  replay, hold, avoid (5/15/30 min or indefinite), per-user talkgroup
  selection, bookmarks, public call sharing with configurable expiry, live
  transcript display, dark/light theme, mobile-responsive layout with
  virtualized lists.
- **Call ingest** — HTTP upload (`/api/call-upload` + backward-compatible
  `/api/trunk-recorder-call-upload`) and directory monitoring with native
  support for Trunk-Recorder, SDRTrunk, DSDPlus, RTLSDR-Airband, ProScan,
  and generic mask-based sources.
- **Auto-populate** — systems, talkgroups, groups, tags, and units created
  automatically from incoming call metadata.
- **Audio processing** — FFmpeg integration with four conversion modes
  (disabled, enabled, normalize, loudnorm) and 8 encoding presets across
  MP3, AAC-LC, and HE-AAC.
- **Transcription** — optional integration with a
  [go-whisper](https://github.com/mutablelogic/go-whisper) sidecar for
  automatic call transcription with in-UI model management, speaker
  diarization (tinydiarize models), 15 languages plus auto-detect, and GPU
  acceleration.
- **Admin dashboard** — CRUD for users, systems, talkgroups, units, groups,
  tags, API keys, directory monitors, downstreams, shared links, webhooks,
  and settings. Log viewer with level/date/text filters and runtime level
  control. JSON config export/import. CSV import/export for talkgroups and
  units. RadioReference metadata preview and import.
- **Authentication** — JWT login with refresh-token rotation (family
  revocation on reuse), bcrypt password hashing (cost ≥ 12), role-based
  access control (admin/listener), per-user talkgroup selection, session
  limits, account expiration, password-change enforcement.
- **Rate limiting** — per-IP login with 3-strike lockout, per-user share
  creation, per-API-key sliding-window upload limits, per-IP shared-link
  access.
- **Secrets at rest** — optional AES-256-GCM encryption for the JWT signing
  secret and downstream API keys, keyed from `OPENSCANNER_ENCRYPTION_KEY`.
- **TLS** — certificate/key file configuration with HTTP → HTTPS redirect
  and experimental Let's Encrypt auto-cert.
- **Outbound HTTP hardening** — transcription and downstream traffic go
  through a shared client with redirects disabled, timeouts enforced, and
  response bodies capped. Private-network targets allowed by default;
  gateable with `OPENSCANNER_BLOCK_INTERNAL_HTTP=1`.
- **Deployment** — single binary, embedded SQLite (WAL), pre-built Docker
  image with FFmpeg. Guided `openscanner setup --interactive` for
  bare-metal installs; `upgrade`, `config validate`, and `service doctor`
  subcommands. Cross-platform service management (systemd / SysV / OpenRC
  / launchd / Windows SCM).
- **Documentation** — deployment guide, admin guide, recorder integration
  guide, architecture overview, API reference.

### Known limitations

- Let's Encrypt auto-cert is experimental and not yet exercised in
  production.
- Downstream forwarding between OpenScanner instances is experimental and
  untested.
- Transcription requires a separately deployed go-whisper sidecar.

[Unreleased]: https://github.com/revtex/squelch/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/revtex/squelch/releases/tag/v3.0.0
[2.0.0]: https://github.com/revtex/squelch/releases/tag/v2.0.0
[1.4.0]: https://github.com/revtex/squelch/releases/tag/v1.4.0
[1.0.0]: https://github.com/revtex/squelch/releases/tag/v1.0.0
