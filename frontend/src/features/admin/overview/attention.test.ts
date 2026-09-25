import { describe, it, expect } from "vitest";
import type { AdminDirMonitor, AdminDownstream, AdminUser, TranscriptionStats } from "@/types";
import { attentionItems, healthPills, navBadges, type OverviewSources } from "./attention";

const NOW = 1_790_000_000;

function monitor(id: number, state: AdminDirMonitor["status"]["state"], error = ""): AdminDirMonitor {
  return {
    id,
    directory: `/srv/m${id}`,
    status: { state, error, since: NOW - 600, lastFile: "", lastFileAt: null, lastResult: "", lastCallId: null, ingested24h: 0 },
  } as unknown as AdminDirMonitor;
}

function downstream(id: number, ok: boolean | null, disabled = 0): AdminDownstream {
  return {
    id,
    label: `DS ${id}`,
    url: "https://up.example.org",
    disabled,
    last: ok === null ? null : { ok, status: ok ? 200 : 401, error: ok ? "" : "401 Unauthorized", millis: 5, at: NOW - 60 },
    failed24h: ok === false ? 3 : 0,
  } as unknown as AdminDownstream;
}

const base: OverviewSources = { now: NOW, hour12: false };

describe("attentionItems", () => {
  it("is empty when nothing is wrong", () => {
    expect(attentionItems({ ...base, monitors: [monitor(1, "watching")], downstreams: [downstream(1, true)] })).toEqual([]);
  });

  it("lists stopped monitors first, as errors, with a link that opens them", () => {
    const items = attentionItems({
      ...base,
      monitors: [monitor(1, "watching"), monitor(2, "stopped", "Path not found")],
      downstreams: [downstream(4, false)],
      users: [
        { id: 1, username: "dispatch-b", passwordNeedChange: 1, disabled: 0 },
        { id: 2, username: "old", passwordNeedChange: 1, disabled: 1 },
      ] as unknown as AdminUser[],
    });
    expect(items.map((i) => [i.tone, i.title])).toEqual([
      ["bad", "Folder monitor /srv/m2 stopped"],
      ["warn", "Downstream DS 4 is failing"],
      ["warn", "1 user still on a temporary password"],
    ]);
    expect(items[0].action.to).toBe("/admin/dirmonitors?open=2");
    expect(items[1].detail).toEqual(["401 Unauthorized. 3 failures in 24 h."]);
    expect(items[2].detail.join("")).toContain("dispatch-b");
    expect(items[2].detail.join("")).not.toContain("old");
  });

  it("counts legacy uploads per key, including those without one", () => {
    const items = attentionItems({
      ...base,
      legacy: [
        // The report cuts labels to six characters; the id tells keys apart.
        { path: "/api/call-upload", method: "POST", apiKeyIdent: "TR-Lak", apiKeyId: 9, count: 400, lastSeen: "" },
        { path: "/api/trunk-recorder-call-upload", method: "POST", apiKeyIdent: "TR-Lak", apiKeyId: 9, count: 12, lastSeen: "" },
        { path: "/api/call-upload", method: "POST", apiKeyIdent: "TR-Lak", apiKeyId: 10, count: 5, lastSeen: "" },
        { path: "/api/call-upload", method: "POST", apiKeyIdent: "", count: 3, lastSeen: "" },
      ],
      apiKeys: [
        { id: 9, ident: "TR-Lake-North" },
        { id: 10, ident: "TR-Lake-South" },
      ] as never,
    });
    expect(items).toHaveLength(3);
    expect(items[0].detail).toContainEqual({ mono: "TR-Lake-North" });
    expect(items[0].detail[0]).toBe("412 requests from key ");
    expect(items[0].action.to).toBe("/admin/apikeys?open=9");
    expect(items[1].detail).toContainEqual({ mono: "TR-Lake-South" });
    expect(items[2].detail[0]).toContain("without an API key");
  });

  it("flags transcription failures and a long queue only while transcription is on", () => {
    const t = { poolEnabled: true, failed24h: 2, queueDepth: 40 } as TranscriptionStats;
    expect(attentionItems({ ...base, transcription: t }).map((i) => i.key)).toEqual(["transcription-failed", "transcription-queue"]);
    expect(attentionItems({ ...base, transcription: { ...t, poolEnabled: false } })).toEqual([]);
  });
});

describe("healthPills", () => {
  it("turns ingest amber after 30 quiet minutes", () => {
    const pill = (lastCallAt: number) => healthPills({ ...base, lastCallAt }).find((p) => p.id === "ingest");
    expect(pill(NOW - 180)).toMatchObject({ tone: "ok", text: "Ingest · last call 3 min ago" });
    expect(pill(NOW - 31 * 60)?.tone).toBe("warn");
    expect(pill(0)).toMatchObject({ tone: "off", text: "Ingest · no calls yet" });
  });

  it("names failing forwarding and storage use", () => {
    const pills = healthPills({
      ...base,
      downstreams: [downstream(1, false), downstream(2, true)],
      storage: { volumeTotalBytes: 120e9, volumeFreeBytes: 79e9 } as never,
      pruneDays: 30,
    });
    expect(pills.find((p) => p.id === "forwarding")).toMatchObject({ tone: "warn", text: "Forwarding · 1 downstream failing" });
    expect(pills.find((p) => p.id === "storage")).toMatchObject({ tone: "ok", text: "Storage · 41 GB of 120 GB, prune 30 d" });
  });

  it("counts connected brokers and says off without any", () => {
    const tr = (states: ("connected" | "error")[]) =>
      healthPills({ ...base, trInstances: states.map((state, i) => ({ id: i, label: `tr${i}`, enabled: true, state })) }).find(
        (p) => p.id === "trunk",
      );
    expect(tr(["connected", "connected"])).toMatchObject({ tone: "ok", text: "Trunk Recorder · 2 / 2 brokers" });
    expect(tr(["connected", "error"])?.tone).toBe("warn");
    expect(healthPills({ ...base, trInstances: null }).find((p) => p.id === "trunk")?.text).toBe("Trunk Recorder · off");
  });
});

describe("navBadges", () => {
  it("counts sizes quietly and trouble in colour", () => {
    const s: OverviewSources = {
      ...base,
      users: [{}, {}] as AdminUser[],
      listeners: 9,
      monitors: [monitor(1, "stopped")],
      downstreams: [downstream(1, false)],
    };
    const b = navBadges(s, attentionItems(s));
    expect(b["/admin/users"]).toEqual({ count: 2, tone: "neutral", sr: "2 users" });
    expect(b["/admin/connections"]).toMatchObject({ count: 9, tone: "neutral" });
    expect(b["/admin/dirmonitors"]).toEqual({ count: 1, tone: "bad", sr: "1 stopped" });
    expect(b["/admin/forwarding"]).toEqual({ count: 1, tone: "warn", sr: "1 failing" });
    expect(b["/admin/overview"]).toMatchObject({ count: 2, tone: "bad" });
    expect(b["/admin/apikeys"]).toBeUndefined();
  });
});
