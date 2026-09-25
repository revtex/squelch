import { describe, it, expect } from "vitest";
import { pickSection } from "./useActiveSection";

describe("pickSection", () => {
  it("marks the first section before any has reached the line", () => {
    expect(pickSection([120, 600, 1100], false)).toBe(0);
  });

  it("marks the last section whose top has passed the line", () => {
    expect(pickSection([-900, -200, 80, 700], false)).toBe(2);
  });

  it("marks the last section at the bottom of the page even if it is short", () => {
    expect(pickSection([-1400, -300, 420, 710], true)).toBe(3);
  });

  it("marks nothing without sections", () => {
    expect(pickSection([], false)).toBe(-1);
  });
});
