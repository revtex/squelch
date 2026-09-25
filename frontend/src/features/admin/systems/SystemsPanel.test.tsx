import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SystemsPanel from "./SystemsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminGroup, AdminSystem, AdminTag, AdminTalkgroup, AdminUnit, TalkgroupImportPreview } from "@/types";

const now = Math.floor(Date.now() / 1000);

const systems: AdminSystem[] = [
  {
    id: 10,
    systemId: 1,
    label: "County",
    autoPopulateTalkgroups: 1,
    blacklistsJson: "[999]",
    led: null,
    order: 0,
    talkgroups: 3,
    units: 1,
    calls24h: 1200,
    lastCall: now - 60,
    blocked: [999],
  },
  {
    id: 11,
    systemId: 2,
    label: "City",
    autoPopulateTalkgroups: 0,
    blacklistsJson: null,
    led: "red",
    order: 1,
    talkgroups: 1,
    units: 0,
    calls24h: 0,
    lastCall: null,
    blocked: [],
  },
];

const groups: AdminGroup[] = [
  { id: 1, label: "Fire", talkgroups: 1 },
  { id: 2, label: "Police", talkgroups: 1 },
];
const tags: AdminTag[] = [{ id: 5, label: "Dispatch", talkgroups: 1 }];

const talkgroups: AdminTalkgroup[] = [
  { id: 100, systemId: 10, talkgroupId: 101, label: "FD Disp", name: "Fire dispatch", frequency: null, led: null, groupId: 1, tagId: 5, order: 0, calls24h: 900, lastHeard: now - 30, avgDurationMs: 6200 },
  { id: 101, systemId: 10, talkgroupId: 102, label: "PD Disp", name: null, frequency: 853912500, led: "blue", groupId: 2, tagId: null, order: 1, calls24h: 300, lastHeard: now - 3600, avgDurationMs: 4000 },
  { id: 102, systemId: 10, talkgroupId: 999, label: null, name: null, frequency: null, led: null, groupId: null, tagId: null, order: 2, calls24h: 0, lastHeard: null, avgDurationMs: 0 },
  { id: 200, systemId: 11, talkgroupId: 7, label: "City Ops", name: null, frequency: null, led: null, groupId: 2, tagId: null, order: 0, calls24h: 0, lastHeard: null, avgDurationMs: 0 },
];
const units: AdminUnit[] = [{ id: 1, systemId: 10, unitId: 4001, label: "Engine 1", order: 0, lastHeard: now - 120 }];

type Op = (arg: unknown) => Promise<unknown>;
const ops = {
  createSystem: vi.fn<Op>(),
  updateSystem: vi.fn<Op>(),
  deleteSystem: vi.fn<Op>(),
  reorder: vi.fn<Op>(),
  block: vi.fn<Op>(),
  unblock: vi.fn<Op>(),
  createTalkgroup: vi.fn<Op>(),
  updateTalkgroup: vi.fn<Op>(),
  deleteTalkgroup: vi.fn<Op>(),
  deleteTalkgroups: vi.fn<Op>(),
  bulk: vi.fn<Op>(),
  applyImport: vi.fn<Op>(),
  previewImport: vi.fn<Op>(),
  createUnit: vi.fn<Op>(),
  updateUnit: vi.fn<Op>(),
  deleteUnit: vi.fn<Op>(),
  exportTalkgroups: vi.fn<Op>(),
};
const mutation = (fn: Op) => [(arg: unknown) => ({ unwrap: () => fn(arg) }), { isLoading: false, isError: false }];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListSystemsQuery: () => ({ data: systems, isLoading: false }),
  useListGroupsQuery: () => ({ data: groups, isLoading: false }),
  useListTagsQuery: () => ({ data: tags, isLoading: false }),
  useListTalkgroupsQuery: (systemId?: number, options?: { skip?: boolean }) => ({
    data: options?.skip ? undefined : talkgroups.filter((t) => systemId === undefined || t.systemId === systemId),
    isLoading: false,
  }),
  useListUnitsQuery: (systemId?: number, options?: { skip?: boolean }) => ({
    data: options?.skip ? undefined : units.filter((u) => systemId === undefined || u.systemId === systemId),
    isLoading: false,
  }),
  useCreateSystemMutation: () => mutation(ops.createSystem),
  useUpdateSystemMutation: () => mutation(ops.updateSystem),
  useDeleteSystemMutation: () => mutation(ops.deleteSystem),
  useReorderSystemsMutation: () => mutation(ops.reorder),
  useBlockTalkgroupMutation: () => mutation(ops.block),
  useUnblockTalkgroupMutation: () => mutation(ops.unblock),
  useCreateTalkgroupMutation: () => mutation(ops.createTalkgroup),
  useUpdateTalkgroupMutation: () => mutation(ops.updateTalkgroup),
  useDeleteTalkgroupMutation: () => mutation(ops.deleteTalkgroup),
  useDeleteTalkgroupsMutation: () => mutation(ops.deleteTalkgroups),
  useBulkTalkgroupsMutation: () => mutation(ops.bulk),
  useApplyTalkgroupImportMutation: () => mutation(ops.applyImport),
  usePreviewTalkgroupImportMutation: () => mutation(ops.previewImport),
  usePreviewUnitImportMutation: () => mutation(ops.previewImport),
  useApplyUnitImportMutation: () => mutation(ops.applyImport),
  usePreviewGroupImportMutation: () => mutation(ops.previewImport),
  useApplyGroupImportMutation: () => mutation(ops.applyImport),
  usePreviewTagImportMutation: () => mutation(ops.previewImport),
  useApplyTagImportMutation: () => mutation(ops.applyImport),
  useCreateUnitMutation: () => mutation(ops.createUnit),
  useUpdateUnitMutation: () => mutation(ops.updateUnit),
  useDeleteUnitMutation: () => mutation(ops.deleteUnit),
  useLazyExportTalkgroupsQuery: () => mutation(ops.exportTalkgroups),
}));

