import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { OpenButton } from "./OpenButton";

export type SortValue = string | number | null | undefined;

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Sortable when present; compares these values. */
  sortValue?: (row: T) => SortValue;
  /** Extra classes on every cell in this column. */
  className?: string;
  /** Numbers and short codes read better right-aligned. */
  align?: "left" | "right";
  /**
   * On a phone each row becomes a card. `title` puts this cell first without a
   * label, `hide` drops it, and the default shows it with its header as a label.
   */
  phone?: "title" | "hide" | "show";
}

export interface SortState {
  id: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T, K extends string | number> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => K;
  /** A short sentence for assistive tech, e.g. "Users". */
  caption: string;
  loading?: boolean;
  /** Shown when there are no rows and nothing is loading. */
  empty?: ReactNode;
  /** Sort at first render. */
  defaultSort?: SortState;
  /** Rows per page; 0 shows them all. */
  pageSize?: number;
  /** Rows can be ticked; the bulk bar shows the ticked count. */
  selected?: ReadonlySet<K>;
  onSelectedChange?: (next: Set<K>) => void;
  /** Buttons in the bulk bar, shown when something is ticked. */
  bulkActions?: ReactNode;
  /** A row can open its details; adds the › column. */
  onOpen?: (row: T, trigger: HTMLElement) => void;
  /**
   * How a row is named to assistive tech: its checkbox reads "Select <name>"
   * and its › button "Details for <name>". Falls back to the key.
   */
  rowLabel?: (row: T) => string;
  /** The key whose panel is open, to mark its row. */
  openKey?: K | null;
  rowClassName?: (row: T) => string;
}

