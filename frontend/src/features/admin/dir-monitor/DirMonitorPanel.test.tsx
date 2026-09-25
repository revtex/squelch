import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import DirMonitorPanel from "./DirMonitorPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminDirMonitor, AdminSystem, AdminTalkgroup } from "@/types";

const now = Math.floor(Date.now() / 1000);

const systems = [
  { id: 1, systemId: 101, label: "County", order: 0 },
  { id: 2, systemId: 202, label: "City", order: 1 },
] as AdminSystem[];
const talkgroups = [
  { id: 10, systemId: 1, talkgroupId: 5200, label: "FD Disp", order: 0 },
] as AdminTalkgroup[];

const monitors: AdminDirMonitor[] = [
  {
    id: 1,
    directory: "/recordings/tr",
    type: "trunk-recorder",
    mask: null,
    extension: "json",
    frequency: null,
    delay: null,
    deleteAfter: 1,
    usePolling: 0,
    disabled: 0,
    systemId: null,
    talkgroupId: null,
    order: 0,
    status: {
      state: "watching",
      error: "",
      since: now - 3600,
      lastFile: "/recordings/tr/5200-1700000000.json",
      lastFileAt: now - 20,
      lastResult: "became call 44 on system 101, talkgroup 5200",
      lastCallId: 44,
      ingested24h: 312,
    },
  },
  {
    id: 2,
    directory: "/mnt/nas/proscan",
    type: "proscan",
    mask: "#DATE_#TIME_#TG",
    extension: "wav",
    frequency: null,
    delay: 5000,
    deleteAfter: 0,
    usePolling: 1,
    disabled: 0,
    systemId: 1,
    talkgroupId: 10,
    order: 1,
    status: {
      state: "stopped",
      error: "cannot watch the folder: no such file or directory",
      since: now - 600,
      lastFile: "",
      lastFileAt: null,
      lastResult: "",
      lastCallId: null,
      ingested24h: 0,
    },
  },
];

