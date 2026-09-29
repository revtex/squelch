import type { AdminSystem } from "@/types";
import { CHIP, CHIP_OFF, CHIP_ON } from "./FilterChips";

export interface SystemPickerProps {
  /** Names the group, e.g. "Systems this user can hear". */
  label: string;
  systems: AdminSystem[];
  /** The chosen system ids; empty means every system. */
  value: number[];
  onChange: (next: number[]) => void;
  hint?: string;
  disabled?: boolean;
}

/**
 * Which systems something applies to, as chips. "All systems" is its own
 * chip: chosen when no single system is, and it covers systems added later.
 */
export function SystemPicker({
  label,
  systems,
  value,
  onChange,
  hint,
  disabled = false,
}: SystemPickerProps) {
  const sorted = systems.slice().sort((a, b) => a.order - b.order);
  const all = value.length === 0;
  const chip = (on: boolean) => `${CHIP} ${on ? CHIP_ON : CHIP_OFF}`;
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="fieldset">
      <span className="fieldset-legend">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={all}
          disabled={disabled}
          className={chip(all)}
          onClick={() => onChange([])}
        >
          All systems
        </button>
        {sorted.map((s) => {
          const on = value.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              className={chip(on)}
              onClick={() => toggle(s.id)}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {hint && <p className="label whitespace-normal">{hint}</p>}
    </div>
  );
}
