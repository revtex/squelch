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

  const width = size === "wide" ? "sm:w-[34rem]" : "sm:w-[420px]";

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
        className={`modal-box relative flex max-h-[88vh] flex-col p-0 max-sm:rounded-t-2xl max-sm:border-x-0 max-sm:border-b-0 sm:h-full sm:max-h-none sm:max-w-none sm:rounded-none sm:border-y-0 sm:border-r-0 ${width}`}
      >
        <button
          ref={closeRef}
          type="button"
          className="absolute right-3.5 top-3 z-10 inline-flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-md border border-admin-line bg-base-300 text-base-content hover:border-secondary"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="min-w-0 border-b border-admin-line py-4 pl-[18px] pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={titleId}
              className={`truncate text-[17px] font-semibold ${titleClassName}`}
            >
              {title}
            </h3>
            {badges}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[13px] text-base-content-dim">{subtitle}</p>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden p-[18px]">
          {children}
        </div>

        {footer && (
          <div className="admin-acts flex flex-wrap justify-end gap-2 border-t border-admin-line bg-base-200 px-[18px] py-3 max-sm:[&>.btn]:flex-auto max-sm:[&>.btn]:justify-center">
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
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3
        id={id}
        className="text-[11px] font-medium uppercase tracking-[0.06em] text-base-content-dim"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface Fact {
  label: string;
  value: ReactNode;
}

/** Label and value pairs, two columns, wrapping long values. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 sm:grid-cols-[130px_1fr]">
      {facts.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-base-content-dim">{f.label}</dt>
          <dd className="min-w-0 [overflow-wrap:anywhere]">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
