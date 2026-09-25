// Calls in progress on the recorder, and the ones that just started or ended.
import { useMemo } from "react";
import { Download } from "lucide-react";
import { DataTable, FilterChips, plural, type Column } from "@/features/admin/_shell";
import { fmtDuration, fmtFreqMHz, fmtTime } from "./format";
import { activeCallRows, csvName, downloadText, toCsv, type ActiveCallRow } from "./trunk";
import type { RecentCallEntry, TrInstance } from "./types";

export interface CallsTabProps {
  instance: TrInstance;
  active: unknown;
  recent: RecentCallEntry[];
  view: "active" | "recent";
  onView: (v: "active" | "recent") => void;
}

function Flags({ encrypted, emergency, conventional }: { encrypted?: boolean; emergency?: boolean; conventional?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1">
      {encrypted && <span className="badge badge-xs badge-warning">encrypted</span>}
      {emergency && <span className="badge badge-xs badge-error">emergency</span>}
      {conventional && <span className="badge badge-xs badge-info">conventional</span>}
    </span>
  );
}

export default function CallsTab({ instance, active, recent, view, onView }: CallsTabProps) {
  const activeRows = useMemo(() => activeCallRows(active), [active]);
  const recentRows = useMemo(() => recent.slice().reverse(), [recent]);

  const activeColumns: Column<ActiveCallRow>[] = [
    { id: "tg", header: "Talkgroup", phone: "title", sortValue: (r) => r.talkgroupAlpha ?? r.talkgroup, cell: (r) => <span className="font-medium">{r.talkgroupAlpha ?? r.talkgroup ?? "—"}</span> },
    { id: "tgid", header: "TG ID", phone: "hide", sortValue: (r) => r.talkgroup, cell: (r) => <span className="font-mono text-xs">{r.talkgroup ?? "—"}</span> },
    { id: "sys", header: "System", phone: "show", sortValue: (r) => r.sysName, cell: (r) => r.sysName ?? "—" },
    { id: "unit", header: "Unit", phone: "show", sortValue: (r) => r.unitAlpha ?? r.unit, cell: (r) => <span className="font-mono text-xs">{r.unitAlpha ?? r.unit ?? "—"}</span> },
    { id: "freq", header: "Frequency", phone: "hide", sortValue: (r) => r.freq, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.freq)}</span> },
    { id: "state", header: "State", phone: "show", sortValue: (r) => r.recState ?? r.callState, cell: (r) => <span className="badge badge-sm badge-ghost">{(r.recState ?? r.callState ?? "—").toLowerCase()}</span> },
    { id: "flags", header: "Flags", phone: "show", sortValue: (r) => [r.encrypted && "encrypted", r.emergency && "emergency"].filter(Boolean).join(" "), cell: (r) => <Flags encrypted={r.encrypted} emergency={r.emergency} /> },
  ];

  const recentColumns: Column<RecentCallEntry>[] = [
    { id: "when", header: "Time", phone: "show", sortValue: (r) => r.at, cell: (r) => <span className="font-mono text-xs">{fmtTime(r.at)}</span> },
    { id: "kind", header: "Event", phone: "show", sortValue: (r) => r.kind, cell: (r) => <span className={`badge badge-sm ${r.kind === "start" ? "badge-success" : "badge-ghost"}`}>{r.kind === "start" ? "started" : "ended"}</span> },
    { id: "tg", header: "Talkgroup", phone: "title", sortValue: (r) => r.talkgroupAlpha ?? r.talkgroup, cell: (r) => <span className="font-medium">{r.talkgroupAlpha ?? r.talkgroup ?? "—"}</span> },
    { id: "sys", header: "System", phone: "show", sortValue: (r) => r.sysName, cell: (r) => r.sysName ?? "—" },
    { id: "unit", header: "Unit", phone: "hide", sortValue: (r) => r.unitAlpha ?? r.unit, cell: (r) => <span className="font-mono text-xs">{r.unitAlpha ?? r.unit ?? "—"}</span> },
    { id: "freq", header: "Frequency", phone: "hide", sortValue: (r) => r.freq, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.freq)}</span> },
    { id: "len", header: "Length", phone: "show", align: "right", sortValue: (r) => r.length, cell: (r) => fmtDuration(r.length) },
    { id: "flags", header: "Flags", phone: "show", sortValue: (r) => [r.encrypted && "encrypted", r.emergency && "emergency", r.conventional && "conventional"].filter(Boolean).join(" "), cell: (r) => <Flags encrypted={r.encrypted} emergency={r.emergency} conventional={r.conventional} /> },
  ];

  const exportCsv = () => {
    if (view === "active") downloadText(csvName(instance, "active-calls"), toCsv(activeColumns, activeRows));
    else downloadText(csvName(instance, "recent-calls"), toCsv(recentColumns, recentRows));
  };
  const count = view === "active" ? activeRows.length : recentRows.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label="Calls"
          value={view}
          onChange={onView}
          options={[
            { id: "active", label: "In progress", count: activeRows.length },
            { id: "recent", label: "Recent", count: recentRows.length },
          ]}
        />
        <button type="button" className="btn btn-sm btn-ghost ms-auto" onClick={exportCsv} disabled={count === 0}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>
      {view === "active" ? (
        <DataTable
          columns={activeColumns}
          rows={activeRows}
          rowKey={(r) => r.key}
          caption="Calls in progress"
          defaultSort={{ id: "tg", dir: "asc" }}
          empty="Nothing is being recorded right now."
        />
      ) : (
        <DataTable
          columns={recentColumns}
          rows={recentRows}
          rowKey={(r) => `${r.callId ?? r.callNum ?? ""}-${r.kind}-${r.at}`}
          caption="Recent calls"
          defaultSort={{ id: "when", dir: "desc" }}
          empty="No calls have started or ended since this page opened."
        />
      )}
      {view === "recent" && recentRows.length > 0 && (
        <p className="text-xs text-base-content/60">The last {plural(recentRows.length, "event")} since the page opened; the recorder does not replay history.</p>
      )}
    </div>
  );
}
