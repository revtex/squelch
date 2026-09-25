import type { AdminSystem } from "@/types";

export interface SystemsPickerProps {
  systems: AdminSystem[];
  value: number[];
  onChange: (ids: number[]) => void;
}

/** Chips for which systems to forward; none selected means all of them. */
export default function SystemsPicker({ systems, value, onChange }: SystemsPickerProps) {
  const sorted = systems.slice().sort((a, b) => a.order - b.order);
  const toggle = (sid: number) =>
    onChange(value.includes(sid) ? value.filter((x) => x !== sid) : [...value, sid]);

  return (
    <div className="fieldset">
      <span className="fieldset-legend">Systems</span>
      <p className="label whitespace-normal">
        Which systems' calls are sent. Pick none to send them all.
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-base-content/60">
          No systems yet, so every system that gets created is sent.
        </p>
      ) : (
        <div role="group" aria-label="Systems" className="flex flex-wrap gap-2">
          {sorted.map((s) => {
            const on = value.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
                onClick={() => toggle(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
