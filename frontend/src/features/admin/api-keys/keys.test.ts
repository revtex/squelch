import { describe, expect, it } from "vitest";
import type { AdminSystem } from "@/types";
import { testCommand, trunkRecorderSnippet } from "./keys";

const systems = [
  { id: 11, label: "Lake County", systemId: 1 },
  { id: 12, label: "Geauga County", systemId: 2 },
] as unknown as AdminSystem[];

describe("testCommand", () => {
  it("prints the status code, since the endpoint answers 204 with no body", () => {
    expect(testCommand("abc", "http://s:3022")).toBe(
      'curl -sS -o /dev/null -w "%{http_code}\\n" -X POST -H "Authorization: Bearer abc" http://s:3022/api/v1/calls/test',
    );
  });
});

describe("trunkRecorderSnippet", () => {
  it("writes the Squelch uploader with one key for the whole plugin", () => {
    expect(JSON.parse(trunkRecorderSnippet("squelch", "k", "http://s", systems, [12]))).toEqual({
      name: "Squelch",
      library: "libsquelch_uploader.so",
      server: "http://s",
      apiKey: "k",
      systems: [{ shortName: "geauga_county", systemId: 2 }],
    });
  });

  it("writes the rdio-scanner uploader with the key on every system", () => {
    expect(JSON.parse(trunkRecorderSnippet("rdioscanner", "k", "http://s", systems, []))).toEqual({
      name: "Squelch",
      library: "librdioscanner_uploader.so",
      server: "http://s",
      systems: [
        { shortName: "lake_county", apiKey: "k", systemId: 1 },
        { shortName: "geauga_county", apiKey: "k", systemId: 2 },
      ],
    });
  });

  it("falls back to a placeholder system when there are none", () => {
    expect(JSON.parse(trunkRecorderSnippet("squelch", "k", "http://s", [], [])).systems).toEqual([
      { shortName: "your_system", systemId: 1 },
    ]);
  });
});
