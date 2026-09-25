import type { ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** A line under the value, such as a change since yesterday. */
  detail?: ReactNode;
  /** A smaller value, for words like "3 min" rather than a count. */
  small?: boolean;
}

/**
 * One figure in a bordered tile: a small label over a large number. Tiles
 * sit in a grid; the label is a term and the value its definition.
 */
export function StatTile({ label, value, detail, small = false }: StatTileProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-admin-line bg-base-200 px-4 py-3.5">
      <dt className="text-xs text-base-content-dim">{label}</dt>
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
