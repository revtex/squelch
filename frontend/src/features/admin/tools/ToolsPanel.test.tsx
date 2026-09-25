import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ToolsPanel from "./ToolsPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminSystem, BackupCounts, BackupPreview, LabelImportPreview, UnitImportPreview } from "@/types";

const now = Math.floor(Date.now() / 1000);

const systems: AdminSystem[] = [
  { id: 10, systemId: 1, label: "County", autoPopulateTalkgroups: 1, blacklistsJson: null, led: null, order: 0, talkgroups: 3, units: 1, calls24h: 0, lastCall: null, blocked: [] },
  { id: 11, systemId: 2, label: "City", autoPopulateTalkgroups: 0, blacklistsJson: null, led: null, order: 1, talkgroups: 1, units: 0, calls24h: 0, lastCall: null, blocked: [] },
];

const counts: BackupCounts = { systems: 2, talkgroups: 531, units: 88, groups: 12, tags: 7, users: 3, lastBackupAt: now - 2 * 86400 };

type Op = (arg: unknown) => Promise<unknown>;
const ops = {
  exportConfig: vi.fn<Op>(),
  exportTalkgroups: vi.fn<Op>(),
  exportUnits: vi.fn<Op>(),
  exportGroups: vi.fn<Op>(),
  exportTags: vi.fn<Op>(),
  backupPreview: vi.fn<Op>(),
  restore: vi.fn<Op>(),
  previewUnits: vi.fn<Op>(),
  applyUnits: vi.fn<Op>(),
  previewGroups: vi.fn<Op>(),
  applyGroups: vi.fn<Op>(),
  previewTags: vi.fn<Op>(),
  applyTags: vi.fn<Op>(),
  previewTalkgroups: vi.fn<Op>(),
  applyTalkgroups: vi.fn<Op>(),
  refetch: vi.fn(),
};
const mutation = (fn: Op) => [(arg: unknown) => ({ unwrap: () => fn(arg) }), { isLoading: false, isFetching: false, isError: false }];

vi.mock("@/features/auth", () => ({ selectToken: () => "tok-123" }));
vi.mock("@/app/store", () => ({ useAppSelector: (selector: (state: unknown) => unknown) => selector({}) }));

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListSystemsQuery: () => ({ data: systems, isLoading: false }),
  useBackupCountsQuery: () => ({ data: counts, isLoading: false, refetch: ops.refetch }),
  useLazyExportConfigQuery: () => mutation(ops.exportConfig),
  useLazyExportTalkgroupsQuery: () => mutation(ops.exportTalkgroups),
  useLazyExportUnitsQuery: () => mutation(ops.exportUnits),
  useLazyExportGroupsQuery: () => mutation(ops.exportGroups),
  useLazyExportTagsQuery: () => mutation(ops.exportTags),
  useBackupPreviewMutation: () => mutation(ops.backupPreview),
  useImportConfigMutation: () => mutation(ops.restore),
  usePreviewUnitImportMutation: () => mutation(ops.previewUnits),
  useApplyUnitImportMutation: () => mutation(ops.applyUnits),
  usePreviewGroupImportMutation: () => mutation(ops.previewGroups),
  useApplyGroupImportMutation: () => mutation(ops.applyGroups),
  usePreviewTagImportMutation: () => mutation(ops.previewTags),
  useApplyTagImportMutation: () => mutation(ops.applyTags),
  usePreviewTalkgroupImportMutation: () => mutation(ops.previewTalkgroups),
  useApplyTalkgroupImportMutation: () => mutation(ops.applyTalkgroups),
}));

