import { describe, it, expect } from "vitest";
import { GROUPS, matchesSearch } from "./settings";

describe("matchesSearch", () => {
  it("finds only the link-expiry row for the Shared links page's link", () => {
    const hits = GROUPS.flatMap((g) =>
      g.rows.filter((r) => matchesSearch(r, g, "Links expire")).map((r) => r.key),
    );
    expect(hits).toEqual(["sharedLinkExpiry"]);
  });
});
