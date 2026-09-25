import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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

const CELL_PHONE =
  "max-sm:flex max-sm:items-baseline max-sm:justify-between max-sm:gap-3 max-sm:px-0 max-sm:py-0.5 max-sm:before:shrink-0 max-sm:before:text-xs max-sm:before:text-base-content/60 max-sm:before:content-[attr(data-label)]";
const TITLE_PHONE =
  "max-sm:block max-sm:px-0 max-sm:pb-1 max-sm:pr-10 max-sm:text-base max-sm:font-semibold";

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
          className="flex flex-wrap items-center gap-2 rounded-box bg-base-200 px-3 py-2 text-sm"
        >
          <span className="font-medium tabular-nums">
            {selectedCount} selected
          </span>
          <div className="flex flex-wrap gap-1">{bulkActions}</div>
          <button
            type="button"
            className="btn btn-ghost btn-xs ml-auto"
            onClick={() => onSelectedChange(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-box border border-base-300 max-sm:border-0">
        <table className="table table-sm max-sm:block">
          <caption className="sr-only">{caption}</caption>
          <thead className="max-sm:hidden">
            <tr>
              {selectable && (
                <th className="w-8">
                  <input
                    ref={headerCheck}
                    type="checkbox"
                    className="checkbox checkbox-sm"
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
                const Icon = active
                  ? sort.dir === "asc"
                    ? ArrowUp
                    : ArrowDown
                  : ArrowUpDown;
                return (
                  <th
                    key={c.id}
                    aria-sort={ariaSort}
                    className={`${c.align === "right" ? "text-right" : ""} ${c.className ?? ""}`}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs -mx-2 gap-1 font-semibold"
                        onClick={() => toggleSort(c.id)}
                      >
                        {c.header}
                        <Icon
                          className={`h-3 w-3 ${active ? "" : "opacity-40"}`}
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {onOpen && (
                <th className="w-10">
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
                  className="py-8 text-center max-sm:block"
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
                  className="py-8 text-center text-base-content/60 max-sm:block"
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
                  className={`max-sm:relative max-sm:block max-sm:border-b max-sm:border-base-300 max-sm:py-3 ${
                    selectable ? "max-sm:pl-8" : ""
                  } ${isOpen ? "bg-base-200" : ""} ${isSelected ? "bg-primary/10" : ""} ${
                    rowClassName?.(row) ?? ""
                  }`}
                >
                  {selectable && (
                    <td className="max-sm:absolute max-sm:left-0 max-sm:top-3 max-sm:p-0">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
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
                        ? TITLE_PHONE
                        : phone === "hide"
                          ? "max-sm:hidden"
                          : CELL_PHONE;
                    return (
                      <td
                        key={c.id}
                        data-label={c.header}
                        className={`${c.align === "right" ? "text-right tabular-nums" : ""} ${phoneClass} ${c.className ?? ""}`}
                      >
                        {c.cell(row)}
                      </td>
                    );
                  })}
                  {onOpen && (
                    <td className="text-right max-sm:absolute max-sm:right-0 max-sm:top-2 max-sm:p-0">
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-base-content/70">
          <span className="tabular-nums">
            Showing {from}–{to} of {sorted.length}
          </span>
          <div className="join">
            <button
              type="button"
              className="btn btn-sm join-item"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <span className="btn btn-sm join-item pointer-events-none tabular-nums">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              className="btn btn-sm join-item"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
