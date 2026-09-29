import type { ConnectionKind } from "@/types";

/** Domain words for each kind of connection (see CONTEXT.md). */
export const KIND_LABELS: Record<ConnectionKind, string> = {
  listener: "LIVE",
  admin: "Admin",
  stream: "BKGND",
};

/** LIVE is navy, BKGND green, an admin socket plain. */
export const KIND_BADGE: Record<ConnectionKind, string> = {
  listener: "badge-info",
  stream: "badge-success",
  admin: "",
};

const REASON_LABELS: Record<string, string> = {
  client: "Left",
  signout: "Signed out",
  revalidation: "Account disabled or expired",
  shutdown: "Server stopped",
  admin: "Disconnected by an admin",
  blocked: "Blocked",
};

export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  return REASON_LABELS[reason] ?? reason;
}

export function clientLabel(native: boolean): string {
  return native ? "Squelch app" : "Browser";
}

function osOf(ua: string): string | null {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function browserOf(ua: string): string | null {
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  return (
    pick(/Edg(?:e|A|iOS)?\/(\d+)/, "Edge") ??
    pick(/OPR\/(\d+)/, "Opera") ??
    pick(/(?:Firefox|FxiOS)\/(\d+)/, "Firefox") ??
    pick(/(?:Chrome|CriOS)\/(\d+)/, "Chrome") ??
    (/Safari\//.test(ua) ? pick(/Version\/(\d+)/, "Safari") : null)
  );
}

/**
 * What a connection is, from its user agent: "Chrome 129 · Windows",
 * "Squelch app · Android". Falls back to "Browser" or "Squelch app".
 */
export function deviceLabel(userAgent: string | null, native: boolean): string {
  const ua = userAgent ?? "";
  if (native) {
    const os = /okhttp|Android/i.test(ua)
      ? "Android"
      : /CFNetwork|Darwin|iPhone|iPad|iOS/.test(ua)
        ? "iOS"
        : null;
    return os ? `Squelch app · ${os}` : "Squelch app";
  }
  const browser = browserOf(ua);
  const os = osOf(ua);
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? (os ? `Browser · ${os}` : "Browser");
}