function renderPanel(url = "/admin/systems") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <SystemsPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function phone(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width") ? !matches : matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

describe("SystemsPanel", () => {
  beforeEach(() => {
    for (const op of Object.values(ops)) op.mockReset().mockResolvedValue({ ok: true, updated: 1, deleted: 1, talkgroups: 0, units: 0, blocked: [] });
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("shows the first system's talkgroups with activity and the blocked marker", () => {
    renderPanel();
    const list = screen.getByRole("listbox", { name: "Systems" });
    expect(within(list).getByRole("option", { name: /County/ })).toHaveAttribute("aria-selected", "true");
    expect(within(list).getByText(/1,200 calls \/ 24 h/)).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Talkgroups" });
    const fd = within(table).getByText("101").closest("tr")!;
    expect(within(fd).getByText("FD Disp")).toBeInTheDocument();
    expect(within(fd).getByText("Fire")).toBeInTheDocument();
    expect(within(fd).getByText("900")).toBeInTheDocument();
    const blocked = within(table).getByText("999").closest("tr")!;
    expect(within(blocked).getByText("blocked")).toBeInTheDocument();
    expect(within(blocked).getByText("unlabeled")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Units/ })).toHaveTextContent("1");
  });

  it("lands on the system that uses a linked group and filters to it", () => {
    renderPanel("/admin/systems?group=2");
    expect(screen.getByRole("option", { name: /County/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "Filter by group" })).toHaveValue("2");
    const table = screen.getByRole("table", { name: "Talkgroups" });
    expect(within(table).getByText("102")).toBeInTheDocument();
    expect(within(table).queryByText("101")).toBeNull();
  });

  it("filters to unlabeled talkgroups and sets a group on the selection", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "1 unlabeled" }));
    const table = screen.getByRole("table", { name: "Talkgroups" });
    expect(within(table).queryByText("101")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Set group" }), "1");
    expect(ops.bulk).toHaveBeenCalledWith({ ids: [102], groupId: 1 });
    expect(await screen.findByRole("status")).toHaveTextContent("Updated 1 talkgroup.");
  });

  it("opens a talkgroup, shows its stats, links to the scanner and saves an edit", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for 101 FD Disp" }));
    const panel = within(screen.getByRole("dialog", { name: "101 FD Disp" }));
    expect(panel.getByText("6.2 s")).toBeInTheDocument();
    expect(panel.getByRole("link", { name: /Listen to recent calls/ })).toHaveAttribute("href", "/?system=10&talkgroup=100");
    await user.clear(panel.getByLabelText("Label"));
    await user.type(panel.getByLabelText("Label"), "Fire Dispatch");
    await user.click(panel.getByRole("button", { name: "Save" }));
    expect(ops.updateTalkgroup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 100, systemId: 10, talkgroupId: 101, label: "Fire Dispatch", groupId: 1, tagId: 5 }),
    );
  });

  it("adds talkgroups one after another, keeping the group", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add talkgroup" }));
    const panel = within(screen.getByRole("dialog", { name: "Add talkgroup" }));
    await user.type(panel.getByLabelText("Talkgroup number"), "103");
    await user.type(panel.getByLabelText("Label"), "FD Tac 1");
    await user.selectOptions(panel.getByLabelText("Group"), "1");
    await user.click(panel.getByRole("button", { name: "Save and add another" }));
    expect(ops.createTalkgroup).toHaveBeenCalledWith(
      expect.objectContaining({ systemId: 10, talkgroupId: 103, label: "FD Tac 1", groupId: 1 }),
    );
    expect(await panel.findByText(/Added so far: 103 FD Tac 1/)).toBeInTheDocument();
    expect(panel.getByLabelText("Talkgroup number")).toHaveValue(null);
    expect(panel.getByLabelText("Group")).toHaveValue("1");
  });

  it("creates a system and only deletes one after its label is typed", async () => {
    const user = userEvent.setup();
    // The list is static here, so the new system "lands" on City's row.
    ops.createSystem.mockResolvedValue({ ...systems[1] });
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add system" }));
    const create = within(screen.getByRole("dialog", { name: "Add system" }));
    await user.type(create.getByLabelText("System number"), "3");
    await user.type(create.getByLabelText("Label"), "Rural");
    await user.click(create.getByRole("button", { name: "Create system" }));
    expect(ops.createSystem).toHaveBeenCalledWith(
      expect.objectContaining({ systemId: 3, label: "Rural", autoPopulateTalkgroups: 1, led: null, order: 2 }),
    );

    await waitFor(() => expect(screen.getByRole("option", { name: /City/ })).toHaveAttribute("aria-selected", "true"));
    await user.click(screen.getByRole("button", { name: "System settings" }));
    const edit = within(screen.getByRole("dialog", { name: "City settings" }));
    await user.click(edit.getByRole("button", { name: /Delete system/ }));
    const confirm = edit.getByRole("group", { name: "Confirm" });
    expect(within(confirm).getByRole("button", { name: "Delete system" })).toBeDisabled();
    await user.type(within(confirm).getByLabelText("Type City to confirm"), "City");
    await user.click(within(confirm).getByRole("button", { name: "Delete system" }));
    expect(ops.deleteSystem).toHaveBeenCalledWith(11);
  });

  it("blocks and unblocks talkgroup numbers", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: /Blocked/ }));
    await user.type(screen.getByLabelText("Talkgroup number"), "555");
    await user.click(screen.getByRole("button", { name: "Block" }));
    expect(ops.block).toHaveBeenCalledWith({ id: 10, talkgroupId: 555 });
    await user.click(screen.getByRole("button", { name: "Unblock 999" }));
    expect(ops.unblock).toHaveBeenCalledWith({ id: 10, talkgroupId: 999 });
  });

  it("previews an import, respects the mode, and applies the remaining rows", async () => {
    const user = userEvent.setup();
    const preview: TalkgroupImportPreview = {
      format: "radioreference",
      rows: [
        { row: 2, talkgroupId: 101, label: "FD Disp", name: "Fire dispatch", status: "unchanged", changes: [] },
        { row: 3, talkgroupId: 102, label: "PD Dispatch", name: "Police dispatch", status: "changed", changes: [
          { field: "label", now: "PD Disp", after: "PD Dispatch" },
          { field: "name", now: "", after: "Police dispatch" },
        ] },
        { row: 4, talkgroupId: 103, label: "FD Tac", status: "new", changes: [] },
      ],
      problems: [{ row: 5, reason: "talkgroup id is not a number" }],
      new: 1,
      unchanged: 1,
      changed: 1,
    };
    ops.previewImport.mockResolvedValue(preview);
    ops.applyImport.mockResolvedValue({ ok: true, created: 1, updated: 1, unchanged: 1 });
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Import" }));
    const wizard = within(screen.getByRole("dialog", { name: "Import talkgroups into County" }));
    await user.upload(wizard.getByLabelText("CSV file"), new File(["Decimal,Alpha Tag\n"], "tgs.csv", { type: "text/csv" }));
    await user.click(wizard.getByRole("button", { name: "Review changes" }));
    const sent = ops.previewImport.mock.calls[0][0] as FormData;
    expect(sent.get("system_id")).toBe("10");
    expect(await wizard.findByText("1 row skipped")).toBeInTheDocument();
    // Fill-in mode only touches the blank name, so 1 new + 1 change.
    expect(wizard.getByRole("button", { name: "Apply 2 changes" })).toBeInTheDocument();
    expect(wizard.queryByText("PD Dispatch")).toBeNull();
    await user.click(wizard.getByRole("radio", { name: /Overwrite/ }));
    expect(wizard.getByRole("button", { name: "Apply 3 changes" })).toBeInTheDocument();
    expect(wizard.getByText("PD Dispatch")).toBeInTheDocument();
    await user.click(wizard.getByRole("checkbox", { name: "Apply 103" }));
    await user.click(wizard.getByRole("button", { name: "Apply 2 changes" }));
    expect(ops.applyImport).toHaveBeenCalledWith({
      systemId: 10,
      mode: "overwrite",
      rows: [{ row: 3, talkgroupId: 102, label: "PD Dispatch", name: "Police dispatch" }],
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Imported: 1 new talkgroup, 1 updated, 1 unchanged.");
  });

  it("on a phone shows the list first and a way back from a system", async () => {
    phone(true);
    const user = userEvent.setup();
    renderPanel();
    expect(screen.queryByRole("table", { name: "Talkgroups" })).toBeNull();
    await user.click(screen.getByRole("option", { name: /City/ }));
    expect(screen.getByRole("table", { name: "Talkgroups" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "City" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All systems" }));
    expect(screen.queryByRole("table", { name: "Talkgroups" })).toBeNull();
  });
});