function compare(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

// On a phone each row is a card: a two-column grid of label-over-value
// pairs, the title top-left, the tick box top-right, the › bottom-right.
const CELL_PHONE =
  "max-sm:block max-sm:border-0 max-sm:p-0 max-sm:before:block max-sm:before:text-[11px] max-sm:before:uppercase max-sm:before:tracking-[0.04em] max-sm:before:text-base-content-dim max-sm:before:content-[attr(data-label)]";
const TITLE_PHONE =
  "max-sm:col-start-1 max-sm:row-start-1 max-sm:block max-sm:border-0 max-sm:p-0 max-sm:text-[15px]";

/**
 * The admin's one table: sortable headers, paging, ticking rows for a bulk
 * action, and a › into each row's details. Under 640px every row is a card
 * whose cells carry their header as a label, so nothing scrolls sideways.
 */
export function DataTable<T, K extends string | number>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  empty = "Nothing here yet.",
  defaultSort,
  pageSize = 25,
  selected,
  onSelectedChange,
  bulkActions,
  onOpen,
  rowLabel,
  openKey = null,
  rowClassName,
}: DataTableProps<T, K>) {
  const [sort, setSort] = useState<SortState | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const headerCheck = useRef<HTMLInputElement>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => compare(get(a.row), get(b.row)) * dir || a.i - b.i)
      .map((x) => x.row);
  }, [rows, sort, columns]);

  const pages =
    pageSize > 0 ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  // Fewer rows than before (a filter, a delete): stay on the last page.
  const current = Math.min(page, pages - 1);
  const visible =
    pageSize > 0
      ? sorted.slice(current * pageSize, (current + 1) * pageSize)
      : sorted;

  const selectable = selected !== undefined && onSelectedChange !== undefined;
  const visibleKeys = visible.map(rowKey);
  const allVisibleSelected =
    selectable && visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k));
  const someVisibleSelected =
    selectable && !allVisibleSelected && visibleKeys.some((k) => selected.has(k));
  useEffect(() => {
    if (headerCheck.current) {
      headerCheck.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const toggleAll = () => {
    if (!selectable) return;
    const next = new Set(selected);
    if (allVisibleSelected) visibleKeys.forEach((k) => next.delete(k));
    else visibleKeys.forEach((k) => next.add(k));
    onSelectedChange(next);
  };
  const toggleOne = (k: K) => {
    if (!selectable) return;
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange(next);
  };

  const toggleSort = (id: string) => {
    setSort((s) =>
      s?.id === id
        ? { id, dir: s.dir === "asc" ? "desc" : "asc" }
        : { id, dir: "asc" },
    );
  };

  const selectedCount = selectable ? selected.size : 0;
  const from = sorted.length === 0 ? 0 : current * pageSize + 1;
  const to = pageSize > 0 ? Math.min(sorted.length, (current + 1) * pageSize) : sorted.length;

  return (
    <div className="space-y-2">
      {selectable && selectedCount > 0 && (
        <div
          role="region"
          aria-label="Selected rows"
          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-primary bg-admin-navy2 px-3 py-2"
        >
          <span className="font-medium tabular-nums">
            {selectedCount} selected
          </span>
          <div className="flex flex-wrap gap-2">{bulkActions}</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            onClick={() => onSelectedChange(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-admin-line bg-base-200">
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <table className="table max-sm:block">
            <caption className="sr-only">{caption}</caption>
            <thead className="max-sm:hidden">
              <tr>
                {selectable && (
                  <th className="w-9 pr-0">
                    <input
                      ref={headerCheck}
                      type="checkbox"
                      className="checkbox"
                      aria-label="Select all on this page"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map((c) => {
                  const active = sort?.id === c.id;
                  const ariaSort = active
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined;
                  return (
                    <th
                      key={c.id}
                      aria-sort={ariaSort}
                      className={`${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                    >
                      {c.sortValue ? (
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1 uppercase"
                          onClick={() => toggleSort(c.id)}
                        >
                          {c.header}
                          <span
                            aria-hidden="true"
                            className={active ? "" : "opacity-50"}
                          >
                            {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
                          </span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
                {onOpen && (
                  <th className="w-12">
                    <span className="sr-only">Details</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {loading && rows.length === 0 && (
                <tr className="max-sm:block">
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0) + (onOpen ? 1 : 0)}
                    className="py-[30px] text-center max-sm:block"
                  >
                    <span className="loading loading-spinner loading-sm" />
                    <span className="sr-only">Loading</span>
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr className="max-sm:block">
                  <td
                    colSpan={columns.length + (selectable ? 1 : 0) + (onOpen ? 1 : 0)}
                    className="py-[30px] text-center text-base-content-dim max-sm:block"
                  >
                    {empty}
                  </td>
                </tr>
              )}
              {visible.map((row) => {
                const k = rowKey(row);
                const isOpen = openKey !== null && openKey === k;
                const isSelected = selectable && selected.has(k);
                const name = rowLabel?.(row) ?? String(k);
                return (
                  <tr
                    key={k}
                    className={`max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-2.5 max-sm:gap-y-1 max-sm:border-b max-sm:border-admin-line max-sm:px-3.5 max-sm:py-2.5 max-sm:last:border-b-0 ${
                      isOpen ? "bg-admin-navy2" : isSelected ? "bg-primary/10" : ""
                    } ${rowClassName?.(row) ?? ""}`}
                  >
                    {selectable && (
                      <td className="w-9 pr-0 max-sm:col-start-2 max-sm:row-start-1 max-sm:w-auto max-sm:justify-self-end max-sm:border-0 max-sm:p-0">
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={`Select ${name}`}
                          checked={isSelected}
                          onChange={() => toggleOne(k)}
                        />
                      </td>
                    )}
                    {columns.map((c) => {
                      const phone = c.phone ?? "show";
                      const phoneClass =
                        phone === "title"
                          ? `${TITLE_PHONE} ${selectable ? "" : "max-sm:col-span-2"}`
                          : phone === "hide"
                            ? "max-sm:hidden"
                            : CELL_PHONE;
                      return (
                        <td
                          key={c.id}
                          data-label={c.header}
                          className={`${c.align === "right" ? "text-right tabular-nums max-sm:text-left" : ""} ${phoneClass} ${c.className ?? ""}`}
                        >
                          {c.cell(row)}
                        </td>
                      );
                    })}
                    {onOpen && (
                      <td className="text-right max-sm:col-span-2 max-sm:flex max-sm:justify-end max-sm:border-0 max-sm:p-0 max-sm:pt-1.5">
                        <OpenButton
                          label={`Details for ${name}`}
                          open={isOpen}
                          onOpen={(el) => onOpen(row, el)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {pageSize > 0 && sorted.length > pageSize && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-admin-line2 px-3.5 py-2.5 text-xs text-base-content-dim">
            <span className="tabular-nums">
              Showing {from}–{to} of {sorted.length}
            </span>
            {current > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-base-content"
                onClick={() => setPage(current - 1)}
              >
                <span aria-hidden="true">←</span> Previous
              </button>
            )}
            {current < pages - 1 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-base-content"
                onClick={() => setPage(current + 1)}
              >
                Next <span aria-hidden="true">→</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
