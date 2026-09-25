// Backup & import: the whole configuration as one file, in and out; radio
// data as CSV per kind, one system or all; RadioReference enrichment; and
// the API docs. Every import reviews before it writes, and a restore is
// guarded by a review, a mode and a typed word.
import { useState } from "react";
import { ArchiveRestore, Copy, Database, Download, ExternalLink, FileText, KeyRound, Upload } from "lucide-react";
import {
  DataTable,
  DetailsPanel,
  PageHeader,
  formatAgo,
  plural,
  useBackupCountsQuery,
  useDetails,
  useLazyExportConfigQuery,
  useLazyExportGroupsQuery,
  useLazyExportTagsQuery,
  useLazyExportTalkgroupsQuery,
  useLazyExportUnitsQuery,
  useListSystemsQuery,
  useToast,
  type Column,
} from "@/features/admin/_shell";
import { selectToken } from "@/features/auth";
import { useAppSelector } from "@/app/store";
import ImportWizard from "./ImportWizard";
import RestorePanel from "./RestorePanel";
import { ENTITY_LABEL, NEEDS_SYSTEM, downloadText, exportFilename, type ImportEntity } from "./tools";
import type { AdminSystem } from "@/types";

const SWAGGER_URL = "/api/v1/admin/docs/index.html";
const DOCS_SESSION_URL = "/api/v1/admin/docs/session";

type Panel =
  | { kind: "restore" }
  | { kind: "import"; entity: ImportEntity; system?: AdminSystem; title?: string }
  | { kind: "token" };

interface RadioRow {
  entity: ImportEntity;
  label: string;
  count: number | undefined;
  detail: string;
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-box border border-admin-line bg-base-100 p-4">
      <h3 className="flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function backupFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `squelch-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export default function ToolsPanel() {
  const toast = useToast();
  const token = useAppSelector(selectToken);
  const { data: systems = [] } = useListSystemsQuery();
  const counts = useBackupCountsQuery();
  const [exportConfig, { isFetching: preparingBackup }] = useLazyExportConfigQuery();
  const [exportTalkgroups] = useLazyExportTalkgroupsQuery();
  const [exportUnits] = useLazyExportUnitsQuery();
  const [exportGroups] = useLazyExportGroupsQuery();
  const [exportTags] = useLazyExportTagsQuery();
  const panel = useDetails<Panel>();
  const [exportSystem, setExportSystem] = useState<Record<ImportEntity, number>>({ talkgroups: 0, units: 0, groups: 0, tags: 0 });
  const [exporting, setExporting] = useState<ImportEntity | null>(null);
  const [rrSystemId, setRrSystemId] = useState(0);
  const [openingDocs, setOpeningDocs] = useState(false);
  const [copied, setCopied] = useState(false);

  const rrSystem = systems.find((s) => s.id === rrSystemId) ?? systems[0];

  const downloadBackup = async () => {
    try {
      const data = await exportConfig().unwrap();
      downloadText(backupFilename(), JSON.stringify(data, null, 2), "application/json");
      toast.success("Backup downloaded. Keep it private: it holds API keys and forwarding secrets.");
      counts.refetch();
    } catch {
      toast.error("The backup could not be prepared.");
    }
  };

  const runExport = async (entity: ImportEntity) => {
    setExporting(entity);
    const system = NEEDS_SYSTEM[entity] ? (systems.find((s) => s.id === exportSystem[entity]) ?? null) : null;
    const arg = system ? { systemId: system.id } : {};
    try {
      let csv: string;
      if (entity === "talkgroups") csv = await exportTalkgroups(arg).unwrap();
      else if (entity === "units") csv = await exportUnits(arg).unwrap();
      else if (entity === "groups") csv = await exportGroups().unwrap();
      else csv = await exportTags().unwrap();
      downloadText(exportFilename(entity, system), csv);
    } catch {
      toast.error(`The ${ENTITY_LABEL[entity]} export failed.`);
    } finally {
      setExporting(null);
    }
  };

