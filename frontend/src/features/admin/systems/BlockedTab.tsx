import { useId, useState } from "react";
import { X } from "lucide-react";
import { CHIP, CHIP_OFF } from "@/features/admin/_shell";
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
  const inputId = useId();
  const labels = new Map(talkgroups.map((t) => [t.talkgroupId, t.label]));

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-sm text-base-content-dim">
        Uploads for a blocked talkgroup are dropped before they are stored.
        {autoPopulate
          ? " Use it for talkgroups auto-populate keeps creating that you never want."
          : " Auto-populate is off for this system, so unknown talkgroups are dropped already; blocking still stops known ones."}
      </p>
      {blocked.length === 0 ? (
        <p className="text-sm text-base-content-dim">Nothing is blocked.</p>
      ) : (
        <ul aria-label="Blocked talkgroups" className="flex flex-wrap gap-2">
          {blocked.map((n) => (
            <li key={n} className={`${CHIP} ${CHIP_OFF} cursor-default pe-1.5`}>
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
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!Number.isInteger(n) || n < 0) return;
          void onBlock(n).then((ok) => {
            if (ok) setValue("");
          });
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Talkgroup number
        </label>
        <input
          id={inputId}
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="TG ID"
          className="input w-32 font-mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy || value === ""}>
          Block
        </button>
      </form>
    </div>
  );
}
