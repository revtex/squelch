import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import LogsPanel from "./LogsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminAuditRow, AdminLog } from "@/types";

const now = Math.floor(Date.now() / 1000);

const lines: AdminLog[] = [
  { dateTime: now - 5, level: "error", message: "dirmonitor: parse error", attrs: { id: "2", file: "/rec/x.wav", error: "bad header" } },
  { dateTime: now - 60, level: "info", message: "request", attrs: { method: "GET", path: "/api/v1/calls", status: "200", latency_ms: "12" } },
  { dateTime: now - 90, level: "info", message: "call ingested", attrs: { call_id: "44", system_id: "1", talkgroup_id: "5200" } },
];
const auditRows: AdminAuditRow[] = [
  { id: 9, dateTime: now - 30, level: "info", message: 'admin: webhook "Ops" created by admin' },
  { id: 8, dateTime: now - 400, level: "warn", message: "login failed for bob from 10.0.0.9" },
];

const refetchLogs = vi.fn();
let followingSeen: { server?: boolean; audit?: boolean; paused?: boolean } = {};

vi.mock("./useAdminLogs", () => ({
  useAdminLogs: (_p: unknown, following: boolean, paused: boolean) => {
    followingSeen.server = following;
    followingSeen.paused = paused;
    return { logs: lines, isLoading: false, isFetching: false, refetch: refetchLogs };
  },
  useAuditTrail: (_p: unknown, following: boolean) => {
    followingSeen.audit = following;
    return { rows: auditRows, isLoading: false, isFetching: false, refetch: vi.fn() };
  },
}));

function renderPanel(path = "/admin/logs") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <LogsPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("LogsPanel", () => {
  beforeEach(() => {
    refetchLogs.mockReset();
    followingSeen = {};
  });

  it("lists server log lines as a table with level text and chips", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Server log" });
    const row = within(table).getByText("dirmonitor: parse error").closest("tr")!;
    expect(within(row).getByText("error")).toBeInTheDocument();
    expect(within(row).getByText("id=2")).toBeInTheDocument();
    expect(within(row).getByText("error=bad header")).toBeInTheDocument();
    const req = within(table).getByText("/api/v1/calls").closest("tr")!;
    expect(within(req).getByText("200")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^error/ })).toHaveTextContent("1");
    expect(followingSeen.server).toBe(true);
    expect(followingSeen.audit).toBe(false);
  });

  it("points at Settings for the log level", () => {
    renderPanel();
    expect(screen.getByRole("link", { name: "Settings → Logging" })).toHaveAttribute("href", "/admin/settings#settings-logging");
  });

  it("prefills the search from the address and opens the audit tab from it", () => {
    renderPanel("/admin/logs?q=%2Frec%2Fx.wav");
    expect(screen.getByRole("searchbox")).toHaveValue("/rec/x.wav");
    renderPanel("/admin/logs?tab=audit");
    expect(screen.getByRole("tab", { name: "Audit trail", selected: true })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Audit trail" });
    expect(within(table).getByText('admin: webhook "Ops" created by admin')).toBeInTheDocument();
  });

  it("opens a line's details with attributes, similar-search and a related link, and pauses following", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for dirmonitor: parse error" }));
    const details = within(screen.getByRole("dialog", { name: "dirmonitor: parse error" }));
    expect(details.getByText("/rec/x.wav")).toBeInTheDocument();
    expect(details.getByText("Line 1 of 3")).toBeInTheDocument();
    expect(details.getByRole("link", { name: "Open Folder monitors" })).toHaveAttribute("href", "/admin/dirmonitors");
    expect(followingSeen.paused).toBe(true);
    await user.click(details.getByRole("button", { name: "Older" }));
    expect(screen.getByRole("dialog", { name: "GET /api/v1/calls" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Show similar lines" }));
    expect(screen.getByRole("searchbox")).toHaveValue("request");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens an audit event with a link to the page it is about", async () => {
    const user = userEvent.setup();
    renderPanel("/admin/logs?tab=audit");
    await user.click(screen.getByRole("button", { name: "Details for login failed for bob from 10.0.0.9" }));
    const details = within(screen.getByRole("dialog", { name: "login failed for bob from 10.0.0.9" }));
    expect(details.getByRole("link", { name: "Open Users" })).toHaveAttribute("href", "/admin/users");
  });
});