  const openDocs = async () => {
    setOpeningDocs(true);
    try {
      const res = await fetch(DOCS_SESSION_URL, { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}` } });
      if (!res.ok) throw new Error(String(res.status));
      const win = window.open(SWAGGER_URL, "_blank", "noopener");
      if (!win) toast.error("The browser blocked the new tab; allow pop-ups for this site and try again.");
    } catch {
      toast.error("The API docs could not be opened: the session for them was refused.");
    } finally {
      setOpeningDocs(false);
    }
  };

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(`Bearer ${token}`);
      setCopied(true);
      toast.success("Access token copied. It expires in 15 minutes.");
    } catch {
      toast.error("The clipboard refused; select the token below and copy it by hand.");
    }
  };

  const c = counts.data;
  const rows: RadioRow[] = [
    { entity: "talkgroups", label: "Talkgroups", count: c?.talkgroups, detail: c ? `across ${plural(c.systems, "system")}` : "" },
    { entity: "units", label: "Units", count: c?.units, detail: c ? `across ${plural(c.systems, "system")}` : "" },
    { entity: "groups", label: "Groups", count: c?.groups, detail: "shared by every system" },
    { entity: "tags", label: "Tags", count: c?.tags, detail: "shared by every system" },
  ];

  const columns: Column<RadioRow>[] = [
    { id: "data", header: "Data", phone: "title", cell: (r) => <span className="font-medium">{r.label}</span> },
    {
      id: "count",
      header: "Count",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.count ?? "…"}
          {r.detail && <span className="ml-1 text-xs text-base-content-dim">{r.detail}</span>}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      className: "whitespace-nowrap",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-xs"
            disabled={NEEDS_SYSTEM[r.entity] && systems.length === 0}
            onClick={(e) => panel.open({ kind: "import", entity: r.entity }, e.currentTarget)}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Import
          </button>
          {NEEDS_SYSTEM[r.entity] && (
            <select
              aria-label={`Export ${r.label.toLowerCase()} from`}
              className="select select-xs"
              value={exportSystem[r.entity]}
              onChange={(e) => setExportSystem((s) => ({ ...s, [r.entity]: Number(e.target.value) }))}
            >
              <option value={0}>All systems</option>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-xs" disabled={exporting != null} onClick={() => void runExport(r.entity)}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exporting === r.entity ? "Exporting…" : NEEDS_SYSTEM[r.entity] && exportSystem[r.entity] === 0 ? "Export all" : "Export"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Backup & import"
        subtitle="The whole configuration as one file, radio data as CSV, RadioReference enrichment, and the API docs."
      />

      <Card title="Configuration backup" icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />}>
        <p className="text-sm text-base-content-dim">
          Systems, talkgroups, units, groups, tags, users (no passwords) and settings, as one JSON file. API keys and forwarding secrets are
          in it too, so keep it private.
        </p>
        <p className="text-sm" role="status">
          {counts.isLoading ? "…" : c?.lastBackupAt ? `Last download ${formatAgo(c.lastBackupAt)}.` : "Never downloaded from this server."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={preparingBackup} onClick={() => void downloadBackup()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {preparingBackup ? "Preparing…" : "Download backup"}
          </button>
          <button type="button" className="btn btn-sm" onClick={(e) => panel.open({ kind: "restore" }, e.currentTarget)}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            Restore from backup…
          </button>
        </div>
      </Card>

      <Card title="Radio data" icon={<Database className="h-4 w-4" aria-hidden="true" />}>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.entity} caption="Radio data" pageSize={0} loading={counts.isLoading && !c} />
        <p className="text-xs text-base-content-dim">Exports can be one system or all. Imports always preview before they write.</p>
      </Card>

      <Card title="Enrich from RadioReference" icon={<FileText className="h-4 w-4" aria-hidden="true" />}>
        <p className="text-sm text-base-content-dim">
          Bring labels, names, categories and tags in from a RadioReference talkgroup export. Same three-step wizard as Import, with a
          changes-only view.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="System to enrich"
            className="select select-sm"
            value={rrSystem?.id ?? 0}
            onChange={(e) => setRrSystemId(Number(e.target.value))}
            disabled={systems.length === 0}
          >
            {systems.length === 0 && <option value={0}>No systems yet</option>}
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!rrSystem}
            onClick={(e) => rrSystem && panel.open({ kind: "import", entity: "talkgroups", system: rrSystem, title: `Enrich ${rrSystem.label} from RadioReference` }, e.currentTarget)}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            Choose CSV…
          </button>
        </div>
      </Card>

      <Card title="API documentation" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
        <p className="text-sm text-base-content-dim">
          Swagger UI lists every endpoint and lets you try them as yourself. It opens in a new tab with a short-lived session of its own.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" disabled={openingDocs} onClick={() => void openDocs()}>
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {openingDocs ? "Opening…" : "Open Swagger UI"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!token} onClick={(e) => panel.open({ kind: "token" }, e.currentTarget)}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy an access token…
          </button>
        </div>
      </Card>

      {panel.selected?.kind === "restore" && (
        <RestorePanel
          onClose={panel.close}
          onDone={(r) => {
            panel.close();
            counts.refetch();
            const saved = r.snapshot ? ` The previous configuration was saved to ${r.snapshot}.` : "";
            toast.success(`Restored (${r.mode}): ${r.created} added, ${r.updated} updated, ${r.removed} removed.${saved}`);
          }}
        />
      )}
      {panel.selected?.kind === "import" && (
        <ImportWizard
          entity={panel.selected.entity}
          systems={systems}
          system={panel.selected.system}
          title={panel.selected.title}
          onClose={panel.close}
          onDone={(summary) => {
            panel.close();
            counts.refetch();
            toast.success(summary);
          }}
        />
      )}
      {panel.selected?.kind === "token" && (
        <DetailsPanel
          title="Your access token"
          subtitle="For curl, scripts and the Authorization header."
          onClose={() => {
            setCopied(false);
            panel.close();
          }}
        >
          <p role="alert" className="alert alert-warning text-sm">
            This is your live admin token. Anyone holding it is you for the next 15 minutes.
          </p>
          <textarea aria-label="Access token" className="textarea mt-3 w-full font-mono text-xs" rows={5} readOnly value={`Bearer ${token ?? ""}`} />
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={() => void copyToken()}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {copied ? "Copied" : "Copy token"}
          </button>
        </DetailsPanel>
      )}
    </div>
  );
}
