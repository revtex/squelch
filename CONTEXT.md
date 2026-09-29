# CONTEXT

The domain model for Squelch — the vocabulary the code, the tests, and the UI
all use for the same things. When a name here and a name in code disagree, one
of them is a bug.

This is the *shared language* file. Structure and rules live elsewhere:
`.github/PROJECT_LAYOUT.md` for layout, `.github/CONVENTIONS.md` for
the Security Rules, `docs/adr/` for decisions and why they were made.

## What Squelch is

A web-based radio call manager. Radio recorders (Trunk-Recorder, SDRTrunk, and
anything speaking the rdio-scanner upload API) push recorded transmissions to
it; Squelch stores the audio on disk and the metadata in SQLite, streams it to
browsers, and serves an admin dashboard. One Go binary with the React SPA
embedded in it.

It does not do the scanning. It is the archive and the distribution layer for
what something else scanned — which is what the name is about.

## Core nouns

**Call** — one recorded transmission: an audio file plus its metadata
(talkgroup, system, timestamp, duration, source unit). The atom of the whole
system. Table `calls`. Everything else exists to route, filter, or present
Calls.

**System** — one radio system being monitored (a P25 trunked system, typically).
Owns Talkgroups. Table `systems`.

**Talkgroup** — the channel a Call was transmitted on, within a System. What a
listener actually chooses between. Table `talkgroups`; grouped by `groups` and
labelled by `tags`.

**Unit** — the individual radio that transmitted. Table `units`.

**Recorder** — the external software producing Calls (Trunk-Recorder, SDRTrunk).
Never called a "scanner": the scanner is the hardware, the Recorder is the
software, and Squelch is neither.

**Listener** — a signed-in user consuming Calls in the browser. Distinct from
**Admin**, who configures the system. Both are rows in `users`; the difference
is the admin flag on the JWT.

## Ingest

**Upload** — a Recorder POSTing a Call to the API. The legacy rdio-scanner
upload surface is kept working on purpose; see `docs/adr/`.

**Dirmonitor** — a filesystem watcher that ingests Calls from a directory a
Recorder writes into, rather than waiting to be POSTed to. Table `dirmonitors`,
package `internal/dirmonitor`.

**Downstream** — another Squelch or rdio-scanner instance this one forwards
Calls to. Table `downstreams`, package `internal/downstream`.

**Webhook** — a URL that is sent a message about each Call (generic signed
JSON, or a Discord embed) rather than the Call itself. Table `webhooks`,
package `internal/webhook`. Downstreams and Webhooks together are
**Forwarding** in the admin.

## Listening

**Selection** — the set of Talkgroups a Listener has chosen to hear. Stored
server-side on the user (`tg_selection_json`); the browser keeps a
write-through cache only. Never modify a Listener's Selection as a side effect
of anything.

**AVOID** — a Talkgroup the Listener has temporarily muted without removing it
from the Selection.

**LIVE** — the normal listening mode: Calls arrive over the WebSocket and play
one at a time in the browser.

**BKGND** — background-audio mode. The server sends one never-ending,
silence-padded audio response so playback survives a locked phone. See
`docs/adr/0004-background-audio-server-stream.md`. Mobile only — on desktop a
background tab keeps running and the control is deliberately hidden.

**Queue** — the Calls waiting to play in LIVE mode. Meaningless in BKGND, where
the server owns the timeline; the display shows a dash rather than a count.

## Admin

**Instance** — one configured Trunk Recorder that Squelch consumes MQTT status
from. Table `tr_instances`, package `internal/trmqtt`. One Squelch can consume
many. Audio never arrives this way — MQTT carries status only.

**Setting** — a unit of application configuration. **All application
configuration lives in the database** (`settings`), not in files. Only
server-level concerns — listen address, database path, TLS, encryption key —
come from CLI, environment, or INI.

**Janitor** — the background sweep that ages out recordings and enforces the
disk-size cap.

## Cross-cutting

**enc::** — the prefix marking a secret encrypted at rest with AES-256-GCM. Its
key-derivation inputs are frozen and must never be renamed; see
`docs/adr/0003-secrets-at-rest.md`.

**v1 / legacy** — the two HTTP surfaces. `/api/v1/*` is canonical and is what
the SPA uses; `/api/*` is deprecated and exists only for Recorder
compatibility. New endpoints go on v1 only.

## Words we do not use

- **"Scanner"** for the app. Squelch is the archive; scanning happens upstream.
  (`features/scanner/` in the frontend predates the name and is the listener UI
  — rename it only as a deliberate, separate change.)
- **"Channel"** for a Talkgroup. Talkgroup is the domain term.
- **"Recording"** for a Call when the metadata matters. "Recording" is the file
  on disk; "Call" is the file plus what it means.
