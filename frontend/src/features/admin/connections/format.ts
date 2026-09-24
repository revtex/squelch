import type { ConnectionKind } from "@/types";

/** Domain words for each kind of connection (see CONTEXT.md). */
export const KIND_LABELS: Record<ConnectionKind, string> = {
  listener: "LIVE",
  admin: "Admin",
  stream: "BKGND",
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

export function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

/** "45s", "12m", "3h 04m", "2d 5h". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
