# 0007. Hand share links to the app with a custom scheme, not Universal Links

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

Share links look like `https://<server>/call/<token>` and open the
`SharedCall` page. With a native client in development, the obvious next step
is to have that link open the app: Android App Links and iOS Universal Links
exist for exactly this, and the mechanism is a static association file the
server publishes — `/.well-known/assetlinks.json` and
`apple-app-site-association`. Serving two files from the Go binary is a small
change, and it was filed as an upstream dependency on that assumption.

The assumption is wrong for a self-hosted product, and the reason is worth
recording because it will look like an oversight to anyone who has shipped
deep links on a single-domain app.

**Both platforms bind the app to its domains at signing time.** iOS reads the
domain list from the `com.apple.developer.associated-domains` entitlement,
fixed when the app is signed. Android verifies only hosts declared in
`AndroidManifest.xml`. Every squelch instance lives on a domain the app has
never heard of, and neither platform accepts a host supplied at install time
or runtime, so one generic build published to the stores cannot ever claim
`https://some-operator.example/call/<token>`.

Three further findings, from the research note in the mobile repo, close the
escape routes someone will reach for:

- **iOS never fetches the file from the server.** Since iOS 14, Apple states
  that requests for `apple-app-site-association` go to an Apple-operated CDN
  rather than the origin, and the file must be "hosted on a domain that is
  available to all IP addresses and ranges". A LAN-only, VPN-only or
  split-horizon instance is invisible to that CDN by construction. The
  `?mode=developer` bypass requires a development-signed build and per-device
  opt-in, so it does not exist for a shipping app.
- **Android's user-granted path is manifest-gated too.** "Open by default"
  offers only hosts the app declared; there is no free-text entry, and a
  host-less `<data android:scheme="https"/>` filter contributes no grantable
  hosts. So the fallback is not "the link opens a chooser" — on an
  undeclared host there is nothing to choose.
- **Ports rule it out independently.** iOS forbids port numbers in `applinks`
  entirely, and self-hosters on `:8443` are ordinary.

## Decision

The shared-call page offers an explicit **"Open in app"** handoff to a custom
URL scheme, `squelch://call/<token>?server=<origin>`, shown only on a phone
and only for a well-formed share token.

On Android the link uses the `intent://` form carrying
`S.browser_fallback_url`, so a visitor without the app stays on the page
instead of seeing a failed navigation.

The server publishes no association files. `/.well-known/*` and
`/apple-app-site-association` return 404 — which is the correct answer for a
server that has no association, and better than the HTTP 200 plus HTML the SPA
fallback used to give a verifier.

The token is validated against the UUID shape the share endpoint issues before
it is interpolated into the intent URL, because `;` and `#` are structural
there: a token carrying either could rewrite the intent's target package or
its extras.

## Consequences

**The iOS branch has a wart with no server-side fix.** When no app handles the
scheme, Safari reports that the address is invalid, and a web page cannot
detect whether an app is installed. A visitor who taps a button labelled "Open
in app" without having the app gets an error dialog. This is accepted rather
than solved: the alternatives are worse (a timing-based probe is unreliable
and user-hostile) and the button is self-describing. The builder keeps the iOS
branch separate from the Android one specifically so it can be switched off
without touching a path that behaves correctly.

The handoff is unverifiable by construction — any app may register a custom
scheme, so a hostile app on the device could claim `squelch://` and receive a
share token. The token grants read access to one call, the same as the link
the user was already holding in a browser, so this is a small exposure and not
a new class of one. Universal Links would have prevented it, but only for
domains an app cannot have.

Share links keep working exactly as before for everyone else. The button is
additive, and the page remains the destination when it is ignored.

## Alternatives considered

**Serve association files from every instance** — the original plan. Does
nothing for a generic store build, for the reasons above. It would only help
an operator who rebuilds the app with their own domain in the manifest and
entitlement, which is a different product.

**A wildcard-subdomain redirector** on a project-controlled public domain.
This genuinely works: iOS supports `applinks:*.share.example`, and Android
matches `*.`-prefixed domains at both verified and user-selected level, so
each operator could be given a subdomain that redirects into their instance.
Rejected because it makes a self-hosted product depend on a central service
the project must run forever, changes every share URL away from the operator's
own host, and lets that central host learn which instance each link belongs
to. Reconsider only if the project ever runs hosted instances anyway.

**Do nothing and let the link open the browser.** This is what still happens
for anyone who ignores the button, and it is fine — the page plays the call.
The handoff exists because the app can do more with a call than the page can.
