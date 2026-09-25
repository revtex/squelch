import type { ReactNode } from "react";

export interface FieldProps {
  /** The control's id; the label points at it. */
  htmlFor: string;
  label: string;
  /** Help under the control, in plain words. */
  hint?: ReactNode;
  /** A validation message; read out as an alert. */
  error?: string | null;
  children: ReactNode;
}

/** A labelled form row: label above, control, help and error beneath. */
export function Field({ htmlFor, label, hint, error, children }: FieldProps) {
  return (
    <div className="fieldset">
      <label className="fieldset-legend" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="label whitespace-normal">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export interface SwitchRowProps {
  id: string;
  label: string;
  hint?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A switch with its name and a hint on the left; the whole row is the target. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: SwitchRowProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-start justify-between gap-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}
    >
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && (
          <span className="block text-xs text-base-content/60">{hint}</span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="toggle toggle-primary shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export interface SegmentedOption<K extends string> {
  id: K;
  label: string;
  hint?: string;
}

export interface SegmentedProps<K extends string> {
  label: string;
  options: readonly SegmentedOption<K>[];
  value: K;
  disabled?: boolean;
  onChange: (value: K) => void;
}

/** A few named choices side by side, e.g. a role. A radio group underneath. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: SegmentedProps<K>) {
  return (
    <div role="radiogroup" aria-label={label} className="join">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.hint}
            disabled={disabled}
            className={`btn btn-sm join-item ${on ? "btn-primary" : ""}`}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
