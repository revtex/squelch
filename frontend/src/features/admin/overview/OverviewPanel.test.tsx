import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ActivityStats } from "@/types";
import OverviewPanel from "./OverviewPanel";
import { OverviewDataContext, type OverviewData } from "./useOverviewSources";
import { attentionItems, healthPills, navBadges, type OverviewSources } from "./attention";

const NOW = 1_790_000_000;
const hour = Math.floor(NOW / 3600) * 3600;

vi.mock("@/shared/services/ws/adminClient", () => ({
  adminWsClient: { isConnected: () => false, on: () => () => {} },
}));

const calls: { op: string; params: unknown }[] = [];
vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useWsQuery: (op: string, params: unknown) => {
    calls.push({ op, params });
    if (op === "activity.chart") return { data: { buckets: [{ hour: hour - 3 * 3600, count: 1412 }, { hour, count: 400 }] }, isLoading: false };
    if (op === "activity.top-talkgroups")
      return {
        data: {
          talkgroups: [
            { talkgroupId: 5, systemId: 1, talkgroupNumber: 41011, talkgroupLabel: "LC FD Disp", talkgroupName: "Lake County Fire Dispatch", systemLabel: "MARCS-IP", callCount: 1204 },
            { talkgroupId: 6, systemId: 1, talkgroupNumber: 41025, talkgroupLabel: "", talkgroupName: "", systemLabel: "MARCS-IP", callCount: 300 },
          ],
        },
        isLoading: false,
      };
    if (op === "logs.audit") return { data: [{ id: 1, dateTime: NOW - 60, level: "info", message: "revtex created user guest-media" }], isLoading: false };
    return { data: undefined, isLoading: false };
  },
}));

const stats: ActivityStats = {
  callsToday: 18942,
  callsYesterday: 17870,
  callsThisWeek: 131204,
  callsTotal: 900000,
  lastCallAt: NOW - 180,
  activeListeners: 9,
  uptime: 12 * 86400 + 4 * 3600,
  startedAt: NOW - (12 * 86400 + 4 * 3600),
  version: "v3.1.0",
};

function data(extra: Partial<OverviewSources> = {}): OverviewData {
  const sources: OverviewSources = { now: NOW, hour12: false, lastCallAt: stats.lastCallAt, listeners: 9, ...extra };
  const attention = attentionItems(sources);
  return { sources, stats, attention, pills: healthPills(sources), badges: navBadges(sources, attention), now: NOW };
}

function renderPanel(value: OverviewData, url = "/admin/overview") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <OverviewDataContext.Provider value={value}>
        <OverviewPanel />
      </OverviewDataContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls.length = 0;
});

describe("OverviewPanel", () => {
  it("lists what needs attention with a link to fix each", () => {
    renderPanel(
      data({
        monitors: [
          {
            id: 2,
            directory: "/srv/sdrtrunk",
            status: { state: "stopped", error: "Path not found", since: NOW - 600, lastFile: "", lastFileAt: null, lastResult: "", lastCallId: null, ingested24h: 0 },
          },
        ] as never,
      }),
    );
    const card = within(screen.getByRole("region", { name: /Needs attention/ }));
    expect(card.getByText("Folder monitor /srv/sdrtrunk stopped")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Open monitor" })).toHaveAttribute("href", "/admin/dirmonitors?open=2");
    expect(card.getByText("error")).toBeInTheDocument();
  });

  it("says so when nothing needs attention", () => {
    renderPanel(data());
    expect(screen.getByText("Nothing needs you right now.")).toBeInTheDocument();
  });

  it("shows the health strip, tiles and busiest talkgroups as links", () => {
    renderPanel(data());
    const health = within(screen.getByRole("navigation", { name: "Service health" }));
    expect(health.getByRole("link", { name: "Ingest · last call 3 min ago" })).toHaveAttribute("href", "/admin/dirmonitors");
    expect(health.getByRole("link", { name: /Transcription · off/ })).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Calls today" })).toHaveAttribute("href", "/admin/systems");
    expect(screen.getByText("18,942")).toBeInTheDocument();
    expect(screen.getByText("▲ 6% vs yesterday")).toBeInTheDocument();
    expect(screen.getByText("12 d 4 h")).toBeInTheDocument();
    expect(screen.getByText(/^v3\.1\.0 · restarted/)).toBeInTheDocument();

    const busiest = within(screen.getByRole("table", { name: /Busiest talkgroups/ }));
    expect(busiest.getByRole("link", { name: "LC FD Disp" })).toHaveAttribute("href", "/admin/systems?system=1&open=5");
    expect(busiest.getByRole("link", { name: "TG 41025" })).toBeInTheDocument();

    expect(screen.getByRole("img", { name: /Peak 1,412 calls/ })).toBeInTheDocument();
    expect(screen.getByText("revtex created user guest-media")).toBeInTheDocument();
  });

  it("asks for the chosen range and names the chart after it", async () => {
    const user = userEvent.setup();
    renderPanel(data());
    expect(screen.getByRole("heading", { name: "Calls per hour · last 24 h" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "7 d" }));
    expect(screen.getByRole("heading", { name: "Calls per hour · last 7 days" })).toBeInTheDocument();
    const charts = calls.filter((c) => c.op === "activity.chart");
    expect(charts[charts.length - 1].params).toEqual({ range: "7d" });
    await user.click(screen.getByRole("radio", { name: "30 d" }));
    expect(screen.getByRole("heading", { name: "Calls per day · last 30 days" })).toBeInTheDocument();
    const tops = calls.filter((c) => c.op === "activity.top-talkgroups");
    expect(tops[tops.length - 1].params).toEqual({ range: "30d" });
  });
});
