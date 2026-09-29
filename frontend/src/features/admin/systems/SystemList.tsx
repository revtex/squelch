import { ArrowDown, ArrowUp } from "lucide-react";
import { formatAgo, plural } from "@/features/admin/_shell";
import type { AdminSystem } from "@/types";
import { ledCss } from "./systems";

export interface SystemListProps {
  systems: AdminSystem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** In reorder mode each row has move buttons instead of being an option. */
  reordering: boolean;
  onMove: (id: number, direction: -1 | 1) => void;
}

function activity(s: AdminSystem): string {
  if (s.calls24h > 0) return `${s.calls24h.toLocaleString()} ${s.calls24h === 1 ? "call" : "calls"} / 24 h`;
  if (s.lastCall) return `last call ${formatAgo(s.lastCall)}`;
  return "no calls yet";
}

/** The systems, one per row, with counts and activity; a listbox unless reordering. */
export default function SystemList({ systems, selectedId, onSelect, reordering, onMove }: SystemListProps) {
  if (systems.length === 0) {
    return <p className="p-4 text-sm text-base-content-dim">No systems yet. Most appear on their own when uploads may create them.</p>;
  }
  const rowBody = (s: AdminSystem) => (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ledCss(s.led) }} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{s.label}</span>
        <span className="block text-xs text-base-content-dim">
          ID {s.systemId} · {plural(s.talkgroups, "talkgroup")} · {activity(s)}
        </span>
      </span>
      <span className={`badge mt-0.5 shrink-0 ${s.autoPopulateTalkgroups === 1 ? "badge-success" : ""}`}>
        {s.autoPopulateTalkgroups === 1 ? "auto" : "manual"}
      </span>
    </>
  );

  if (reordering) {
    return (
      <ul aria-label="Systems in display order" className="divide-y divide-admin-line2">
        {systems.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2.5 px-4 py-3">
            {rowBody(s)}
            <span className="join shrink-0">
              <button
                type="button"
                className="btn btn-ghost btn-xs join-item"
                aria-label={`Move ${s.label} up`}
                disabled={i === 0}
                onClick={() => onMove(s.id, -1)}
              >
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-xs join-item"
                aria-label={`Move ${s.label} down`}
                disabled={i === systems.length - 1}
                onClick={() => onMove(s.id, 1)}
              >
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul role="listbox" aria-label="Systems" className="divide-y divide-admin-line2">
      {systems.map((s) => {
        const on = s.id === selectedId;
        return (
          <li
            key={s.id}
            role="option"
            aria-selected={on}
            tabIndex={0}
            className={`flex cursor-pointer items-center gap-2.5 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary ${on ? "bg-admin-navy2" : "hover:bg-base-300"}`}
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
          >
            {rowBody(s)}
          </li>
        );
      })}
    </ul>
  );
}
