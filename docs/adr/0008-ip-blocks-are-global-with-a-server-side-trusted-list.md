# 0008. IP blocks are global, with a trusted list only the host can change

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

Admin → Connections lets an admin block an address or range. Two questions
had answers that look wrong at first glance.

**What a block covers.** Squelch serves several things from one port: the
v1 API, the legacy rdio-scanner upload API, both WebSocket channels, the
background audio stream, shared-call pages and the SPA itself. Blocks could
apply only to listeners and leave the recorder-facing upload path open.

**Who can undo a block.** The feature exists to shut out an attacker. Used
from a compromised or rogue admin account, it also shuts out the real
operator. Blocking an address, disconnecting it and signing it out is exactly
what that attacker needs to keep an operator off their own server. The
operator's defence has to be something an admin login alone cannot change.

The client address itself is a weak point. It comes from gin's
trusted-proxy handling (`--trusted-proxies`). By default that trusts loopback
and every RFC 1918 range, so any client on the LAN can send
`X-Forwarded-For: 127.0.0.1` and be resolved as loopback.

## Decision

**Blocks are global.** `middleware.IPBlock` is the first middleware on the
root router, before authentication and rate limits. A blocked address gets a
403 on every route: API, WebSocket upgrades, uploads, shared-call pages and
the SPA. Blocks live in the `ip_blocks` table, are matched in memory from an
atomic snapshot, and can carry an expiry.

**The trusted list lives in server configuration, not in the database.**
`--trusted-addresses` (`SQUELCH_TRUSTED_ADDRESSES`, JSON `trusted_addresses`)
lists addresses and ranges that blocks never apply to. The admin UI shows it
read-only. Changing it needs access to the host, which an admin login does
not give.

**Loopback is always trusted, but only when it is real.** A request counts as
loopback only when both the resolved client address and the socket peer are
loopback, so a forged header from the LAN does not qualify. Configured
entries are matched against the resolved address, which makes them exactly
as trustworthy as `--trusted-proxies`. Squelch logs a warning at startup when
trusted addresses are set but the proxy list is still the default.

**Guards on creating a block**, with no override:

- The range must be in canonical form.
- It must be no wider than /16 (IPv4) or /48 (IPv6).
- It must not touch loopback or overlap any trusted entry.

A range that contains the calling admin's own address needs an explicit
confirmation. Creating a block closes the connections it covers at once, with
the reason `blocked` in History. Each block and removal is written to
Admin → Logs.

## Consequences

- "Block this address" means what it says. A blocked recorder cannot upload,
  and a blocked visitor cannot load the page.
- A rogue admin can add blocks but cannot block a trusted address, so an
  operator who configured the list keeps access. That admin can still
  disconnect trusted connections, which reconnect at once, and can disable or
  delete the operator's account. Protecting the account itself is separate,
  unbuilt work.
- The list is only as strong as `--trusted-proxies`. If every private range is
  trusted as a proxy, a LAN client can claim a trusted address. The deployment
  guide says to narrow the proxy list to the real reverse proxy first.
- Recovery from a self-lockout needs the host. Under Docker, requests from the
  host arrive from the bridge gateway, not loopback, and there is no CLI
  unblock command. The documented path is: add your address to
  `SQUELCH_TRUSTED_ADDRESSES`, restart, then remove the block.
- Blocking whole providers or countries is refused by the width limit on
  purpose. That belongs at the firewall or reverse proxy.

## Alternatives considered

- **Keep the trusted list in the database, editable from the admin UI.** That
  would be more convenient, but it defeats the purpose: the threat is an admin
  account used against the operator, and that account could remove the
  operator from the list before blocking them.
- **Leave the upload endpoint unblocked** so a mistaken block could never cut
  off a recorder. This lost because "block this address" would silently not
  mean that, and the recorder path is where a hostile uploader would be.
- **Treat any request that resolves to loopback as trusted.** This lost to the
  forged `X-Forwarded-For: 127.0.0.1` case above. It is why the socket peer
  must be loopback too.
- **Stop gin from honouring `X-Real-IP`** to remove a second forgery path. This
  lost because gin reads `X-Real-IP` only when `X-Forwarded-For` is absent, so
  it adds no new way to forge an address. Dropping it could also break proxies
  that set only `X-Real-IP`. The fix for forgery is a narrow
  `--trusted-proxies`.
- **Allow wider ranges behind a "force" flag.** This lost because a range wider
  than /16 or /48 typed into this dialog is almost always a typo
  (`10.0.0.0/8` meant `/24`), and it would take large parts of the internet
  offline for every listener and recorder.
