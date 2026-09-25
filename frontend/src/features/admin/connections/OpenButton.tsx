import { ChevronRight } from "lucide-react";

/** The one way into a row's details panel. */
export default function OpenButton({
  label,
  open,
  onOpen,
}: {
  /** Names the row, e.g. "Details for alice (LIVE)". */
  label: string;
  /** This row's panel is showing. */
  open: boolean;
  onOpen: (trigger: HTMLElement) => void;
}) {
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
