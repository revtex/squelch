import { describe, it, expect } from "vitest";
import { buildAppHandoff, detectHandoffPlatform } from "./appHandoff";

const TOKEN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PAGE = "https://scanner.example/call/3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const ORIGIN = "https://scanner.example";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

describe("detectHandoffPlatform", () => {
  it("recognises Android and iOS, and nothing else", () => {
    expect(detectHandoffPlatform(ANDROID_UA)).toBe("android");
    expect(detectHandoffPlatform(IPHONE_UA)).toBe("ios");
    expect(detectHandoffPlatform(DESKTOP_UA)).toBeNull();
  });
});

describe("buildAppHandoff", () => {
  const base = { token: TOKEN, pageUrl: PAGE, origin: ORIGIN };

  it("builds an intent URL with a browser fallback on Android", () => {
    const handoff = buildAppHandoff({ ...base, userAgent: ANDROID_UA });

    expect(handoff?.platform).toBe("android");
    expect(handoff?.href).toContain(`intent://call/${TOKEN}`);
    expect(handoff?.href).toContain("scheme=squelch");
    expect(handoff?.href).toContain("package=io.github.revtex.squelch");
    expect(handoff?.href).toContain(
      `S.browser_fallback_url=${encodeURIComponent(PAGE)}`,
    );
    expect(handoff?.href.endsWith(";end")).toBe(true);
  });

  it("builds a custom-scheme URL on iOS", () => {
    const handoff = buildAppHandoff({ ...base, userAgent: IPHONE_UA });

    expect(handoff?.platform).toBe("ios");
    expect(handoff?.href).toBe(
      `squelch://call/${TOKEN}?server=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("offers nothing on a desktop browser", () => {
    expect(buildAppHandoff({ ...base, userAgent: DESKTOP_UA })).toBeNull();
  });

  it("carries the server origin, so the app knows which instance to ask", () => {
    const handoff = buildAppHandoff({ ...base, userAgent: ANDROID_UA });
    expect(handoff?.href).toContain(
      `server=${encodeURIComponent(ORIGIN)}`,
    );
  });

  it("refuses a token that is not a share token", () => {
    // `;` and `#` are structural in an intent:// URL, so a token that could
    // carry them never reaches the string at all.
    const hostile = [
      "abc;package=com.evil.app;end",
      "3f2504e0-4f89-11d3-9a0c-0305e82c3301;S.browser_fallback_url=https://evil.example",
      "../../etc/passwd",
      "#Intent;action=android.intent.action.VIEW;end",
      "",
    ];
    for (const token of hostile) {
      expect(
        buildAppHandoff({ ...base, token, userAgent: ANDROID_UA }),
      ).toBeNull();
    }
  });

  it("offers nothing when the route has no token", () => {
    expect(
      buildAppHandoff({ ...base, token: undefined, userAgent: ANDROID_UA }),
    ).toBeNull();
  });
});
