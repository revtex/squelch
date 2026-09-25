import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  DataTable,
  FilterChips,
  PageHeader,
  SearchBox,
  formatAgo,
  useCreateDirMonitorMutation,
  useDeleteDirMonitorMutation,
  useDetails,
  useOpenParam,
  useListDirMonitorsQuery,
  useListSystemsQuery,
  useListTalkgroupsQuery,
  useRestartDirMonitorMutation,
  useToast,
  useUpdateDirMonitorMutation,
  type Column,
} from "@/features/admin/_shell";
import type { AdminDirMonitor } from "@/types";
import DirMonitorDetails, { type MonitorAction } from "./DirMonitorDetails";
import DirMonitorForm, { type DirMonitorFormValues } from "./DirMonitorForm";
import {
  destinationLabel,
  fileName,
  matchesFilter,
  matchesSearch,
  recorderType,
  stateBadge,
  type StatusFilter,
} from "./monitors";

type Panel =
  | { key: string; kind: "details"; id: number }
  | { key: string; kind: "edit"; id: number }
  | { key: string; kind: "create" };

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Folder monitors: folders on the server that recorders write into. */
export default function DirMonitorPanel() {
  const { data: monitors, isLoading } = useListDirMonitorsQuery();
  const { data: systems } = useListSystemsQuery();
  const { data: talkgroups } = useListTalkgroupsQuery();
  const [createMonitor] = useCreateDirMonitorMutation();
  const [updateMonitor] = useUpdateDirMonitorMutation();
  const [deleteMonitor] = useDeleteDirMonitorMutation();
  const [restartMonitor] = useRestartDirMonitorMutation();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const monitorIds = useMemo(() => monitors?.map((m) => m.id), [monitors]);
  useOpenParam(monitorIds, (id) => panel.open({ key: `details:${id}`, kind: "details", id }));
  const p = panel.selected;

  const systemList = useMemo(() => systems ?? [], [systems]);
  const talkgroupList = useMemo(() => talkgroups ?? [], [talkgroups]);
  const all = useMemo(
    () => (monitors ? [...monitors].sort((a, b) => a.order - b.order || a.id - b.id) : []),
    [monitors],
  );
  const rows = useMemo(
    () =>
      all.filter(
        (m) => matchesFilter(m, filter) && matchesSearch(m, systemList, talkgroupList, query),
      ),
    [all, filter, query, systemList, talkgroupList],
  );
  const counts = useMemo(() => {
    const c = { all: all.length, running: 0, stopped: 0, disabled: 0 };
    for (const m of all) {
      if (matchesFilter(m, "running")) c.running++;
      else if (matchesFilter(m, "stopped")) c.stopped++;
      else if (matchesFilter(m, "disabled")) c.disabled++;
    }
    return c;
  }, [all]);

  const current = p && "id" in p ? (all.find((m) => m.id === p.id) ?? null) : null;

  const columns: Column<AdminDirMonitor>[] = [
    {
      id: "folder",
      header: "Folder",
      phone: "title",
      sortValue: (m) => m.directory,
      cell: (m) => (
        <span className="flex flex-col">
          <span className="font-mono text-sm break-all">{m.directory}</span>
          <span className="text-xs text-base-content-dim">{recorderType(m.type).label}</span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (m) => stateBadge(m).id,
      cell: (m) => {
        const b = stateBadge(m);
        return (
          <span className="flex flex-col gap-0.5">
            <span className={`badge badge-sm ${b.badge}`}>{b.label}</span>
            {m.status.error && (
              <span className="text-xs text-error">{m.status.error}</span>
            )}
          </span>
        );
      },
    },
    {
      id: "destination",
      header: "Calls go to",
      phone: "hide",
      cell: (m) => destinationLabel(m, systemList, talkgroupList),
    },
    {
      id: "lastFile",
      header: "Last file",
      sortValue: (m) => m.status.lastFileAt ?? 0,
      cell: (m) =>
        m.status.lastFileAt ? (
          <span className="flex flex-col">
            <span>{formatAgo(m.status.lastFileAt)}</span>
            <span className="truncate font-mono text-xs text-base-content-dim" title={m.status.lastFile}>
              {fileName(m.status.lastFile)}
            </span>
          </span>
        ) : (
          <span className="text-base-content-dim">none yet</span>
        ),
    },
    {
      id: "calls",
      header: "Calls, 24 h",
      align: "right",
      sortValue: (m) => m.status.ingested24h,
      cell: (m) => (m.status.ingested24h > 0 ? m.status.ingested24h.toLocaleString() : "—"),
    },
  ];

  const openDetails = (m: AdminDirMonitor, trigger: HTMLElement) =>
    panel.open({ key: `details:${m.id}`, kind: "details", id: m.id }, trigger);

  const closeForm = () => {
    setFormError(null);
    panel.close();
  };

  const withBusy = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      setFormError(message(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const onCreate = (values: DirMonitorFormValues) =>
    withBusy(async () => {
      const created = await createMonitor({ ...values, order: all.length }).unwrap();
      toast.success(`Now watching ${created.directory}.`);
      panel.replace({ key: `details:${created.id}`, kind: "details", id: created.id });
    }, "Failed to add the monitor.");

  const onUpdate = (m: AdminDirMonitor, values: DirMonitorFormValues) =>
    withBusy(async () => {
      await updateMonitor({ id: m.id, ...values, order: m.order }).unwrap();
      toast.success(`Saved ${values.directory}.`);
      panel.replace({ key: `details:${m.id}`, kind: "details", id: m.id });
    }, "Failed to save the monitor.");

  const act = async (m: AdminDirMonitor, action: MonitorAction): Promise<string | null> => {
    setBusy(true);
    try {
      if (action === "delete") {
        await deleteMonitor(m.id).unwrap();
        toast.success(`Deleted the monitor for ${m.directory}.`);
        return null;
      }
      const { id, status: _status, ...rest } = m;
      void _status;
      await updateMonitor({ id, ...rest, disabled: action === "disable" ? 1 : 0 }).unwrap();
      toast.success(
        action === "disable" ? `Stopped watching ${m.directory}.` : `Watching ${m.directory} again.`,
      );
      return null;
    } catch (e) {
      return message(e, "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Folder monitors"
        subtitle="Folders on this server that a recorder writes into. New recordings become calls without an upload."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => panel.open({ key: "create", kind: "create" })}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add monitor
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Search by folder, recorder or destination"
          className="w-full sm:w-80"
        />
        <FilterChips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "running", label: "Running", count: counts.running },
            { id: "stopped", label: "Stopped", count: counts.stopped },
            { id: "disabled", label: "Disabled", count: counts.disabled },
          ]}
        />
      </div>

      <DataTable
        caption="Folder monitors"
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        loading={isLoading}
        empty={
          all.length === 0
            ? "No folder monitors yet. Add one to import recordings a recorder writes to this server."
            : "No monitor matches that search."
        }
        defaultSort={{ id: "folder", dir: "asc" }}
        onOpen={openDetails}
        rowLabel={(m) => m.directory}
        openKey={p?.kind === "details" ? p.id : null}
      />

      {p?.kind === "details" && current && (
        <DirMonitorDetails
          key={current.id}
          monitor={current}
          systems={systemList}
          talkgroups={talkgroupList}
          busy={busy}
          onEdit={() => panel.replace({ key: `edit:${current.id}`, kind: "edit", id: current.id })}
          onRestart={async () => (await restartMonitor(current.id).unwrap()).status}
          onAction={(action) => act(current, action)}
          onClose={panel.close}
        />
      )}

      {p?.kind === "create" && (
        <DirMonitorForm
          monitor={null}
          systems={systemList}
          talkgroups={talkgroupList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onCreate(values)}
          onClose={closeForm}
        />
      )}

      {p?.kind === "edit" && current && (
        <DirMonitorForm
          key={current.id}
          monitor={current}
          systems={systemList}
          talkgroups={talkgroupList}
          busy={busy}
          error={formError}
          onSubmit={(values) => void onUpdate(current, values)}
          onClose={closeForm}
        />
      )}
    </div>
  );
}
