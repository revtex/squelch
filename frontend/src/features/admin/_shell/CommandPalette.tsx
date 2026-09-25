import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { NAV_ITEMS } from "./nav";
import {
  useListApiKeysQuery,
  useListDirMonitorsQuery,
  useListDownstreamsQuery,
  useListSystemsQuery,
  useListTalkgroupsQuery,
  useListUsersQuery,
} from "./useAdminWsOps";
import { useNavigationGuard } from "./useNavigationGuard";

/** A setting the palette can find; it opens Settings filtered to it. */
export interface PaletteSetting {
  label: string;
  /** The settings section it is in. */
  section: string;
}

export interface CommandPaletteProps {
  onClose: () => void;
  settings?: readonly PaletteSetting[];
}

interface Entry {
  id: string;
  kind: string;
  label: string;
  hint?: string;
  to: string;
  icon?: LucideIcon;
}

/** Most rows of one kind a search shows, so pages stay in view. */
const PER_KIND = 6;
const NO_SETTINGS: readonly PaletteSetting[] = [];

function has(q: string, ...parts: (string | number | null | undefined)[]) {
  return parts.some((p) => p != null && String(p).toLowerCase().includes(q));
}

/**
 * Ctrl+K: type a few letters to jump to a page, or straight to a user,
 * talkgroup, API key, setting, folder monitor or downstream. Arrow keys
 * move, Enter goes, Esc closes. A row opens the item's details through the
 * page's `?open=` link.
 */
export function CommandPalette({ onClose, settings = NO_SETTINGS }: CommandPaletteProps) {
  const [query, setQueryState] = useState("");
  const [index, setIndex] = useState(0);
  const setQuery = (next: string) => {
    setQueryState(next);
    setIndex(0);
  };
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { requestNavigation } = useNavigationGuard();

  const { data: users } = useListUsersQuery();
  const { data: systems } = useListSystemsQuery();
  const { data: talkgroups } = useListTalkgroupsQuery();
  const { data: apiKeys } = useListApiKeysQuery();
  const { data: monitors } = useListDirMonitorsQuery();
  const { data: downstreams } = useListDownstreamsQuery();

  useEffect(() => {
    input.current?.focus();
  }, []);

  const matches = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Entry[] = NAV_ITEMS.filter(
      (i) => !q || has(q, i.label, i.keywords),
    ).map((i) => ({ id: i.to, kind: "Page", label: i.label, to: i.to, icon: i.icon }));
    if (q.length < 2) return pages;

    const systemName = new Map((systems ?? []).map((s) => [s.id, s.label]));
    const take = (rows: Entry[]) => rows.slice(0, PER_KIND);
    return [
      ...pages,
      ...take(
        (users ?? [])
          .filter((u) => has(q, u.username))
          .map((u) => ({
            id: `user:${u.id}`,
            kind: "User",
            label: u.username,
            to: `/admin/users?open=${u.id}`,
          })),
      ),
      ...take(
        (talkgroups ?? [])
          .filter((t) => has(q, t.label, t.name, t.talkgroupId))
          .map((t) => ({
            id: `tg:${t.id}`,
            kind: "Talkgroup",
            label: t.label || t.name || String(t.talkgroupId),
            hint: [String(t.talkgroupId), systemName.get(t.systemId)].filter(Boolean).join(" · "),
            to: `/admin/systems?system=${t.systemId}&open=${t.id}`,
          })),
      ),
      ...take(
        (apiKeys ?? [])
          .filter((k) => has(q, k.ident))
          .map((k) => ({
            id: `key:${k.id}`,
            kind: "API key",
            label: k.ident || `Key ${k.id}`,
            to: `/admin/apikeys?open=${k.id}`,
          })),
      ),
      ...take(
        settings
          .filter((s) => has(q, s.label))
          .map((s) => ({
            id: `setting:${s.label}`,
            kind: "Setting",
            label: s.label,
            hint: s.section,
            to: `/admin/settings?q=${encodeURIComponent(s.label)}`,
          })),
      ),
      ...take(
        (monitors ?? [])
          .filter((m) => has(q, m.directory))
          .map((m) => ({
            id: `monitor:${m.id}`,
            kind: "Monitor",
            label: m.directory,
            to: `/admin/dirmonitors?open=${m.id}`,
          })),
      ),
      ...take(
        (downstreams ?? [])
          .filter((d) => has(q, d.label, d.url))
          .map((d) => ({
            id: `downstream:${d.id}`,
            kind: "Downstream",
            label: d.label || d.url,
            to: `/admin/forwarding?open=${d.id}`,
          })),
      ),
    ];
  }, [query, users, systems, talkgroups, apiKeys, monitors, downstreams, settings]);

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
            matches[index] ? `cmdk-${matches[index].id}` : undefined
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
            <li key={m.id} id={`cmdk-${m.id}`} role="option" aria-selected={i === index}>
              <button
                type="button"
                tabIndex={-1}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left ${
                  i === index ? "bg-base-300" : ""
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(m.to)}
              >
                {m.icon ? (
                  <m.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                ) : (
                  <span className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 truncate">
                  {m.label}
                  {m.hint && (
                    <span className="text-base-content-dim"> · {m.hint}</span>
                  )}
                </span>
                <small className="ml-auto shrink-0 pl-3 text-xs text-base-content-dim">
                  {m.kind}
                </small>
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
