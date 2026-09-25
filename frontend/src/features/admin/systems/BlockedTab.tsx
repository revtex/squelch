import { useState } from "react";
import { X } from "lucide-react";
import type { AdminTalkgroup } from "@/types";

export interface BlockedTabProps {
  blocked: number[];
  talkgroups: AdminTalkgroup[];
  autoPopulate: boolean;
  busy: boolean;
  onBlock: (talkgroupId: number) => Promise<boolean>;
  onUnblock: (talkgroupId: number) => void;
}

/** Talkgroup numbers whose uploads are dropped; add one, or remove with ✕. */
export default function BlockedTab({ blocked, talkgroups, autoPopulate, busy, onBlock, onUnblock }: BlockedTabProps) {
  const [value, setValue] = useState("");
  const labels = new Map(talkgroups.map((t) => [t.talkgroupId, t.label]));

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-base-content-dim">
        Uploads for a blocked talkgroup are dropped before they are stored.
        {autoPopulate
          ? " Use it for talkgroups auto-populate keeps creating that you never want."
          : " Auto-populate is off for this system, so unknown talkgroups are dropped already; blocking still stops known ones."}
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0) return;
          void onBlock(n).then((ok) => {
            if (ok) setValue("");
          });
        }}
      >
        <label className="form-control">
          <span className="label-text text-xs">Talkgroup number</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            className="input input-sm w-40"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-sm" disabled={busy || value === ""}>
          Block
        </button>
      </form>
      {blocked.length === 0 ? (
        <p className="text-sm text-base-content-dim">Nothing is blocked.</p>
      ) : (
        <ul aria-label="Blocked talkgroups" className="flex flex-wrap gap-2">
          {blocked.map((n) => (
            <li key={n} className="badge badge-lg gap-1 pe-1">
              <span className="font-mono">{n}</span>
              {labels.get(n) && <span className="text-base-content-dim">{labels.get(n)}</span>}
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-circle"
                aria-label={`Unblock ${n}`}
                disabled={busy}
                onClick={() => onUnblock(n)}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
