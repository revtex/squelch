// Control-channel messages: counts by opcode, or the live feed with a Pause.
import { useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { DataTable, FilterChips, SearchBox, plural, type Column } from "@/features/admin/_shell";
import { fmtTime } from "./format";
import { messageStats, type MessageStat } from "./trunk";
import { useFreeze } from "./useFreeze";
import type { MessageEntry } from "./types";

type View = "stats" | "live";

function matches(m: MessageEntry, q: string): boolean {
  if (!q) return true;
  return [m.shortname, m.type, m.opcode, m.opcodeType, m.opcodeDesc, m.meta].filter(Boolean).join(" ").toLowerCase().includes(q);
}

export default function MessagesTab({ messages }: { messages: MessageEntry[] }) {
  const [view, setView] = useState<View>("stats");
  const [query, setQuery] = useState("");
  const { rows, paused, newCount, toggle } = useFreeze(messages);
  const stats = useMemo(() => messageStats(messages), [messages]);
  const live = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((m) => matches(m, q)).slice().reverse();
  }, [rows, query]);

  const statColumns: Column<MessageStat>[] = [
    { id: "count", header: "Count", phone: "show", align: "right", sortValue: (r) => r.count, cell: (r) => <span className="font-semibold tabular-nums">{r.count.toLocaleString()}</span> },
    { id: "type", header: "Type", phone: "title", sortValue: (r) => r.type, cell: (r) => r.type },
    { id: "opcode", header: "Opcode", phone: "show", sortValue: (r) => r.opcode, cell: (r) => <span className="font-mono text-xs">{r.opcode}</span> },
    { id: "otype", header: "Opcode type", phone: "show", sortValue: (r) => r.opcodeType, cell: (r) => r.opcodeType },
    { id: "sys", header: "Systems", phone: "hide", sortValue: (r) => r.systems, cell: (r) => r.systems },
    { id: "last", header: "Last seen", phone: "show", sortValue: (r) => r.lastSeen, cell: (r) => <span className="font-mono text-xs">{fmtTime(r.lastSeen)}</span> },
    { id: "desc", header: "Description", phone: "hide", sortValue: (r) => r.description, cell: (r) => <span className="text-xs text-base-content/70">{r.description || "—"}</span> },
  ];

  const liveColumns: Column<MessageEntry>[] = [
    { id: "when", header: "Time", phone: "show", sortValue: (r) => r.at, cell: (r) => <span className="font-mono text-xs">{fmtTime(r.at)}</span> },
    { id: "sys", header: "System", phone: "show", sortValue: (r) => r.shortname, cell: (r) => r.shortname ?? "—" },
    { id: "type", header: "Type", phone: "title", sortValue: (r) => r.type, cell: (r) => r.type ?? "—" },
    { id: "opcode", header: "Opcode", phone: "show", sortValue: (r) => r.opcode, cell: (r) => <span className="font-mono text-xs">{r.opcode ?? "—"}</span> },
    { id: "otype", header: "Opcode type", phone: "hide", sortValue: (r) => r.opcodeType, cell: (r) => r.opcodeType ?? "—" },
    {
      id: "meta",
      header: "Description",
      phone: "show",
      sortValue: (r) => r.meta ?? r.opcodeDesc ?? r.trunkMsg,
      cell: (r) => <span className="text-xs text-base-content/70">{r.meta ?? r.opcodeDesc ?? r.trunkMsg ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label="Messages"
          value={view}
          onChange={setView}
          options={[
            { id: "stats", label: "By opcode", count: stats.length },
            { id: "live", label: "Live", count: messages.length },
          ]}
        />
        {view === "live" && (
          <>
            <SearchBox value={query} onChange={setQuery} label="Search messages by system, type or opcode" className="w-full sm:w-64" />
            <button type="button" className={`btn btn-sm ms-auto ${paused ? "btn-warning" : ""}`} aria-pressed={paused} onClick={toggle}>
              {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
              {paused ? "Resume" : "Pause"}
            </button>
            {paused && (
              <span role="status" className="text-xs text-warning">
                Paused · {plural(newCount, "new message")} waiting
              </span>
            )}
          </>
        )}
      </div>
      {view === "stats" ? (
        <DataTable
          columns={statColumns}
          rows={stats}
          rowKey={(r) => r.key}
          caption="Messages by opcode"
          defaultSort={{ id: "count", dir: "desc" }}
          empty="No control-channel messages yet. Set the messages topic in the recorder's plugin config to see them."
        />
      ) : (
        <DataTable
          columns={liveColumns}
          rows={live}
          rowKey={(r) => `${r.at}-${r.opcode ?? ""}-${r.shortname ?? ""}`}
          caption="Live messages"
          defaultSort={{ id: "when", dir: "desc" }}
          pageSize={50}
          empty={query ? "No messages match." : "No control-channel messages yet."}
        />
      )}
    </div>
  );
}
