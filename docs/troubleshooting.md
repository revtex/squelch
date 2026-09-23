# Troubleshooting

Things that go wrong on a running Squelch server, arranged by what you see.
This page is for whoever runs the server. If you are listening rather than
running it, the [Listener Guide](listener-guide.md#troubleshooting) covers the
listening screen.

---

## Contents

- [Start Here](#start-here)
- [The Server Will Not Start](#the-server-will-not-start)
- [No Calls Are Arriving](#no-calls-are-arriving)
- [Calls Arrive but Nobody Hears Them](#calls-arrive-but-nobody-hears-them)
- [Audio Problems](#audio-problems)
- [Calls Disappear](#calls-disappear)
- [After an Upgrade](#after-an-upgrade)
- [Transcription](#transcription)
- [Locked Out](#locked-out)
- [Still Stuck](#still-stuck)

---

## Start Here

Four checks answer most questions before you go looking.

**Is the server up, and which version?**

```bash
curl http://localhost:3022/api/v1/health
```

A healthy server answers `{"status":"ok","version":"..."}`. No answer at all
means the process is down or not listening where you think it is.

**What does the log say?** Squelch logs a startup banner with the version, the
database path, the recordings directory, and whether FFmpeg was found. Read it
first — it settles a lot of guesses.

```bash
docker compose logs -f squelch          # Docker
journalctl -u squelch -f                # systemd service
```

Administrators can also read the log in the dashboard under **Logs**, filtered
by date range, level, and text. The **Log Level** control on that page raises or
lowers the server's detail without a restart — turn it up while you are
investigating, and back down when you are done.

**Is the config file valid?** (binary or service installs)

```bash
squelch config validate --config /path/to/squelch.json
```

**Is the service installed and running?** (binary or service installs)

```bash
squelch service doctor
```

---

## The Server Will Not Start

**It exits complaining about the config file.**
Run `squelch config validate --config <path>`. One specific case: the
`encryption_key` field is not allowed inside the config file and Squelch refuses
to start if it finds one. Pass the key with `--encryption-key`,
`--encryption-key-file`, or `SQUELCH_ENCRYPTION_KEY` instead.

**It exits saying it cannot read stored secrets.**
The database holds encrypted values and the key it was given does not decrypt
them — usually a key that was changed, lost, or not passed to the new container.
Squelch refuses to run with secrets it cannot read rather than serving blanks.
Restore the original key. There is no recovery without it; back the key up
alongside the database. See
[Keeping Secrets Safe](deployment-guide.md#keeping-secrets-safe).

**The port is already taken.**
Change the listen address with `--listen`, `SQUELCH_LISTEN`, or the port mapping
in `docker-compose.yml`.

**It cannot open the database or write recordings.**
Both are created owner-only by the account running the server. In Docker that
account is not root, so a bind-mounted directory owned by someone else fails.
Check the ownership of your data directory against
[Your Data Directory](deployment-guide.md#your-data-directory).

---

## No Calls Are Arriving

Work from the recorder inward.

**The recorder is rejected with `401`.** The message says which of three
things happened:

- `API key required` — no key reached Squelch at all. Check that the recorder
  is sending one and that the upload URL is right; the endpoint is
  `/api/call-upload`.
- `invalid API key` — a key arrived and does not match any key on the server.
  Keys are shown once, at creation, and stored hashed, so a mistyped or
  truncated one cannot be looked up. Issue a new key in **Admin → API Keys**
  and paste it into the recorder.
- `API key is disabled` — the key exists but **Disabled** is set on it in
  **Admin → API Keys**.

**The recorder reports `403` and `API key not permitted for this system`.**
The key is valid but scoped. In **Admin → API Keys**, check its **Systems**
field: empty means every system, otherwise only the systems listed are
accepted. A scope Squelch cannot parse denies everything rather than allowing
everything, so a hand-edited one is worth re-saving from the dashboard.

**The recorder reports `429` and `rate limit exceeded`.**
Uploads are being throttled, either by the per-key **Rate Limit** in
**Admin → API Keys** or by the global limit. Raise the key's limit, or find out
why the recorder is sending that much.

**The recorder reports success but no call appears.**
It was very likely rejected as a duplicate — that returns `200` with
`{"message":"duplicate call rejected"}`, so a recorder that only checks the
status code sees success. The log records `duplicate call rejected` with the
system and talkgroup. A call is a duplicate when another call on the same system
and talkgroup falls within **Duplicate Detection Time Frame (ms)** of it, under
**Admin → Options → Call Processing** (500 ms by default). Two recorders
covering the same site will do this legitimately. Widen or narrow the window
there, or switch on **Disable Duplicate Call Detection**.

**A directory monitor is not picking up files.**
Check the log for lines beginning `dirmonitor:`. They name the specific reason:
the directory could not be watched or read, a filename did not match the mask
(`parse error`), the file resolved outside the watched directory and was
rejected, or the audio file could not be read. Confirm the path and the filename
mask in **Admin → Monitors** against the files the recorder is actually writing.

**Nothing at all reaches the server.**
Confirm it from the recorder's own host — a firewall, a container network, or a
reverse proxy that is not passing `/api/` will produce silence rather than an
error in the Squelch log.

---

## Calls Arrive but Nobody Hears Them

Calls showing up under **Admin → Dashboards → Activity** or in search, but
not playing live,
means the delivery side rather than the ingest side.

**The listening screen never connects and no calls appear.**
Live calls travel over a WebSocket. A reverse proxy that does not pass the
upgrade headers breaks exactly this and nothing else — the page loads, search
works, live is dead. The working Caddy and nginx configurations are in
[Running Behind a Reverse Proxy](deployment-guide.md#running-behind-a-reverse-proxy).

**Listeners are turned away once the server is busy.**
**Max Simultaneous Clients** in **Admin → Options → Scanner Behavior** caps
concurrent listeners at 200 by default. Past that, a new connection is closed
as soon as it opens, and the page reconnects on a backoff without ever
receiving a call — so it looks like a dead feed, not a refusal. Raise the cap
if your server can carry the load.

**Anonymous visitors get the sign-in page instead of the feed.**
That is the default. **Public Access** in **Admin → Options → General** is what
allows listening without an account.

**One listener hears nothing while others are fine.**
Check that account in **Admin → Users**. **System Selection** restricts which
systems and talkgroups the account may hear; **Disabled**, **Expiration**, and
**Connection Limit** each cut a listener off in their own way.

**One talkgroup never plays for anyone.**
Check it in **Admin → Systems → Talkgroups**. Listener-side causes — avoids,
selection, hold — are in the
[Listener Guide](listener-guide.md#choosing-what-you-hear).

---

## Audio Problems

**Calls list but will not play.**
The metadata reached the database and the audio did not, or the file is no
longer on disk. Check the recordings directory named in the startup banner,
and check free disk space.

**Background listening fails on phones, with the server returning 503.**
Background mode is a server-encoded stream and needs FFmpeg with the
`libmp3lame` encoder available to the Squelch process. Without it the stream
endpoint stays off and answers `audio streaming is unavailable on this server`.
The Docker image ships FFmpeg; a binary install may not have it. The startup
banner reports whether FFmpeg was found.

**Audio conversion is not happening.**
Same cause — the log warns `ffmpeg not found on PATH` at startup. Conversion is
also off unless you select a mode in **Admin → Options → Call Processing**. See
[FFmpeg](deployment-guide.md#ffmpeg-optional).

**Volume is wildly uneven between systems.**
That is a recording-level difference, not a bug. Set audio conversion to
**Loudnorm** in **Admin → Options → Call Processing**.

---

## Calls Disappear

**Everything older than a week is gone.**
**Prune Database After (days)** in **Admin → Options → Call Processing**
defaults to **7**. It deletes calls and their audio past that age. Raise it, or
set it to `0` to stop pruning entirely — and then watch your disk, because
nothing else will.

**The disk filled up anyway.**
Audio is the bulk of it. Lower the retention, pick a smaller encoding preset
under **Audio Encoding Preset**, or give the recordings directory more room.

---

## After an Upgrade

**Settings look reset, or environment variables are being ignored.**
v3.0.0 renamed the environment variables and reset some settings deliberately.
Work through
[Rename your environment variables](deployment-guide.md#3-rename-your-environment-variables)
and [Other things that reset](deployment-guide.md#other-things-that-reset).

**The fix you upgraded for is still not there.**
Reload the page before anything else. Browsers cache the app, and a stale copy
looks exactly like a failed upgrade. Ctrl+Shift+R (Cmd+Shift+R on a Mac) forces
it. Then confirm the running version with
`curl http://localhost:3022/api/v1/health` — if it is the old one, the container
did not actually get replaced.

**It will not start after the upgrade.**
See [The Server Will Not Start](#the-server-will-not-start), and restore the
backup you took before upgrading —
[Backing Up](deployment-guide.md#backing-up) covers both directions.

---

## Transcription

**No transcripts appear.**
Transcription is off by default and runs as a separate service. Check that
**Transcription** is enabled in the admin dashboard, that the URL points at a
reachable go-whisper instance, and that a model is downloaded. Setup is in
[Transcription](deployment-guide.md#transcription-optional).

**Transcripts arrive minutes late.**
Whisper on CPU is slow enough to fall behind a busy system. GPU acceleration is
the fix; see
[GPU Acceleration](deployment-guide.md#gpu-acceleration-highly-recommended).

---

## Locked Out

**You forgot the administrator password.**
Start the server once with `--admin-password`, or with `SQUELCH_ADMIN_PASSWORD`
set. It resets the first administrator account's password during startup and
then carries on running normally. The password must be 8 to 128 characters.

Binary or service install:

```bash
squelch --admin-password 'a-new-password' --db-file /path/to/squelch.db
```

Docker — add it to the service's `environment:` block, bring the stack up,
confirm you can sign in, then remove it and bring the stack up again:

```yaml
environment:
  - SQUELCH_ADMIN_PASSWORD=a-new-password
```

Take it back out afterwards. Left in place it sits in your compose file in
plain text and resets the password on every restart. Doing this at all needs
access to the server itself, which is the point.

**A listener forgot theirs.**
Any administrator can set it in **Admin → Users** — edit the user and enter a
new password.

---

## Still Stuck

Open an issue at <https://github.com/revtex/squelch/issues> with:

- The version, from `curl http://localhost:3022/api/v1/health`.
- How you run it — Docker or binary, and what is in front of it.
- What you did, what you expected, and what happened.
- The relevant part of the log, with keys and tokens removed.

For anything with a security impact, do not open an issue — follow
[SECURITY.md](../SECURITY.md).
