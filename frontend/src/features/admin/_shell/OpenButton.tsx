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
      className={`inline-flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border ${
        open
          ? "border-admin-line bg-base-300 text-base-content"
          : "border-transparent text-base-content-dim hover:border-admin-line hover:bg-base-300 hover:text-base-content"
      }`}
      aria-label={label}
      aria-expanded={open}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
