import { describe, it, expect } from "vitest";
import { formatAgo, formatClock, formatDay, formatDuration, formatUntil, formatWhen } from "./format";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

describe("formatDay", () => {
  it("writes the local day as year-month-day", () => {
    expect(formatDay(at(2026, 3, 7, 23, 59))).toBe("2026-03-07");
  });
});

describe("formatWhen", () => {
  const now = at(2026, 9, 25, 10, 0);

  it("says Today and Yesterday for the last two days", () => {
    expect(formatWhen(at(2026, 9, 25, 8, 2), { now })).toBe("Today 08:02");
    expect(formatWhen(at(2026, 9, 24, 21, 14), { now })).toBe("Yesterday 21:14");
  });

  it("gives the date further back", () => {
    expect(formatWhen(at(2026, 9, 22, 14, 11), { now })).toBe("2026-09-22 14:11");
  });

  it("uses a 12-hour clock when asked", () => {
    expect(formatWhen(at(2026, 9, 25, 14, 5), { now, hour12: true })).toMatch(
      /^Today 2:05\s?PM$/i,
    );
  });
});

describe("formatDuration", () => {
  it("spaces its units as the redesign does", () => {
    expect(formatDuration(41)).toBe("41 s");
    expect(formatDuration(14 * 60)).toBe("14 m");
    expect(formatDuration(2 * 3600 + 41 * 60)).toBe("2 h 41 m");
    expect(formatDuration(6 * 86_400 + 3 * 3600)).toBe("6 d 3 h");
  });
});

describe("formatAgo and formatUntil", () => {
  const now = 1_800_000_000;

  it("write relative times as the redesign does", () => {
    expect(formatAgo(now - 10, now)).toBe("just now");
    expect(formatAgo(now - 120, now)).toBe("2 min ago");
    expect(formatAgo(now - 2 * 3600, now)).toBe("2 h ago");
    expect(formatAgo(now - 53 * 86_400, now)).toBe("53 d ago");
    expect(formatAgo(now - 100 * 86_400, now)).toBe(formatDay(now - 100 * 86_400));
    expect(formatUntil(now + 28 * 86_400, now)).toBe("in 28 d");
    expect(formatUntil(now + 600, now)).toBe("in 10 min");
    expect(formatUntil(now - 1, now)).toBe("expired");
  });
});

describe("formatClock", () => {
  it("reads 24-hour to the second by default and 12-hour when the server says so", () => {
    const t = new Date(2026, 8, 25, 19, 6, 52).getTime() / 1000;
    expect(formatClock(t)).toBe("19:06:52");
    expect(formatClock(t, { hour12: true })).toMatch(/^7:06:52\s?PM$/i);
  });
});
