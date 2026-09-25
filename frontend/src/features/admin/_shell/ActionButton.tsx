import { useId, type ReactNode } from "react";

export interface ActionButtonProps {
  icon: ReactNode;
  label: string;
  /** One line under the label saying what the action does. */
  hint: string;
  /** Styled as destructive. */
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/**
 * A full-width action in a details panel: an icon, a verb, and a plain-words
 * hint of what will happen. The hint is read with the button's name.
 */
export function ActionButton({
  icon,
  label,
  hint,
  danger = false,
  disabled = false,
  onClick,
}: ActionButtonProps) {
  const hintId = useId();
  return (
    <button
      type="button"
      aria-describedby={hintId}
      className={`btn btn-block min-h-11 justify-start whitespace-normal px-3.5 py-2.5 text-left ${
        danger ? "btn-error" : ""
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span
          id={hintId}
          aria-hidden="true"
          className={`mt-0.5 text-xs font-normal ${danger ? "opacity-75" : "text-base-content-dim"}`}
        >
          {hint}
        </span>
      </span>
    </button>
  );
}