function renderPanel() {
  return render(
    <MemoryRouter initialEntries={["/admin/tools"]}>
      <ToastProvider>
        <ToolsPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

const downloads: { name: string; text: string }[] = [];

beforeEach(() => {
  downloads.length = 0;
  Object.values(ops).forEach((fn) => fn.mockReset());
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, text: "" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToolsPanel", () => {
  it("shows the last backup, the radio data counts, and downloads a backup", async () => {
    const user = userEvent.setup();
    ops.exportConfig.mockResolvedValue({ systems: [], settings: [] });
    renderPanel();
    expect(screen.getByRole("heading", { name: "Backup & import" })).toBeInTheDocument();
    expect(screen.getByText("Last download 2 d ago")).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "Radio data" }));
    expect(table.getByText("531")).toBeInTheDocument();
    expect(table.getAllByText("across 2 systems")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Download backup" }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/^squelch-backup-\d{8}-\d{4}\.json$/);
    expect(ops.refetch).toHaveBeenCalled();
    expect(await screen.findByText(/Backup downloaded/)).toBeInTheDocument();
  });

  it("exports one system or all, naming the file after the choice", async () => {
    const user = userEvent.setup();
    ops.exportTalkgroups.mockResolvedValue("talkgroup_id,label\n1,a\n");
    ops.exportGroups.mockResolvedValue("label\nFire\n");
    renderPanel();
    const table = within(screen.getByRole("table", { name: "Radio data" }));

    await user.click(table.getAllByRole("button", { name: "Export all" })[0]);
    await waitFor(() => expect(ops.exportTalkgroups).toHaveBeenCalledWith({}));
    expect(downloads[0].name).toBe("all-systems-talkgroups.csv");

    // One picker in the card header scopes both talkgroup and unit exports.
    await user.selectOptions(screen.getByRole("combobox", { name: "Export from" }), "11");
    await user.click(table.getAllByRole("button", { name: "Export" })[0]);
    await waitFor(() => expect(ops.exportTalkgroups).toHaveBeenLastCalledWith({ systemId: 11 }));
    expect(downloads[1].name).toBe("City-talkgroups.csv");

    await user.click(table.getAllByRole("button", { name: "Export" })[2]);
    await waitFor(() => expect(ops.exportGroups).toHaveBeenCalled());
    expect(downloads[2].name).toBe("all-systems-groups.csv");
  });

  it("imports units through the wizard with a system picker and a review", async () => {
    const user = userEvent.setup();
    const preview: UnitImportPreview = {
      rows: [
        { row: 2, unitId: 4001, label: "Engine 1", status: "unchanged", changes: [] },
        { row: 3, unitId: 4002, label: "Medic 2", status: "changed", changes: [{ field: "label", now: "M2", after: "Medic 2" }] },
        { row: 4, unitId: 4003, label: "Chief", status: "new", changes: [] },
      ],
      problems: [],
      new: 1,
      unchanged: 1,
      changed: 1,
    };
    ops.previewUnits.mockResolvedValue(preview);
    ops.applyUnits.mockResolvedValue({ ok: true, created: 1, updated: 1, unchanged: 0 });
    renderPanel();
    const table = within(screen.getByRole("table", { name: "Radio data" }));
    await user.click(table.getAllByRole("button", { name: "Import" })[1]);
    const wizard = within(screen.getByRole("dialog", { name: "Import units into County" }));
    await user.selectOptions(wizard.getByLabelText("System"), "11");
    expect(screen.getByRole("dialog", { name: "Import units into City" })).toBeInTheDocument();
    await user.upload(wizard.getByLabelText("CSV file"), new File(["unit_id,label\n"], "units.csv", { type: "text/csv" }));
    await user.click(wizard.getByRole("button", { name: "Review changes" }));
    expect((ops.previewUnits.mock.calls[0][0] as FormData).get("system_id")).toBe("11");
    expect(await wizard.findByText("1 new unit")).toBeInTheDocument();
    // Fill mode leaves the existing label alone; overwrite takes it.
    expect(wizard.getByRole("button", { name: "Apply 1 change" })).toBeInTheDocument();
    await user.click(wizard.getByRole("radio", { name: "Overwrite labels" }));
    await user.click(wizard.getByRole("button", { name: "Apply 2 changes" }));
    expect(ops.applyUnits).toHaveBeenCalledWith({
      systemId: 11,
      mode: "overwrite",
      rows: [
        { row: 3, unitId: 4002, label: "Medic 2" },
        { row: 4, unitId: 4003, label: "Chief" },
      ],
    });
    expect(await screen.findByText("Imported: 1 new unit, 1 updated, 0 unchanged.")).toBeInTheDocument();
  });

  it("imports groups as labels, only the new ones", async () => {
    const user = userEvent.setup();
    const preview: LabelImportPreview = {
      rows: [
        { row: 1, label: "Fire", status: "unchanged" },
        { row: 2, label: "EMS", status: "new" },
        { row: 3, label: "Roads", status: "new" },
      ],
      problems: [{ row: 4, reason: "label is missing" }],
      new: 2,
      unchanged: 1,
    };
    ops.previewGroups.mockResolvedValue(preview);
    ops.applyGroups.mockResolvedValue({ ok: true, created: 1, unchanged: 1 });
    renderPanel();
    const table = within(screen.getByRole("table", { name: "Radio data" }));
    await user.click(table.getAllByRole("button", { name: "Import" })[2]);
    const wizard = within(screen.getByRole("dialog", { name: "Import groups" }));
    expect(wizard.queryByLabelText("System")).toBeNull();
    await user.upload(wizard.getByLabelText("CSV file"), new File(["label\nFire\n"], "groups.csv", { type: "text/csv" }));
    await user.click(wizard.getByRole("button", { name: "Review changes" }));
    expect(await wizard.findByText("2 new groups")).toBeInTheDocument();
    expect(wizard.getByText("1 row skipped")).toBeInTheDocument();
    expect(wizard.queryByRole("radio", { name: /Overwrite/ })).toBeNull();
    await user.click(wizard.getByRole("checkbox", { name: "Apply Roads" }));
    await user.click(wizard.getByRole("button", { name: "Apply 1 change" }));
    expect(ops.applyGroups).toHaveBeenCalledWith({ labels: ["EMS"] });
    expect(await screen.findByText("Imported: 1 new group, 1 unchanged.")).toBeInTheDocument();
  });

  it("opens the RadioReference wizard on the chosen system", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.selectOptions(screen.getByRole("combobox", { name: "System to enrich" }), "11");
    await user.click(screen.getByRole("button", { name: "Choose CSV…" }));
    expect(screen.getByRole("dialog", { name: "Enrich City from RadioReference" })).toBeInTheDocument();
  });

  it("restores only after a review, a mode and the typed word", async () => {
    const user = userEvent.setup();
    const preview: BackupPreview = {
      entities: [
        { key: "systems", label: "Systems", included: true, inFile: 2, now: 2, added: 0, changed: 0, removed: 0, examples: [] },
        { key: "talkgroups", label: "Talkgroups", included: true, inFile: 531, now: 548, added: 0, changed: 0, removed: 17, examples: ["LCSO", "TG 41021"] },
        { key: "users", label: "Users", included: true, inFile: 13, now: 14, added: 0, changed: 0, removed: 1, examples: ["guest-media"] },
        { key: "settings", label: "Settings", included: true, inFile: 24, now: 24, added: 0, changed: 2, removed: 0, examples: [] },
        { key: "webhooks", label: "Webhooks", included: false, inFile: 0, now: 1, added: 0, changed: 0, removed: 0, examples: [] },
      ],
      warnings: [],
    };
    ops.backupPreview.mockResolvedValue(preview);
    ops.restore.mockResolvedValue({ ok: true, mode: "replace", created: 0, updated: 2, removed: 18, snapshot: "/data/backups/pre-restore-1.json" });
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Restore from backup…" }));
    const panel = within(screen.getByRole("dialog", { name: "Restore from backup" }));
    const backup = { systems: [{ id: 1 }], talkgroups: [] };
    await user.upload(panel.getByLabelText("Backup file"), new File([JSON.stringify(backup)], "b.json", { type: "application/json" }));
    await user.click(panel.getByRole("button", { name: "Review" }));
    expect(ops.backupPreview).toHaveBeenCalledWith(backup);

    const review = within(await panel.findByRole("table", { name: "What the restore would change" }));
    expect(review.getByText("17 not in the file, kept (LCSO, TG 41021, …)")).toBeInTheDocument();
    expect(review.getByText("not in the file; left alone")).toBeInTheDocument();
    expect(review.getByText("2 differ")).toBeInTheDocument();
    expect(panel.getByRole("status")).toHaveTextContent("0 added, 2 updated, nothing removed.");

    await user.click(panel.getByRole("radio", { name: /Replace everything/ }));
    expect(review.getByText("17 not in the file would be removed (LCSO, TG 41021, …)")).toBeInTheDocument();
    expect(panel.getByRole("status")).toHaveTextContent("0 added, 2 updated, 18 removed.");
    await user.click(panel.getByRole("button", { name: "Replace everything…" }));
    const confirm = within(panel.getByRole("group", { name: "Confirm" }));
    const go = confirm.getByRole("button", { name: "Replace everything" });
    expect(go).toBeDisabled();
    await user.type(confirm.getByLabelText("Type RESTORE to continue"), "restore");
    expect(go).toBeEnabled();
    await user.click(go);
    expect(ops.restore).toHaveBeenCalledWith({ ...backup, mode: "replace" });
    expect(await screen.findByText("Restored (replace): 0 added, 2 updated, 18 removed. The previous configuration was saved to /data/backups/pre-restore-1.json.")).toBeInTheDocument();
  });

  it("refuses a file that is not a backup before asking the server", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Restore from backup…" }));
    const panel = within(screen.getByRole("dialog", { name: "Restore from backup" }));
    await user.upload(panel.getByLabelText("Backup file"), new File(["not json"], "b.json", { type: "application/json" }));
    await user.click(panel.getByRole("button", { name: "Review" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("The file is not JSON.");
    expect(ops.backupPreview).not.toHaveBeenCalled();
  });

  it("shows the token behind a warning and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Copy an access token…" }));
    const panel = within(screen.getByRole("dialog", { name: "Your access token" }));
    expect(panel.getByRole("alert")).toHaveTextContent("Anyone holding it is you for the next 15 minutes.");
    expect(panel.getByRole("textbox", { name: "Access token" })).toHaveValue("Bearer tok-123");
    await user.click(panel.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith("Bearer tok-123");
    expect(await panel.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("reports when the API docs session is refused", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Open Swagger UI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The API docs could not be opened");
  });
});
