/** Formatting shared by the admin pages: dates, durations and counts. */

export function formatDateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString();
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

/** "just now", "12m ago", "3h ago", "2d ago", or the date when older. */
export function formatAgo(unix: number, now = Date.now() / 1000): string {
  const s = Math.floor(now - unix);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 14 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return formatDate(unix);
}

/** "in 3d", "in 2h", or "expired" once past. */
export function formatUntil(unix: number, now = Date.now() / 1000): string {
  const s = Math.floor(unix - now);
  if (s <= 0) return "expired";
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `in ${Math.floor(s / 3600)}h`;
  return `in ${Math.floor(s / 86_400)}d`;
}

/** "1 device", "3 devices". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A date input's value ("2026-09-24") for a unix time, in local time. */
export function toDateInput(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The unix time at the end of the day a date input names, in local time. */
export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.floor(new Date(y, m - 1, d, 23, 59, 59).getTime() / 1000);
}

/** Bytes as a short size: "41.2 GB", "820 MB", "12 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  const digits = i === 0 ? 0 : n < 10 ? 1 : 0;
  return `${n.toFixed(digits)} ${units[i]}`;
}
