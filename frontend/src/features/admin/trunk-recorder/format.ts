// Display helpers shared across the Trunk Recorder dashboard views.
// Centralised so column formatting stays consistent and locale-friendly.

export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString();
}

export function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function fmtDuration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtFreqMHz(hz: number | undefined): string {
  if (hz == null || !Number.isFinite(hz) || hz <= 0) return "—";
  return `${(hz / 1_000_000).toFixed(4)} MHz`;
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function fmtNumber(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v !== "") return v;
  return "—";
}
