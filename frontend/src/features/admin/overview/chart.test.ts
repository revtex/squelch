import { describe, it, expect } from "vitest";
import { averageOf, fillSeries, niceTop, peakOf } from "./chart";

const NOW = 1_790_000_000 + 1800; // half past an hour

describe("fillSeries", () => {
  it("gives one point per hour over 24 h, zero where no calls came", () => {
    const hour = Math.floor(NOW / 3600) * 3600;
    const s = fillSeries([{ hour, count: 5 }, { hour: hour - 5 * 3600, count: 2 }], "24h", NOW);
    expect(s.unit).toBe("hour");
    expect(s.points).toHaveLength(24);
    expect(s.points[23]).toEqual({ at: hour, count: 5 });
    expect(s.points[18]).toEqual({ at: hour - 5 * 3600, count: 2 });
    expect(s.points.filter((p) => p.count === 0)).toHaveLength(22);
  });

  it("gives 168 hours over 7 days", () => {
    expect(fillSeries([], "7d", NOW).points).toHaveLength(7 * 24);
  });

  it("folds 30 days into local days and keeps the total", () => {
    const hour = Math.floor(NOW / 3600) * 3600;
    const buckets = [0, 1, 30, 200, 700].map((k) => ({ hour: hour - k * 3600, count: 1 }));
    const s = fillSeries(buckets, "30d", NOW);
    expect(s.unit).toBe("day");
    expect(s.points.length).toBeGreaterThanOrEqual(30);
    expect(s.points.length).toBeLessThanOrEqual(31);
    expect(s.points.reduce((n, p) => n + p.count, 0)).toBe(5);
  });
});

describe("chart scale", () => {
  it("rounds the top so four steps are round numbers", () => {
    expect(niceTop(1412)).toBe(1600);
    expect(niceTop(3)).toBe(4);
    expect(niceTop(90)).toBe(100);
    expect(niceTop(27)).toBe(32);
  });

  it("finds the peak and the average", () => {
    const pts = [
      { at: 1, count: 2 },
      { at: 2, count: 9 },
      { at: 3, count: 1 },
    ];
    expect(peakOf(pts)).toEqual({ at: 2, count: 9 });
    expect(peakOf([{ at: 1, count: 0 }])).toBeNull();
    expect(averageOf(pts)).toBe(4);
  });
});
