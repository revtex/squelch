# Admin Guide

_Squelch was previously named OpenScanner._

This guide covers every panel in the Squelch admin dashboard — what each setting does, how panels work, and how to configure your system.

The admin dashboard is at `/admin` and requires signing in with an admin account.

## Contents

- [Navigation](#navigation)
- [Overview](#overview)
- [Trunk Recorder](#trunk-recorder)
- [Users](#users)
- [Connections](#connections)
- [Systems & talkgroups](#systems--talkgroups)
- [Groups & Tags](#groups--tags)
- [API Keys](#api-keys)
- [Folder monitors](#folder-monitors)
- [Forwarding](#forwarding)
- [Shared Links](#shared-links)
- [Transcription](#transcription)
- [Settings](#settings)
- [Logs & audit](#logs--audit)
- [Backup & import](#backup--import)

---

## Navigation

The sidebar groups the admin into five areas:

- **Overview** — **Overview**, **Trunk Recorder** and **Logs & audit**
- **People & access** — **Users**, **Connections**, **API keys** and **Shared links**
- **Radio data** — **Systems & talkgroups**, **Groups & tags** and **Transcription**
- **Ingest & delivery** — **Folder monitors** and **Forwarding**
- **Server** — **Settings** and **Backup & import**

The search field in the top bar (or **Ctrl K**) opens a search box. Type a few letters to jump to any page, or straight to a user, talkgroup, API key, setting, folder monitor or downstream server; choosing one opens its details (a setting opens **Settings** filtered to it). The top bar also shows whether the admin's live connection to the server is up: **Live**, **Reconnecting…** or **Offline**. While it is reconnecting, lists stop updating until it is back. On a wide window it also says how long ago the last call came in.

Some sidebar items carry a count. **Overview** shows how many problems need attention, amber or red by the worst one. **Users**, **Connections** and **API keys** show how many there are (live connections for Connections). **Folder monitors** shows how many have stopped, and **Forwarding** how many targets are failing. A count only appears when it is above zero.

On a phone the sidebar becomes a bar along the bottom with **Overview**, **Users**, **Systems** and **Logs**; **More**, or the menu button at the top left, lists every section. On a narrow desktop window the sidebar shrinks to icons with short labels.

**Open scanner** at the foot of the sidebar returns you to the live scanner at `/`. **Sign out**, beside your username, clears your session. If you have unsaved changes in a panel, you'll be prompted before navigating away.

---

## Overview

**Overview** is the admin's landing page. It answers three questions in order: does anything need you, is ingest healthy, and how busy has it been.

**Needs attention** lists problems worst first. Each row says what is wrong and has a button that opens the place to fix it. A row clears by itself once the problem is gone, and the card reads "Nothing needs you right now." when the list is empty. It watches for:

- a folder monitor that has stopped or is reporting errors
- the recordings disk under 10% free (red under 5%)
- a downstream server or webhook whose recent deliveries are failing
- a Trunk Recorder instance whose broker will not connect
- transcriptions that failed in the last 24 hours, or a queue of 25 calls or more
- uploads still arriving on the deprecated `/api/*` surface, one row per API key, with a button that opens the key
- users who still have to change a temporary password

**Service health** is a row of pills for Ingest, Listeners, Trunk Recorder, Transcription, Forwarding and Storage. Green is healthy, amber wants a look and grey means the feature is off. Ingest turns amber when no call has arrived for 30 minutes; the time comes from the last call's own timestamp. Transcription turns amber on any failure in the last 24 hours or a long queue.

Five tiles follow. Each opens the page behind it.

- **Calls today** — calls since midnight, with the change against the same time yesterday
- **This week** — calls over the last 7 days and the average per day
- **Listeners now** — live scanner connections; admins are not counted
- **Transcribed 24 h** — calls transcribed in the last 24 hours and the queue. It can include older calls that were retried or caught up
- **Uptime** — how long the server has run, its version and when it last restarted

The **24 h**, **7 d** and **30 d** chips at the top choose the range for the calls chart and **Busiest talkgroups**. The choice stays in the page's link. The chart shows calls per hour, or per day over 30 days, and marks the peak. Choose a talkgroup to open it in **Systems & talkgroups**. **Recent admin activity** shows the last four lines of the audit log; **Audit log** opens the rest.

---

## Trunk Recorder

If you run [trunk-recorder](https://github.com/robotastic/trunk-recorder) with the [MQTT status plugin](https://github.com/taclane/trunk-recorder-mqtt-status), Squelch can subscribe to its broker and show what the recorder is doing: control-channel decode rate, recorders, calls in progress, unit affiliations and the trunking messages themselves.

The integration is off by default. Turn it on under **Settings → Integrations → Trunk Recorder MQTT** (the page links there while it is off), then **Add instance** for each trunk-recorder: a label, the `instance_id` from its config, the broker URL and base topic, and credentials if the broker needs them. The units and messages topics follow from the base topic unless you change them.

The page shows one instance at a time; the selector in the header switches between them and the choice stays in the link. A banner says whether Squelch is connected to the broker, whether the plugin has reported in, and how long ago the last frame arrived; when the connection fails it says why. **Instance settings** opens the broker settings beside the page, with **Test broker** (the result shows there, in words) and **Reconnect**, and **Remove instance** after asking. Four tiles follow: systems, recorders recording out of the total, calls in progress with how many are encrypted, and the decode rate with its range over the last five minutes.

| Tab           | Shows                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard** | Two cards, side by side on a wide window and stacked on a narrower one: the decode-rate chart for the last five minutes, and one row per system with its rate, control channel, P25 identifiers (written as RadioReference does, `sysid 2EE`) and health: **ok** while it decodes, **not decoding** at zero, **waiting** before the first rate frame, **no recent rate** when rate frames stop for 30 seconds, and **no feed** while the broker is disconnected. |
| **Calls**     | Calls in progress, or the ones that started and ended since the page opened. Sortable, with an **Export CSV** button.                        |
| **Recorders** | Every recorder with its state, frequency and call count, so a stuck one stands out. Sortable, with **Export CSV**.                          |
| **Units**     | Affiliations, calls and data events as radios key up. Search by unit, talkgroup or system; **Hold** freezes the list and counts what arrives.|
| **Messages**  | Control-channel messages counted by opcode, or the live feed with **Pause** and a count of new messages waiting.                            |
| **Config**    | The recorder's own settings and SDR sources as the plugin published them on connect, with the raw JSON underneath.                          |

Every table stacks into cards on a phone. A page opened while the recorder is already running starts from what the server has held in memory, so the chart and tables are not empty until the next frame.

> Audio is **not** consumed over MQTT — calls keep flowing through your existing folder monitor or `/api/v1/calls` upload pipeline. The MQTT feed only powers this page.

See the [Trunk Recorder MQTT guide](tr-mqtt-guide.md) for the plugin config, multi-recorder layouts and the bundled mosquitto compose profile (`docker compose --profile mqtt up -d`).

---

## Users

Who can sign in, what they can hear, and where they are signed in.

The table shows each account's name with an **admin** badge for admins, its status, the systems it can hear, its **Sessions** (connections open right now and browsers or phones that can sign back in without a password) and its last sign-in with the address. A grey line under the name says when an account is the primary admin, when it expires and whether it has a connection limit. Search by name, role or system, and use the chips to show only admins, temporary-password, expired or disabled accounts. Tick rows to sign out, disable or delete several accounts at once.

Choose **Add user** to create an account. You set a temporary password (or **Generate** one) and hand it to the user; by default they must pick their own password the first time they sign in. Turn **Require a new password at first sign-in** off if the user chose the password themselves.

Choose the **›** button on a row for the account's details. They list its role, systems, expiry, connection limit, devices and last sign-in. **Live now** lists the account's open connections, each with **Open** to see it under **Connections**, and **See devices** lists the browsers and phones that can sign back in. The actions are:

| Action | What it does |
| --- | --- |
| Edit details | Change the name, role, systems, expiry date and connection limit. |
| Reset password | Set a new temporary password for someone who lost theirs. By default they must change it at their next sign-in and are signed out everywhere, so anyone holding the old password is out. |
| Require password change | A switch. On, the user is asked for a new password the next time they sign in. Accounts with it on show a **temporary password** badge in the table. |
| Sign out everywhere | Every device needs the password again. Use it if you think someone else has the account. |
| Disable account / Enable account | Disabling keeps the account but refuses sign-in and signs it out everywhere. Nothing is deleted. |
| Delete user | Removes the account, its devices and its bookmarks for good. Calls and recordings are not affected. |

Each account has:

| Field            | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| Username         | Login name                                                      |
| Role             | **Admin** (full access) or **Listener** (scanner only)          |
| Expires          | Optional date after which the account is locked out             |
| Connection limit | Optional cap on simultaneous connections for this user          |
| Systems          | **All systems**, which includes systems added later, or only the ones you pick |

The primary admin (the first account) cannot be disabled or deleted, and its role, expiry, limit and systems are fixed. You cannot disable or delete your own account.

### Sign-in lockouts

After three failed sign-ins an address is locked out for ten minutes (both numbers are set under **Settings → Access & security**). While any address is locked out or counting failures, a **Sign-in lockouts** card appears under the table; **Clear** lets that address try again at once.

---

## Connections

See who is using the server right now, which devices can sign back in, who has connected recently, and which addresses are blocked. The tabs show how many connections, devices and blocks there are. On the first three tabs each row shows:

- **Who** — the user name, or **Public listener**, with the browser and system under it, such as **Chrome 129 · Windows** or **Squelch app · Android**. Hover over it to see the full browser identification.
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

**Disconnect** is on **Live** only. **Sign out this device** needs a signed-in device, so it is missing for public listeners. **Block this address** is missing on rows marked **trusted**, because those addresses can never be blocked, and the details say so. From **History** you can sign out a device or an account that is not connected right now; if it has already been signed out, you are told so.

Your own admin connection is marked **you**, and the device you are using is marked **this device**. Signing it out takes you to the sign-in page.

### Live

Every open connection, with how long it has been up. Visitors who have not signed in (with **Public Access** on) show as **Public listener**. The list updates on its own as people come and go. Use the filter box to narrow it by user name, address or country.

### Signed-in devices

Every sign-in that can still renew itself without a password: each browser or phone that signed in and has not signed out, been signed out, or gone 30 days without using the server. A browser that signed in without **Remember me** forgets its sign-in when it closes, but stays listed here until that 30 days runs out. **Last seen from** is where it last renewed its sign-in from — within the last 15 minutes if it is in use. **online** means it has at least one connection open right now.

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

Pick a time range (**24 h**, **7 days**, **30 days** or **Everything kept**) and a connection type with the chips, and page through with **Previous** and **Next**. History is kept for 30 days by default; change it with **Keep Connection History** under [Settings → Storage](#storage). Setting it to 0 stops recording and leaves the tab empty.

### Blocked addresses

A blocked address cannot reach Squelch at all. It is refused for listening, for the admin dashboard, and for uploads from recorders. Anyone connected from it is dropped as soon as you add the block.

To block an address, choose **Block this address** in a row's details, or **Block an address** on this tab. Enter an address such as `203.0.113.9` or a range such as `203.0.113.0/24`, and optionally a reason. Then choose how long the block lasts: 1 hour, 24 hours, 7 days, or until you remove it. **Remove** asks first, then lifts the block straight away.

Some blocks are refused:

- **Too wide.** The widest block allowed is `/16` for IPv4 or `/48` for IPv6. Block anything wider at your firewall or reverse proxy.
- **A range written with host bits.** For example, `192.168.1.5/24` is refused, and the message gives the range you probably meant, `192.168.1.0/24`.
- **Loopback, or a range that overlaps the Never blocked list.**
- **Your own address.** If the range includes the address you are connected from, the block form warns you and the button changes to **Block anyway**. Blocking yourself disconnects this page, and you cannot get back in from that address until the block is removed.

**Never blocked** lists the addresses no block applies to: loopback, plus any addresses set on the server with `--trusted-addresses`. The list cannot be changed from the dashboard, so an admin account alone cannot lock out whoever runs the server. See [Addresses That Can Never Be Blocked](deployment-guide.md#addresses-that-can-never-be-blocked).

A block is only as reliable as the client address Squelch sees. A device that Squelch trusts as a proxy can claim any address and get past a block. Narrow the trusted proxies to your reverse proxy, as described in [Showing the Real Client Address](deployment-guide.md#showing-the-real-client-address).

---

## Systems & talkgroups

A system is one radio system: a county trunked system, a set of conventional channels, an SDRTrunk source. Each system owns its **talkgroups** and **units**. The page lists your systems on the left (on a phone, the list comes first and a system opens over it) with an LED swatch, whether talkgroups are created automatically (**auto**) or only by you (**manual**), how many talkgroups it has and its calls in the last 24 hours. Choosing a system shows its number, how many talkgroups and units it has, its last call and its calls in 24 hours, then its talkgroups, units and blocked talkgroups on the right. A notice above the list says whether new systems are created from uploads, with a link to change it.

Most systems appear on their own the first time a recorder uploads to them, when **Settings → Radio data → Create systems from uploads** allows it. **Add system** is for setting one up before the first call arrives. **Reorder** moves systems up and down the scanner's display order.

### System settings

- **System number** — must match what your recorder sends. Changing it stops uploads that still use the old number; the field warns you when you do.
- **Label** — shown on the scanner display and in the admin.
- **LED colour** — lights when a call on this system plays; talkgroups without their own colour use it.
- **Auto-populate talkgroups** — unknown talkgroups on this system are created from uploads, unlabeled, so you can name them later. With it off, calls for unknown talkgroups are dropped.
- **Delete system** — removes the system, its talkgroups and its units; you type the label to confirm. Calls stay and show their numbers only.

### Talkgroups

The table shows each talkgroup's number, label and name, group, tag, calls in the last 24 hours and when it was last heard. Search matches numbers, labels, names, groups and tags; the group and tag menus narrow the list, and the **N unlabeled** chip shows only the talkgroups auto-populate created that nobody has named yet. An unlabeled talkgroup reads "TG" and its number, with an **unlabeled** badge. A talkgroup with its own LED colour shows it after its name. A **blocked** marker means uploads for that number are dropped.

Opening a talkgroup shows its activity in three tiles (calls in 24 hours, last heard, average length), with the fields below them to edit in place. The LED colour is a row of colour chips, with **System default** first.

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

### Blocked talkgroups

Talkgroup numbers whose uploads are dropped before they are stored, for talkgroups auto-populate keeps creating that you never want. Type a number under the chips and press **Block**; the ✕ on a chip unblocks it. Blocking keeps the talkgroup and its calls; delete them separately if you want them gone.

---

## Groups & Tags

Groups and tags organize your talkgroups into categories.

- **Groups** sort talkgroups in the scanner's picker by function (e.g. Fire, Law, EMS, Public Works)
- **Tags** say what kind of traffic a talkgroup carries (e.g. Law Dispatch, Law Tac, Fire Tac, Emergency Ops)

Both lists are tables edited in place on **Admin → Groups & tags**, each with its count in the header:

- **Add** — type a name in the row at the foot of the table and press **Add**. Names are trimmed and must be unique.
- **Rename** — turns the row into a text field; **Enter** saves, **Esc** cancels.
- **Talkgroups** — how many talkgroups use it; an unused one says **unused**. **Show** opens **Systems** filtered to those talkgroups.
- **Delete** — asks in place. An unused label is removed at once, with a ten-second **Undo** in the toast. A label that talkgroups still use asks where they should go first (another group or tag, or none) and moves them before deleting.

On a phone each row becomes a card, with its actions under it.

Assign groups and tags to talkgroups in the **Systems** panel. Squelch ships with sensible defaults (Air, Common, EMS, Fire, Interop, Law, Public Works for groups; ~20 tags covering law, fire, EMS, corrections, and more).

---

## API Keys

API keys authenticate recorders that upload calls to Squelch over HTTP. **Admin → API keys** lists every key by its label, with its fingerprint and creation date under it, the systems it may upload to (by name), its rate limit, when and from where it was last used, calls uploaded in the last 24 hours and its status. Search by label, fingerprint, system or address, and filter to enabled, disabled, **Legacy uploads** (keys still sending to the deprecated `/api/*` path) or **Never used** keys.

**Create key** asks for:

| Field      | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| Label      | Name the recorder or site, so the audit log reads well. Required.  |
| Systems    | **All systems**, which includes systems added later, or only the ones you pick. |
| Rate limit | Calls a minute this key may upload. Blank uses the server default. |
| Enabled    | Turn off to prepare a key you will switch on later.                |

After you save, the **secret is shown once**, with a copy button, a `curl` test command and a ready-made Trunk-Recorder plugin entry. It cannot be looked up later; rotate the key if it is lost.

The **›** button opens a key's details. The header shows its fingerprint (a short, stable handle that never reveals the secret). The details show where and when it was last used, and its label, systems and rate limit can be changed there and saved with **Save**. The actions are:

- **Copy test command** — a `curl` command that checks the key and the address, with `<secret>` to fill in.
- **Disable key / Enable key** — refuse or accept uploads without deleting the key. A disabled key's uploads get 401.
- **Rotate secret** — issues a new secret. The old one keeps working for 24 hours so the recorder can be updated without a gap; the key shows as **rotating** until then.
- **Delete key** — asks first. Uploads with it fail at once. Calls the key uploaded are kept.

A key that sent requests to the deprecated `/api/*` path in the last 24 hours carries a **legacy** badge beside its call count, and its details explain what to change. Every create, edit, rotate, disable and delete is recorded in **Logs**.

See the [Recorder Guide](recorder-guide.md) for how to configure your recorder with the key.

---

## Folder monitors

Folder monitors watch a folder on the server and import the recordings a recorder writes into it, so a recorder on the same machine (or a mounted share) needs no upload at all.

The list shows each monitor's folder, with its file type and options under it ("*.wav · deletes after import · polling"), its recorder, where it sends calls (**From filename**, or a fixed system and talkgroup), its **runtime state**, when it last saw a file and how many calls it made in the last 24 hours. The state is one of **watching** (kernel file events), **polling** (scanning on a timer), **stopped** (with the reason on the row, e.g. the folder is gone or cannot be read) or **disabled**. A running monitor that hit a read error keeps its state and shows the error beside it. Search by folder, recorder or destination, and filter to **Running**, **Stopped** or **Disabled**.

The **›** button opens the monitor's details. A stopped monitor leads with a red notice giving the last error. Then come its settings in plain words, when the current state began, the last file and what came of it ("became call 44 on system 101, talkgroup 5200", "skipped: the audio file is too small to be a call", "could not be read: …"), a **Restart** button for a stopped monitor whose folder has come back, a link to that monitor's log lines, **Edit**, **Disable** or **Enable**, and **Delete**. Every change is written to the audit log.

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

Recorders that do not name the system in their files can **send every call to** a fixed system and, optionally, talkgroup. Others take it **from the filename** or the files.

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

**Forwarding** is where a copy of each new call goes once Squelch has accepted it. It has two tabs: **Downstream servers**, other Squelch servers that receive the call and its audio, and **Webhooks**, URLs that receive a message about the call. Each tab opens with a line on what it does and its **Add** button. Both are listed the same way: a label with the address under it, the systems they get, a status badge (**delivering** or **sending**, **failing**, **nothing sent yet** or **disabled**), when the last delivery happened, with its time or response code, and how many failed in the last 24 hours, followed by the last error. Search by label, address or system, and filter to **Active**, **Failing** or **Disabled**.

The **›** button opens a target's details. A failing target leads with a red notice giving the last error. Then come the delivery facts, a **Send a test** button that posts a test message and shows what the other end answered right there, **Edit**, **Disable** or **Enable**, and **Delete**. Every change and every test is written to the audit log with the target's label.

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

Each row has **Copy link**, **Listen** (opens the shared page in a new tab, the way a visitor sees it) and **Revoke**. Revoking offers a ten-second **Undo** that puts the link back with the same address. An expired link has **Remove** instead. Tick rows to revoke several at once, or use **Revoke expired** in the header to clear the ones that no longer work.

Revoking a link makes the call eligible for normal pruning again. Whether links can be created and how long they last are set in **Settings → Sharing**.

---

## Transcription

Turns recordings into text with a separate [go-whisper](https://github.com/mutablelogic/go-whisper) sidecar; see the [Deployment Guide](deployment-guide.md#transcription-optional) for running one. Transcripts show under the scanner display and in the call search.

The banner at the top says whether the sidecar answers, its version when it reports one, the model in use and how many workers are running; when it does not answer, it says why in a sentence (nothing listening, name does not resolve, no answer in five seconds). **Test connection** tries it again and writes the result to the audit trail. Four tiles follow: the **queue** (with whether it is growing and roughly how far behind), calls **transcribed in 24 hours** as a share of all calls, the **average time per call** with its range, and **failures in 24 hours** with a link to them.

### Settings

Each setting has its name and help on the left and its control on the right. Everything here is saved together with **Save**; toggles included. The bar at the bottom lists what changed, **Discard** puts it back, and leaving with unsaved changes asks first.

| Setting                         | What it does                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Transcribe new calls            | Off pauses the queue; nothing is lost.                                                                    |
| Show transcripts in the scanner | Listeners see the text under the display while a call plays.                                              |
| go-whisper URL                  | The sidecar's base URL, reachable from the server (default `http://localhost:8081`). **Test** tries it.   |
| Language                        | The language to expect, or auto-detect, which costs a little time per call.                               |
| Speaker turns                   | Splits the text by speaker. Needs a tinydiarize (`tdrz`) model; the switch is off until one is in use.    |
| Skip calls shorter than         | Calls under this length are not sent, saving queue time on key-ups. 0 sends every call.                   |

### Models

Every whisper.cpp model, with its size, relative speed and whether it marks speaker turns, so you can choose before downloading. **Download** starts a download on the sidecar, and the row shows **downloading** with the percentage and a progress bar; it continues if you leave the page, and **Cancel** stops it. **Use** makes a downloaded model the active one. **Delete** removes a model from the sidecar after asking; the model in use cannot be deleted while transcription is on.

### Recent jobs

What happened to each call handed to the transcriber, with the time of the call ("Today 18:52"): **done** with how long it took, **failed** with the reason in words (sidecar timed out, sidecar not reachable, audio file is missing), **skipped** when it was shorter than the minimum, or **queued**. Filter by status; **Retry** sends a failed or skipped call again, and **Retry N calls** does the same for every one in the list. Transcription must be on for a retry. Failed and queued counts cover the last 24 hours; the list keeps 30 days.

---

## Settings

Server-wide options, in named groups on one page. A **Find a setting** box narrows the page to the rows that mention what you type. The group names down the left side jump to each group and mark the one you are reading as you scroll; on a phone they sit in a row under the title. Nothing applies until you press **Save changes** in the bar at the bottom, which lists what you changed; **Discard** puts everything back. The one exception is the **Log level**, which applies the moment you pick it and says so. A changed row carries a **Changed** badge until it is saved, and leaving the page with unsaved changes asks first.

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
| Create systems from uploads | An upload naming a system number that does not exist creates it, with talkgroup auto-create on. Off rejects such uploads. Each system's own talkgroup auto-create is under [Systems & talkgroups](#systems--talkgroups) | On |

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

Both are tables you can search, with **Range** chips (last hour, 24 h, 7 days, all) that apply at once, a choice of how many lines to load (200 to 5,000), and **Download**, which saves what is loaded as a text file. **Following** reloads every 5 seconds and after new calls; it pauses while you have scrolled down into older lines or have a line open, and resumes when you come back up. Press it to stop following, and again to pick up the newest lines.

### Server log

The server keeps its recent log lines in memory. Each row shows the time (the full date on hover), the level as a coloured dot (red error, amber warn, blue info, grey debug), and the message with a few short chips for its attributes, for example `call=1234 sys=7 tg=5200` for an ingested call or `try=3 error=…` for a failed delivery. HTTP requests show the method, path, status and latency. **Level** chips, each with its dot, filter the list and show how many lines each level has.

The **›** button opens a line in the side panel: every attribute, the raw JSON with a **Copy** button, **Newer** and **Older** to step through the list, **Show similar lines** to search for the same message, and a link to the page the line is about (a folder monitor, a forwarding target, a user, an API key, and so on).

How much the server logs is set under **Settings → Logging**; the log level applies at once, without a restart.

### Audit trail

Sign-ins and failed sign-ins, lockouts, every admin change (users, systems, groups and tags, API keys, forwarding, folder monitors, shared links, settings), address blocks, and delivery failures are written to the database and listed here newest first, with the acting admin named in each line. Opening an event offers **Show similar events** and a link to the page it is about.

Events are kept for **90 days** by default; change **Keep the audit trail for** under **Settings → Logging** to keep them longer or shorter. Older rows are pruned once a day.

---

## Backup & import

The whole configuration in and out as one file, radio data in and out as CSV, RadioReference enrichment, and the API docs. Every import shows what it would change before it writes anything.

### Configuration backup

**Download backup** saves systems, talkgroups, units, groups, tags, users and settings as one JSON file, named after the date. Users come without their passwords. API keys (hashed), forwarding keys and webhook secrets are in the file too, so keep it private. If secrets encryption is on, encrypted values keep their `enc::` form and can only be restored on a server with the same `--encryption-key`. The card says when a backup was last downloaded from this server.

**Restore from backup…** is guarded in three steps:

1. **Choose file** — a backup from this page, or from another Squelch.
2. **Review** — a table compares the file with what is live, one row per kind of data: how many are in the file, how many are here now, and the result: *n added* (in the file, not here), *n differ* (in both, different), and what is here but not in the file, with a few names. A kind of data the file does not carry is left alone. Choose **Merge** (add and update, never delete) or **Replace everything** (the tables in the file end up exactly as the file has them; what the file lacks is removed). Settings are only ever added or updated. Your own account and the primary admin are never removed or demoted.
3. **Restore** — type `RESTORE` and confirm. Squelch first saves the current configuration to a `backups/` folder beside the database (`pre-restore-<time>.json`, the ten newest kept), then applies the file in one transaction and tells you where the previous configuration went. Folder monitors, forwarding and transcription pick up the restored settings without a restart.

Rows are matched by what stays the same between two servers, not by database ids: system number, talkgroup number within a system, unit number, label, username, API key, folder, URL. A user the restore adds has no password until an admin sets one under **Users**.

### Radio data

One table with a row for talkgroups, units, groups and tags, each with its count. The picker in the card's header chooses whether talkgroup and unit exports take every system or one.

- **Import** opens the same wizard for every kind: pick the system (talkgroups and units belong to one), choose the CSV, review what is new, what would change field by field and which rows could not be read, untick anything to leave alone, and apply. Talkgroups take Squelch, rdio-scanner and RadioReference files; units take `unit_id, label, order`; groups and tags take one label per row. **Fill in blanks only** and **Overwrite** work as on the Systems page.
- **Export** downloads a CSV of the system chosen in the header, or **Export all** for every system with a leading `system` column that carries the system number. Groups and tags export as one label per row.

### Enrich from RadioReference

Pick a system and **Choose CSV…** to bring labels, names, categories and tags in from a RadioReference talkgroup export. It is the same wizard as Import, opened on that system with the changes-only view.

### API documentation

**Open Swagger UI** issues a short-lived session for the docs and opens them at `/api/v1/admin/docs` in a new tab; the page says so if the session is refused or the tab is blocked. **Copy an access token…** shows your live admin token behind a warning: anyone holding it is you for the next 15 minutes.

---
