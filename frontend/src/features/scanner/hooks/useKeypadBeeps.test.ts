import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeypadBeeps } from "./useKeypadBeeps";

const KEY = "squelch-keypad-beeps";

describe("useKeypadBeeps", () => {
  beforeEach(() => {
    localStorage.clear();
    // The module caches the stored value; a fresh read is forced by
    // writing through the hook in each test that needs one.
  });

  it("follows the server's setting until this browser picks one", () => {
    const { result } = renderHook(() => useKeypadBeeps("whistler"));
    expect(result.current.style).toBe("whistler");
    expect(result.current.label).toBe("Whistler");
  });

  it("keeps the browser's choice once made, and remembers it", () => {
    const { result } = renderHook(() => useKeypadBeeps("uniden"));
    act(() => result.current.setStyle("disabled"));

    // Off is a choice, not an absence: the server's uniden no longer wins.
    expect(result.current.style).toBe("disabled");
    expect(result.current.label).toBe("Off");
    expect(localStorage.getItem(KEY)).toBe("disabled");
  });

  it("shares the choice between every caller", () => {
    const a = renderHook(() => useKeypadBeeps("uniden"));
    const b = renderHook(() => useKeypadBeeps("uniden"));
    act(() => a.result.current.setStyle("whistler"));
    expect(b.result.current.style).toBe("whistler");
  });
});
