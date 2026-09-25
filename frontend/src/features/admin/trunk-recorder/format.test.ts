import { describe, expect, it } from "vitest";
import { fmtFreqMHz, fmtHexId } from "./format";

describe("fmtHexId", () => {
  it("writes hex identifiers the RadioReference way", () => {
    expect(fmtHexId("0x2ee")).toBe("2EE");
    expect(fmtHexId("0xbee00")).toBe("BEE00");
    expect(fmtHexId("0X2F1")).toBe("2F1");
  });

  it("leaves anything that is not a 0x number alone", () => {
    expect(fmtHexId("750")).toBe("750");
    expect(fmtHexId("0x")).toBe("0x");
    expect(fmtHexId("0xZZ")).toBe("0xZZ");
  });
});

describe("fmtFreqMHz", () => {
  it("shows four decimals in MHz and a dash for nothing", () => {
    expect(fmtFreqMHz(853_937_500)).toBe("853.9375 MHz");
    expect(fmtFreqMHz(undefined)).toBe("—");
  });
});
