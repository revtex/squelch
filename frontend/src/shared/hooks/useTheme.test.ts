import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  applyStoredTheme,
  DEFAULT_THEME,
  THEMES,
  useTheme,
} from "@/shared/hooks/useTheme";

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("offers seven themes with Squelch classic as the default", () => {
    expect(THEMES).toHaveLength(7);
    expect(DEFAULT_THEME).toBe("squelch-classic");
  });

  it("falls back to the default for a retired theme", () => {
    localStorage.setItem("squelch-theme", "squelch-light");
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "squelch-classic",
    );
  });

  it("applies a stored theme at start-up", () => {
    localStorage.setItem("squelch-theme", "squelch-ember");
    applyStoredTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "squelch-ember",
    );
  });

  it("sets, applies and remembers a choice", () => {
    applyStoredTheme();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme("squelch-midnight"));
    expect(result.current.theme).toBe("squelch-midnight");
    expect(result.current.label).toBe("Midnight");
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      "squelch-midnight",
    );
    expect(localStorage.getItem("squelch-theme")).toBe("squelch-midnight");
  });
});
