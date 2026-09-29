/**
 * Handing a share link to the native app.
 *
 * Universal Links / App Links cannot do this job for a self-hosted server:
 * both platforms bind the app-to-domain association at signing time, and a
 * squelch instance lives on a domain the app has never heard of. iOS makes it
 * doubly impossible, fetching `apple-app-site-association` through an
 * Apple-operated CDN that a LAN-only instance is invisible to. So the page
 * offers an explicit handoff to a custom scheme instead — the only mechanism
 * that works on an arbitrary host, behind a VPN, or on a non-443 port.
 *
 * See docs/adr/0007-share-link-app-handoff.md.
 */

/** URL scheme the native apps register. */
const APP_SCHEME = "squelch";

/** Android package that claims the scheme, used for the `intent://` form. */
const ANDROID_PACKAGE = "io.github.revtex.squelch";

/**
 * Share tokens are UUIDs (`uuid.New().String()` in
 * `backend/internal/handler/share/share.go`). The token is interpolated into
 * an `intent://` URL, where `;` and `#` are structural, so anything that is
 * not a token the server could have issued is refused outright rather than
 * escaped and hoped for. Encoding alone would be enough today; this survives
 * the encoding being dropped by a later edit.
 */
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HandoffPlatform = "android" | "ios";

export interface AppHandoff {
  /** Value for the anchor's href. */
  href: string;
  platform: HandoffPlatform;
}

/**
 * Detect the platform from a user-agent string. Deliberately narrow: an
 * unrecognised agent gets no button, because a custom-scheme link that
 * matches nothing is a dead end on a desktop browser.
 */
export function detectHandoffPlatform(
  userAgent: string,
): HandoffPlatform | null {
  if (/android/i.test(userAgent)) return "android";
  // iPadOS 13+ reports a desktop Safari agent; the touch-point check is the
  // documented way to tell it apart, and is passed in rather than read here
  // so this stays a pure function.
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  return null;
}

export interface BuildHandoffArgs {
  token: string | undefined;
  /** The page the browser should stay on when no app takes the link. */
  pageUrl: string;
  /** Origin of the squelch server this link came from. */
  origin: string;
  userAgent: string;
}

/**
 * Build the handoff URL for this page, or null when there is nothing sensible
 * to offer.
 */
export function buildAppHandoff({
  token,
  pageUrl,
  origin,
  userAgent,
}: BuildHandoffArgs): AppHandoff | null {
  if (!token || !TOKEN_PATTERN.test(token)) return null;

  const platform = detectHandoffPlatform(userAgent);
  if (platform === null) return null;

  const query = `server=${encodeURIComponent(origin)}`;
  const path = `call/${encodeURIComponent(token)}`;

  if (platform === "android") {
    // `S.browser_fallback_url` is the whole reason to prefer the intent form:
    // with no app installed the browser stays on this page instead of
    // reporting a failed navigation.
    const fallback = encodeURIComponent(pageUrl);
    return {
      platform,
      href:
        `intent://${path}?${query}#Intent;scheme=${APP_SCHEME};` +
        `package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`,
    };
  }

  // iOS has no fallback mechanism: Safari reports an invalid address when
  // nothing handles the scheme, and the page cannot detect whether the app is
  // installed. That wart is accepted deliberately — see the ADR — and this
  // branch is kept separate from the Android one so it can be switched off
  // without touching a path that behaves correctly.
  return { platform, href: `${APP_SCHEME}://${path}?${query}` };
}
