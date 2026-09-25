import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NAV_ITEMS } from "./nav";
import { useNavigationGuard } from "./useNavigationGuard";

export interface CommandPaletteProps {
  onClose: () => void;
}

/**
 * Ctrl+K: type a few letters and jump to a section. Arrow keys move,
 * Enter goes, Esc closes.
 */
export function CommandPalette({ onClose }: CommandPaletteProps) {
  const [query, setQueryState] = useState("");
  const [index, setIndex] = useState(0);
  const setQuery = (next: string) => {
    setQueryState(next);
    setIndex(0);
  };
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { requestNavigation } = useNavigationGuard();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((i) =>
      `${i.label} ${i.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query]);

  const go = (to: string) => {
    onClose();
    if (requestNavigation(to)) navigate(to);
  };

  return (
    <dialog
      open
      className="modal modal-open items-start px-4 pt-[60px]"
      aria-label="Search"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, matches.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const m = matches[index];
          if (m) go(m.to);
        }
      }}
    >
      <div className="modal-box w-full max-w-[560px] overflow-hidden rounded-[10px] p-0 shadow-none">
        <input
          ref={input}
          type="text"
          className="w-full border-0 border-b border-admin-line bg-base-100 px-4 py-3.5 text-[15px] outline-none"
          placeholder="Jump to a page, user, talkgroup or setting…"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={
            matches[index] ? `cmdk-${matches[index].to}` : undefined
          }
          aria-autocomplete="list"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul
          id="cmdk-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[360px] overflow-y-auto"
        >
          {matches.length === 0 && (
            <li className="px-4 py-3 text-base-content-dim">
              Nothing matches “{query}”.
            </li>
          )}
          {matches.map((m, i) => (
            <li key={m.to} id={`cmdk-${m.to}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left ${
                  i === index ? "bg-base-300" : ""
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(m.to)}
              >
                <m.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                {m.label}
                <small className="ml-auto text-xs text-base-content-dim">Page</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
