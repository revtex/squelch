// Every recorder the plugin reports, so a stuck one stands out.
import { useMemo } from "react";
import { Download } from "lucide-react";
import { DataTable, type Column } from "@/features/admin/_shell";
import { fmtDuration, fmtFreqMHz } from "./format";
import { RECORDER_STATE_TONE, csvName, downloadText, recorderRows, toCsv, type RecorderRow } from "./trunk";
import type { TrInstance } from "./types";

export interface RecordersTabProps {
  instance: TrInstance;
  payload: unknown;
}

export default function RecordersTab({ instance, payload }: RecordersTabProps) {
  const rows = useMemo(() => recorderRows(payload), [payload]);
  const columns: Column<RecorderRow>[] = [
    { id: "id", header: "Recorder", phone: "title", sortValue: (r) => r.id, cell: (r) => <span className="font-mono">{r.id}</span> },
    { id: "src", header: "Source", phone: "show", sortValue: (r) => r.source, cell: (r) => r.source ?? "—" },
    { id: "type", header: "Type", phone: "show", sortValue: (r) => r.type, cell: (r) => r.type ?? "—" },
    {
      id: "state",
      header: "State",
      phone: "show",
      sortValue: (r) => r.state,
      cell: (r) => <span className={`badge badge-sm ${RECORDER_STATE_TONE[r.state] ?? "badge-ghost"}`}>{r.state}</span>,
    },
    { id: "freq", header: "Frequency", phone: "show", sortValue: (r) => r.freq, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.freq)}</span> },
    { id: "dur", header: "Busy for", phone: "hide", align: "right", sortValue: (r) => r.duration, cell: (r) => fmtDuration(r.duration) },
    { id: "calls", header: "Calls", phone: "show", align: "right", sortValue: (r) => r.calls, cell: (r) => (r.calls != null ? r.calls.toLocaleString() : "—") },
  ];
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => downloadText(csvName(instance, "recorders"), toCsv(columns, rows))}
          disabled={rows.length === 0}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption="Recorders"
        defaultSort={{ id: "id", dir: "asc" }}
        pageSize={50}
        empty="No recorders frame yet. The plugin sends one every few seconds while it runs."
      />
    </div>
  );
}
