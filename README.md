# Squelch

**Hear what matters.**

Squelch is a self-hosted archive for scanner radio traffic. Point your radio
recorder at it and every call is stored, transcribed, and searchable — plus a
live feed you can listen to in any browser, on your phone or at your desk.

_Squelch was previously named OpenScanner._

---

## Is this for you?

Squelch is the **listening and archiving end** of a scanner setup. It does not
tune radios itself — something else does the receiving and hands Squelch the
audio.

You'll get the most out of it if:

- You already run a radio recorder — [Trunk-Recorder](https://github.com/robotastic/trunk-recorder),
  [SDRTrunk](https://github.com/DSheirer/sdrtrunk), or another tool that writes
  one audio file per call.
- You want to listen live **and** go back and find the call you missed.
- You have a machine that stays on — a NAS, a mini PC, or a small VPS is plenty.

What you need before you start:

- **A machine that's always on**, with Docker installed (or run the single
  binary yourself — no database server to set up either way).
- **A radio recorder** already producing per-call audio.
- **Disk space** for the audio. Squelch can prune old calls automatically.

Already running rdio-scanner? Squelch speaks the same upload protocol, so your
recorder config works with a URL change. See [Coming from rdio-scanner](#coming-from-rdio-scanner).

---

## Quick start

```bash
git clone https://github.com/revtex/squelch.git
cd squelch
docker compose up -d
```

Then open **<http://localhost:3022>** and follow the first-run setup to create
your admin account.

That's a working server. To start hearing traffic, add an API key and point your
recorder at it — the [Recorder Guide](docs/recorder-guide.md) walks through it
for each supported recorder.

Prefer to run it without Docker, or put it behind a reverse proxy with HTTPS?
The [Deployment Guide](docs/deployment-guide.md) covers both.

---

## Documentation

Start here, in this order:

| Guide | What it covers |
| --- | --- |
| [Deployment Guide](docs/deployment-guide.md) | Installing, upgrading, backups, reverse proxies, HTTPS, encrypting secrets |
| [Recorder Guide](docs/recorder-guide.md) | Pointing each supported recorder at Squelch |
| [Admin Guide](docs/admin-guide.md) | Every screen in the admin dashboard, panel by panel |
| [Trunk Recorder MQTT Guide](docs/tr-mqtt-guide.md) | Live recorder health dashboard via trunk-recorder's MQTT plugin |

For contributors: [CONTEXT.md](CONTEXT.md) defines the project's vocabulary, and
[docs/adr/](docs/adr/) records the significant design decisions and why the
alternatives lost.

---

## What you get

### Listening

- **Live feed** with play/pause, skip, and replay, streamed as calls arrive.
- **Hold and avoid** — lock onto a system or talkgroup, or mute one for 5/15/30
  minutes or until you undo it.
- **Talkgroup selection** — search and multi-select by system, group, or tag.
  Your selection is saved to your account, not just the browser.
- **Search the archive** by system, talkgroup, group, tag, date range,
  transcript text, or bookmark.
- **Bookmarks and share links** — flag calls for later, or generate a public
  link to a single call with an expiry date.
- **Works on a phone** — mobile-first layout, and a background mode that keeps
  playing when the screen locks.
- **Dark and light themes.**

### Getting calls in

- **HTTP upload** — recorders POST to `/api/call-upload`, using the same
  protocol and API-key auth as rdio-scanner.
- **Directory monitoring** — or let Squelch watch a folder for new recordings,
  with configurable polling, filename masks, and optional auto-delete.
- **Supported recorders** — Trunk-Recorder, SDRTrunk, DSDPlus, RTLSDR-Airband,
  ProScan, voxcall, and generic filename-mask sources.
- **Auto-populate** — systems, talkgroups, groups, tags, and units are created
  from incoming call metadata, so you aren't hand-entering a radio system.
- **Duplicate detection** and **auto-pruning** of calls older than N days.
- **Audio processing** via FFmpeg — optional conversion, normalization, and
  several MP3/AAC encoding presets.

### Transcription

Squelch can transcribe calls automatically using
[go-whisper](https://github.com/mutablelogic/go-whisper), run as a separate
container.

- Download and switch between Whisper models from the admin dashboard.
- Transcripts appear live in the player and are **searchable** afterwards.
- Speaker diarization, 15 languages plus auto-detect.
- Runs on CPU, but a GPU is strongly recommended (6 GB+ VRAM).

### Administration

- **Dashboard** — calls today/week/total, active listeners, uptime, a 24-hour
  activity chart, and top talkgroups.
- **Users** — named accounts with admin or listener roles, per-user talkgroup
  selection, expiration dates, and session limits.
- **Radio data** — manage systems, talkgroups, units, groups, and tags, with CSV
  import/export and RadioReference enrichment.
- **API keys** with per-key system grants and rate limits.
- **Trunk Recorder dashboard** — if you run trunk-recorder's MQTT status plugin,
  Squelch shows live decode rates, recorder states, active calls, and unit
  activity. See the [Trunk Recorder MQTT Guide](docs/tr-mqtt-guide.md).
- **Logs** — query by level, date, and text, with runtime log-level control.
- **Backup and restore** of your full configuration as JSON.

### Running it

- **One binary, no database server** — SQLite is built in.
- **Docker image** with FFmpeg included, or a guided
  `squelch setup --interactive` that writes config and installs a system service
  on Linux, macOS, or Windows.
- **HTTPS** with your own certificate, or behind Nginx or Caddy — both have
  tested, WebSocket-aware example configs in the deployment guide.
- **Optional encryption at rest** (AES-256-GCM) for the login signing key, web
  push key, downstream API keys, and Trunk Recorder broker passwords.
- Sensible security defaults: JWT sessions with refresh-token rotation, bcrypt
  password hashing, role-based access, and rate limiting on logins, uploads, and
  share links.

---

## Coming from rdio-scanner

Squelch is a from-scratch reimplementation of
[rdio-scanner](https://github.com/chuot/rdio-scanner), not a fork, and it keeps
the upload API compatible on purpose:

- `/api/call-upload` and `/api/trunk-recorder-call-upload` accept the same
  multipart fields.
- API keys work the same way (`X-API-Key` header or `?key=` query parameter).
- SDRTrunk's key-verification probe and the recorder-facing error messages match,
  so recorder-side logs stay readable.
- **Your existing recorder config works with only a URL change.**

What's different:

| | rdio-scanner | Squelch |
| --- | --- | --- |
| **Transcription** | Not available | Built in, with search, live display, and GPU support |
| **Auto-populate** | Systems only | Systems, talkgroups, groups, tags, and units |
| **Call sharing** | Not available | Public share links with an expiry |
| **Bookmarks** | Not available | Bookmark calls and filter the archive to them |
| **Users** | Access codes | Named accounts, admin/listener roles, expiry, session limits |
| **Recorder health** | Not available | Live Trunk Recorder dashboard over MQTT |
| **Log viewer** | Basic | Query by level, date, and text with runtime level control |
| **Config backup** | Not available | Export and import the whole configuration as JSON |
| **Secrets encryption** | Not available | Optional AES-256-GCM encryption at rest |

---

## Recorder compatibility

Squelch works with any recorder that produces one audio file per call, either by
receiving an upload or by watching a directory.

| Recorder | Upload | Directory watch |
| --- | :-: | :-: |
| [Trunk-Recorder](https://github.com/robotastic/trunk-recorder) | ✔ | ✔ |
| [SDRTrunk](https://github.com/DSheirer/sdrtrunk) | ✔ | ✔ |
| [RTLSDR-Airband](https://github.com/szpajder/RTLSDR-Airband) | | ✔ |
| [DSDPlus Fast Lane](https://www.dsdplus.com/) | | ✔ |
| [ProScan](https://www.proscan.org/) | | ✔ |
| [voxcall](https://github.com/aaknitt/voxcall) | ✔ | |

Setup steps for each are in the [Recorder Guide](docs/recorder-guide.md).

---

## Configuration

Almost everything — audio processing, scanner behavior, sharing, retention — is
configured in the admin dashboard and stored in the database. There's no config
file to edit for day-to-day settings.

Only the handful of options Squelch needs *before* it can open its database come
from the command line, environment, or a JSON config file:

| Flag | Environment variable | What it does |
| --- | --- | --- |
| `--listen` | `SQUELCH_LISTEN` | Listen address (default `:3022`) |
| `--db-file` | `SQUELCH_DB_FILE` | Where the database lives |
| `--recordings-dir` | `SQUELCH_RECORDINGS_DIR` | Where audio files are stored |
| `--ssl-listen` | `SQUELCH_SSL_LISTEN` | HTTPS listen address |
| `--ssl-cert` | `SQUELCH_SSL_CERT` | TLS certificate file (PEM) |
| `--ssl-key` | `SQUELCH_SSL_KEY` | TLS private key file (PEM) |
| `--ssl-auto-cert` | `SQUELCH_SSL_AUTO_CERT` | Domain for Let's Encrypt (experimental) |
| `--encryption-key` | `SQUELCH_ENCRYPTION_KEY` | Key for encrypting secrets at rest |
| `--encryption-key-file` | `SQUELCH_ENCRYPTION_KEY_FILE` | Read that key from a file instead |
| `--timezone` | `SQUELCH_TIMEZONE` / `TZ` | IANA timezone for recorder timestamps |
| `--trusted-proxies` | `SQUELCH_TRUSTED_PROXIES` | Proxies allowed to set `X-Forwarded-For` (default: loopback and private ranges; `none` to disable) |

The full reference is in the
[Deployment Guide](docs/deployment-guide.md#configuration-reference).

---

## API

- **REST API** at `/api/v1/*`, with Swagger UI for signed-in admins at
  `/api/v1/admin/docs`.
- **Listener WebSocket** at `/api/v1/ws/listener` for live call streaming and
  listener counts.
- **Admin WebSocket** at `/api/v1/ws/admin` for live dashboard updates.
- **Health check** at `GET /api/v1/health`.

The older `/api/*` endpoints — including `/ws` and `/api/admin/ws` — still work
and send deprecation headers. Recorders should keep using `/api/call-upload`,
which is deliberately kept rdio-scanner-compatible; everything else new should
use `/api/v1/*`.

---

## Development

```bash
make dev     # Go hot-reload (air) + Vite dev server
make build   # Production build (single binary)
make test    # Run all tests
make lint    # Lint Go + TypeScript
```

**Tech stack:** Go + Gin, SQLite (modernc, WAL) with sqlc, React 18 +
TypeScript, Vite, Tailwind CSS 4 with DaisyUI 5, Redux Toolkit and RTK Query.
FFmpeg for audio, go-whisper for transcription. The React app is embedded into
the Go binary at build time, so production is a single executable.

---

## License

Squelch is licensed under the
[GNU General Public License v3.0](LICENSE).
