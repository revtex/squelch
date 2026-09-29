import { describe, it, expect } from "vitest";
import { deviceLabel } from "./format";

describe("deviceLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "Chrome 129 · Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      "Edge 129 · Windows",
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Firefox 130 · Linux",
    ],
    [
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari 18 · iPad",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      "Chrome 129 · Android",
    ],
  ])("names the browser and system of %s", (ua, label) => {
    expect(deviceLabel(ua, false)).toBe(label);
  });

  it("names the app and its platform", () => {
    expect(deviceLabel("okhttp/4.12.0", true)).toBe("Squelch app · Android");
    expect(deviceLabel("Squelch/12 CFNetwork/1568 Darwin/24.0.0", true)).toBe(
      "Squelch app · iOS",
    );
    expect(deviceLabel(null, true)).toBe("Squelch app");
  });

  it("falls back when it cannot tell", () => {
    expect(deviceLabel("", false)).toBe("Browser");
    expect(deviceLabel("curl/8.5.0", false)).toBe("Browser");
  });
});
