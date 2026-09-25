# Admin Guide

_Squelch was previously named OpenScanner._

This guide covers every panel in the Squelch admin dashboard — what each setting does, how panels work, and how to configure your system.

The admin dashboard is at `/admin` and requires signing in with an admin account.

## Contents

- [Navigation](#navigation)
- [Overview](#overview)
- [Trunk Recorder Dashboard](#trunk-recorder-dashboard)
- [Users](#users)
- [Connections](#connections)
- [Systems](#systems)
- [Groups & Tags](#groups--tags)
- [API Keys](#api-keys)
- [Monitors (Directory Monitors)](#monitors-directory-monitors)
- [Downstreams](#downstreams)
- [Shared Links](#shared-links)
- [Transcription](#transcription)
- [Settings](#settings)
- [Logs](#logs)
- [Tools](#tools)

---

## Navigation

The sidebar groups the admin into five areas:

- **Overview** — stats and recent activity
- **People & access** — **Users** and **Connections**
- **Radio data** — **Systems**, **Groups & tags** and **API keys**
- **Ingest & delivery** — **Folder monitors**, **Downstreams**, **Webhooks**, **Shared links** and **Transcription**
- **Server** — **Settings**, **Logs & audit**, **Trunk Recorder** and **Backup & import**

Press **Ctrl K** (or choose **Go to** in the top bar) and type a few letters to jump to any section. The top bar also shows whether the admin's live connection to the server is up: **Live**, **Reconnecting…** or **Offline**. While it is reconnecting, lists stop updating until it is back.

On a phone the sidebar becomes a bar along the bottom with **Overview**, **Users**, **Systems** and **Logs & audit**; **More** lists every section. On a narrow desktop window the sidebar shrinks to icons with short labels.

The **Scanner** link in the sidebar and in the account menu returns you to the live scanner at `/`. **Sign out** clears your session. If you have unsaved changes in a panel, you'll be prompted before navigating away.

---

## Overview

**Overview** gives you a quick overview of your system:

- **Calls Today** — number of calls ingested today
- **This Week** — calls over the last 7 days
- **Total Calls** — all-time call count
- **Active Listeners** — currently connected scanner clients
- **Server Uptime** — how long the server has been running
- **24-Hour Activity Chart** — visual breakdown of call volume by hour
- **Top Talkgroups** — most active talkgroups

---

## Trunk Recorder Dashboard

If you run [trunk-recorder](https://github.com/robotastic/trunk-recorder) with the [MQTT status plugin](https://github.com/taclane/trunk-recorder-mqtt-status), Squelch can subscribe to its broker and surface live operational data — control-channel decode rate, recorder states, active calls, system tables, unit affiliation, and trunking-message debugging — under **Trunk Recorder**.

The Trunk Recorder integration is opt-in. Enable it under **Settings → Trunk Recorder MQTT**, then add one instance row per trunk-recorder under **Trunk Recorder → Instances**.

> Audio is **not** consumed over MQTT — calls keep flowing through your existing dirmonitor or `/api/v1/calls` upload pipeline. The MQTT feed only powers the live dashboard.

See the [Trunk Recorder MQTT guide](tr-mqtt-guide.md) for the full plugin config, multi-TR layout patterns, and bundled mosquitto compose profile (`docker compose --profile mqtt up -d`).

---

## Users

Who can sign in, what they can hear, and where they are signed in.

The table shows each account's role, status, systems, how many connections it has open right now, how many browsers and phones can sign back in without a password (**Devices**), and when it was last seen. Search by name, role or system, and use the status chips to show only active, disabled, expired or temporary-password accounts. Tick rows to sign out, disable or delete several accounts at once.

Choose **Add user** to create an account. You set a temporary password (or **Generate** one) and hand it to the user; by default they must pick their own password the first time they sign in. Turn **Require a new password at first sign-in** off if the user chose the password themselves.

Choose the **›** button on a row for the account's details and actions:

| Action | What it does |
| --- | --- |
| Edit | Change the name, role, systems, expiry date and connection limit. |
| Reset password | Set a new temporary password for someone who lost theirs. By default they must change it at their next sign-in and are signed out everywhere, so anyone holding the old password is out. |
| Require password change | A switch. On, the user is asked for a new password the next time they sign in. Accounts with it on show a **temporary password** badge in the table. |
| Sign out everywhere | Every device needs the password again. Use it if you think someone else has the account. |
| Disable / Enable | Disabling keeps the account but refuses sign-in and signs it out everywhere. Nothing is deleted. |
| Delete | Removes the account, its devices and its bookmarks for good. |

Each account has:

| Field            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| Username         | Login name                                                      |
| Role             | **Admin** (full access) or **Listener** (scanner only)          |
| Expires          | Optional date after which the account is locked out             |
| Connection limit | Optional cap on simultaneous connections for this user          |
| Systems          | Optional — restrict which systems this user can hear; none picked means all |

The primary admin (the first account) cannot be disabled or deleted, and its role, expiry, limit and systems are fixed. You cannot disable or delete your own account.

### Sign-in lockouts

After three failed sign-ins an address is locked out for ten minutes. While any address is locked out or counting failures, a **Sign-in lockouts** card appears under the table; **Clear** lets that address try again at once.

---

## Connections

See who is using the server right now, which devices can sign back in, who has connected recently, and which addresses are blocked. The tabs show how many connections, devices and blocks there are. On the first three tabs each row shows:

- **Who** — the user name, or **Anonymous**, with **Squelch app** (the mobile app) or **Browser** under it. Hover over the client to see the full browser identification.
- **Address** — the visitor's IP address. Behind a reverse proxy this is only right once Squelch trusts that proxy; if every row shows the same address, see [Showing the Real Client Address](deployment-guide.md#showing-the-real-client-address).
- **Type** — **LIVE** is the listening screen's live feed, **BKGND** is background audio (one listener with BKGND on has both a LIVE and a BKGND connection), **Admin** is someone on the admin dashboard.
- **Country** — shown under the address when the server has a country database. See [Showing Listeners' Countries](deployment-guide.md#showing-listeners-countries-optional). Private and local addresses show as **Local network**. History shows the country found at the time of the connection.

Click any user name or address to jump to **History** filtered to it.

### Acting on a Connection or Device

Choose the **›** button at the end of a row to open its details. They slide in from the right (from the bottom on a phone) with everything known about that connection or device, links to its history, and what you can do about it. Each action says what it will do, asks you to confirm in the same place, and is written to **Logs** with your user name. Press **Esc** or **✕** to close the details.

| Action | What it does |
| --- | --- |
| Disconnect | Closes that one connection. Nothing is signed out, so a signed-in browser or app usually reconnects within seconds. Use it to clear a stuck connection. |
| Sign out this device | Signs that one browser or phone out. It is disconnected straight away and needs the password to get back in. The account's other devices stay signed in. |
| Sign out everywhere | Signs the account out on every device at once. |
| Block this address | Opens the block form with that row's address filled in. See [Blocked addresses](#blocked-addresses). |

**Disconnect** is on **Live** only. **Sign out this device** needs a signed-in device, so it is missing for anonymous visitors. **Block this address** is missing on rows marked **trusted**, because those addresses can never be blocked, and the details say so. From **History** you can sign out a device or an account that is not connected right now; if it has already been signed out, you are told so.

Your own admin connection is marked **you**, and the device you are using is marked **this device**. Signing it out takes you to the sign-in page.

### Live

Every open connection, with how long it has been up. Anonymous visitors (with **Public Access** on) show as **Anonymous**. The list updates on its own as people come and go. Use the filter box to narrow it by user name, address or country.

### Devices

Every sign-in that can still renew itself without a password: each browser or phone that signed in and has not signed out, been signed out, or gone 30 days without using the server. A browser that signed in without **Remember me** forgets its sign-in when it closes, but stays listed here until that 30 days runs out. **Last seen from** is where it last renewed its sign-in from — within the last 15 minutes if it is in use. **Online** means it has at least one connection open right now.

### History

A record of every connection: who, from where, when, how long it lasted, and how it **ended**:

| Ended | Meaning |
| --- | --- |
| Left | The visitor closed the page or lost their connection |
| Signed out | The session was ended: they logged out, their password changed, an admin signed the device or account out, or an admin disabled, deleted or edited the account |
| Account disabled or expired | The periodic account check found the account disabled or past its expiration date |
| Server stopped | The server shut down or restarted while they were connected |
| Disconnected by an admin | An admin used **Disconnect** |
| Blocked | An admin blocked the address it came from |

Choose a time range and a connection type, and page through with **Previous** and **Next**. History is kept for 30 days by default; change it with **Keep Connection History** under [Settings → Connections](#connections-1). Setting it to 0 stops recording and leaves the tab empty.

### Blocked addresses

A blocked address cannot reach Squelch at all. It is refused for listening, for the admin dashboard, and for uploads from recorders. Anyone connected from it is dropped as soon as you add the block.

To block an address, choose **Block this address** in a row's details, or **Block an address** on this tab. Enter an address such as `203.0.113.9` or a range such as `203.0.113.0/24`, and optionally a reason. Then choose how long the block lasts: 1 hour, 24 hours, 7 days, or until you remove it. **Remove** lifts a block straight away.

Some blocks are refused:

- **Too wide.** The widest block allowed is `/16` for IPv4 or `/48` for IPv6. Block anything wider at your firewall or reverse proxy.
- **A range written with host bits.** For example, `192.168.1.5/24` is refused, and the message gives the range you probably meant, `192.168.1.0/24`.
- **Loopback, or a range that overlaps the Never blocked list.**
- **Your own address.** If the range includes the address you are connected from, the block form warns you and the button changes to **Block anyway**. Blocking yourself disconnects this page, and you cannot get back in from that address until the block is removed.

**Never blocked** lists the addresses no block applies to: loopback, plus any addresses set on the server with `--trusted-addresses`. The list cannot be changed from the dashboard, so an admin account alone cannot lock out whoever runs the server. See [Addresses That Can Never Be Blocked](deployment-guide.md#addresses-that-can-never-be-blocked).

A block is only as reliable as the client address Squelch sees. A device that Squelch trusts as a proxy can claim any address and get past a block. Narrow the trusted proxies to your reverse proxy, as described in [Showing the Real Client Address](deployment-guide.md#showing-the-real-client-address).

---

## Systems

Systems represent your radio systems (e.g. a county trunked system, a conventional channel group). Each system contains **talkgroups** and **units**.

### System Settings

- **Label** — display name shown in the scanner
- **Order** — controls display position (lower numbers appear first)
- **TG Auto-Populate** — when enabled, talkgroups are automatically created from incoming calls for this system. If the incoming call includes additional metadata (talkgroup name, label, group, tag, or unit information), those are created or updated automatically as well.

### Talkgroups

Each talkgroup has:

| Field        | Description                                      |
| ------------ | ------------------------------------------------ |
| Talkgroup ID | Numeric identifier matching your recorder output |
| Label        | Short display label (e.g. "FD Dispatch")         |
| Name         | Longer descriptive name                          |
| Frequency    | Optional frequency in Hz                         |
| Group        | Category grouping (from Groups panel)            |
| Tag          | Classification tag (from Tags panel)             |

You can search talkgroups by ID, label, or name. Large lists are virtualized for performance.

### Units

Each unit has a **Unit ID** and **Label**. Units represent individual radios on a system. You can search by ID or label.

---

## Groups & Tags

Groups and tags organize your talkgroups into categories.

- **Groups** sort talkgroups in the scanner's picker by function (e.g. Fire, Law, EMS, Public Works)
- **Tags** say what kind of traffic a talkgroup carries (e.g. Law Dispatch, Law Tac, Fire Tac, Emergency Ops)

Both lists are edited in place on **Admin → Groups & tags**:

- **Add** — type a name in the row at the top of the list and press **Add group** or **Add tag**. Names are trimmed and must be unique.
- **Rename** — the pencil turns the row into a text field; **Enter** saves, **Esc** cancels.
- **Usage** — each row shows how many talkgroups use it, or **unused**. Click the count to open **Systems** filtered to those talkgroups.
- **Delete** — the trash asks in place. An unused label is removed at once, with a ten-second **Undo** in the toast. A label that talkgroups still use asks where they should go first (another group or tag, or none) and moves them before deleting.

Assign groups and tags to talkgroups in the **Systems** panel. Squelch ships with sensible defaults (Air, Common, EMS, Fire, Interop, Law, Public Works for groups; ~20 tags covering law, fire, EMS, corrections, and more).

---

## API Keys

API keys authenticate recorders that upload calls to Squelch over HTTP. **Admin → API keys** lists every key by its label with its status, the systems it may upload to (by name), calls uploaded in the last 24 hours and when it was last used. Search by label, fingerprint, system or address, and filter to active, disabled, **Legacy uploads** (keys still sending to the deprecated `/api/*` path) or **Never used** keys.

**Add key** asks for:

| Field      | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| Label      | Where the key is used, e.g. the recorder's name or site. Required. |
| Systems    | Which systems the key may upload to. Pick none to allow them all.  |
| Rate limit | Calls a minute this key may upload. Empty uses the server default. |
| Enabled    | Turn off to refuse uploads with this key without deleting it.      |

After you save, the **secret is shown once**, with a copy button, a `curl` test command and a ready-made Trunk-Recorder plugin entry. It cannot be looked up later; rotate the key if it is lost.

The **›** button opens a key's details: its fingerprint (a short, stable handle that never reveals the secret), where and when it was last used, and these actions:

- **Edit** — label, systems and rate limit.
- **Rotate secret** — issues a new secret. The old one keeps working for 24 hours so the recorder can be updated without a gap; the key shows as **Rotating** until then.
- **Disable / Enable** — refuse or accept uploads without deleting the key.
- **Delete** — asks first. Calls the key uploaded are kept.

A key that sent requests to the deprecated `/api/*` path in the last 24 hours carries a **legacy uploads** badge, and its details explain what to change. Every create, edit, rotate, disable and delete is recorded in **Logs**.

See the [Recorder Guide](recorder-guide.md) for how to configure your recorder with the key.

---

## Monitors (Directory Monitors)

Directory monitors watch a local folder and automatically import call audio files. This is an alternative to API-based upload — useful when your recorder writes files to a shared directory.

Each monitor has:

| Field              | Description                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Directory          | Folder path to watch (browseable from the UI)                                                      |
| Type               | Recorder type: **Default**, **DSDPlus**, **SDR-Trunk**, or **Trunk-Recorder**                      |
| Mask               | Filename pattern using tokens to extract metadata (see below)                                      |
| Extension          | File extension filter (e.g. `wav`, `mp3`)                                                          |
| Delay              | Wait time in milliseconds before processing a new file (allows writes to complete)                 |
| Use Polling        | Use polling instead of filesystem events (for network drives or mounts that don't support inotify) |
| Delete After       | Remove the source file after successful import                                                     |
| System Override    | Force all files to a specific system                                                               |
| Talkgroup Override | Force all files to a specific talkgroup                                                            |
| Frequency          | Optional frequency override in Hz                                                                  |
| Disabled           | Temporarily stop watching                                                                          |
| Order              | Display position                                                                                   |

### Filename Mask Tokens

The mask extracts metadata from filenames. Available tokens:

`#DATE`, `#TIME`, `#SYS`, `#TG`, `#HZ`, `#GROUP`, `#TAG`, `#UNIT`

Example: a file named `2025-01-15_143022_101_5200.wav` with mask `#DATE_#TIME_#SYS_#TG` would extract the date, time, system 101, and talkgroup 5200.

The UI includes a help section with the full token reference.

---

## Downstreams

> **Note:** Downstream forwarding is implemented but has not been tested. Use at your own risk.

Downstreams forward ingested calls to other Squelch instances. Use this to fan out from a central server to regional or public-facing instances.

Each downstream has:

| Field    | Description                                     |
| -------- | ----------------------------------------------- |
| URL      | Remote server's call-upload endpoint            |
| API Key  | Authentication key for the remote server        |
| Systems  | Restrict which systems to forward (empty = all) |
| Disabled | Temporarily stop forwarding                     |
| Order    | Display position                                |

Downstream API keys are encrypted at rest in the database when an [encryption key](deployment-guide.md#keeping-secrets-safe) is configured. The admin UI never displays API keys — they are shown as masked dots. To change a key, enter a new one in the edit form; leave it blank to keep the existing key.

---

## Shared Links

Lists all shared call links created by users. Each entry shows:

- System and talkgroup
- Call date and duration
- Who shared it and when
- Expiration date (or "Never")

You can delete shared links from here. Deleting a link makes the call eligible for normal pruning.

Shared link creation and expiry are controlled in **Settings → Sharing & Notifications**.

---

## Transcription

Configure automatic speech-to-text for calls. Transcription uses a separate [go-whisper](https://github.com/mutablelogic/go-whisper) sidecar service — see the [Deployment Guide](deployment-guide.md#transcription-optional) for setup instructions.

This panel shows a connection status indicator and provides these controls:

| Setting                 | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| Transcription Enabled   | Master on/off toggle                                                |
| Live Transcript Display | Show transcription text in the live scanner player                  |
| Transcription URL       | Address of the go-whisper server (default: `http://localhost:8081`) |
| Language                | Target language or auto-detect (15 languages supported)             |
| Diarize                 | Speaker identification — only available with `-tdrz` models         |

### Model Management

Before transcription works, you need to download at least one model. The panel provides:

- **Download** — select from the list of available Whisper models and download
- **Set Active** — choose which downloaded model to use
- **Delete** — remove a downloaded model

The panel also shows transcription statistics when available.

---

## Settings

General settings that control how Squelch behaves. Settings are organized into groups.

### General

| Setting        | Description                                                           | Default |
| -------------- | --------------------------------------------------------------------- | ------- |
| Branding Label | Short text shown above the scanner (e.g. your county or project name) | (empty) |
| Support Email  | Contact email displayed to users                                      | (empty) |
| Public Access  | Allow unauthenticated users to listen to the scanner                  | Off     |

### Scanner Behavior

| Setting | Description | Default |
| --- | --- | --- |
| 12-Hour Time Format | Display times as AM/PM instead of 24-hour | Off |
| Show Listeners Count | Display the number of active listeners in the scanner | Off |
| Max Simultaneous Clients | Maximum number of live listeners allowed at once | 200 |

### Call Processing

| Setting | Description | Default |
| --- | --- | --- |
| Audio Conversion (FFmpeg) | **Disabled** / Enabled / Normalize / Loudnorm — controls audio processing on ingest | Disabled |
| Audio Encoding Preset | Codec and bitrate for converted audio (MP3 or AAC at various bitrates) | MP3 32 kbps |
| Disable Duplicate Call Detection | Skip checking for duplicate calls on upload | Off |
| Duplicate Detection Time Frame (ms) | Window for matching duplicate calls (±milliseconds) | 500 |
| Prune Database After (days) | Auto-delete calls older than this many days (0 = never prune) | 7 |

#### Audio Encoding Presets

| Preset         | Description                           |
| -------------- | ------------------------------------- |
| MP3 32 kbps    | **Default** — good balance of size and quality |
| MP3 24 kbps    | Lower bitrate MP3                     |
| MP3 16 kbps    | Smallest MP3                          |
| AAC-LC 32 kbps | Better quality than MP3 at the same bitrate |
| AAC-LC 24 kbps | Lower bitrate AAC                     |
| AAC-LC 16 kbps | Smallest AAC-LC                       |
| HE-AAC 12 kbps | High-efficiency AAC, very small files |
| HE-AAC 8 kbps  | Smallest possible, lowest quality     |

> **Keypad beeps are not an admin setting.** The button-press sound is chosen
> by each listener from the listening screen's ⋮ menu → **Keypad beeps**: the person
> listening is the one in the quiet room, and they are not always the admin.
> A signed-in listener's choice is stored against their account and follows
> them to any browser they sign in on; an anonymous listener's is kept in that
> browser. The instance-wide starting point is the `keypadBeeps` setting,
> which a listener's own choice overrides from then on; set it with
> `squelch config-set keypadBeeps uniden|whistler|disabled`.

### Sharing

| Setting | Description | Default |
| --- | --- | --- |
| Shareable Links | Allow users to create shareable links to specific calls | Off |
| Shared Link Expiry (days) | How long shared links stay active (0 = never expire) | 0 |

### Connections

| Setting | Description | Default |
| --- | --- | --- |
| Keep Connection History (days) | How long **Connections → History** keeps each connection. 0 stops recording; older rows are removed once an hour | 30 |

### Integrations

| Setting | Description | Default |
| --- | --- | --- |
| Trunk Recorder MQTT | Subscribe to trunk-recorder's MQTT status plugin and enable the **Trunk Recorder** page | Off |

Turning this on only enables the feature. You still need to add one instance row per trunk-recorder under **Trunk Recorder → Instances**, pointing at your broker. The [Trunk Recorder MQTT guide](tr-mqtt-guide.md) has the plugin-side configuration.

---

## Logs

View and search server logs in real time.

### Filters

- **Date Range** — select a range or use quick shortcuts (last 1, 6, or 24 hours)
- **Level** — filter by debug, info, warn, or error
- **Search** — text search across log messages
- **Limit** — number of entries to load (200 / 500 / 1,000 / 2,500 / 5,000)

### Controls

- **Auto-Refresh** — stream new log entries as they arrive via WebSocket
- **Auto-Scroll** — keep the view scrolled to the latest entry
- **Refresh** — manually reload logs
- **Clear Filters** — reset all filters to defaults
- **Log Level** — change the server's runtime log level (debug, info, warn, error) without restarting

HTTP request logs are color-coded by status: green for 2xx, gray for 3xx, yellow for 4xx, red for 5xx.

Each log row also shows short contextual chips next to the message for common events — for example `call=1234 sys=7 tg=5200 dur=3400` for an ingested call, or `downstream=2 call=1234 try=3` for a failed downstream push. Click a row to open a details panel with the full attribute list.

---

## Tools

Utilities for bulk data management and maintenance.

### CSV Import

- **Import Talkgroups** — upload a CSV to bulk-create or update talkgroups for a system. Choose between overwrite (update existing) or skip (keep existing) for duplicates.
- **Import Units** — same as above for unit records.

Both report how many records were inserted, updated, and skipped.

### CSV Export

- **Export Talkgroups** — download all talkgroups (or filter by system) as CSV.
- **Export Units** — download all units (or filter by system) as CSV.

### JSON Config

- **Export Config** — download the full server configuration as `squelch-config.json`. Useful for backups or migrating to a new server. If secrets encryption is enabled, exported values retain their `enc::` encrypted form.
- **Import Config** — restore configuration from a previously exported JSON file. If the backup contains encrypted values (`enc::` prefix), the target server must have the same `--encryption-key` configured. The import is rejected if no key is set or the key cannot decrypt the values.

### RadioReference

Preview and apply talkgroup metadata from RadioReference. This lets you pull talkgroup names, groups, and tags from RadioReference data and merge them into your system.

### API Docs

Opens the Swagger API documentation at `/api/v1/admin/docs`. Squelch issues a short-lived session for it when you click through, so the browser can authenticate to the docs UI.

---
