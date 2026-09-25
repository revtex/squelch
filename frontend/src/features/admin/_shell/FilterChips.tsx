import type { KeyboardEvent } from "react";

export interface ChipOption<K extends string> {
  id: K;
  label: string;
  /** Shown after the label; the count of rows this chip would show. */
  count?: number;
}

export interface FilterChipsProps<K extends string> {
  /** Names the group for assistive tech, e.g. "Status". */
  label: string;
  options: readonly ChipOption<K>[];
  value: K;
  onChange: (value: K) => void;
}

/**
 * One-of-many filter chips: a radio group drawn as small buttons. Arrow keys
 * move between them, as in any radio group.
 */
export function FilterChips<K extends string>({
  label,
  options,
  value,
  onChange,
}: FilterChipsProps<K>) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (index + 1) % options.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (index - 1 + options.length) % options.length;
    }
    if (next === null) return;
    e.preventDefault();
    const option = options[next];
    onChange(option.id);
    const buttons =
      e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        "[role=radio]",
      );
    buttons?.[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap items-center gap-1"
    >
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`btn btn-xs ${on ? "btn-neutral" : "btn-ghost"}`}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
            {o.count !== undefined && (
              <span className="opacity-60 tabular-nums" aria-hidden="true">
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface ToggleChipsProps<K extends string> {
  label: string;
  options: readonly ChipOption<K>[];
  value: readonly K[];
  onChange: (value: K[]) => void;
}

/** Any-of-many chips, each a pressed or unpressed button. */
export function ToggleChips<K extends string>({
  label,
  options,
  value,
  onChange,
}: ToggleChipsProps<K>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            className={`btn btn-xs ${on ? "btn-neutral" : "btn-ghost"}`}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])
            }
          >
            {o.label}
            {o.count !== undefined && (
              <span className="opacity-60 tabular-nums" aria-hidden="true">
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
