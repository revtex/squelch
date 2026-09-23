# Listener Guide

How to use the listening screen — the page you land on at your Squelch server's
address. This guide is for the person listening. For running the server, see the
[Deployment Guide](deployment-guide.md); for the admin dashboard, see the
[Admin Guide](admin-guide.md).

---

## Contents

- [Before You Start](#before-you-start)
- [Signing In](#signing-in)
- [Start Listening](#start-listening)
- [Reading the Display](#reading-the-display)
- [Choosing What You Hear](#choosing-what-you-hear)
- [Playback Controls](#playback-controls)
- [Transcripts](#transcripts)
- [Searching Past Calls](#searching-past-calls)
- [Bookmarks](#bookmarks)
- [Sharing a Call](#sharing-a-call)
- [Making It Yours](#making-it-yours)
- [Listening on a Phone](#listening-on-a-phone)
- [Troubleshooting](#troubleshooting)

---

## Before You Start

You need:

- **The address of a Squelch server** — something like `https://scanner.example.com`
  or `http://192.168.1.50:3022`. Whoever runs the server gives you this.
- **An account**, unless the server allows anonymous listening. If the server
  requires an account and you do not have one, you land on the sign-in page.
- **A current browser** — Chrome, Edge, Firefox or Safari, on desktop or phone.

Nothing to install. Squelch is a web page.

---

## Signing In

1. Open the server's address in your browser.
2. If the listening screen appears, the server allows anonymous listening and you
   are done — though signing in gets you bookmarks and settings that follow you.
3. If a sign-in page appears, enter your username and password and select
   **Sign In**.

You can sign in later without losing your place: select the **⋮** button at the
top right of the listening screen, then **Sign in**.

If the server asks you to change your password on first sign-in, do so — the
account stays locked to that prompt until you do.

---

## Start Listening

Browsers do not allow a page to make noise until you interact with it, so
playback always starts with one press.

1. Select **LIVE**. The button lights up green.
2. The display reads **Tap LIVE to start listening** until it is on; after that
   it waits quietly for the next call.
3. When a call arrives, it plays and the display fills in.

The small round light at the top right of the screen tells you the state at a
glance:

| Light | Meaning |
| --- | --- |
| Dark | LIVE is off — nothing will play |
| Amber, blinking | Paused |
| Bright green | A call is playing |
| Dim green | LIVE is on, waiting for the next call |

A talkgroup can carry its own colour, set by the admin. When one of those is
playing, the light shows that colour instead of green.

---

## Reading the Display

The panel at the top is laid out like a scanner's screen. Top block, left to
right and top to bottom:

- **Clock** — the current time.
- **L:** — how many people are listening right now. Only shown if the admin
  turned it on.
- **Q:** — how many calls are waiting to play after this one. Shows a dash
  while background audio is on, because the server is doing the queueing.
- **System name**, and the talkgroup's **tag** in a filled chip.
- **Group · Talkgroup label**, and the time the call started.
- **Talkgroup name**, large. Long names shrink to fit rather than wrapping.

Below the block:

- **Frequency** in MHz, and **TGID** — the talkgroup's number.
- The **☆** and **share** marks, and **UID** — the radio that transmitted.
- **E:** and **S:** — decode errors and signal spikes reported by the recorder.
  High numbers mean a weak or noisy signal.
- **Elapsed / total** time of the call, on the right.
- **HOLD**, **AVOID** and **PATCH** appear as outlined badges when they apply.

The panel keeps one height whether a call is playing, idle, or has a transcript
underneath, so nothing on the page jumps as calls arrive.

---

## Choosing What You Hear

### Pick talkgroups with SELECT

1. Select **SELECT**.
2. Choose a tab — **Groups**, **Tags** or **Systems** — depending on how you
   want to slice the list.
3. Turn individual talkgroups on or off with their switches.
4. Use **All Talkgroups** at the top to turn everything on, or **Turn all off**
   to clear the list and start from nothing.
5. Select **Close**.

Signed in, your choice is saved to your account, so it is the same the next time
you sign in, on any device. Without an account it is kept in that browser.

### Mute a talkgroup for a while with AVOID

AVOID silences a talkgroup without removing it from your selection — for a
talkgroup that is busy right now but that you still want back later.

1. While a call from that talkgroup is playing, select **AVOID**.
2. Choose **30 minutes**, **60 minutes**, **120 minutes** or **Permanent**.

To see what you have avoided, or to bring one back early:

1. Select **SELECT**, then the **Avoids** tab. The number beside the tab is how
   many timed avoids are running.
2. Each row shows the talkgroup and the time left, counting down.
3. Select **Resume** to put it back on the air immediately.

A **permanent** avoid has no clock to show, so it is not listed on that tab.
Turn it back on from the talkgroup itself under Groups, Tags or Systems.

### Stay on one conversation with HOLD

1. While a call is playing, select **HOLD**.
2. Choose **Hold System** to hear only that system, or **Hold Talkgroup** to
   hear only that talkgroup.
3. Everything else is skipped until you choose **Release System** or
   **Release Talkgroup** from the same menu.

HOLD lasts only as long as the page is open — it is not saved to your account.

---

## Playback Controls

Under the display:

- **Replay** (↺) — plays the last call again, including after it has finished.
- **Play / pause** (the large round button) — pauses playback; calls continue to
  queue while paused.
- **Skip** (⏭) — abandons the current call and moves to the next in the queue.
- **Speaker** — mutes and unmutes. The slider beside it sets the volume on
  desktop.

Under the mode buttons, **RECENT** lists the last few calls, one per line. Select
any row to play it again. A talkgroup's colour shows as a stripe down its left
edge, and the row currently playing is marked.

---

## Transcripts

If the admin has enabled transcription, spoken words appear under the display as
the call plays.

- The header shows **TRANSCRIPT** and how many lines or speakers there are.
- The strip above the text is the call's timeline: the filled part is what you
  have already heard.
- The text follows along in a three-line window. Scroll it with the wheel or a
  finger to read back.
- Select the header to collapse or expand the panel.

Transcripts are produced by a speech service and are not perfect. Treat them as a
guide to the audio, not a record of it.

---

## Searching Past Calls

1. Select **SEARCH**.
2. Narrow the list with any combination of:
   - **Transcript** — words spoken in the call, if transcription is on.
   - **System**, **Talkgroup**, **Group**, **Tag** — each with its own search
     box for long lists.
   - **Date range** — a start and end date.
   - **Sort** — **Newest first** or **Oldest first**.
   - **Bookmarked only** — just the calls you have starred.
3. Select **Reset filters** to clear everything and start again.

Each result offers **play**, **download**, and — when signed in — a star to
bookmark it and a share mark. Results are paged; use **Prev** and **Next** at the
top.

---

## Bookmarks

Bookmarks are saved to your account, so they need you to be signed in.

- **Add one:** select the **☆** on the display while a call is playing, or the
  star on any search result. A filled star means it is saved.
- **Open the list:** select **⋮**, then **Bookmarks**.
- From the list you can **play** a call, **download** its audio, or select the
  filled star to remove it.

---

## Sharing a Call

Sharing has to be turned on by the admin; where it is off, the share mark does
not appear.

1. Select the **share** mark on the display, or on a search or bookmark row.
2. A box opens with the link. Select **Copy** to put it on your clipboard, or
   **Open** to view the page yourself.
3. Send the link to anyone. It opens a page with that one call, playable without
   an account.

Shared links can be set to expire. Ask your admin how long yours last.

---

## Making It Yours

Select **⋮** at the top right.

### Theme

Seven dark themes, all built from the same palette: **Squelch classic** (the
default — the pale green readout), **Midnight**, **Graphite**, **Ember**,
**Moss**, **Plum** and **Ash**. Each row previews its colours. The choice applies
to every page, admin included, and is remembered in that browser.

### Display brightness

Dims or brightens the readout panel alone, for a dark room. It does not change
the rest of the page.

### Keypad beeps

The sound the buttons make: **Off**, **Uniden** or **Whistler**. Picking one
plays it, so you can hear the difference before you settle. Signed in, the choice
is saved to your account and follows you to any browser you sign in on; without
an account it stays in that browser.

The rest of the menu holds **About** (version and support contact),
**Change Password**, **Sign Out**, and **Admin Panel** for administrators.

---

## Listening on a Phone

Everything above works on a phone, with one addition.

A phone suspends a web page when you lock the screen or switch apps, which stops
playback. **BKGND** avoids that: the server sends one continuous audio stream so
the sound keeps going.

1. Select **BKGND**, beside LIVE. They are two ways of listening — choosing one
   releases the other.
2. Lock the screen or switch apps. Audio continues, and the lock screen shows
   the talkgroup that is playing.

While BKGND is on:

- **Pause**, **Skip**, **Replay** and **HOLD** are greyed out — the server is
  driving playback, and those act on this tab's player.
- **Q:** shows a dash, because the server owns the queue.
- The call list and transcripts catch up when you come back to the page.

BKGND appears on phones and tablets only. A desktop browser keeps playing a
background tab on its own, so the control is not needed there.

---

## Troubleshooting

**Nothing plays, and the light is dark.**
LIVE is off. Select **LIVE**. Browsers require that press before a page may make
sound.

**LIVE is on but nothing ever arrives.**
Check **SELECT** — if everything is switched off, nothing can reach you. Then
check **SELECT → Avoids** for a talkgroup you muted and forgot. Also confirm with
your admin that calls are actually being uploaded.

**One talkgroup never plays.**
It is avoided, or it is switched off in your selection, or HOLD is keeping you on
something else. Check in that order.

**Audio stops when I lock my phone.**
Use **BKGND** rather than LIVE. See [Listening on a Phone](#listening-on-a-phone).

**The page looks wrong, or a fix I was told about is missing.**
Reload the page. Browsers cache the app, and a reload picks up the current
version. On desktop, Ctrl+Shift+R (Cmd+Shift+R on a Mac) forces it.

**I cannot see bookmarks, sharing, or the admin panel.**
Bookmarks and sharing need you to be signed in, sharing also needs the admin to
enable it, and the admin panel needs an administrator account.
