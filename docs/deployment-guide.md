# Deployment Guide

_Squelch was previously named OpenScanner._

This guide walks you through getting Squelch running at home. The Docker path is the easiest and works for most people — start there, and only dip into the Advanced section if you need something special.

## Contents

- [Quick Start with Docker](#quick-start-with-docker)
- [Upgrading to v3.0.0](#upgrading-to-v300)
- [Upgrading from OpenScanner](#upgrading-from-openscanner)
- [First-Time Login](#first-time-login)
- [Your Data Directory](#your-data-directory)
- [Backing Up](#backing-up)
- [Running Behind a Reverse Proxy](#running-behind-a-reverse-proxy)
- [Addresses That Can Never Be Blocked](#addresses-that-can-never-be-blocked)
- [Showing Listeners' Countries (Optional)](#showing-listeners-countries-optional)
- [HTTPS Options](#https-options)
- [Keeping Secrets Safe](#keeping-secrets-safe)
- [Transcription (Optional)](#transcription-optional)
- [FFmpeg (Optional)](#ffmpeg-optional)
- [Verification Checklist](#verification-checklist)
- [Advanced](#advanced)

---

## Quick Start with Docker

If you have Docker installed, you can be up and running in a couple of minutes.

1. Create a folder to hold your database and recordings, then step into it:

   ```bash
   mkdir -p squelch/data
   cd squelch
   ```

2. Create a file called `docker-compose.yml` with this content:

   ```yaml
   services:
     squelch:
       image: ghcr.io/revtex/squelch:dev
       ports:
         - "3022:3022"
       volumes:
         - ./data:/data
       environment:
         - SQUELCH_DB_FILE=/data/squelch.db
         - SQUELCH_RECORDINGS_DIR=/data/recordings
         - SQUELCH_LISTEN=0.0.0.0:3022
         - TZ=America/New_York # change to your timezone
       healthcheck:
         test: ["CMD", "wget", "-qO-", "http://localhost:3022/api/v1/health"]
         interval: 30s
         timeout: 5s
         start_period: 10s
         retries: 3
       restart: unless-stopped
   ```

3. Start it:

   ```bash
   docker compose up -d
   ```

4. Open <http://localhost:3022> in your browser. Squelch will walk you through creating your first admin account.

> **Tip:** Set `TZ` to your local timezone (the [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones), like `America/Chicago` or `Europe/London`). That way recorder timestamps come out right.

That's it. Everything below is optional — only read on if you need it.

---

## Upgrading to v3.0.0

v3.0.0 changes how secrets stored in the database are encrypted. Secrets written
by v2.x or earlier cannot be read by v3.0.0 until they are re-encrypted, so
**Squelch will refuse to start** until you have run the `squelch-rekey` tool
once. It names the secrets it cannot read, so you will not be guessing.

`squelch-rekey` ships beside the server binary in every release archive, and
inside the Docker image.

### Before you start

Stop the server. The tool takes its own backup, but it needs the database to be
idle — and a backup taken while the server is running is not a backup you can
trust.

### 1. See what would change

```bash
squelch-rekey -db /var/lib/squelch/squelch.db
```

It reports what it found and exits without writing anything:

```
Found 3 encrypted value(s): 0 already current, 3 to re-encrypt.
  re-encrypt  settings.value rowid=1
  re-encrypt  downstreams.api_key rowid=1
  re-encrypt  tr_instances.password_enc rowid=1

Dry run — nothing was written. Re-run with -apply to make these changes.
```

The encryption key comes from `SQUELCH_ENCRYPTION_KEY` or `-key`, or from a key
file via `SQUELCH_ENCRYPTION_KEY_FILE` or `-key-file` — whichever the server
already uses. It is the same key the server runs with; the tool does not change
your key, only what is derived from it.

If it reports that a value cannot be decrypted under **either** scheme, stop:
your encryption key does not match this database. Nothing has been written.

### 2. Apply

```bash
squelch-rekey -db /var/lib/squelch/squelch.db -apply
```

It writes a backup to `squelch.db.pre-rekey-<timestamp>` first, then re-encrypts
everything in a single transaction. Running it again is safe — a second pass
finds nothing to do.

### Docker

The image's entrypoint runs the server, so the tool needs `--entrypoint`.
`--user 1001` matters too: without it the container runs as root and leaves a
root-owned backup file in a data directory owned by `appuser`, which the server
then cannot manage.

```bash
docker compose down

# Report only.
docker compose run --rm --no-deps --user 1001 \
  --entrypoint ./squelch-rekey squelch -db /data/squelch.db

# Then, once the report looks right:
docker compose run --rm --no-deps --user 1001 \
  --entrypoint ./squelch-rekey squelch -db /data/squelch.db -apply

docker compose up -d
```

`-db` can be omitted — the image already sets `SQUELCH_DB_FILE=/data/squelch.db`
— but passing it explicitly is worth the keystrokes when the command rewrites
every secret you have.

The encryption key is inherited from the service's environment, so if your
compose file sets `SQUELCH_ENCRYPTION_KEY` the tool picks it up with no extra
flag. If it is in a `.env` or a secret rather than the service environment, pass
it with `-key`.

The backup lands in the same volume, beside the database, as
`squelch.db.pre-rekey-<timestamp>`. Copy it somewhere off the host before you
start the server again.

### 3. Rename your environment variables

v3.0.0 no longer reads `OPENSCANNER_*`. If your compose file or service unit
still sets them, rename them to `SQUELCH_*` now — **they will not error, they
will simply be ignored**, and the server will fall back to defaults.

### Other things that reset

- The CLI no longer reads `~/.openscanner-token`. Run `squelch login` once more.
- Browser theme and paused state reset once per browser. Your talkgroup
  selection is **not** affected — it lives on your user account, server-side.

## Upgrading from OpenScanner

Squelch was previously named OpenScanner. Your data carries over intact,
but several things are named differently and need a one-time change.

> **Upgrading from v1.x?** Go via v2.x rather than straight to v3.0.0.
> v3.0.0 no longer detects an OpenScanner data directory, so pointed at
> one it will create an empty database beside your old one rather than
> stopping. Upgrade to v2.x first, which does stop and tell you what to
> do — or perform step 2 below by hand before starting v3.0.0.

**1. The image.** `ghcr.io/revtex/openscanner` becomes
`ghcr.io/revtex/squelch`. The old image is no longer updated.

**2. The database filename.** `openscanner.db` becomes `squelch.db`.
Squelch will **not** rename it for you. Stop the old container, then:

```bash
cd /path/to/your/data
mv openscanner.db squelch.db
# Only if they exist (they do if the server was not shut down cleanly):
mv openscanner.db-wal squelch.db-wal
mv openscanner.db-shm squelch.db-shm
```

If you would rather keep the old filename, point Squelch at it with
`--db-file /data/openscanner.db` (or `SQUELCH_DB_FILE`) and nothing else
needs to change.

**3. The environment variables.** `OPENSCANNER_*` becomes `SQUELCH_*`.
v2.x honoured the old names with a startup warning; **v3.0.0 ignores
them entirely**, falling back to defaults without an error. Rename them
before upgrading to v3.0.0.

| Before | After |
| --- | --- |
| `OPENSCANNER_DB_FILE` | `SQUELCH_DB_FILE` |
| `OPENSCANNER_RECORDINGS_DIR` | `SQUELCH_RECORDINGS_DIR` |
| `OPENSCANNER_LISTEN` | `SQUELCH_LISTEN` |
| `OPENSCANNER_ENCRYPTION_KEY` | `SQUELCH_ENCRYPTION_KEY` |
| `OPENSCANNER_JWT_SECRET` | `SQUELCH_JWT_SECRET` |

**4. Encrypted secrets (v3.0.0 only).** v1.x and v2.x share one secrets
encryption scheme; v3.0.0 changed it. See
[Upgrading to v3.0.0](#upgrading-to-v300) — you must run `squelch-rekey`
once, and the server will refuse to start until you have.

The database schema is identical throughout, so no migration runs. Your
recordings directory, API keys, and admin users are untouched.

In the browser, v2.x migrated your theme, paused state, and saved
talkgroup selection forward from their old storage keys. v3.0.0 no
longer does, so theme and paused state reset once. Your talkgroup
selection is unaffected — it is stored on your user account,
server-side, not in the browser.

---

## First-Time Login

The first time you open Squelch you'll see a setup page instead of a login page. Pick a username and password and click **Create**. That account becomes the admin user.

There is no default username or password — Squelch doesn't ship with one. If you ever forget your admin password, you can reset it on the next startup:

- **Binary:** run once with `--admin-password new-password`, then restart normally.
- **Docker:** add `SQUELCH_ADMIN_PASSWORD=new-password` to your compose file, run `docker compose up -d --force-recreate`, then remove the line and recreate again.

Either way, the password is consumed at startup — remove the flag or env var afterwards so it isn't sitting in your config.

Once you're logged in, head to **Admin → Systems** to set up your first trunked or conventional system, then **Admin → API Keys** to generate an upload key for your recorder. The [Recorder Guide](recorder-guide.md) takes it from there.

---

## Your Data Directory

The `./data` folder you mounted in the compose file holds everything Squelch needs to remember: the SQLite database (`squelch.db`), the server log file (`squelch.log`, written alongside the database), and the audio recordings (`recordings/`). Anything else Squelch creates — cached transcription models, temporary files — lives inside the container and can be thrown away without losing your data.

Keep that `./data` folder safe, and you can reinstall, upgrade, or move to a new machine without losing anything.

---

## Backing Up

Backups are small and simple. You only need two things:

1. The database file — `data/squelch.db`
2. The recordings folder — `data/recordings/`

A plain `tar` or `rsync` of the `data/` directory is enough. You can copy it while Squelch is running (SQLite's WAL mode handles that safely), but for a tidy point-in-time backup it's better to stop the container first:

```bash
docker compose stop
tar czf squelch-backup-$(date +%F).tar.gz data/
docker compose start
```

To restore, unpack the archive into the same location and start the container again.

> **Tip:** If you turn on encryption (see [Keeping Secrets Safe](#keeping-secrets-safe)), also back up your `.env` file — without the key, the encrypted entries in your database can't be read.

---

## Running Behind a Reverse Proxy

Most people already have a web server (Caddy, nginx, Traefik) on their home server. Putting Squelch behind it gives you a clean domain name and one place to manage TLS certificates.

Every proxy needs to do three things:

- **Forward WebSocket upgrades.** The live call feed uses `/api/v1/ws/listener` and the admin dashboard uses `/api/v1/ws/admin`; older clients still use `/api/ws`, `/ws` and `/api/admin/ws`. Proxying the whole site (`/`) with upgrades allowed covers all of them. Audio and the background stream (`/api/v1/listener/stream`) are ordinary HTTP responses.
- **Send `X-Forwarded-Proto`** so Squelch knows whether to mark cookies as secure.
- **Send `X-Forwarded-For`** with the visitor's real address. The proxy examples below all do this.

Then tell Squelch which address the proxy connects from — see [Showing the Real Client Address](#showing-the-real-client-address). Skipping that step leaves anyone on your network able to fake their address.

### Showing the Real Client Address

Squelch records a client address against every login attempt, rate limit and log line. Behind a proxy, every connection arrives from the proxy, so the real address has to come from the `X-Forwarded-For` header — and Squelch must only believe that header from the proxy itself. Anyone can put any address in it.

**Why it matters:** login lockout counts failed passwords per address. If every visitor appears to come from the proxy, one person mistyping a password three times locks **everyone** out for ten minutes. If Squelch believes the header from anyone, a visitor can dodge the lockout by claiming a different address each time.

Out of the box, Squelch believes `X-Forwarded-For` from any loopback or private address (`127.0.0.0/8`, `::1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`). That makes a first install work behind almost any proxy, but it also means **any device on your LAN** that connects to Squelch's port directly can claim to be any address. Narrow it to your proxy:

1. **Find the address your proxy connects from.** It depends on where each one runs:

   | Proxy runs… | Squelch runs… | Squelch sees the proxy as… |
   | --- | --- | --- |
   | on the host | on the host (binary install) | `127.0.0.1` |
   | on the host | in Docker, reached through a published port (`127.0.0.1:3022` or `localhost:3022`) | the gateway of Squelch's Docker network — see the command below |
   | in Docker, on the same Docker network as Squelch | in Docker | the proxy container's address (pin it, or use the network's subnet if only the proxy and Squelch are on it) |
   | on another machine | anywhere | that machine's LAN address |

   To find a Docker network's gateway (the project name is usually the folder your compose file is in):

   ```bash
   docker network inspect squelch_default --format '{{(index .IPAM.Config 0).Gateway}}'
   ```

   Expected output is a single address such as `172.18.0.1`.

   If you are not sure, set up the proxy first, then look at the log (step 3): with no trusted proxy matching, every request shows the proxy's address, and that is the one to use.

2. **Set it** with `--trusted-proxies` or `SQUELCH_TRUSTED_PROXIES` (comma-separated addresses or CIDR ranges). In Docker Compose:

   ```yaml
   services:
     squelch:
       environment:
         - SQUELCH_TRUSTED_PROXIES=172.18.0.1
   ```

   Then `docker compose up -d` to apply it. With no proxy in front of Squelch at all, set it to `none`.

3. **Check it.** Browse the site through the proxy from your phone or another computer, then read the request log:

   ```bash
   docker compose logs squelch | grep '"msg":"request"' | tail -5
   ```

   Each line ends in `"ip":"…"`. It should be the address of the device you browsed from, not the proxy's. If it shows the proxy's address, the trusted-proxy setting does not match where the proxy connects from — go back to step 1.

> **If a Docker network is recreated** (for example after `docker compose down` removes it), it can come back with a different subnet and gateway. Nothing breaks, but every visitor shows as the new gateway address until you update `SQUELCH_TRUSTED_PROXIES`. Step 3 catches this.

If the proxy is on the same machine, you can also stop anything bypassing it by publishing Squelch's port on localhost only. Keep `SQUELCH_LISTEN` at `0.0.0.0:3022` inside the container — `127.0.0.1` there would make the container unreachable — and restrict the published port instead:

```yaml
ports:
  - "127.0.0.1:3022:3022"
```

Recorders and apps that used `http://<server>:3022` directly then have to go through the proxy's address.

### Caddy

Caddy handles TLS, WebSockets and forwarded headers on its own. Since v2.5 it also discards any `X-Forwarded-For` a visitor sends and writes the real address, so the header cannot be forged through it. It does pass a visitor's `X-Real-IP` straight through, so remove it:

```caddy
scanner.example.com {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3022 {
        header_up -X-Real-IP
    }
}
```

If Caddy itself sits behind Cloudflare's proxy (orange cloud), see [Cloudflare](#cloudflare).

### nginx

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name scanner.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name scanner.example.com;

    ssl_certificate     /etc/letsencrypt/live/scanner.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/scanner.example.com/privkey.pem;

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:3022;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
    }
}
```

`$proxy_add_x_forwarded_for` adds the real address to the end of whatever the visitor sent. Squelch reads the list from the end backwards and stops at the first address that is not a trusted proxy, so a forged entry at the front is ignored — **as long as `SQUELCH_TRUSTED_PROXIES` names only nginx**. With the default private ranges, a LAN visitor's own address counts as "trusted" and Squelch reads past it to the forged one.

### Nginx Proxy Manager

1. Add a **Proxy Host** for your domain, forwarding to Squelch's address and port `3022` (`http`).
2. Turn on **Websockets Support**.
3. On the **SSL** tab, request a certificate and turn on **Force SSL**.

Nginx Proxy Manager already sends `X-Forwarded-For`, `X-Real-IP` and `X-Forwarded-Proto`. It runs in Docker, so its address as Squelch sees it is its container address on the shared network, or the Docker gateway if it reaches Squelch through a published port — use the table above.

### Traefik

Traefik forwards WebSockets and sets `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Real-Ip` itself. By default it discards those headers when a visitor sends them, so they cannot be forged through it. With Traefik watching Docker, add labels to the Squelch service:

```yaml
services:
  squelch:
    labels:
      - traefik.enable=true
      - traefik.http.routers.squelch.rule=Host(`scanner.example.com`)
      - traefik.http.routers.squelch.entrypoints=websecure
      - traefik.http.routers.squelch.tls.certresolver=letsencrypt
      - traefik.http.services.squelch.loadbalancer.server.port=3022
```

Use your own entrypoint and certificate resolver names. Traefik and Squelch must share a Docker network; set `SQUELCH_TRUSTED_PROXIES` to Traefik's container address, or to that network's subnet if nothing else is on it.

### Apache

Needs Apache 2.4.47 or later, with `mod_proxy`, `mod_proxy_http`, `mod_headers` and `mod_ssl` enabled (`a2enmod proxy proxy_http headers ssl` on Debian and Ubuntu).

```apache
<VirtualHost *:443>
    ServerName scanner.example.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/scanner.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/scanner.example.com/privkey.pem

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader unset X-Real-IP

    ProxyPass        / http://127.0.0.1:3022/ upgrade=websocket
    ProxyPassReverse / http://127.0.0.1:3022/
</VirtualHost>
```

Apache adds `X-Forwarded-For` on its own, appending to anything the visitor sent — the same as nginx, so the same rule applies: set `SQUELCH_TRUSTED_PROXIES` to Apache's address only.

### Cloudflare

**Cloudflare Tunnel** (`cloudflared`): point the tunnel's service at Squelch (`http://localhost:3022`, or `http://squelch:3022` when `cloudflared` runs in the same Compose project). Cloudflare sends the visitor's address in `X-Forwarded-For`, so set `SQUELCH_TRUSTED_PROXIES` to the address `cloudflared` connects from, using the table above.

**Cloudflare's proxy in front of your own proxy** (the orange cloud): your proxy now sees Cloudflare's servers, not visitors, and has to be told to trust them — otherwise every visitor shows up as a Cloudflare address. Cloudflare publishes its ranges at <https://www.cloudflare.com/ips/>. In Caddy, add them to the global options and forward the resolved address:

```caddy
{
    servers {
        trusted_proxies static 173.245.48.0/20 103.21.244.0/22 # …the full list from cloudflare.com/ips
    }
}

scanner.example.com {
    reverse_proxy 127.0.0.1:3022 {
        header_up X-Forwarded-For {client_ip}
        header_up -X-Real-IP
    }
}
```

In nginx, use `set_real_ip_from` for each Cloudflare range with `real_ip_header CF-Connecting-IP;` and send `proxy_set_header X-Forwarded-For $remote_addr;`. Either way, Squelch still trusts only your own proxy.

### Checking the Proxy

After starting the proxy, open the public URL in a browser and confirm the live scanner shows new calls and plays audio. New calls arriving prove the WebSocket forwarding is working; audio playing proves the standard HTTPS forwarding (and cookies) are working.

> **Tip:** Make sure your server's clock is accurate (NTP is usually on by default). Login tokens have expiry times, and a clock that's off by several minutes will cause confusing login failures.

---

## Addresses That Can Never Be Blocked

Admins can block an address or range from **Admin → Connections → Blocked addresses**. To make sure nobody can lock you out that way, including someone who has stolen an admin password, list the addresses you manage Squelch from in `--trusted-addresses` or `SQUELCH_TRUSTED_ADDRESSES`. Blocks never apply to them, and the admin dashboard cannot change the list. Only someone who can change the server's configuration can.

1. **Narrow your trusted proxies first.** A trusted address is only as trustworthy as the client address Squelch works out. Under the default trusted proxies, any device on your LAN can claim to be your address. Follow [Showing the Real Client Address](#showing-the-real-client-address) before relying on this list. Squelch logs a warning at startup when trusted addresses are set but trusted proxies are still the default.

2. **Find your address.** Open **Admin → Connections → Blocked addresses**. It shows the address you are connected from.

3. **Set it.** Use comma-separated addresses or CIDR ranges. In Docker Compose:

   ```yaml
   services:
     squelch:
       environment:
         - SQUELCH_TRUSTED_ADDRESSES=203.0.113.7,192.168.1.0/24
   ```

   Then run `docker compose up -d`. An entry that is not an address or a range stops Squelch from starting, and the log names it.

4. **Check it.** The **Never blocked** list on the Blocked addresses tab shows every trusted address. Rows from those addresses are marked **trusted** and have no **Block address** action.

Things to know:

- **Loopback is always trusted,** but only for a request made on the server itself. In Docker, a request from the host reaches the container from the Docker network's gateway, not from loopback, so it gets no exemption.
- **Home addresses change.** If your internet provider changes your address, the old entry stops protecting you. Trust the range your provider uses, or the address of a VPN you always connect through.
- **The list cannot be edited from the dashboard on purpose.** If you are locked out, see [Locked Out](troubleshooting.md#locked-out) in the troubleshooting guide.

## Showing Listeners' Countries (Optional)

**Admin → Connections** can show the country each connection comes from. The lookup uses a country database file that you download and keep on the server. Addresses are looked up locally and never leave the server. Squelch does not include a database, so this is off until you add one. Private and local addresses always show as **Local network**, with or without a database.

Squelch reads any IP-to-country file in the MMDB format. Two free ones work:

| Database | Account needed | Updates | Licence |
| --- | --- | --- | --- |
| [DB-IP IP to Country Lite](https://db-ip.com/db/lite.php) | No | Monthly | CC BY 4.0 |
| [MaxMind GeoLite2-Country](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data) | Yes, free | Twice a week | [GeoLite EULA](https://www.maxmind.com/en/geolite/eula) |

You download the file yourself, so you are the licensee. Squelch shows the credit each licence asks for under the country column.

### DB-IP (recommended)

1. **Download it** into your data folder. The file name carries the year and month:

   ```bash
   cd squelch/data
   curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz" \
     | gunzip > country.mmdb.new && mv country.mmdb.new country.mmdb
   ```

   Early on the 1st of a month the new file may not be published yet. If the download fails, try again later that day.

2. **Point Squelch at it** with `--geoip-db` or `SQUELCH_GEOIP_DB`. In Docker Compose, the data folder is `/data` inside the container:

   ```yaml
   services:
     squelch:
       environment:
         - SQUELCH_GEOIP_DB=/data/country.mmdb
   ```

   Then run `docker compose up -d`.

3. **Check it.** The log shows `geoip: country lookup is on` at startup, and **Admin → Connections** gains a **Country** column. If the file cannot be opened, Squelch starts anyway with a warning and no country column.

4. **Keep it current.** Run the step 1 command once a month, for example from cron on the 2nd:

   ```bash
   0 4 2 * * cd /path/to/squelch/data && curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$(date +\%Y-\%m).mmdb.gz" | gunzip > country.mmdb.new && mv country.mmdb.new country.mmdb
   ```

   Squelch checks for a replaced file every hour, so no restart is needed. Always download to a new name and then move it into place, as the command does. Overwriting the open file directly can make Squelch read a half-written database.

### MaxMind GeoLite2

1. Create a free account at [maxmind.com](https://www.maxmind.com/en/geolite2/signup) and generate a licence key.
2. Install MaxMind's [`geoipupdate`](https://dev.maxmind.com/geoip/updating-databases) tool, set `EditionIDs GeoLite2-Country` in its configuration, and point its database directory at your data folder.
3. Set `SQUELCH_GEOIP_DB=/data/GeoLite2-Country.mmdb` and restart Squelch.
4. **Update it on a schedule.** The GeoLite EULA requires you to replace the file within 30 days of each MaxMind release, and to delete old copies. Run `geoipupdate` from cron at least weekly. It replaces the file safely, and Squelch picks the new one up within the hour.

This product includes GeoLite Data created by MaxMind, available from https://www.maxmind.com.

## HTTPS Options

You have two choices for serving Squelch over HTTPS:

- **Reverse proxy (recommended):** Let Caddy, nginx, or Traefik terminate TLS and forward plain HTTP to Squelch on localhost. This is the standard setup for self-hosted apps and gives you a single place to manage certificates.
- **Built-in TLS:** Squelch can serve HTTPS directly if you pass it a certificate and key, or ask it to fetch one from Let's Encrypt. This is useful when you don't want to run a separate proxy — for example, on a small VPS that only runs Squelch.

For built-in TLS, see [Built-in TLS](#built-in-tls) under Advanced.

---

## Keeping Secrets Safe

Squelch stores a few sensitive values in its database: the signing key used for your login sessions, your web-push key, any downstream scanner API keys, and any Trunk Recorder broker passwords. By default these are stored as plain text.

You can turn on an encryption option that **scrambles those values in the database file**, so that someone who steals your `squelch.db` can't read your API keys or forge logins from it. You provide a key when Squelch starts, and that key is the only way to unlock the scrambled values.

**Do I need this?** If your Squelch is only reachable from your home network and you trust the people on it, you can skip encryption without any real downside. If you're exposing Squelch to the internet, or you share the server with other users, turn it on.

### Turning Encryption On (Docker)

Two ways to supply the key. A **key file** is the better one and is what the
rest of this guide assumes: it keeps the key out of the container's environment
(where `docker inspect` and any crash dump would show it), and `squelch-rekey`
reads the same file when you need it.

#### Option A — key file (recommended)

1. Generate a key next to your `docker-compose.yml`. Keep it **outside** the
   data volume: a copy of your database should not carry the key that protects
   it.

   ```bash
   openssl rand -hex 32 > squelch-encryption.key
   ```

2. Make it readable by the container. Squelch drops privileges to `appuser`
   (uid/gid **1001**) before it reads anything, so a key file owned only by you
   will fail with `permission denied` and the container will restart-loop:

   ```bash
   sudo chown "$USER":1001 squelch-encryption.key
   chmod 640 squelch-encryption.key
   ```

   Group-readable by 1001, writable only by you, not world-readable.

3. Mount it read-only and point Squelch at it:

   ```yaml
   services:
     squelch:
       image: ghcr.io/revtex/squelch:dev
       volumes:
         - ./data:/data
         - ./squelch-encryption.key:/run/secrets/squelch-encryption.key:ro
       environment:
         - SQUELCH_ENCRYPTION_KEY_FILE=/run/secrets/squelch-encryption.key
         # ...your other env vars...
   ```

4. Recreate the container:

   ```bash
   docker compose up -d --force-recreate
   ```

#### Option B — environment variable

1. Generate a key into a `.env` file next to your `docker-compose.yml`:

   ```bash
   echo "SQUELCH_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env
   chmod 600 .env
   ```

2. Add `.env` to your `.gitignore` if you version-control your compose file.

3. Reference the variable in your `docker-compose.yml`:

   ```yaml
   services:
     squelch:
       environment:
         - SQUELCH_ENCRYPTION_KEY=${SQUELCH_ENCRYPTION_KEY}
   ```

4. Recreate the container as above.

Putting the key directly inside `docker-compose.yml` works too, but then it ends
up in whatever copy of that file you share or commit.

### Confirming It Worked

On the next startup Squelch encrypts your existing secrets in place and prints
`Encryption at rest  yes` in its startup banner. You should also see one log
line per secret it converted:

```
"msg":"secrets: encrypted setting","key":"jwtSecret"
"msg":"secrets: encrypted trunk recorder broker password","id":1
```

And the plaintext warnings it used to print on every start should be gone.
Those two signals are the verification — between them they tell you the key was
read and every secret was converted.

If you want to confirm in the database itself, **stop the container first** and
open the file read-write. Squelch runs SQLite in WAL mode, so a read-only copy
or a `:ro` mount cannot take a read lock, and a freshly encrypted value may
still be sitting in the `-wal` file rather than the main database:

```bash
docker compose stop squelch
sqlite3 data/squelch.db "SELECT key FROM settings WHERE value LIKE 'enc::%';"
docker compose start squelch
```

> **Important:** Back up the key file (or the key inside `.env`) somewhere
> separate from your database backups. If you lose it, the encrypted values
> cannot be recovered — you would need to re-enter your downstream API keys and
> Trunk Recorder broker passwords, and everyone would need to log in again.
> Keeping the key in the same place as the database backup defeats the point.

### What Gets Encrypted

Here's the short list of what changes when encryption is on. Everything else (system names, talkgroup lists, colors, toggles) stays as plain text.

| Value | Where it lives | What it's used for |
| --- | --- | --- |
| Login signing key | `settings` table (`jwtSecret`) | Signs your login sessions and API tokens |
| Web push key | `settings` table (`vapidPrivateKey`) | Signs browser push notifications |
| Downstream API keys | `downstreams` table (`api_key`) | Lets Squelch forward calls to another scanner server |
| Trunk Recorder broker password | `tr_instances` table (`password_enc`) | Authenticates to your MQTT broker |

Encrypted entries are prefixed with `enc::` in the database, so if you're poking around in SQLite you can tell which rows are encrypted at a glance.

### If You Don't Set a Key

Squelch still starts fine without a key — it just keeps the values above as plain text. On startup it prints a warning in the log letting you know encryption is off, so you don't forget by accident. For a hobby setup on a trusted home network, that's perfectly reasonable. If you later decide to turn it on, add the key file (or the variable) and restart — Squelch will encrypt the existing values on its own, no separate migration step.

Going the other way is not supported: once values are encrypted, removing the key does **not** decrypt them. Squelch refuses to start rather than run with secrets it cannot read, so keep the key for as long as you keep the database.

---

## Transcription (Optional)

Squelch can automatically transcribe calls using [go-whisper](https://github.com/mutablelogic/go-whisper), a whisper.cpp sidecar that runs as its own service.

Add this alongside Squelch in your `docker-compose.yml`:

```yaml
whisper:
  image: ghcr.io/mutablelogic/go-whisper
  volumes:
    - whisper-data:/data
  environment:
    - GOWHISPER_DIR=/data
    - GOWHISPER_ADDR=0.0.0.0:8081
  command: ["run"]
  restart: unless-stopped
```

Then in Squelch's admin dashboard, open **Admin → Transcription** and:

1. Set **Transcription URL** to `http://whisper:8081`.
2. **Download a model** — pick one from the list and click download.
3. **Select the model** you just downloaded as the active model.
4. Set **Language** (default `en`, or leave blank to auto-detect).
5. Turn **Transcription Enabled** on.

Available models:

| Model                 | Notes                                                   |
| --------------------- | ------------------------------------------------------- |
| `ggml-tiny`           | Fastest, lowest accuracy (multilingual)                 |
| `ggml-tiny.en`        | Fastest, English-only                                   |
| `ggml-base`           | Good balance (multilingual)                             |
| `ggml-base.en`        | Good balance, English-only                              |
| `ggml-small`          | Better accuracy, slower (multilingual)                  |
| `ggml-small.en`       | Better accuracy, English-only                           |
| `ggml-medium`         | High accuracy, needs more resources (multilingual)      |
| `ggml-medium.en`      | High accuracy, English-only                             |
| `ggml-large-v3`       | Best accuracy, most resource-heavy                      |
| `ggml-large-v3-turbo` | Near-best accuracy, faster than large-v3                |
| `ggml-small.en-tdrz`  | Enables speaker diarization (identifies who is talking) |

Once transcription is on, transcribed text appears in the live player and is searchable from the **Search** page.

### GPU Acceleration (Highly Recommended)

CPU-only transcription is very slow — on a typical home CPU, calls may not finish processing in time for the live player to show the transcript. A GPU with at least **6 GB of VRAM** (for example an NVIDIA RTX 3050 6GB) lets you run `ggml-large-v3-turbo` with good accuracy at close to real-time speed.

Options:

- **NVIDIA CUDA** — use the `ghcr.io/mutablelogic/go-whisper-cuda` image with GPU device passthrough
- **Intel iGPU** — mount `/dev/dri` with the right group IDs for Vulkan/OpenCL
- **AMD ROCm** — mount ROCm devices

The project's [docker-compose.yml](../docker-compose.yml) has commented-out examples for each. For more detail, see the [go-whisper repository](https://github.com/mutablelogic/go-whisper) — note that go-whisper is a third-party project and Squelch doesn't provide support for it directly.

---

## FFmpeg (Optional)

FFmpeg handles audio conversion and normalization. It's **already installed in the Docker image**, so you don't need to do anything unless you're running from a binary.

In **Admin → Options** you can pick a conversion mode:

- **Disabled** — store audio files as-is
- **Enabled** — basic codec conversion
- **Normalize** — conversion with compression
- **Loudnorm** — conversion with loudness normalization (good for consistent volume across systems)

---

## Verification Checklist

After deploying, check these to confirm everything works:

- [ ] `curl http://localhost:3022/api/v1/health` returns a 200 response
- [ ] The browser URL shows the scanner interface (or the setup page on first run)
- [ ] Admin login works and the dashboard loads
- [ ] A test upload from your recorder appears in Squelch
- [ ] The live scanner feed shows new calls in real time (this proves WebSockets are working) and plays them back (this proves audio HTTP fetches and cookies are working)

If one of those fails, [Troubleshooting](troubleshooting.md) lists the usual cause for each symptom.

---

## Advanced

Everything below is for less-common setups: binary installs, CLI flags, externally-managed secrets, and network hardening. Most users won't need any of it.

### Binary Install

Squelch also ships as a single executable for Linux, macOS, and Windows — no Docker, no external database.

#### Guided Setup

The easiest way is the built-in setup command, which creates directories, writes a config file, and installs a system service.

```bash
sudo ./squelch setup --interactive
```

It asks for:

- Listen address
- Database file path
- Recordings directory
- Config file location
- Install path for the binary

Once it's done, Squelch is running as a system service. Open the listen address in your browser to finish setup.

To accept platform defaults without prompting:

```bash
sudo ./squelch setup
```

#### Manual Run

If you'd rather just run it without installing a service:

```bash
./squelch --listen 0.0.0.0:3022 --db-file ./data/squelch.db --recordings-dir ./data/recordings
```

#### Platform Defaults

When you use `squelch setup`, paths are chosen for your OS:

**Linux:**

| Setting    | Default                                 |
| ---------- | --------------------------------------- |
| Config     | `/etc/squelch/squelch.json`     |
| Database   | `/var/lib/squelch/squelch.db`   |
| Recordings | `/var/lib/squelch/recordings`       |
| Executable | `/usr/local/bin/squelch`            |
| Service    | systemd / SysV / OpenRC (auto-detected) |

**macOS:**

| Setting    | Default                                         |
| ---------- | ----------------------------------------------- |
| Config     | `/usr/local/etc/squelch/squelch.json`   |
| Database   | `/usr/local/var/lib/squelch/squelch.db` |
| Recordings | `/usr/local/var/lib/squelch/recordings`     |
| Executable | `/usr/local/bin/squelch`                    |
| Service    | launchd                                         |

**Windows:**

| Setting    | Default                                      |
| ---------- | -------------------------------------------- |
| Config     | `%ProgramData%\Squelch\squelch.json` |
| Database   | `%ProgramData%\Squelch\squelch.db`   |
| Recordings | `%ProgramData%\Squelch\recordings`       |
| Executable | `%ProgramFiles%\Squelch\squelch.exe` |
| Service    | Windows Service Control Manager              |

You can override any of these with flags:

```bash
squelch setup \
  --listen 0.0.0.0:3022 \
  --db-file /opt/squelch/data.db \
  --recordings-dir /opt/squelch/recordings \
  --config /opt/squelch/config.json \
  --install-binary /opt/squelch/squelch
```

### Service Management

After `squelch setup`, the following commands manage the installed service:

| Command                                     | What it does                                                     |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `squelch setup`                         | Full install (create dirs, write config, install service, start) |
| `squelch setup --interactive`           | Same, with interactive prompts                                   |
| `squelch setup --force`                 | Overwrite existing setup / reinstall service                     |
| `squelch upgrade --binary /path/to/new` | Replace the installed binary and restart the service             |
| `squelch config validate`               | Check your JSON config file for errors                           |
| `squelch service doctor`                | Print service status and diagnostics                             |

For direct control:

```bash
squelch --service install --config /path/to/squelch.json
squelch --service start
squelch --service stop
squelch --service restart
squelch --service uninstall
```

#### Upgrading

```bash
curl -L -o /tmp/squelch-new https://github.com/revtex/squelch/releases/latest/...
squelch upgrade --binary /tmp/squelch-new
```

If the service was stopped before upgrading, it stays stopped afterwards.

### Configuration Reference

Squelch reads settings from three places, in this priority order:

**CLI flags > environment variables > JSON config file > built-in defaults**

Docker users will almost always use environment variables; binary users typically use the JSON config file written by `squelch setup`.

#### CLI Flags

| Flag                    | Description                                               | Default                |
| ----------------------- | --------------------------------------------------------- | ---------------------- |
| `--listen`              | HTTP listen address                                       | `:3022`                |
| `--db-file`             | SQLite database file path                                 | `squelch.db`       |
| `--recordings-dir`      | Directory for audio recordings                            | (executable directory) |
| `--ssl-listen`          | HTTPS listen address                                      | (disabled)             |
| `--ssl-cert`            | TLS certificate file (PEM)                                |                        |
| `--ssl-key`             | TLS private key file (PEM)                                |                        |
| `--ssl-auto-cert`       | Domain for Let's Encrypt auto-cert                        |                        |
| `--encryption-key`      | Key for encrypting secrets at rest                        |                        |
| `--encryption-key-file` | Path to a file containing the encryption key              |                        |
| `--timezone`            | IANA timezone for recorder timestamps                     | `UTC`                  |
| `--trusted-proxies`     | Proxy IPs/CIDRs allowed to set `X-Forwarded-For`, or `none` | loopback + private ranges |
| `--trusted-addresses`   | IPs/CIDRs that can never be blocked (loopback always is)  |                        |
| `--geoip-db`            | Path to an IP-to-country MMDB file                        | (off)                  |
| `--admin-password`      | Reset the first admin user's password on startup          |                        |
| `--config`              | Path to JSON config file                                  | `squelch.json`     |
| `--config-save`         | Write current flags to JSON config and exit               |                        |
| `--version`             | Print version and exit                                    |                        |
| `--service`             | Service command: install, uninstall, start, stop, restart |                        |

#### Environment Variables

| Variable                          | Maps to                 |
| --------------------------------- | ----------------------- |
| `SQUELCH_LISTEN`              | `--listen`              |
| `SQUELCH_DB_FILE`             | `--db-file`             |
| `SQUELCH_RECORDINGS_DIR`      | `--recordings-dir`      |
| `SQUELCH_SSL_LISTEN`          | `--ssl-listen`          |
| `SQUELCH_SSL_CERT`            | `--ssl-cert`            |
| `SQUELCH_SSL_KEY`             | `--ssl-key`             |
| `SQUELCH_SSL_AUTO_CERT`       | `--ssl-auto-cert`       |
| `SQUELCH_ENCRYPTION_KEY`      | `--encryption-key`      |
| `SQUELCH_ENCRYPTION_KEY_FILE` | `--encryption-key-file` |
| `SQUELCH_ADMIN_PASSWORD`      | `--admin-password`      |
| `SQUELCH_TIMEZONE`            | `--timezone`            |
| `SQUELCH_TRUSTED_PROXIES`     | `--trusted-proxies`     |
| `SQUELCH_TRUSTED_ADDRESSES`   | `--trusted-addresses`   |
| `SQUELCH_GEOIP_DB`            | `--geoip-db`            |
| `TZ`                              | `--timezone` (fallback) |

#### Env-Only Settings

A couple of toggles don't have matching CLI flags or JSON fields — they only exist as environment variables.

| Variable                          | Description                                                                                                                                                                                                                     | Default |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `SQUELCH_BLOCK_INTERNAL_HTTP` | When set to `1`, `true`, or `yes`, Squelch refuses outbound HTTP (transcription, downstream push) to private-network, loopback, link-local, and multicast addresses. Off by default so whisper and LAN scanners still work. | unset   |
| `SQUELCH_JWT_SECRET`          | Lets you supply the login-session signing key yourself instead of having Squelch auto-generate one. See [Externalizing the Login Signing Key](#externalizing-the-login-signing-key) below.                                  | unset   |

#### JSON Config File

You can save your settings to a JSON file so you don't need to pass flags every time:

```bash
squelch --listen 0.0.0.0:3022 --db-file /data/squelch.db --recordings-dir /data/recordings --config-save
```

That produces:

```json
{
  "listen": "0.0.0.0:3022",
  "db_file": "/data/squelch.db",
  "recordings_dir": "/data/recordings",
  "ssl_listen": "",
  "ssl_cert_file": "",
  "ssl_key_file": "",
  "ssl_auto_cert": "",
  "timezone": ""
}
```

Pass `--recordings-dir` if you want it in the file — left off, it defaults to the directory the executable sits in, and that is what gets saved. Temporary flags (`--admin-password`, `--config-save`, `--version`, `--service`) are never written. `--trusted-proxies` is written as `trusted_proxies`, `--trusted-addresses` as `trusted_addresses` and `--geoip-db` as `geoip_db`, each only when you have set it.

**The encryption key is never written to this file, and must never be added to it by hand.** Squelch refuses to start if it finds an `encryption_key` field there and prints:

```
squelch: refusing to start — remove 'encryption_key' from squelch.json; pass the key via --encryption-key, --encryption-key-file, or SQUELCH_ENCRYPTION_KEY
```

A config file written by an older version may still carry that field. Delete the line and supply the key with `--encryption-key`, `--encryption-key-file`, or `SQUELCH_ENCRYPTION_KEY` instead. An empty `"encryption_key": ""` is ignored — only a real value stops startup.

### Built-in TLS

Squelch can serve HTTPS itself in two ways.

#### With Your Own Certificate

```bash
squelch --ssl-listen :443 --ssl-cert /path/to/cert.pem --ssl-key /path/to/key.pem
```

#### Automatic Let's Encrypt (Experimental)

> **Warning:** This is implemented but hasn't been tested widely in production. For reliable TLS, a reverse proxy like Caddy is the safer bet.

```bash
squelch --ssl-auto-cert scanner.example.com
```

How it works:

1. Squelch uses Go's `autocert` library to talk to Let's Encrypt.
2. Let's Encrypt verifies you control the domain by fetching a file from `http://your-domain/.well-known/acme-challenge/...`. Squelch's HTTP listener answers automatically.
3. Once verified, a certificate is issued and Squelch serves HTTPS on port 443.
4. Certificates are cached in `autocert-cache/` next to the binary and renewed automatically.

Requirements:

- **Port 80** must be reachable from the internet (for the verification challenge)
- **Port 443** must be reachable (for HTTPS)
- **DNS** must point the domain to the server's public IP
- The domain passed to `--ssl-auto-cert` must match the DNS record exactly

In both TLS modes, non-challenge HTTP traffic is redirected to HTTPS.

#### Adding TLS After Setup

`squelch setup` doesn't configure TLS — it only writes listen address, database path, and recordings directory. To add TLS afterwards, either edit your JSON config file directly:

```json
{
  "listen": ":3022",
  "db_file": "/var/lib/squelch/squelch.db",
  "recordings_dir": "/var/lib/squelch/recordings",
  "ssl_listen": ":443",
  "ssl_cert_file": "/path/to/cert.pem",
  "ssl_key_file": "/path/to/key.pem"
}
```

Or merge new flags into the existing config with `--config-save`:

```bash
squelch --config /etc/squelch/squelch.json \
  --ssl-listen :443 \
  --ssl-cert /path/to/cert.pem \
  --ssl-key /path/to/key.pem \
  --config-save
```

Then restart the service:

```bash
squelch --service restart
```

The installed service reads `--config <path>` on every start, so no reinstall is needed.

### Externalizing the Login Signing Key

Squelch signs login sessions and API tokens with a secret it auto-generates on first startup and stores in the database. If you have your own secret-management setup (Kubernetes secrets, Vault, a `.env` file you already use for other services), you can supply the key yourself with `SQUELCH_JWT_SECRET`.

**Binary / shell:**

```bash
export SQUELCH_JWT_SECRET="$(openssl rand -hex 32)"
```

**Docker Compose:** put the key in your `.env` file, then reference it in `docker-compose.yml`:

```bash
echo "SQUELCH_JWT_SECRET=$(openssl rand -hex 32)" >> .env
```

```yaml
environment:
  - SQUELCH_JWT_SECRET=${SQUELCH_JWT_SECRET}
```

When set:

- Squelch uses this value and never reads or writes the database's `jwtSecret` setting.
- Encryption at rest still protects everything else in the table above — the web push key, downstream API keys, and Trunk Recorder broker passwords. You're just managing the session key yourself.
- Rotating the secret means changing the variable and restarting — existing sessions are invalidated and everyone logs in again.

For most setups you don't need this — the default (stored in the DB, encrypted if you set an encryption key) works fine.

### Blocking Outbound Traffic to Private Networks

By default, Squelch's outbound HTTP (to your transcription sidecar, downstream scanners, webhook targets) is allowed to reach private network addresses. That's what lets `http://whisper:8081` and other LAN services work.

If you're in a more locked-down environment and want to block outbound traffic to private, loopback, link-local, and multicast addresses, set:

```yaml
environment:
  - SQUELCH_BLOCK_INTERNAL_HTTP=1
```

Note that this will also block a whisper sidecar running on the same host, so only turn it on if all your downstream targets are on the public internet.

### Build from Source

#### Requirements

- Go 1.25+
- Node.js 22+ with pnpm
- Make

#### Build

```bash
make build
```

This builds the frontend, embeds it into the Go binary, and writes `build/squelch`.

#### Development

```bash
make dev    # Hot-reload backend (air) + Vite dev server with proxy
make test   # Run all backend + frontend tests
make lint   # Run linters
```
