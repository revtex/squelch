import { ChevronRight } from "lucide-react";

export interface OpenButtonProps {
  /** Names the row, e.g. "Details for alice". */
  label: string;
  /** This row's panel is showing. */
  open: boolean;
  onOpen: (trigger: HTMLElement) => void;
}

/** The one way into a row's details panel. */
export function OpenButton({ label, open, onOpen }: OpenButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-square btn-sm ${open ? "btn-active" : "btn-ghost"}`}
      aria-label={label}
      aria-expanded={open}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
