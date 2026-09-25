# Recorder Setup Guide

_Squelch was previously named OpenScanner._

This guide walks you through connecting your radio recorder to Squelch. Each recorder section includes the steps you need to get calls flowing.

## Contents

- [Before You Start](#before-you-start)
- [Trunk-Recorder](#trunk-recorder)
- [SDRTrunk](#sdrtrunk)
- [RTLSDR-Airband](#rtlsdr-airband)
- [DSDPlus Fast Lane](#dsdplus-fast-lane)
- [ProScan](#proscan)
- [voxcall](#voxcall)
- [Other Recorders](#other-recorders)
- [Directory Monitor Settings](#directory-monitor-settings)
- [Filename Masks](#filename-masks)
- [Supported Audio Formats](#supported-audio-formats)
- [Helpful Settings](#helpful-settings)

## Before You Start

Before connecting a recorder, make sure:

1. **Squelch is running** and accessible from the machine running your recorder (e.g. `http://192.168.1.100:3022`).
2. **Create your systems** in **Admin → Systems**. There are two auto-populate options to help with initial setup:
   - **Auto-Populate Systems** (global toggle at the top of the Systems panel) — automatically creates new systems from incoming calls.
   - **TG Auto-Populate** (per-system toggle) — automatically creates talkgroups within that system as calls arrive.
3. **Create an API key** if your recorder uploads over HTTP. Go to **Admin → API keys → Add key**, give it a label, and copy the secret (it is shown once, with a test command and a Trunk-Recorder snippet). You can restrict which systems the key is allowed to send calls for.

> **Tip:** If you're migrating from rdio-scanner, Squelch's upload API is backward-compatible. You only need to change the server URL in your recorder config.

---

## Trunk-Recorder

Trunk-Recorder is the most common recorder used with Squelch. You can connect it two ways.

### Option A: HTTP Upload (Recommended)

This uses Trunk-Recorder's built-in `rdioscanner_uploader` plugin to send calls directly to Squelch over the network.

1. Open your Trunk-Recorder `config.json`.
2. In the `"plugins"` array, add an entry using the `librdioscanner_uploader.so` library:
   ```json
   {
     "name": "Squelch",
     "library": "librdioscanner_uploader.so",
     "server": "http://<your-squelch-address>:3022",
     "systems": [
       {
         "shortName": "your_system",
         "apiKey": "your-api-key-here",
         "systemId": 1
       }
     ]
   }
   ```
3. Replace `<your-squelch-address>` with your Squelch server's IP or hostname.
4. The `"name"` field can be anything — it's just a label.
5. Each entry in `"systems"` maps a Trunk-Recorder system (by `shortName`) to a Squelch system:
   - `shortName` — must match the `"shortName"` of a system in your Trunk-Recorder config.
   - `apiKey` — the API key you created in **Admin → API keys**. Multiple systems can share the same key.
   - `systemId` — the radio system ID that identifies this system. This must match the **System ID** field of an existing system in **Admin → Systems**. If **Auto-Populate Systems** is enabled, you can use any number and Squelch will create the system automatically on the first upload.
6. If you have multiple Trunk-Recorder systems (e.g. multi-site), add an entry for each one. They can all use the same API key and even the same `systemId` if they belong to the same logical system.
7. Restart Trunk-Recorder. Calls should start appearing in Squelch within seconds.

### Option B: Directory Monitor

If Trunk-Recorder runs on the same machine as Squelch (or writes to a shared filesystem), you can have Squelch watch the output directory instead.

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **Trunk Recorder**.
3. Set **Directory** to Trunk-Recorder's recording output folder (e.g. `/opt/trunk-recorder/recordings`).
4. Leave **Extension** blank — the monitor picks up audio files automatically.
5. Save and the monitor will begin scanning the directory.

Trunk-Recorder writes a JSON sidecar file alongside each audio recording. Squelch reads the sidecar to extract system, talkgroup, frequency, units, and other metadata.

---

## SDRTrunk

SDRTrunk can send calls to Squelch using its built-in Rdio Scanner streaming feature, or you can use directory monitoring.

### Option A: HTTP Upload (Rdio Scanner Streaming)

1. In SDRTrunk, go to the **Streaming** tab for your system.
2. Add a new **Rdio Scanner** streaming target.
3. Set the **Server URL** to `http://<your-squelch-address>:3022/api/call-upload`.
4. Enter your **API Key** from Squelch.
5. Set the **System ID** to the radio system ID. This must match the **System ID** field of an existing system in **Admin → Systems**. If **Auto-Populate Systems** is enabled, you can use any number and Squelch will create the system automatically on the first upload.
6. Enable the stream. SDRTrunk will upload calls as they are recorded.

> **Note:** SDRTrunk sends a test request when you first connect to verify the API key. Squelch handles this automatically.

### Option B: Directory Monitor

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **SDR Trunk**.
3. Set **Directory** to SDRTrunk's recordings folder.
4. Set **Extension** to `mp3` (recommended).
5. Save the monitor.

Squelch reads metadata from the MP3 file's ID3 tags (which SDRTrunk embeds automatically) and falls back to the filename if tags are missing.

---

## RTLSDR-Airband

> **Note:** RTLSDR-Airband support has not been fully tested. If you run into issues, please [submit a GitHub issue](https://github.com/revtex/squelch/issues).

RTLSDR-Airband is supported through directory monitoring only.

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **RTLSDR-Airband**.
3. Set **Directory** to where RTLSDR-Airband writes its recordings.
4. Set **System ID** to the system in Squelch that these recordings belong to.
5. Set **Talkgroup ID** to the talkgroup to assign (typically one talkgroup per monitored frequency).
6. Optionally set **Frequency** if you want it stored with each call.
7. Save the monitor.

Since RTLSDR-Airband doesn't embed metadata in its recordings, you need to tell Squelch which system and talkgroup to assign by configuring them on the monitor.

---

## DSDPlus Fast Lane

> **Note:** DSDPlus support has not been fully tested. If you run into issues, please [submit a GitHub issue](https://github.com/revtex/squelch/issues).

DSDPlus is supported through directory monitoring only.

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **DSDPlus Fast Lane**.
3. Set **Directory** to the parent folder that contains DSDPlus's date-organized subfolders (e.g. `C:\DSDPlus\recordings`).
4. Set **Extension** to `mp3` or `wav` (whichever DSDPlus outputs).
5. Save the monitor.

Squelch parses system and talkgroup information from the DSDPlus filename structure. You can also set system/talkgroup overrides on the monitor if needed.

---

## ProScan

> **Note:** ProScan support has not been fully tested. If you run into issues, please [submit a GitHub issue](https://github.com/revtex/squelch/issues).

ProScan is supported through directory monitoring only.

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **ProScan**.
3. Set **Directory** to ProScan's recordings folder.
4. Set **Extension** to `wav` (the typical output format).
5. Optionally set a **Mask** to extract metadata from filenames (see [Filename Masks](#filename-masks) below).
6. Save the monitor.

---

## voxcall

> **Note:** voxcall support has not been fully tested. If you run into issues, please [submit a GitHub issue](https://github.com/revtex/squelch/issues).

voxcall sends calls to Squelch via HTTP upload.

1. Configure voxcall to POST recordings to `http://<your-squelch-address>:3022/api/call-upload`.
2. Include your API key in the `X-API-Key` header (or as a `?key=` query parameter).
3. voxcall sends call metadata as form fields alongside the audio file.

---

## Other Recorders

If your recorder isn't listed above, you can still use Squelch with directory monitoring and a generic configuration.

1. Go to **Admin → Monitors → Add Monitor**.
2. Set **Type** to **Default (mask-based)**.
3. Set **Directory** to wherever your recorder saves files.
4. Set **Extension** to match your audio format (e.g. `mp3`, `wav`).
5. Set **System ID** and **Talkgroup ID** if all recordings in that folder belong to one system/talkgroup.
6. If your filenames contain metadata, set a **Mask** to extract it (see [Filename Masks](#filename-masks) below).
7. Save the monitor.

---

## Directory Monitor Settings

When creating a directory monitor, these settings are available:

| Setting                 | Description                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Type**                | Recorder type: **Trunk Recorder**, **SDR Trunk**, **DSDPlus Fast Lane**, **RTLSDR-Airband**, **ProScan**, or **Default (mask-based)**. The form shows only the fields that type actually uses. |
| **Directory**           | The folder to watch for new recordings                                                                                               |
| **Extension**           | File extension filter (e.g. `mp3`). Leave blank to accept all supported types                                                        |
| **Mask**                | Filename pattern for extracting metadata (see below)                                                                                 |
| **Delay**               | Milliseconds to wait after a file appears before ingesting (gives the recorder time to finish writing). Minimum is 2000 (2 seconds). |
| **Delete After Ingest** | Remove the file from disk after Squelch processes it                                                                             |
| **System ID**           | Override: assign all files to this system                                                                                            |
| **Talkgroup ID**        | Override: assign all files to this talkgroup                                                                                         |
| **Frequency**           | Override: assign this frequency to all files                                                                                         |

---

## Filename Masks

If your recorder embeds metadata in filenames, you can define a mask pattern to extract it. Masks use tokens that Squelch replaces with regex capture groups.

**Example:** If your files are named `SYS001_TG1234_20260422_143022.mp3`, you could use the mask:

```
SYS#SYS_TG#TG_#DATE_#TIME
```

### Available Tokens

| Token     | Matches                                         | Example         |
| --------- | ----------------------------------------------- | --------------- |
| `#SYS`    | System radio ID                                 | `001`           |
| `#TG`     | Talkgroup radio ID                              | `1234`          |
| `#TGID`   | Talkgroup radio ID (same as #TG)                | `1234`          |
| `#DATE`   | Date as YYYYMMDD                                | `20260422`      |
| `#TIME`   | Time as HHMMSS                                  | `143022`        |
| `#ZTIME`  | UTC time as HHMMSS                              | `183022`        |
| `#UNIT`   | Source unit ID                                  | `5551`          |
| `#TGLBL`  | Talkgroup label                                 | `Fire Dispatch` |
| `#SYSLBL` | System label                                    | `Metro PD`      |
| `#GROUP`  | Talkgroup group label                           | `Fire`          |
| `#TAG`    | Talkgroup tag label                             | `Dispatch`      |
| `#TGAFS`  | Talkgroup in AFS format _(not yet implemented)_ | `01-001`        |
| `#HZ`     | Frequency in Hz                                 | `851000000`     |
| `#KHZ`    | Frequency in kHz                                | `851000`        |
| `#MHZ`    | Frequency in MHz                                | `851.000`       |
| `#TGHZ`   | Talkgroup frequency in Hz                       | `851000000`     |
| `#TGKHZ`  | Talkgroup frequency in kHz                      | `851000`        |
| `#TGMHZ`  | Talkgroup frequency in MHz                      | `851.000`       |

Mask parsing runs after the recorder-specific parser and fills in any metadata that wasn't already extracted.

---

## Supported Audio Formats

Squelch accepts the following audio file types:

`.mp3` · `.wav` · `.m4a` · `.aac` · `.ogg` · `.flac` · `.opus`

If **Convert audio on upload** is set in **Admin → Settings → Ingest & audio**, incoming files are converted to a standard format (configurable encoding preset) using FFmpeg.

---

## Helpful Settings

These settings in **Admin → Settings → Ingest & audio** affect how calls are ingested:

| Setting                            | What It Does                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Convert audio on upload**        | Converts incoming audio to a standard format using FFmpeg: keep the original, convert only, or convert and normalise peaks or loudness. |
| **Reject duplicate calls**         | The check that turns away calls with the same system/talkgroup within a short time window. Switch it off to keep them all.       |
| **Duplicate window**               | How close (in milliseconds) two calls must be to be considered duplicates.                                                        |
| **Default upload rate limit**      | Calls a minute an API key can upload unless the key sets its own rate under **Admin → API Keys**.                                   |

> **Note:** **Create systems from uploads** is under **Admin → Settings → Radio data**; each system has its own **TG Auto-Populate** toggle under **Admin → Systems** for automatic talkgroup creation.

---

## Calls Not Arriving?

[Troubleshooting](troubleshooting.md#no-calls-are-arriving) works through it from the recorder inward: what each rejection code means, why a successful-looking upload can still be discarded as a duplicate, and what the log says when a directory monitor skips a file.
