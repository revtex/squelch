// The calls chart's series: one point per hour for 24 h and 7 d, one per
// local day for 30 d. The server only returns hours that had calls, so
// silent hours are filled with zeros here, or the line would skip them.
import type { ActivityBucket, ActivityRange } from "@/types";

export interface Point {
  /** Unix seconds at the start of the hour or day. */
  at: number;
  count: number;
}

export interface Series {
  unit: "hour" | "day";
  points: Point[];
}

const HOUR = 3600;
const RANGE_SECONDS: Record<ActivityRange, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
};

function localDayStart(unix: number): number {
  const d = new Date(unix * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function fillSeries(buckets: readonly ActivityBucket[], range: ActivityRange, now: number): Series {
  const byHour = new Map<number, number>();
  for (const b of buckets) byHour.set(b.hour, (byHour.get(b.hour) ?? 0) + b.count);
  const lastHour = Math.floor(now / HOUR) * HOUR;
  const firstHour = Math.floor((now - RANGE_SECONDS[range]) / HOUR) * HOUR + HOUR;

  if (range !== "30d") {
    const points: Point[] = [];
    for (let h = firstHour; h <= lastHour; h += HOUR) points.push({ at: h, count: byHour.get(h) ?? 0 });
    return { unit: "hour", points };
  }

  const byDay = new Map<number, number>();
  for (const [h, n] of byHour) {
    if (h < firstHour) continue;
    const day = localDayStart(h);
    byDay.set(day, (byDay.get(day) ?? 0) + n);
  }
  const points: Point[] = [];
  // Step by calendar day so a daylight-saving change keeps days whole.
  const cursor = new Date(localDayStart(firstHour) * 1000);
  const end = localDayStart(now);
  for (let day = localDayStart(firstHour); day <= end; ) {
    points.push({ at: day, count: byDay.get(day) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
    day = Math.floor(cursor.getTime() / 1000);
  }
  return { unit: "day", points };
}

/** A top for the y-axis that splits into four round steps. */
export function niceTop(max: number): number {
  if (max <= 4) return 4;
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Calls are whole, so steps below ten stay whole too (no 7.5 lines).
  const step =
    [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10]
      .map((m) => m * mag)
      .filter((v) => Number.isInteger(v))
      .find((v) => v >= raw) ?? 10 * mag;
  return step * 4;
}

export function peakOf(points: readonly Point[]): Point | null {
  let best: Point | null = null;
  for (const p of points) if (!best || p.count > best.count) best = p;
  return best && best.count > 0 ? best : null;
}

export function averageOf(points: readonly Point[]): number {
  if (points.length === 0) return 0;
  return Math.round(points.reduce((n, p) => n + p.count, 0) / points.length);
}
