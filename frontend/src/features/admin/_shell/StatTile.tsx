import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** A line under the value, such as a change since yesterday. */
  detail?: ReactNode;
  /** A smaller value, for words like "3 min" rather than a count. */
  small?: boolean;
  /** The whole tile opens this page; the label is the link's name. */
  to?: string;
}

/**
 * One figure in a bordered tile: a small label over a large number. Tiles
 * sit in a grid; the label is a term and the value its definition.
 */
export function StatTile({ label, value, detail, small = false, to }: StatTileProps) {
  return (
    <div
      className={`relative flex min-w-0 flex-col gap-1 rounded-lg border border-admin-line bg-base-200 px-4 py-3.5 ${
        to ? "hover:border-admin-dim2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary" : ""
      }`}
    >
      <dt className="text-xs text-base-content-dim">
        {to ? (
          <Link to={to} className="outline-none after:absolute after:inset-0 after:content-['']">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd
        className={`font-semibold leading-[1.1] tracking-[-0.02em] tabular-nums ${
          small ? "text-lg" : "text-[26px]"
        }`}
      >
        {value}
      </dd>
      {detail && <dd className="text-xs text-base-content-dim">{detail}</dd>}
    </div>
  );
}

/** A row of stat tiles, read as one description list. */
export function StatGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`grid gap-2.5 ${className}`}>{children}</dl>;
}
