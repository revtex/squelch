import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * A search result links to a page with `?open=<id>`. Once the page's rows
 * have loaded, this opens that row's details and drops the parameter, so a
 * reload or Back does not open it again. An id that is not in the list is
 * dropped quietly.
 *
 * `ids` is undefined while the rows are still loading.
 */
export function useOpenParam(
  ids: readonly number[] | undefined,
  open: (id: number) => void,
) {
  const [search, setSearch] = useSearchParams();
  const raw = search.get("open");
  const openRef = useRef(open);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => {
    if (raw === null) {
      handled.current = null;
      return;
    }
    if (ids === undefined || handled.current === raw) return;
    handled.current = raw;
    const id = Number(raw);
    if (Number.isInteger(id) && ids.includes(id)) openRef.current(id);
    const next = new URLSearchParams(search);
    next.delete("open");
    setSearch(next, { replace: true });
  }, [raw, ids, search, setSearch]);
}