type Op = (arg: unknown) => Promise<unknown>;
const createOp = vi.fn<Op>();
const updateOp = vi.fn<Op>();
const restartOp = vi.fn<Op>();
const testMaskOp = vi.fn<Op>();
const loadDirs = vi.fn<Op>();
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListDirMonitorsQuery: () => ({ data: monitors, isLoading: false, isError: false }),
  useListSystemsQuery: () => ({ data: systems, isLoading: false, isError: false }),
  useListTalkgroupsQuery: () => ({ data: talkgroups, isLoading: false, isError: false }),
  useCreateDirMonitorMutation: () => mutation(createOp),
  useUpdateDirMonitorMutation: () => mutation(updateOp),
  useDeleteDirMonitorMutation: () => mutation(vi.fn()),
  useRestartDirMonitorMutation: () => mutation(restartOp),
  useTestMaskMutation: () => mutation(testMaskOp),
  useLazyListServerDirectoriesQuery: () => [
    (arg: unknown) => ({ unwrap: () => loadDirs(arg) }),
    {
      data: {
        path: "/mnt",
        parent: "/",
        directories: [{ name: "nas", path: "/mnt/nas" }],
      },
      isFetching: false,
    },
  ],
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DirMonitorPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("DirMonitorPanel", () => {
  beforeEach(() => {
    createOp.mockReset().mockResolvedValue({ ...monitors[0], id: 3, directory: "/mnt/nas" });
    updateOp.mockReset().mockResolvedValue({});
    restartOp.mockReset().mockResolvedValue({ ok: true, status: { ...monitors[1].status, state: "polling", error: "" } });
    testMaskOp.mockReset().mockResolvedValue({ ok: true, values: { "#TG": "5200", "#DATE": "2025-01-15" } });
    loadDirs.mockReset().mockResolvedValue({});
  });

  it("shows each monitor's runtime state, destination and last file", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Folder monitors" });
    const tr = within(table).getByText("/recordings/tr").closest("tr")!;
    expect(within(tr).getByText("watching")).toBeInTheDocument();
    expect(within(tr).getByText("From filename")).toBeInTheDocument();
    expect(within(tr).getByText("Trunk Recorder")).toBeInTheDocument();
    expect(within(tr).getByTitle(/5200-1700000000\.json$/)).toBeInTheDocument();
    expect(within(tr).getByText("312")).toBeInTheDocument();
    const nas = within(table).getByText("/mnt/nas/proscan").closest("tr")!;
    expect(within(nas).getByText("stopped")).toBeInTheDocument();
    expect(within(nas).getByText(/no such file or directory/)).toBeInTheDocument();
    expect(within(nas).getByText(/^County · TG \d+ \(FD Disp\)$/)).toBeInTheDocument();
    expect(within(nas).getByText(/polling/)).toBeInTheDocument();
  });

  it("filters to stopped monitors and restarts one from its details", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /Stopped/ }));
    expect(screen.queryByText("/recordings/tr")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Details for /mnt/nas/proscan" }));
    const details = within(screen.getByRole("dialog", { name: "/mnt/nas/proscan" }));
    expect(details.getByText(/^Stopped/).closest(".alert")).toHaveTextContent(/Last error: cannot watch the folder/);
    expect(details.getByText("every 5 s")).toBeInTheDocument();
    await user.click(details.getByRole("button", { name: "Restart" }));
    expect(restartOp).toHaveBeenCalledWith(2);
    expect(await details.findByRole("status")).toHaveTextContent("Restarted, now polling.");
    expect(details.getByRole("link", { name: "Show this monitor's log lines" })).toHaveAttribute(
      "href",
      "/admin/logs?q=%2Fmnt%2Fnas%2Fproscan",
    );
  });

  it("shows only the fields the chosen recorder needs and tests the mask live", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add monitor" }));
    const form = within(screen.getByRole("dialog", { name: "New folder monitor" }));
    expect(form.queryByLabelText("Filename mask")).toBeNull();
    expect(form.queryByLabelText("Send every call to system")).toBeNull();
    expect(form.getByRole("radio", { name: "Trunk Recorder" })).toHaveAttribute("aria-checked", "true");
    await user.click(form.getByRole("radio", { name: "Other (filename mask)" }));
    expect(form.getByLabelText("Send every call to system")).toBeInTheDocument();
    await user.type(form.getByLabelText("Filename mask"), "#TG_#DATE");
    await user.type(form.getByLabelText("Try it on a filename"), "5200_2025-01-15.wav");
    await waitFor(() =>
      expect(testMaskOp).toHaveBeenCalledWith({ mask: "#TG_#DATE", filename: "5200_2025-01-15.wav" }),
    );
    expect(await form.findByRole("status")).toHaveTextContent("Matches. #DATE = 2025-01-15 #TG = 5200");
  });

  it("browses server folders inside the panel and submits seconds as milliseconds", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add monitor" }));
    await user.click(screen.getByRole("button", { name: "Browse" }));
    const browser = within(screen.getByRole("dialog", { name: "Pick a folder" }));
    await user.click(browser.getByRole("button", { name: "nas" }));
    expect(loadDirs).toHaveBeenCalledWith({ path: "/mnt/nas" });
    await user.click(browser.getByRole("button", { name: "Use this folder" }));
    const form = within(screen.getByRole("dialog", { name: "New folder monitor" }));
    expect(form.getByLabelText("Folder")).toHaveValue("/mnt");
    await user.clear(form.getByLabelText("Wait before ingest, seconds"));
    await user.type(form.getByLabelText("Wait before ingest, seconds"), "3.5");
    await user.click(form.getByRole("button", { name: "Add monitor" }));
    expect(createOp).toHaveBeenCalledWith(
      expect.objectContaining({ directory: "/mnt", type: "trunk-recorder", delay: 3500, usePolling: 1, order: 2 }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Now watching /mnt/nas.");
  });

  it("disables a monitor with confirmation and shows a server error", async () => {
    const user = userEvent.setup();
    updateOp.mockRejectedValue(new Error("folder monitor not found"));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for /recordings/tr" }));
    const details = within(screen.getByRole("dialog", { name: "/recordings/tr" }));
    await user.click(details.getByRole("button", { name: "Disable" }));
    await user.click(within(details.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Disable" }));
    expect(updateOp).toHaveBeenCalledWith(expect.objectContaining({ id: 1, disabled: 1, extension: "json" }));
    expect(updateOp.mock.calls[0][0]).not.toHaveProperty("status");
    expect(await details.findByRole("alert")).toHaveTextContent("folder monitor not found");
  });
});
