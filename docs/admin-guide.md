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
- [Folder monitors](#folder-monitors)
- [Forwarding](#forwarding)
- [Shared Links](#shared-links)
- [Transcription](#transcription)
- [Settings](#settings)
- [Logs & audit](#logs--audit)
- [Tools](#tools)

---

## Navigation

The sidebar groups the admin into five areas:

- **Overview** — stats and recent activity
- **People & access** — **Users** and **Connections**
- **Radio data** — **Systems**, **Groups & tags** and **API keys**
- **Ingest & delivery** — **Folder monitors**, **Forwarding**, **Shared links** and **Transcription**
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

The Trunk Recorder integration is opt-in. Enable it under **Settings → Integrations → Trunk Recorder MQTT**, then add one instance row per trunk-recorder under **Trunk Recorder → Instances**.

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

After three failed sign-ins an address is locked out for ten minutes (both numbers are set under **Settings → Access & security**). While any address is locked out or counting failures, a **Sign-in lockouts** card appears under the table; **Clear** lets that address try again at once.

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

Choose a time range and a connection type, and page through with **Previous** and **Next**. History is kept for 30 days by default; change it with **Keep Connection History** under [Settings → Storage](#storage). Setting it to 0 stops recording and leaves the tab empty.

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

A system is one radio system: a county trunked system, a set of conventional channels, an SDRTrunk source. Each system owns its **talkgroups** and **units**. The page lists your systems on the left (on a phone, the list comes first and a system opens over it) with an LED swatch, whether talkgroups are created automatically (**auto**) or only by you (**manual**), how many talkgroups it has and its calls in the last 24 hours. Choosing a system shows its talkgroups, units and blocked list on the right.

Most systems appear on their own the first time a recorder uploads to them, when **Settings → Radio data → Create systems from uploads** allows it. **Add system** is for setting one up before the first call arrives. **Reorder** moves systems up and down the scanner's display order.

### System settings

- **System number** — must match what your recorder sends. Changing it stops uploads that still use the old number; the field warns you when you do.
- **Label** — shown on the scanner display and in the admin.
- **LED colour** — lights when a call on this system plays; talkgroups without their own colour use it.
- **Auto-populate talkgroups** — unknown talkgroups on this system are created from uploads, unlabeled, so you can name them later. With it off, calls for unknown talkgroups are dropped.
- **Delete system** — removes the system, its talkgroups and its units; you type the label to confirm. Calls stay and show their numbers only.

### Talkgroups

The table shows each talkgroup's number, label and name, group, tag, calls in the last 24 hours and when it was last heard. Search matches numbers, labels, names, groups and tags; the group and tag menus narrow the list, and the **N unlabeled** button shows only the talkgroups auto-populate created that nobody has named yet. A **blocked** marker means uploads for that number are dropped.

Opening a talkgroup shows its activity (calls in 24 hours, last heard, average call length) with the fields below it to edit in place:

| Field            | Description                                      |
| ---------------- | ------------------------------------------------ |
| Talkgroup number | Decimal ID matching your recorder output         |
| Label            | Short display label (e.g. "FD Dispatch")         |
| Name             | Longer descriptive name                          |
| Group            | Category (from Groups & Tags)                    |
| Tag              | Classification tag (from Groups & Tags)          |
| LED colour       | Overrides the system's colour for this talkgroup |
| Frequency        | Optional, in MHz                                 |

Under **More**, **Listen to recent calls** opens the scanner's search on that talkgroup, **Block from uploads** drops future calls on it, and **Delete talkgroup** removes it (its calls stay, labelled by number). **Add talkgroup** has **Save and add another**, which keeps the group, tag and colour for the next one.

Ticking rows shows a selection bar for bulk changes: set the group, tag or LED colour for all of them, block them, or delete them.

#### Import

**Import** on a system takes a CSV in Squelch, rdio-scanner or RadioReference format; the format is detected from the header. Nothing changes until you review the result: the wizard lists what is new, what would change (field by field, now and after) and which rows it could not read. **Fill in blanks only** sets only fields that are empty today; **Overwrite** replaces label, name, group and tag with the file's values. Untick any talkgroup you want left alone, then **Apply**. Groups and tags named in the file are created if they do not exist. **Export** downloads the system's talkgroups as CSV.

### Units

Units name individual radios. Each has a **Unit number**, a **Label** and when it was last heard. Search by number or label; open one to rename or delete it.

### Blocked

Talkgroup numbers whose uploads are dropped before they are stored, for talkgroups auto-populate keeps creating that you never want. Add a number to block it; the ✕ on a chip unblocks it. Blocking keeps the talkgroup and its calls; delete them separately if you want them gone.

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

## Folder monitors

Folder monitors watch a folder on the server and import the recordings a recorder writes into it, so a recorder on the same machine (or a mounted share) needs no upload at all.

The list shows each monitor's folder and recorder type, its **runtime state**, where its calls go, the last file it saw and how many calls it made in the last 24 hours. The state is one of **watching** (kernel file events), **polling** (scanning on a timer), **stopped** (with the reason on the row, e.g. the folder is gone or cannot be read) or **disabled**. A running monitor that hit a read error keeps its state and shows the error beside it. Search by folder, recorder or destination, and filter to **Running**, **Stopped** or **Disabled**.

The **›** button opens the monitor's details: its settings in plain words, when the current state began, the last file and what came of it ("became call 44 on system 101, talkgroup 5200", "skipped: the audio file is too small to be a call", "could not be read: …"), a **Restart** button for a stopped monitor whose folder has come back, a link to that monitor's log lines, **Edit**, **Disable** or **Enable**, and **Delete**. Every change is written to the audit log.

### Adding a monitor

The form shows only the fields the chosen **recorder** needs:

| Recorder             | What the monitor reads                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| Trunk Recorder       | The JSON file written next to each recording                                            |
| SDRTrunk             | The tags inside its MP3 files                                                           |
| DSD+ Fast Lane       | The system and talkgroup in the filename                                                |
| ProScan              | The ProScan filename, plus a mask for anything it lacks                                 |
| RTLSDR-Airband       | Conventional recordings; the system and frequency come from the monitor                 |
| Other (filename mask) | Any recorder; a mask says which parts of the filename are the date, system and talkgroup |

Every monitor has a **folder** (an absolute path on the server; **Browse** walks the server's folders inside the panel), an optional file **extension** filter, a **wait before ingest** in seconds, and three switches: **Poll instead of watching** for network shares (NFS, CIFS/SMB) and other mounts that do not report new files, **Delete the file after import** (Squelch keeps its own copy), and **Enabled**.

The wait means two things: when watching, how long a file must sit unchanged before it is read, so the recorder can finish writing (at least 2 seconds); when polling, how often the folder is scanned (at least half a second).

Recorders that do not name the system in their files can **send every call to** a fixed system and, optionally, talkgroup. Others read it from the files.

### Filename masks

A mask says which parts of the filename carry the call's details. Tokens stand for the parts that vary; everything else must match exactly. Type a real filename into **Try it on a filename** and the form shows what the mask reads from it as you type.

| Token                            | Meaning                                              |
| -------------------------------- | ---------------------------------------------------- |
| `#DATE`                          | date: `20201231`, `2020-12-31` or `2020_12_31`       |
| `#TIME`, `#ZTIME`                | local or UTC time: `085430`, `08-54-30` or `08:54:30` |
| `#SYS`, `#SYSLBL`                | system id or label                                   |
| `#TG`, `#TGLBL`, `#TGAFS`        | talkgroup id, label, or id in AFS form (`11-061`)    |
| `#HZ`, `#KHZ`, `#MHZ`            | frequency                                            |
| `#TGHZ`, `#TGKHZ`, `#TGMHZ`      | frequency used as the talkgroup id                   |
| `#GROUP`, `#TAG`, `#UNIT`        | group label, tag label, unit id                      |

Example: `2025-01-15_143022_101_5200.wav` with the mask `#DATE_#TIME_#SYS_#TG` gives the date, the time, system 101 and talkgroup 5200.

---

## Forwarding

**Forwarding** is where a copy of each new call goes once Squelch has accepted it. It has two tabs: **Downstreams**, other Squelch servers that receive the call and its audio, and **Webhooks**, URLs that receive a message about the call. Both are listed the same way: a label, the address, a status badge (**ok**, **failing** with the reason, **nothing sent yet** or **disabled**), the systems they get, when the last delivery happened and how many failed in the last 24 hours. Search by label, address or system, and filter to **Active**, **Failing** or **Disabled**.

The **›** button opens a target's details: the delivery facts, a **Send a test** button that posts a test message and shows what the other end answered right there, **Edit**, **Disable** or **Enable**, and **Delete**. Every change and every test is written to the audit log with the target's label.

### Downstreams

A downstream is another Squelch server. Use it to fan out from a central server to regional or public-facing ones. Each downstream has a **label**, the other server's **base address** (calls are uploaded to its `/api/v1/calls` endpoint), an **API key** created on that server, an optional list of **systems** to forward (none means all), and an **Enabled** switch. Deliveries are retried three times with increasing waits before a call is dropped for that downstream; the last failure is shown on the row.

Downstream API keys are encrypted at rest when an [encryption key](deployment-guide.md#keeping-secrets-safe) is configured. The key is never shown again after you save it; to change it, enter a new one in the edit form, or leave the field blank to keep the current key. **Send a test** checks that the other server is reachable and accepts the key without uploading a call.

### Webhooks

A webhook posts a message to a URL for every accepted call. Each one has a **label**, a **type**, the **URL**, an optional list of **systems** (none means all) and an **Enabled** switch.

- **Generic JSON** sends Squelch's own payload: a `call` event with the call's id, time, frequency, length, source unit and its system and talkgroup labels. The details panel shows the exact headers and body under **What your service receives**. When a **secret** is set, every post carries an `X-Squelch-Signature: sha256=…` header holding the HMAC-SHA256 of the body under that secret, so your service can check the post came from Squelch. The secret is stored encrypted, never shown again and never sent to the browser; leave the field blank while editing to keep it, or tick **Remove the secret** to send unsigned posts.
- **Discord** posts an embed to a Discord channel's webhook URL, with the talkgroup, system, length and unit.

**Send a test** posts a test message (event `test`) so you can confirm the target accepts it before any call is sent. Failed deliveries are retried three times, then dropped and logged.

---

## Shared Links

Lists every call a listener has shared by link, newest first: the talkgroup and system, when the call was recorded and how long it is, who shared it and when, how many times the public page has been opened, and when the link expires. Expired links are dimmed and labelled. Search by talkgroup, system or user, and filter to **Active** or **Expired**.

The **›** button opens a link's details with **Copy link**, **Open shared page** (plays the call the way a visitor sees it) and **Revoke**. Revoking asks first and offers a ten-second **Undo** that puts the link back with the same address. Tick rows to revoke several at once, or use **Revoke N expired links** in the header to clear the ones that no longer work.

Revoking a link makes the call eligible for normal pruning again. Whether links can be created and how long they last are set in **Settings → Sharing**.

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

Server-wide options, in named groups on one page. A **Find a setting** box narrows the page to the rows that mention what you type, and the group names under the title jump to each group. Nothing applies until you press **Save changes** in the bar at the bottom, which lists what you changed; **Discard** puts everything back. The one exception is the **Log level**, which applies the moment you pick it and says so. A changed row carries a **Changed** badge until it is saved, and leaving the page with unsaved changes asks first.

Rows that depend on another are indented under it and greyed out while the parent is off: the duplicate window under **Reject duplicate calls**, the encoding under **Convert audio on upload**, the expiry under **Let listeners share calls**.

### General

| Setting | Description | Default |
| --- | --- | --- |
| Instance name | Short text shown above the scanner and in the browser tab (up to 64 characters) | (empty) |
| Support email | Contact address shown on the sign-in page and in error messages; a plain address, or empty | (empty) |

### Scanner

Defaults for every listener. Each listener can override the ones marked **per user** from the scanner's ⋮ menu.

| Setting | Description | Default |
| --- | --- | --- |
| 12-hour clock | Show AM/PM times everywhere, including the admin | Off |
| Show listener count | The live listener number on the scanner display | Off |
| Keypad beeps (per user) | The default sound set for the keypad: **Uniden**, **Whistler** or **Off**. A signed-in listener's own choice follows their account; an anonymous listener's stays in that browser | Uniden |

### Radio data

| Setting | Description | Default |
| --- | --- | --- |
| Create systems from uploads | An upload naming a system number that does not exist creates it, with talkgroup auto-create on. Off rejects such uploads. Each system's own talkgroup auto-create is under [Systems](#systems) | On |

### Ingest & audio

| Setting | Description | Default |
| --- | --- | --- |
| Default upload rate limit | Calls a minute an API key may upload unless the key sets its own (1 to 600) | 60 |
| Reject duplicate calls | Another call on the same system and talkgroup within the window below is turned away | On |
| Duplicate window | How close, in milliseconds, two calls must be to count as duplicates | 500 |
| Convert audio on upload | **Keep the original**, **Convert only**, **Convert and normalise peaks**, or **Convert and normalise loudness**. Needs FFmpeg on the server; without it the row is greyed out | Keep the original |
| Encoding | Codec and bitrate for converted audio (see below) | MP3 · 32 kbps |

#### Encoding presets

| Preset         | Description                           |
| -------------- | ------------------------------------- |
| MP3 32 kbps    | **Default** — good balance of size and quality |
| MP3 24 kbps    | Lower bitrate MP3                     |
| MP3 16 kbps    | Smallest MP3                          |
| AAC-LC 32 kbps | Better quality than MP3 at the same bitrate |
| AAC-LC 24 kbps | Lower bitrate AAC                     |
| AAC-LC 16 kbps | Smallest AAC-LC                       |
| HE-AAC 12 kbps | High-efficiency AAC, very small files; needs libfdk_aac in FFmpeg |
| HE-AAC 8 kbps  | Smallest possible, lowest quality; needs libfdk_aac in FFmpeg |

### Storage

The group heading shows how much the recordings take and how many files there are, the size of the volume they sit on and its free space, the size of the database, and the oldest call. The recordings figure is measured in the background and refreshed every ten minutes.

| Setting | Description | Default |
| --- | --- | --- |
| Delete calls older than | Calls and their audio past this many days are removed. 0 keeps everything. Calls with a live shared link are kept until the link expires | 7 |
| Keep connection history | How long **Connections → History** remembers who connected. 0 stops recording; older rows are removed once an hour | 30 |

### Sharing

| Setting | Description | Default |
| --- | --- | --- |
| Let listeners share calls | Adds a **Share** button to the scanner; the links work without signing in | Off |
| Links expire after | Days until a shared link stops working. 0 means never | 0 |

### Access & security

| Setting | Description | Default |
| --- | --- | --- |
| Public listening | Anyone with the address can listen without an account. Admin pages always need a sign-in | Off |
| Listener limit | Most live connections at once across everyone. 0 means no limit | 200 |
| Lock out sign-in after | Failed sign-ins from one address before it must wait (1 to 20). Applies at once | 3 |
| Lockout lasts | Minutes a locked-out address waits (1 to 1440). **Users → Sign-in lockouts** can clear one early | 10 |
| Trusted addresses | Read-only: the addresses the server was started with (`--trusted-addresses` or `SQUELCH_TRUSTED_ADDRESSES`) that can never be blocked from Connections | none |

### Integrations

| Setting | Description | Default |
| --- | --- | --- |
| Trunk Recorder MQTT | Subscribe to trunk-recorder's MQTT status plugin and enable the **Trunk Recorder** page, where the brokers are configured | Off |

**Transcription** has its own page; the group links to it.

### Logging

| Setting | Description | Default |
| --- | --- | --- |
| Log level | How much the server logs: **Info**, **Debug**, **Warn** or **Error**. Applies at once, without Save or a restart; Debug is noisy | Info |
| Keep the audit trail for | Days the sign-ins and admin changes on **Logs & audit** are kept before they are pruned (1 to 3650) | 90 |

---

## Logs & audit

Two tabs: the **Server log**, what the server is doing right now, and the **Audit trail**, who changed what.

Both are tables you can search, with **Range** chips (last hour, 24 h, 7 days, all) that apply at once, a choice of how many lines to load (200 to 5,000), **Refresh**, and **Download**, which saves what is loaded as a text file. **Following** reloads every 5 seconds and after new calls; it pauses while you have scrolled down into older lines or have a line open, and resumes when you come back up.

### Server log

The server keeps its recent log lines in memory. Each row shows the time (the full date on hover), the level as text, and the message with a few short chips for its attributes, for example `call=1234 sys=7 tg=5200` for an ingested call or `try=3 error=…` for a failed delivery. HTTP requests show the method, path, status and latency. **Level** chips filter the list and show how many lines each level has.

The **›** button opens a line in the side panel: every attribute, the raw JSON with a **Copy** button, **Newer** and **Older** to step through the list, **Show similar lines** to search for the same message, and a link to the page the line is about (a folder monitor, a forwarding target, a user, an API key, and so on).

How much the server logs is set under **Settings → Logging**; the log level applies at once, without a restart.

### Audit trail

Sign-ins and failed sign-ins, lockouts, every admin change (users, systems, groups and tags, API keys, forwarding, folder monitors, shared links, settings), address blocks, and delivery failures are written to the database and listed here newest first, with the acting admin named in each line. Opening an event offers **Show similar events** and a link to the page it is about.

Events are kept for **90 days** by default; change **Keep the audit trail for** under **Settings → Logging** to keep them longer or shorter. Older rows are pruned once a day.

---

## Tools

Utilities for bulk data management and maintenance.

### CSV Import

- **Import Talkgroups** — the same reviewed import as **Systems → Import**, for when you want to pick the system here.
- **Import Units** — upload a CSV to bulk-create or update unit records for a system.

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
