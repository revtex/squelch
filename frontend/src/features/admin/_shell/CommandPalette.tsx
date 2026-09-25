import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
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
      className="modal modal-open items-start pt-[10vh]"
      aria-label="Go to"
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
      <div className="modal-box w-full max-w-lg p-0">
        <label className="input input-lg flex w-full items-center gap-3 rounded-none border-0 border-b border-base-300 focus-within:outline-none">
          <Search className="h-5 w-5 opacity-60" aria-hidden="true" />
          <input
            ref={input}
            type="text"
            className="grow"
            placeholder="Go to a section"
            aria-label="Go to a section"
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
          <kbd className="kbd kbd-sm">Esc</kbd>
        </label>
        <ul
          id="cmdk-list"
          role="listbox"
          className="menu max-h-[60vh] w-full flex-nowrap overflow-y-auto p-2"
        >
          {matches.length === 0 && (
            <li className="px-3 py-4 text-sm text-base-content/60">
              No section matches “{query}”.
            </li>
          )}
          {matches.map((m, i) => (
            <li key={m.to} id={`cmdk-${m.to}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                className={i === index ? "menu-active" : ""}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(m.to)}
              >
                <m.icon className="h-4 w-4" aria-hidden="true" />
                {m.label}
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
