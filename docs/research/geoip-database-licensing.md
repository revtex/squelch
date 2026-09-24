# Licence terms for the free IP-to-country MMDB databases

Investigated 2026-09-24 for the admin "Connections" page, which will show each
listener's country resolved from an operator-supplied MMDB file. Squelch will
not bundle a database; the deployment guide points operators at one. This note
is the source for that guide section. Every source below was read on
2026-09-24 unless a different date is given.

Each finding is tagged:

- **[verified]** — read in the primary source at the cited URL.
- **[vendor]** — a vendor's own assertion (marketing or knowledge-base page),
  not a licence term.
- **[unconfirmed]** — could not be confirmed from a primary source.

## 1. MaxMind GeoLite2-Country

### The agreement

**[verified]** The agreement is the **"GeoLite End User License Agreement"**,
"Updated on: February 12, 2026", at
<https://www.maxmind.com/en/geolite/eula>. The older path
`https://www.maxmind.com/en/geolite2/eula` returns `302` to `/en/geolite/eula`.
The preamble says "Due to rebranding 'GeoLite' may be used with the same meaning
as 'GeoLite2'", so the database Squelch would read is still the file MaxMind
publishes as `GeoLite2-Country.mmdb`.

**[verified]** The previous version was dated December 7, 2020 (Wayback
snapshots of 2024-01-15 and 2025-09-14, both showing "Updated on: December 7,
2020"). A text diff of the 2025-09-14 snapshot against the live page shows the
February 2026 revision is a rebrand (`GeoLite2` → `GeoLite`) plus one wording
change in §6: "you will not disclose the Services to any third party *or after*
notifying MaxMind" became "*without* notifying MaxMind". Section numbering and
every other clause are the same.

**[verified]** §1 incorporates by reference the "Creative Commons Corporation
Attribution-ShareAlike 4.0 International License (the 'Creative Commons
License')", the MaxMind Data Processing Addendum ("DPA"), the Privacy Policy and
the Website Terms of Use. Precedence on conflict is "DPA, PP, WT and Creative
Commons License". Note the CC variant is **BY-SA**, not plain BY.

### Account and licence key

**[verified]** MaxMind's blog post "Significant Changes to Accessing and Using
GeoLite Databases" (Miguel Atienza, December 18, 2019,
<https://blog.maxmind.com/significant-changes-to-accessing-and-using-geolite-databases/>):

> Starting December 30, 2019, we will be requiring users of our GeoLite
> databases to register for a MaxMind account and obtain a license key in order
> to download GeoLite databases. We will continue to offer the GeoLite databases
> without charge, and with the ability to redistribute with proper attribution
> and in compliance with privacy regulations.

and: "Starting December 30, 2019, downloads will no longer be served from our
public GeoLite page, from geolite.maxmind.com/download/geoip/database/\*, or
from any other public URL." The stated reason is CCPA "Do Not Sell" requests:
"by requiring a MaxMind account and contact information from you, we will be
able to communicate all valid 'Do Not Sell' requests to you as we receive them."

**[verified]** The developer portal
(<https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/>) lists the
three GeoLite databases (Country, City, ASN) in `.mmdb` and `.csv`, requires a
MaxMind account, and defines the key: "A license key is like a password used to
authenticate database downloads or web service requests."

**[verified]** Download methods
(<https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases>,
<https://dev.maxmind.com/geoip/updating-databases/>): the `geoipupdate`
program, the account portal ("Download Files"), or a direct URL of the form
`https://download.maxmind.com/geoip/databases/<Edition>/download?suffix=<fmt>`
authenticated with HTTP Basic auth as `ACCOUNT_ID:LICENSE_KEY`
(`curl -O -J -L -u YOUR_ACCOUNT_ID:YOUR_LICENSE_KEY '<url>'`).

### Redistribution and bundling

**[verified]** §3 "Limited grant of rights":

> to the extent the Services contain any copyrightable elements those
> copyrightable elements are governed by the Creative Commons License. You must
> provide attribution of your use to MaxMind (an example of attribution: "This
> product includes GeoLite Data created by MaxMind, available from
> https://www.maxmind.com."

and a second, separate grant for internal use: "a non-exclusive,
non-transferable limited license to access and use the Services for your own
internal business purposes." Also: "you may not remove or obscure any copyright
notice or other notice or terms of use contained in the Services."

**[verified]** §6 "Disclosure of Services":

> Except as explicitly permitted by the Creative Commons License, you will not
> disclose the Services to any third party without notifying MaxMind of the
> anticipated disclosure and obtaining MaxMind's prior written consent to the
> disclosure. To the extent you disclose the Services to a third party as
> permitted by this Agreement, you will impose upon the third party the same or
> substantially similar contractual duties imposed on you and the rights
> provided to MaxMind as in this Agreement, including those in Section 3
> (LIMITED GRANT OF RIGHTS), Section 6 (ADDITIONAL RESTRICTIONS), and the DPA
> and, where not inconsistent with the other terms of this Agreement, as in the
> Creative Commons License. You are responsible for the acts or omissions of any
> third parties with which you share the Services.

**[vendor]** MaxMind's knowledge base reads this as: "if you share the GeoLite
Databases or GeoLite Data with others, you need to hold others to the same or
substantially similar requirements"
(<https://support.maxmind.com/knowledge-base/articles/who-is-covered-by-the-geolite-end-user-license-agreement>).
A paid "Commercial Redistribution License" exists for anyone who wants to
"distribute an unlimited number of copies of the GeoLite databases to your
customers and users as part of a single reseller product" without attribution
(<https://support.maxmind.com/knowledge-base/articles/commercial-license-for-geolite>).

**[unconfirmed]** Whether copying `GeoLite2-Country.mmdb` into a third-party
Docker image is "explicitly permitted by the Creative Commons License" (and so
exempt from the written-consent step) or is a "disclosure" that needs consent
and a flow-down of §3/§6/DPA. Neither the EULA nor any MaxMind knowledge-base
page mentions container images or software packages. The two clauses pull in
opposite directions and only MaxMind can resolve it. Squelch does not bundle a
database, so this does not need resolving for us; it is the reason not to.

### Attribution

**[verified]** The EULA's own wording is an *example*, not a mandated string:
"You must provide attribution of your use to MaxMind (an example of
attribution: 'This product includes GeoLite Data created by MaxMind, available
from https://www.maxmind.com.'" (§3).

**[vendor]** Where it goes:

> The GeoLite End User License Agreement allows you to use data from GeoLite
> databases and web services to build applications that are available to users
> outside your company or organization, or to display that data to users
> outside your organization, as long as you attribute the data to MaxMind. An
> example of an acceptable attribution would be including the following in all
> advertising and documentation mentioning features of or use of GeoLite data:
> "This product includes GeoLite Data created by MaxMind, available from
> https://www.maxmind.com."

(<https://support.maxmind.com/knowledge-base/articles/sell-or-display-data-from-geolite-databases-and-web-services>).
No MaxMind page says the notice must be in a user interface; "advertising and
documentation" is the only placement MaxMind names.

### Update cadence and the 30-day rule

**[verified]** Publication schedule
(<https://support.maxmind.com/knowledge-base/articles/download-and-update-maxmind-databases>):
GeoLite Country and GeoLite City "Every Tuesday and Friday"; GeoLite ASN "Every
weekday (Monday through Friday)".

**[verified]** §6 "Destructions of GeoLite Database and GeoLite Data", the
exact wording:

> From time to time, MaxMind will release an updated version of the GeoLite
> Databases, and you agree to promptly use the updated version of the GeoLite
> Databases. You shall cease use of and destroy (i) any old versions of the
> Services within thirty (30) days following the release of the updated GeoLite
> Databases; and (ii) all Services immediately upon termination of the license
> under this Agreement. Upon request, you shall provide MaxMind with written
> confirmation of such destruction.

The developer portal restates it as "you must delete GeoLite databases within
30 days of a new release", and the knowledge base as "Customers have 30 days to
delete outdated databases"
(<https://support.maxmind.com/knowledge-base/articles/maintain-up-to-date-data>).
Because a new Country release ships twice a week, in practice an operator must
refresh the file at least every 30 days.

### Restrictions on use and accuracy

**[verified]** There is **no restriction on using the data for blocking** and
**no restriction on country-level accuracy claims**. The restrictions that do
exist:

- §4: no FCRA use (credit, insurance, employment, government-licence
  eligibility).
- §5 "Accuracy expectation": "none of the Services reliably identifies any
  geographic level or division more precise than the zip code or postal code
  associated with an IP address. Accordingly, it is imperative that you and
  your end users not rely on the GeoLite Data to identify a specific household,
  individual, or street address," and a warranty "that you will not use or
  encourage others to use the GeoLite Data for the purpose of identifying or
  locating a specific household, individual, or street address."
- §6 "Security of the Services": maintain "reasonable and appropriate technical
  and organizational measures" protecting the database, and notify MaxMind of
  any "data incident involving the Services".
- §12: furnished "as-is" with "no warranty, express or implied, with respect to
  their capability, accuracy, or completeness."

**[vendor]** The developer portal adds "IP geolocation is inherently imprecise"
and that GeoLite City "is not recommended for commercial use cases"; the GeoLite
marketing page advertises "Country-level compliance in regions where territory
is not disputed" (<https://www.maxmind.com/en/geolite-free-ip-geolocation-data>).

### Geography-based terms (the "EU" question)

**[verified]** There is **no EU, EEA or other regional restriction on who may
use GeoLite** in any version read: the live February 2026 text, the 2025-09-14
snapshot and the 2024-01-15 snapshot (both dated December 7, 2020). The only
geography-flavoured clause is §18 "Compliance with law", which is US export
control, present unchanged in all three versions:

> ... including all applicable export and re-export control laws and
> regulations, such as the Export Administration Regulations ("EAR") maintained
> by the USA Department of Commerce, trade and economic sanctions maintained by
> the USA Treasury Department's Office of Foreign Assets Control, and the
> International Traffic in Arms Regulations ("ITAR") ... you agree that you
> shall not, directly or indirectly, sell, export, re-export, transfer, divert,
> or otherwise dispose of any Services (including products derived from or
> based on such Services) to any destination, entity, or person prohibited by
> the laws or regulations of the USA ...

Governing law is Massachusetts (§13). If a 2024/2025 "geography-based term" was
remembered, this export-control clause is the likeliest candidate. **[vendor]**
The GDPR overview page says only that "MaxMind is covered by the GDPR in
situations where MaxMind processes personal data of MaxMind customers, including
but not limited to customer end users, if those individuals are located in the
EU" (<https://support.maxmind.com/knowledge-base/articles/overview-of-gdpr-and-other-privacy-laws>).

## 2. DB-IP "IP to Country Lite"

### Licence and attribution

**[verified]** Both <https://db-ip.com/db/lite.php> and the download page
<https://db-ip.com/db/download/ip-to-country-lite> link the licence to
`http://creativecommons.org/licenses/by/4.0/` and say, verbatim:

> The free IP to Country Lite database by DB-IP is licensed under a Creative
> Commons Attribution 4.0 International License.
>
> You are free to use this IP to Country Lite database in your application,
> provided you give attribution to DB-IP.com for the data.
>
> In the case of a web application, you must include a link back to DB-IP.com
> on pages that display or use results from the database. You may do it by
> pasting the HTML code snippet below into your code :

```html
<a href='https://db-ip.com'>IP Geolocation by DB-IP</a>
```

**[verified]** The Terms of Service (<https://db-ip.com/tos.php>) carve the
free downloads out of the commercial terms: "The terms above do not apply to
the free database downloads which are licensed under the terms of the Creative
Commons Attribution 4.0 International License". The commercial terms are the
ones that forbid competing API services and redistribution; they do not apply
to Lite.

**[verified]** "The DB-IP Lite databases are subsets of the commercial
databases with reduced coverage and accuracy" (lite.php); "The free IP to
Country Lite database is a subset of the IP to Country database with reduced
coverage and accuracy" (download page). DB-IP does not publish accuracy
figures for Lite beyond an internal "Accuracy Index".

### Update cadence and download URL

**[verified]** "Our IP to Country Lite database is updated monthly and
available in CSV and MMDB formats" (download page); "Lite downloads are updated
monthly" (lite.php).

**[verified]** The download page links directly to
`https://download.db-ip.com/free/dbip-country-lite-2026-09.mmdb.gz` (and the
`.csv.gz` twin). No account, key or cookie is needed. `HEAD` requests on
2026-09-24:

| URL | Status | Size | Last-Modified |
| --- | --- | --- | --- |
| `.../free/dbip-country-lite-2026-09.mmdb.gz` | 200 | 4,116,896 B | Tue, 01 Sep 2026 06:27:01 GMT |
| `.../free/dbip-country-lite-2026-08.mmdb.gz` | 200 | 4,096,588 B | Sat, 01 Aug 2026 06:33:49 GMT |

So the pattern `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`
holds, the file lands on the 1st of the month, and the previous month stays
available.

**[verified]** MMDB layout
(<https://db-ip.com/db/format/ip-to-country-lite/mmdb.html>): "compliant with
version 2.0 of the specification and is compatible with free MMDB reader
libraries". Fields: `continent.code`, `continent.geoname_id`,
`continent.names`, `country.geoname_id`, `country.iso_code`,
`country.is_in_european_union`, `country.names`. Those are the same field
names GeoLite2-Country uses, so one reader struct serves both files.

### What CC BY 4.0 itself says about redistribution

Read at <https://creativecommons.org/licenses/by/4.0/legalcode.en>.

**[verified]** §2(a)(1): "the Licensor hereby grants You a worldwide,
royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise
the Licensed Rights in the Licensed Material to: reproduce and Share the
Licensed Material, in whole or in part; and produce, reproduce, and Share
Adapted Material."

**[verified]** §1(i): "Share means to provide material to the public by any
means or process that requires permission under the Licensed Rights, such as
reproduction, public display, public performance, distribution, dissemination,
communication, or importation, and to make material available to the public
including in ways that members of the public may access the material from a
place and at a time individually chosen by them."

**[verified]** §3(a)(1), the conditions that attach "If You Share the Licensed
Material (including in modified form)":

- (A) retain, if supplied by the Licensor: "(i) identification of the
  creator(s) of the Licensed Material and any others designated to receive
  attribution, in any reasonable manner requested by the Licensor"; "(ii) a
  copyright notice"; "(iii) a notice that refers to this Public License"; "(iv)
  a notice that refers to the disclaimer of warranties"; "(v) a URI or
  hyperlink to the Licensed Material to the extent reasonably practicable";
- (B) "indicate if You modified the Licensed Material and retain an indication
  of any previous modifications"; and
- (C) "indicate the Licensed Material is licensed under this Public License,
  and include the text of, or the URI or hyperlink to, this Public License."

§3(a)(2): "You may satisfy the conditions in Section 3(a)(1) in any reasonable
manner based on the medium, means, and context in which You Share the Licensed
Material. For example, it may be reasonable to satisfy the conditions by
providing a URI or hyperlink to a resource that includes the required
information." §3(a)(3): the Licensor may ask for the 3(a)(1)(A) information to
be removed.

**[verified]** §2(a)(5)(B) "No downstream restrictions": "You may not offer or
impose any additional or different terms or conditions on, or apply any
Effective Technological Measures to, the Licensed Material if doing so
restricts exercise of the Licensed Rights by any recipient of the Licensed
Material." §4 confirms the grant covers "the right to extract, reuse,
reproduce, and Share all or a substantial portion of the contents of the
database" where sui generis database rights apply.

**Reading these together.** Bundling `dbip-country-lite.mmdb` in a Docker
image or shipping it in a release tarball is "Sharing" and is permitted
outright; the price is the §3(a) notice set (creator, licence link, a link to
the material, a modification statement if any). The DB-IP "link back on pages
that display or use results" wording is stricter than the legal code: the
legal code's conditions trigger on *Sharing the material*, and a page that
shows a country name derived from a lookup is not obviously sharing the
database. But §3(a)(1)(A)(i) says attribution is given "in any reasonable
manner requested by the Licensor", and the link snippet is that request, so
the practical rule is: **[vendor]** put `IP Geolocation by DB-IP` linked to
`https://db-ip.com` on pages that show results.

### Privacy

**[unconfirmed]** DB-IP says nothing about GDPR or the privacy implications of
geolocating end users with the Lite database. Its privacy policy
(<https://db-ip.com/privacy.php>) covers only visitors to db-ip.com.

## 3. `github.com/oschwald/maxminddb-golang`

Read from the repository via the GitHub API on 2026-09-24.

**[verified]** `go.mod` on `main`:
`module github.com/oschwald/maxminddb-golang/v2`, `go 1.26.0`. The README
installs it as `go get github.com/oschwald/maxminddb-golang/v2` and requires
"Go 1.26 or later". Latest release **v2.6.0** (2026-09-07); v2.0.0 shipped
2025-10-18 (`CHANGELOG.md`). v2.6.0's notes are worth knowing for an
operator-supplied file: it "Fixed a denial-of-service issue where a crafted
database could use repeated pointers to cause excessive CPU and memory use
during reflection decoding" and added `maxsize:N` struct-tag limits, so use
this version or later, not v1. The README also states "This is not an official
MaxMind API."

**[verified]** Licence is **ISC**: `LICENSE` reads "ISC License / Copyright (c)
2015, Gregory J. Oschwald" with the standard ISC permission and disclaimer
text; pkg.go.dev shows the same.

**[verified]** Pure Go, no cgo: a GitHub code search for `import "C"` in the
repository returns 0 hits, and none of `reader.go`, `result.go`, `traverse.go`
or the `mmap_*.go` files declare cgo. Memory mapping goes through
`golang.org/x/sys` behind build tags:

- `mmap_unix.go`: `//go:build !windows && !appengine && !plan9 && !js && !wasip1 && !wasi` (uses `golang.org/x/sys/unix`)
- `mmap_windows.go`: `//go:build windows && !appengine` (uses `golang.org/x/sys/windows`)
- `mmap_stub.go`: `//go:build appengine || plan9 || js || wasip1 || wasi`

So it builds with `CGO_ENABLED=0` on the alpine image. Runtime dependency is
`golang.org/x/sys v0.48.0`; `testify`, `x/tools`, `x/mod`, `x/sync`, `yaml`
are test/tool-only.

**[verified]** Test fixtures: `.gitmodules` declares `testdata` as a submodule
of `https://github.com/maxmind/MaxMind-DB.git`, pinned at commit
`b532ae5dbdbdb04a9588a631af0030e01cbcdcd0` (committed 2026-08-29). Tests open
them via `testFile("GeoLite2-City-Test.mmdb")` etc.; `GeoIP2-Country-Test.mmdb`
is referenced from `reader_test.go`, `traverse_test.go` and `verifier_test.go`.
The submodule content is not vendored into the Go module, so Squelch's build
never pulls the fixtures.

**[verified]** `maxmind/MaxMind-DB` (`README.md`): "This software is Copyright
(c) 2013 - 2026 by MaxMind, Inc. This is free software, licensed under the
Apache License, Version 2.0 or the MIT License", with both `LICENSE-APACHE` and
`LICENSE-MIT` at the root. `test-data/` contains `GeoIP2-Country-Test.mmdb`,
`GeoLite2-Country-Test.mmdb` and `GeoIP2-Country-Shield-Test.mmdb`, generated
by `go run ./cmd/write-test-data` from JSON in `source-data/`
(`test-data/README.md`). Neither `test-data/README.md` nor the root README
carves the fixtures out of the repository licence, so they sit under the same
Apache-2.0 OR MIT dual licence. They are synthetic (a handful of documented
IPs), not extracts of GeoLite2, so the GeoLite EULA does not attach to them.
If Squelch ever copies one into its own tests for a fixture, it needs the
MaxMind copyright line plus the MIT or Apache notice.

## 4. Privacy and GDPR statements from the vendors

**[verified]** The GeoLite EULA §7 "Personal data" incorporates the DPA "to the
extent the parties process any Personal Information (as defined in the DPA) in
connection with your use of the Services", and gives the DPA precedence over
the rest of the EULA on that subject.

**[unconfirmed]** The DPA body. It is served only as a PDF at
<https://www.maxmind.com/data-processing-addendum.pdf> (search-index title:
"MaxMind Data Processing Addendum (July 2025)"); the file uses subsetted-font
glyph encoding and no PDF text tool was available in this environment, so its
controller/processor allocation and any end-user-notice obligations for
database (offline) customers could not be read. Read it before writing any
GDPR sentence that goes beyond "the EULA incorporates a DPA".

**[verified]** MaxMind's Privacy Policy (last updated August 11, 2026,
<https://www.maxmind.com/en/privacy-policy>) lists "Device identifiers,
including IP address" as personal information, says "MaxMind's services are not
intended to be used for the purpose of locating or identifying a specific
individual or household", and offers a web-form opt-out for an IP address.
**[vendor]** The knowledge base explains the visible effect on a downloaded
database: when a lookup "does not return at least country-level data, that
nearly always indicates that the owner of the IP has submitted a valid Do Not
Sell My Personal Information request, or that the IP is used by an anonymizing
proxy" (<https://support.maxmind.com/knowledge-base/articles/maxmind-geolocation-coverage>).
That is also the stated reason for the 30-day refresh rule: the 2019 blog post
says honouring "Do Not Sell" requests "involves MaxMind removing IP addresses
from the GeoLite data and communicating to GeoLite users that the IP addresses
in question should (immediately) not be utilized".

**[verified]** DB-IP makes no statement at all (see §2 above).

Neither vendor tells a self-hosted operator whether resolving a listener's IP
to a country is itself GDPR-relevant processing; that is the operator's own
analysis. MaxMind's contractual asks that bear on it are the ones already
listed: keep the file current (30 days), do not use it to identify a household
or individual, and keep the database itself secured.

## What this means for Squelch

**Recommendation: default the deployment guide to DB-IP IP to Country Lite;
document GeoLite2-Country as the alternative.** DB-IP is a single unauthenticated
`curl` with a predictable URL, CC BY 4.0 with a one-line attribution, monthly
cadence with no purge clause, and the same MMDB field names as GeoLite2.
GeoLite2 needs an account, a licence key stored on the host, a twice-weekly
release with a contractual 30-day destroy-old-copies duty, a BY-SA plus
written-consent redistribution regime, and a DPA nobody has read. Country-level
accuracy is what the Connections page needs, and DB-IP does not restrict it.

**What the deployment guide must say** (per database):

- *DB-IP*: download `https://download.db-ip.com/free/dbip-country-lite-YYYY-MM.mmdb.gz`,
  gunzip (8.3 MB uncompressed for 2026-09), point the configured database path
  at it, refresh monthly (file appears on the 1st);
  licence CC BY 4.0; attribution is handled by Squelch's UI when this database
  is in use (see below). Link <https://db-ip.com/db/lite.php>.
- *GeoLite2-Country*: requires a free MaxMind account and licence key
  (<https://www.maxmind.com/en/geolite2/signup>); fetch with `geoipupdate` or
  the Basic-auth download URL; **you must replace the file within 30 days of
  each MaxMind release** (they ship Tuesdays and Fridays) and delete old
  copies, per the GeoLite EULA §6; do not use it to identify a household or
  individual (§5); the EULA is CC BY-SA 4.0 plus MaxMind's own terms and asks
  for attribution "in all advertising and documentation" of the feature. Link
  <https://www.maxmind.com/en/geolite/eula>.
- Both: Squelch does not ship, mirror or redistribute either file; the
  operator is the licensee. Say this explicitly so nobody later "helpfully"
  adds one to the Docker image, which would put the project under MaxMind §6
  or DB-IP CC BY §3(a) sharing conditions.

**What notice the UI must show.** Squelch can read the MMDB metadata and
render the matching credit on the Connections page footer, next to the country
column. **[verified]** The `database_type` metadata field is
`DBIP-Country-Lite` in the 2026-09 DB-IP file (description
"DB-IP.com - IP to Country") and `GeoLite2-Country` in MaxMind's
`GeoLite2-Country-Test.mmdb` fixture, both read from the files' metadata
sections on 2026-09-24; the production GeoLite2 file could not be downloaded
without an account, so the MaxMind string is confirmed from the fixture only.

- DB-IP: the vendor's requested snippet, verbatim:
  `<a href="https://db-ip.com">IP Geolocation by DB-IP</a>`. This is a
  requirement DB-IP states for "pages that display or use results".
- GeoLite2: "This product includes GeoLite Data created by MaxMind, available
  from https://www.maxmind.com." MaxMind names documentation and advertising,
  not the UI, as the placement, so the same sentence must also appear in the
  deployment guide; showing it in the UI as well costs nothing and covers the
  "display that data to users outside your organization" case.
- Unknown `database_type`: no credit line; the operator owns whatever licence
  applies.

Only the page that shows the resolved country needs the line; nothing else in
Squelch, and nothing in the README, has to mention either vendor, because
Squelch itself uses no GeoLite or DB-IP data.

**Reader.** `github.com/oschwald/maxminddb-golang/v2` at v2.6.0 or later, ISC,
pure Go, so the alpine `CGO_ENABLED=0` build is unaffected; add its ISC notice
to whatever third-party-licence listing the binary already carries. Do not copy
the MaxMind-DB test fixtures into the repo; generate a tiny fixture with
[`github.com/maxmind/mmdbwriter`](https://github.com/maxmind/mmdbwriter)
(Apache-2.0, actively maintained, last push 2026-09-23) in a test helper
instead, which also avoids carrying a MaxMind copyright line.

## Unconfirmed items, collected

1. Whether bundling `GeoLite2-Country.mmdb` in a third-party Docker image is
   "explicitly permitted by the Creative Commons License" (no consent needed)
   or a §6 disclosure needing MaxMind's written consent. Not addressed by any
   MaxMind page. Moot for Squelch.
2. The MaxMind DPA's contents (roles, end-user notice duties for offline
   database customers). PDF not readable here; title dated July 2025.
3. Any explicit MaxMind position that a GeoLite attribution must appear inside
   a UI. MaxMind only names "advertising and documentation".
4. Any DB-IP statement on privacy or GDPR for users of the Lite database.
   There is none.
5. Whether the EULA's export-control §18 is what was recalled as a
   "geography-based" 2024/2025 term. No EU/EEA restriction exists in the
   2024-01, 2025-09 or 2026-02 texts; the 2024-09 and 2025-01 Wayback
   captures returned redirect stubs and were not readable, so a short-lived
   intermediate revision cannot be ruled out, only judged unlikely given the
   identical "December 7, 2020" date on both sides of that gap.
