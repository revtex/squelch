import { useId, type ReactNode } from "react";
import { COUNT } from "./FilterChips";

export interface CardProps {
  /** The header bar's title; without one the card has no header. */
  title?: ReactNode;
  /** A count pill beside the title. */
  count?: number | string;
  /** Right side of the header: a hint, a link or a small button. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The body's padding and layout; tables pass "" to run edge to edge. */
  bodyClassName?: string;
}

/**
 * The admin's card: a bordered panel, with an optional header bar (title,
 * count, and something on the right) over a rule. A titled card is a
 * region named by its title.
 */
export function Card({
  title,
  count,
  meta,
  children,
  className = "",
  bodyClassName = "flex flex-col gap-3 p-4",
}: CardProps) {
  const id = useId();
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={`min-w-0 rounded-lg border border-admin-line bg-base-200 ${className}`}
    >
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-admin-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id={id} className="text-sm font-semibold">
              {title}
            </h2>
            {count !== undefined && <span className={COUNT}>{count}</span>}
          </div>
          {meta && (
            <div className="flex items-center gap-2 text-xs text-base-content-dim">
              {meta}
            </div>
          )}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
