# Security Policy

Squelch is self-hosted software that handles recorded radio traffic, listener
accounts, and recorder credentials. Vulnerability reports are welcome, and this
page says where to send them and what happens next.

---

## Supported versions

`3.x` is the current release line, and fixes ship there. If you are on an older
line, upgrade before reporting — the
[Deployment Guide](docs/deployment-guide.md#upgrading-to-v300) covers it.

---

## Reporting a vulnerability

**Do not open a public issue, pull request, or discussion for a security
problem.** A public report tells every operator running Squelch about the hole
before there is a fix for it.

Report it privately through GitHub:

1. Go to <https://github.com/revtex/squelch/security/advisories/new>.
2. Describe the issue, the version you tested, and how to reproduce it.

That creates a private advisory visible only to you and the maintainers.

### What to include

- **What an attacker gets.** Which account, which data, which system — the
  concrete result, not just the flaw.
- **Who has to be able to reach it.** Anonymous internet, a signed-in listener,
  an administrator, or a recorder holding an API key.
- **How to reproduce it**, in the smallest form you have: a request, a fixture
  file, a short script.
- **The version**, from the listening screen's **⋮ → About** or from
  `GET /api/v1/health`.
- **Your deployment shape** if it matters — reverse proxy, HTTPS termination,
  Docker or binary.

### Ground rules

Please test against your own instance. Do not probe someone else's server, and
do not run availability tests against a live one.

Please give the maintainers a chance to ship a fix before describing the issue
publicly. If you would rather not be named when the fix is announced, say so in
the report.

---

## Scope

**In scope** — anything in this repository that lets someone cross a boundary
Squelch is supposed to enforce:

- Signing in as, or acting as, another account.
- Reading calls, talkgroups, or systems an account is not permitted to hear.
- Reaching an administrator-only route without an administrator account.
- Uploading calls without a valid API key, or to a system a key is not
  permitted to write to.
- Recovering a stored secret — an API key, a refresh token, an encrypted
  setting — from the database, the logs, or an API response.
- Remote code execution, path traversal out of the recordings directory, or
  server-side request forgery through an outbound fetch.
- Stored or reflected script execution in the listening screen or the admin
  dashboard.

**Out of scope:**

- Anything requiring an account you were not given, or access to the server's
  filesystem or process.
- Denial of service through sheer volume, and rate-limit tuning on a server you
  control.
- A server that the operator has deliberately opened up — **Public Access** on,
  no HTTPS, no reverse proxy, or the encryption key left unset. These are
  documented choices; see the
  [Deployment Guide](docs/deployment-guide.md#keeping-secrets-safe).
- Findings from an automated scanner with no demonstrated impact.
- Dependency advisories with no reachable path in Squelch — those can be opened
  as ordinary issues.

---

## What Squelch already does

Stated so you know what to test against, not as a claim of completeness.

- **Passwords** are hashed, never stored or logged in the clear.
- **Access tokens** are short-lived and held in browser memory only, never in
  local or session storage. In a browser the refresh token is an httpOnly
  cookie scoped to `/api`; native clients carry it in the request body instead.
  Either way it is stored hashed and rotated as a family, and a replayed token
  revokes the whole family.
- **Recorder API keys** are stored hashed, not recoverable from the database,
  and shown in full only once when created.
- **Secrets at rest** — the login signing key, the web push key, downstream API
  keys, and the Trunk Recorder broker password — can be encrypted with
  AES-256-GCM using a key supplied only by flag, file, or environment variable,
  never written into the config file. See
  [Keeping Secrets Safe](docs/deployment-guide.md#keeping-secrets-safe) and
  [What Gets Encrypted](docs/deployment-guide.md#what-gets-encrypted).
- **Administrator routes** require an administrator token, checked on the
  server for every request.
- **Uploads** require an API key, which can be restricted to named systems and
  rate-limited per key.
- **Outbound requests** go through a hardened HTTP client that can be blocked
  from reaching private network ranges; see
  [Blocking Outbound Traffic to Private Networks](docs/deployment-guide.md#blocking-outbound-traffic-to-private-networks).
- **Request bodies** are size-capped, and request rates are limited.
- **The database and log file** are created readable only by the account that
  runs the server.
- **In CI**, CodeQL analyses every push and pull request on `main` and `dev`
  plus a weekly scheduled run, and the repository has secret scanning, push
  protection, and automated dependency security updates enabled.

---

## Running it safely

The operator's side of this is in the
[Deployment Guide](docs/deployment-guide.md): put it behind HTTPS, set an
encryption key, and keep backups of the database and the encryption key
together — an encrypted database without its key cannot be read back. If your
proxy is not on loopback or a private range, name it explicitly with
`--trusted-proxies`, since that is what decides which client IP Squelch
believes.
