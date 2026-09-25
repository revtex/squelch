// Unit events (affiliations, calls, data) as they arrive, with a search and
// a way to hold the list still.
import { useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { DataTable, SearchBox, plural, type Column } from "@/features/admin/_shell";
import { fmtFreqMHz, fmtTime } from "./format";
import { useFreeze } from "./useFreeze";
import type { UnitEventEntry } from "./types";

const KIND_LABEL: Record<string, string> = {
  on: "on",
  off: "off",
  call: "call",
  end: "end",
  data: "data",
  join: "join",
  ackresp: "ack",
  ans_req: "answer",
  location: "location",
};

const KIND_TONE: Record<string, string> = {
  on: "badge-success",
  off: "badge-ghost",
  call: "badge-info",
  end: "badge-ghost",
  data: "badge-secondary",
  join: "badge-primary",
  location: "badge-warning",
};

function matches(e: UnitEventEntry, q: string): boolean {
  if (!q) return true;
  const hay = [e.shortname, e.unitId, e.unitAlpha, e.talkgroupId, e.talkgroupAlpha, e.talkgroupGroup, e.talkgroupTag]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export default function UnitsTab({ events }: { events: UnitEventEntry[] }) {
  const [query, setQuery] = useState("");
  const { rows, paused, newCount, toggle } = useFreeze(events);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((e) => matches(e, q)).slice().reverse();
  }, [rows, query]);

  const columns: Column<UnitEventEntry>[] = [
    { id: "when", header: "Time", phone: "show", sortValue: (r) => r.at, cell: (r) => <span className="font-mono text-xs">{fmtTime(r.at)}</span> },
    { id: "kind", header: "Event", phone: "show", sortValue: (r) => r.kind, cell: (r) => <span className={`badge badge-sm ${KIND_TONE[r.kind] ?? "badge-ghost"}`}>{KIND_LABEL[r.kind] ?? r.kind}</span> },
    { id: "unit", header: "Unit", phone: "title", sortValue: (r) => r.unitAlpha ?? r.unitId, cell: (r) => <span className="font-mono text-xs">{r.unitAlpha ?? r.unitId ?? "—"}</span> },
    { id: "tg", header: "Talkgroup", phone: "show", sortValue: (r) => r.talkgroupAlpha ?? r.talkgroupId, cell: (r) => r.talkgroupAlpha ?? r.talkgroupId ?? "—" },
    { id: "sys", header: "System", phone: "show", sortValue: (r) => r.shortname, cell: (r) => r.shortname ?? "—" },
    { id: "freq", header: "Frequency", phone: "hide", sortValue: (r) => r.freq, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.freq)}</span> },
    {
      id: "notes",
      header: "Notes",
      phone: "hide",
      sortValue: (r) => [r.encrypted && "encrypted", r.callNum && `call ${r.callNum}`, r.talkgroupTag, r.talkgroupPatches && `patches ${r.talkgroupPatches}`].filter(Boolean).join(" · "),
      cell: (r) => (
        <span className="text-xs text-base-content-dim">
          {[r.encrypted && "encrypted", r.callNum && `call ${r.callNum}`, r.talkgroupTag, r.talkgroupPatches && `patches ${r.talkgroupPatches}`].filter(Boolean).join(" · ")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={query} onChange={setQuery} label="Search unit events by unit, talkgroup or system" className="w-full sm:w-72" />
        <button type="button" className={`btn btn-sm ms-auto ${paused ? "btn-warning" : ""}`} aria-pressed={paused} onClick={toggle}>
          {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
          {paused ? "Follow" : "Hold"}
        </button>
        {paused && (
          <span role="status" className="text-xs text-warning">
            Held · {plural(newCount, "new event")} waiting
          </span>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(r) => `${r.at}-${r.topic}-${r.unitId ?? ""}-${r.talkgroupId ?? ""}`}
        caption="Unit events"
        defaultSort={{ id: "when", dir: "desc" }}
        pageSize={50}
        empty={query ? "No unit events match." : "No unit events yet. They arrive as radios affiliate and key up."}
      />
    </div>
  );
}
