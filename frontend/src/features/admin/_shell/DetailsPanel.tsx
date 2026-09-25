import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export interface DetailsPanelProps {
  title: string;
  /** Extra classes for the title, e.g. to dim an anonymous name. */
  titleClassName?: string;
  /** One line under the title saying what this thing is. */
  subtitle?: ReactNode;
  /** Badges shown beside the title. */
  badges?: ReactNode;
  /** `wide` fits a two-column form; the default fits facts and actions. */
  size?: "default" | "wide";
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the content, e.g. a form's Save and Cancel. */
  footer?: ReactNode;
}

/**
 * The one place details, forms and confirmations live: a sheet that slides in
 * from the right, or up from the bottom on a phone. It is a dialog, so Esc
 * closes it and focus lands inside; the host gives focus back to whatever
 * opened it. The close button is always in the top-right corner.
 */
export function DetailsPanel({
  title,
  titleClassName = "",
  subtitle,
  badges,
  size = "default",
  onClose,
  children,
  footer,
}: DetailsPanelProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Opened (hosts remount it per subject): focus goes inside the sheet.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const width = size === "wide" ? "sm:w-[34rem]" : "sm:w-[26rem]";

  return (
    <dialog
      open
      className="modal modal-open modal-bottom sm:modal-end"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        className={`modal-box relative flex max-h-[85vh] flex-col gap-5 p-0 sm:h-full sm:max-h-none sm:max-w-none sm:rounded-none ${width}`}
      >
        <button
          ref={closeRef}
          type="button"
          className="btn btn-ghost btn-sm btn-square absolute right-3 top-3 z-10"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 space-y-1 px-5 pr-14 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={titleId}
              className={`truncate text-lg font-bold ${titleClassName}`}
            >
              {title}
            </h3>
            {badges}
          </div>
          {subtitle && (
            <p className="text-sm text-base-content/60">{subtitle}</p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
          {children}
        </div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 bg-base-100 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

/** A small uppercase heading that groups a panel's facts or actions. */
export function PanelSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">
        {title}
      </p>
      {children}
    </div>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Label and value pairs, two columns, wrapping long values. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
      {facts.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-base-content/60">{f.label}</dt>
          <dd className="min-w-0 break-words">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
