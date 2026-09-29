# 0009. Country comes from a local database file only

- **Status:** Accepted
- **Date:** 2026-09-24

## Context

Admin → Connections shows each connection's address. A country next to it
makes an unfamiliar address easier to judge. Every way of getting the country
means matching the address against a geolocation dataset, and the choices are
where that dataset lives and who supplies it.

Squelch is self-hosted, and many installs are LAN-only or firewalled. The
addresses in question belong to listeners, and MaxMind itself treats IP
addresses as personal information.

The licensing research is in
[`docs/research/geoip-database-licensing.md`](../research/geoip-database-licensing.md).
The two free country databases carry different terms:

- **DB-IP IP to Country Lite** is CC BY 4.0, needs no account and asks for a
  link back.
- **MaxMind GeoLite2-Country** needs an account and licence key. Its EULA
  requires old copies to be replaced within 30 days of each update, and
  restricts passing the file to third parties.

## Decision

The country is looked up in an MMDB file on the server, named by
`--geoip-db` (`SQUELCH_GEOIP_DB`, JSON `geoip_db`). Without the option, no
lookup happens and the Country column is hidden.

- **No address leaves the server.** Squelch makes no network call to find a
  country.
- **Squelch does not ship or download a database.** The operator fetches one
  and is its licensee. The deployment guide recommends DB-IP and documents
  GeoLite2 as the alternative.
- **The page shows the credit the loaded database asks for.** It is chosen from
  the file's `database_type` metadata.
- **Local addresses never touch the file.** Private, loopback, link-local and
  CGNAT addresses show as "Local network".
- **A live connection's country is resolved once, when it connects.** History
  keeps that code. Signed-in devices are looked up from their last address
  when the list is shown.
- **The file is re-read hourly if it changed.** A missing or unreadable file
  logs a warning and turns the column off; it never stops the server.

## Consequences

- Lookups take microseconds, work offline and need no outbound internet.
- Accuracy is whatever the operator's file gives, and it goes stale unless the
  operator refreshes the file. Squelch cannot do that for them. GeoLite2 users
  also carry the 30-day replacement duty.
- Turning the feature on takes an extra step: download a file and set a path.
  Most installs will not show countries.
- Because nothing is bundled, the project sits outside both vendors'
  redistribution terms. Adding a database to the Docker image would change
  that and needs its own decision.

## Alternatives considered

- **An online lookup service** such as ip-api.com or ipinfo.io. This lost on
  every count that matters for a self-hosted server:
  - Every listener's address goes to a third party the operator has no
    agreement with.
  - The server needs outbound internet, which many installs don't have.
  - Free tiers rate-limit and disappear.
  - Every connection pays for a network round trip.

  If it is ever wanted, it should be an explicit opt-in through
  `safehttp.Client`, recorded in a new ADR.
- **Bundle a database in the Docker image.** This lost on licensing:
  - Bundling DB-IP is allowed, but the project would then owe the CC BY
    notices for every copy it ships.
  - Whether bundling GeoLite2 needs MaxMind's written consent under EULA §6
    is unresolved, and only MaxMind can answer it.
  - A bundled file also goes stale between releases.
