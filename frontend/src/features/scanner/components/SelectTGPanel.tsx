import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ChevronDown, ChevronRight, Search } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/app/store";
import {
  toggleTG,
  setAllTGs,
  setTGsByIds,
  removeAvoid,
  clearAvoids,
} from "../scannerSlice";
import type { TalkgroupConfig, AvoidEntry } from "@/types";

interface SelectTGPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "groups" | "tags" | "systems" | "avoids";

function formatCountdown(expiresAt: number, now: number): string {
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTalkgroupLabelName(
  label?: string,
  name?: string,
  talkgroupId?: number,
): string {
  const cleanLabel = (label ?? "").trim();
  const cleanName = (name ?? "").trim();
  if (cleanLabel && cleanName && cleanLabel !== cleanName) {
    return `${cleanLabel} - ${cleanName}`;
  }
  return (
    cleanLabel ||
    cleanName ||
    (talkgroupId != null ? `TGID: ${talkgroupId}` : "(Unnamed Talkgroup)")
  );
}

// ---------- Section: a collapsible accordion row ----------

interface SectionProps {
  label: string;
  talkgroups: TalkgroupConfig[];
  tgSelection: Record<number, boolean>;
  avoidMap: Map<number, AvoidEntry>;
  heldTGs: Set<number>;
  now: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleAll: (ids: number[], enabled: boolean) => void;
  onToggleTG: (id: number) => void;
  secondaryLabels?: Record<number, string>;
}

function Section({
  label,
  talkgroups,
  tgSelection,
  avoidMap,
  heldTGs,
  now,
  expanded,
  onToggleExpand,
  onToggleAll,
  onToggleTG,
  secondaryLabels,
}: SectionProps) {
  // Count effective state: a TG is "off" if deselected OR avoided
  const effectiveActiveCount = talkgroups.filter((tg) => {
    if (tgSelection[tg.id] === false) return false;
    const avoid = avoidMap.get(tg.id);
    if (avoid && (avoid.expiresAt === 0 || avoid.expiresAt > now)) return false;
    return true;
  }).length;
  const total = talkgroups.length;
  const allOn = effectiveActiveCount === total;
  const allOff = effectiveActiveCount === 0;

  return (
    <div className="border-b border-base-300">
      {/* Header */}
      <div className="flex w-full items-center gap-2 px-4 py-3 hover:bg-base-200 transition-colors">
        {/* LED indicator — click to toggle all */}
        <button
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleAll(
              talkgroups.map((tg) => tg.id),
              !allOn,
            );
          }}
          aria-label={allOn ? "Turn all off" : "Turn all on"}
        >
          <span
            className={`inline-block w-3 h-3 rounded-full shadow-sm ${
              allOn
                ? "bg-green-500 shadow-green-500/50"
                : allOff
                  ? "bg-red-500 shadow-red-500/50"
                  : "bg-yellow-500 shadow-yellow-500/50"
            }`}
          />
        </button>
        {/* Expand/collapse — click row */}
        <button
          className="flex flex-1 items-center gap-2 text-left min-w-0"
          onClick={onToggleExpand}
        >
          {expanded ? (
            <ChevronDown size={16} className="shrink-0 text-base-content/50" />
          ) : (
            <ChevronRight size={16} className="shrink-0 text-base-content/50" />
          )}
          <span className="flex-1 font-medium text-sm truncate">{label}</span>
          <span className="badge badge-sm badge-ghost">
            {effectiveActiveCount}/{total}
          </span>
        </button>
      </div>

      {/* Expanded talkgroup list */}
      {expanded && (
        <div className="bg-base-200/40 px-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {talkgroups.map((tg) => {
              const enabled = tgSelection[tg.id] !== false;
              const secondary = secondaryLabels?.[tg.id];
              const fullTalkgroupName = formatTalkgroupLabelName(
                tg.label,
                tg.name,
                tg.talkgroupId,
              );
              const avoid = avoidMap.get(tg.id);
              const isAvoided =
                avoid !== undefined &&
                (avoid.expiresAt === 0 || avoid.expiresAt > now);
              const isHeld = heldTGs.has(tg.id);
              return (
                <label
                  key={tg.id}
                  className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                    enabled && !isAvoided
                      ? "bg-primary/10 hover:bg-primary/20"
                      : "hover:bg-base-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs checkbox-primary"
                    checked={enabled && !isAvoided}
                    onChange={() => onToggleTG(tg.id)}
                  />
                  {tg.ledColor && (
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: tg.ledColor }}
                    />
                  )}
                  <span
                    className="text-sm truncate flex-1"
                    title={fullTalkgroupName}
                  >
                    {fullTalkgroupName}
                  </span>
                  {isHeld && (
                    <span className="badge badge-xs badge-secondary">HELD</span>
                  )}
                  {isAvoided && avoid.expiresAt === 0 && (
                    <span className="badge badge-xs badge-error">AVOID</span>
                  )}
                  {isAvoided && avoid.expiresAt > 0 && (
                    <span className="badge badge-xs badge-warning">
                      AVOID {formatCountdown(avoid.expiresAt, now)}
                    </span>
                  )}
                  {secondary && !isAvoided && !isHeld && (
                    <span className="text-[11px] text-base-content/40 truncate max-w-24">
                      {secondary}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Main panel ----------

export default function SelectTGPanel({ isOpen, onClose }: SelectTGPanelProps) {
  const dispatch = useAppDispatch();

  const config = useAppSelector((s) => s.scanner.config);
  const tgSelection = useAppSelector((s) => s.scanner.tgSelection);
  const tgSelectionReady = useAppSelector((s) => s.scanner.tgSelectionReady);
  const avoidList = useAppSelector((s) => s.scanner.avoidList);
  const heldTG = useAppSelector((s) => s.scanner.heldTG);
  const heldSystem = useAppSelector((s) => s.scanner.heldSystem);

  const [activeTab, setActiveTab] = useState<TabId>("groups");
  const [search, setSearch] = useState("");
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});
  const [now, setNow] = useState(() => Date.now());

  const scrollRef = useRef<HTMLDivElement>(null);

  const systems = useMemo(() => config?.systems ?? [], [config]);
  const allTalkgroups = useMemo(
    () => systems.flatMap((s) => s.talkgroups ?? []),
    [systems],
  );

  // Avoid lookup: tgId → AvoidEntry
  const avoidMap = useMemo(() => {
    const map = new Map<number, AvoidEntry>();
    for (const entry of avoidList) {
      map.set(entry.talkgroupId, entry);
    }
    return map;
  }, [avoidList]);

  // Held TGs set — includes all TGs in a held system
  const heldTGs = useMemo(() => {
    const set = new Set<number>();
    if (heldTG !== null) set.add(heldTG);
    if (heldSystem !== null) {
      const sys = systems.find((s) => s.id === heldSystem);
      if (sys) {
        for (const tg of sys.talkgroups) set.add(tg.id);
      }
    }
    return set;
  }, [heldTG, heldSystem, systems]);

  // Has any timed avoids? Drive 1-second timer only when needed + panel open
  const hasTimedAvoids = useMemo(
    () => avoidList.some((a) => a.expiresAt > 0),
    [avoidList],
  );
  useEffect(() => {
    if (!isOpen || !hasTimedAvoids) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isOpen, hasTimedAvoids]);

  // Only the avoids that run out on their own. A permanent avoid has no
  // clock to show and belongs with the talkgroup it silenced, which is
  // where it is turned back on.
  const timedAvoids = useMemo(() => {
    const byId = new Map(allTalkgroups.map((tg) => [tg.id, tg]));
    return avoidList
      .filter((a) => a.expiresAt > 0 && a.expiresAt > now)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .map((a) => ({ entry: a, tg: byId.get(a.talkgroupId) }));
  }, [avoidList, allTalkgroups, now]);

  // Toggle handler: if TG has an active avoid, clicking clears the avoid
  // (and re-enables in tgSelection if it was a permanent avoid).
  // Otherwise, normal toggle behavior.
  const handleToggleTG = useCallback(
    (id: number) => {
      const avoid = avoidMap.get(id);
      const isAvoided =
        avoid !== undefined &&
        (avoid.expiresAt === 0 || avoid.expiresAt > Date.now());

      if (isAvoided) {
        // Clear the avoid entry
        dispatch(removeAvoid(id));
        // Clicking an avoided row means "I want this back": make sure it is
        // not also switched off in the user's own selection.
        if (tgSelection[id] === false) {
          dispatch(toggleTG(id));
        }
      } else {
        dispatch(toggleTG(id));
      }
    },
    [dispatch, tgSelection, avoidMap],
  );

  // Bulk toggle for a section header LED. The section passes the exact
  // talkgroups it rendered, so the toggle always matches the count badge —
  // including placeholder sections like "(No Group)" and filtered results.
  const handleToggleAll = useCallback(
    (ids: number[], enabled: boolean) => {
      if (ids.length === 0) return;
      dispatch(setTGsByIds({ ids, enabled }));
    },
    [dispatch],
  );

  // Build lookups for secondary labels
  const tgSystemLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const sys of systems) {
      for (const tg of sys.talkgroups ?? []) {
        map[tg.id] = sys.label;
      }
    }
    return map;
  }, [systems]);

  const tgGroupLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const tg of allTalkgroups) {
      map[tg.id] = tg.group ?? "";
    }
    return map;
  }, [allTalkgroups]);

  const tgTagLabel = useMemo(() => {
    const map: Record<number, string> = {};
    for (const tg of allTalkgroups) {
      map[tg.id] = tg.tag ?? "";
    }
    return map;
  }, [allTalkgroups]);

  // Derive grouped data
  const groupMap = useMemo(() => {
    const map = new Map<string, TalkgroupConfig[]>();
    for (const tg of allTalkgroups) {
      const key = tg.group || "(No Group)";
      const list = map.get(key);
      if (list) list.push(tg);
      else map.set(key, [tg]);
    }
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [allTalkgroups]);

  const tagMap = useMemo(() => {
    const map = new Map<string, TalkgroupConfig[]>();
    for (const tg of allTalkgroups) {
      const key = tg.tag || "(No Tag)";
      const list = map.get(key);
      if (list) list.push(tg);
      else map.set(key, [tg]);
    }
    return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [allTalkgroups]);

  // Search filtering
  const searchLower = search.toLowerCase();

  const matchesTG = useCallback(
    (tg: TalkgroupConfig) => {
      if (!searchLower) return true;
      return (
        (tg.label ?? "").toLowerCase().includes(searchLower) ||
        (tg.name ?? "").toLowerCase().includes(searchLower) ||
        (tg.group ?? "").toLowerCase().includes(searchLower) ||
        (tg.tag ?? "").toLowerCase().includes(searchLower) ||
        String(tg.talkgroupId).includes(searchLower)
      );
    },
    [searchLower],
  );

  const matchesSection = useCallback(
    (label: string, tgs: TalkgroupConfig[]) => {
      if (!searchLower) return true;
      if (label.toLowerCase().includes(searchLower)) return true;
      return tgs.some(matchesTG);
    },
    [searchLower, matchesTG],
  );

  const filterTGs = useCallback(
    (tgs: TalkgroupConfig[]) => {
      if (!searchLower) return tgs;
      return tgs.filter(matchesTG);
    },
    [searchLower, matchesTG],
  );

  // Auto-expand sections matching search
  useEffect(() => {
    if (!searchLower) return;
    const expanded: Record<string, boolean> = {};
    const entries =
      activeTab === "groups" ? groupMap : activeTab === "tags" ? tagMap : null;
    if (entries) {
      for (const [label, tgs] of entries) {
        if (matchesSection(label, tgs)) {
          expanded[`${activeTab}-${label}`] = true;
        }
      }
    }
    if (activeTab === "systems") {
      for (const sys of systems) {
        if (matchesSection(sys.label, sys.talkgroups ?? [])) {
          expanded[`systems-${sys.id}`] = true;
        }
      }
    }
    queueMicrotask(() => setExpandedSections(expanded));
  }, [searchLower, activeTab, groupMap, tagMap, systems, matchesSection]);

  const toggleExpand = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Stats — effective count accounts for avoids
  const totalCount = allTalkgroups.length;
  const activeCount = allTalkgroups.filter(
    (tg) => tgSelection[tg.id] !== false,
  ).length;
  const effectiveActiveCount = allTalkgroups.filter((tg) => {
    if (tgSelection[tg.id] === false) return false;
    const avoid = avoidMap.get(tg.id);
    if (avoid && (avoid.expiresAt === 0 || avoid.expiresAt > now)) return false;
    return true;
  }).length;

  // "All Talkgroups" LED. Turning everything back on throws away a whole
  // filtering session in one click, so confirm that direction; turning
  // everything off is trivially undone by the same button.
  const handleToggleAllTGs = () => {
    const enable = effectiveActiveCount < totalCount;
    if (enable) {
      const off = totalCount - activeCount;
      if (
        off > 0 &&
        !window.confirm(
          `Re-enable all ${totalCount} talkgroups? This clears the ${off} you have turned off.`,
        )
      ) {
        return;
      }
      dispatch(clearAvoids());
    }
    dispatch(setAllTGs(enable));
  };

  // Reset search when closing
  useEffect(() => {
    if (!isOpen) {
      queueMicrotask(() => setSearch(""));
    }
  }, [isOpen]);

  // Scroll to top on tab change
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl && typeof scrollEl.scrollTo === "function") {
      scrollEl.scrollTo(0, 0);
    }
  }, [activeTab]);

  if (!isOpen) return null;

  if (!tgSelectionReady) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-base-100">
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <h2 className="text-lg font-semibold">Select Talkgroups</h2>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <span className="loading loading-spinner loading-md" />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <h2 className="text-lg font-semibold">Select Talkgroups</h2>
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* Search bar + stats */}
      <div className="flex items-center gap-3 border-b border-base-300 px-4 py-2">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-base-content/40"
          />
          <input
            type="text"
            className="input input-sm w-full pl-8"
            placeholder="Search talkgroups..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <span className="text-sm text-base-content/60 whitespace-nowrap">
          {effectiveActiveCount}/{totalCount} active
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-base-300">
        {(["groups", "tags", "systems", "avoids"] as TabId[]).map((tab) => (
          <button
            key={tab}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-primary text-primary"
                : "text-base-content/60 hover:text-base-content"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {tab === "avoids" && timedAvoids.length > 0 && (
              <span className="badge badge-xs badge-ghost ml-1.5">
                {timedAvoids.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Global All On/Off toggle row. Not on the avoids tab: that list
            is about clocks running out, not the whole selection. */}
        <div
          className={`items-center gap-2 px-4 py-2 border-b border-base-300 bg-base-200/60 ${
            activeTab === "avoids" ? "hidden" : "flex"
          }`}
        >
          <button
            className="shrink-0"
            onClick={handleToggleAllTGs}
            aria-label={
              effectiveActiveCount === totalCount
                ? "Turn all off"
                : "Turn all on"
            }
          >
            <span
              className={`inline-block w-3 h-3 rounded-full shadow-sm ${
                effectiveActiveCount === totalCount
                  ? "bg-green-500 shadow-green-500/50"
                  : effectiveActiveCount === 0
                    ? "bg-red-500 shadow-red-500/50"
                    : "bg-yellow-500 shadow-yellow-500/50"
              }`}
            />
          </button>
          <span className="text-sm font-medium">All Talkgroups</span>
          <span className="badge badge-sm badge-ghost ml-auto">
            {effectiveActiveCount}/{totalCount}
          </span>
        </div>

        {activeTab === "avoids" &&
          (timedAvoids.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-base-content/60">
              No timed avoids. A permanent avoid is turned back on from the
              talkgroup itself, under Groups, Tags or Systems.
            </p>
          ) : (
            <ul>
              {timedAvoids.map(({ entry, tg }) => (
                <li
                  key={entry.talkgroupId}
                  className="flex items-center gap-3 border-b border-base-300 px-4 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {formatTalkgroupLabelName(
                        tg?.label,
                        tg?.name,
                        tg?.talkgroupId,
                      )}
                    </span>
                    {tg && tgSystemLabel[tg.id] && (
                      <span className="block truncate text-xs text-base-content/50">
                        {tgSystemLabel[tg.id]}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-base-content/70">
                    {formatCountdown(entry.expiresAt, now)}
                  </span>
                  <button
                    className="btn btn-ghost btn-xs shrink-0"
                    onClick={() => handleToggleTG(entry.talkgroupId)}
                  >
                    Resume
                  </button>
                </li>
              ))}
            </ul>
          ))}

        {activeTab === "groups" &&
          [...groupMap.entries()]
            .filter(([label, tgs]) => matchesSection(label, tgs))
            .map(([group, tgs]) => {
              const key = `groups-${group}`;
              return (
                <Section
                  key={key}
                  label={group}
                  talkgroups={filterTGs(tgs)}
                  tgSelection={tgSelection}
                  avoidMap={avoidMap}
                  heldTGs={heldTGs}
                  now={now}
                  expanded={!!expandedSections[key]}
                  onToggleExpand={() => toggleExpand(key)}
                  onToggleAll={handleToggleAll}
                  onToggleTG={handleToggleTG}
                  secondaryLabels={tgSystemLabel}
                />
              );
            })}

        {activeTab === "tags" &&
          [...tagMap.entries()]
            .filter(([label, tgs]) => matchesSection(label, tgs))
            .map(([tag, tgs]) => {
              const key = `tags-${tag}`;
              return (
                <Section
                  key={key}
                  label={tag}
                  talkgroups={filterTGs(tgs)}
                  tgSelection={tgSelection}
                  avoidMap={avoidMap}
                  heldTGs={heldTGs}
                  now={now}
                  expanded={!!expandedSections[key]}
                  onToggleExpand={() => toggleExpand(key)}
                  onToggleAll={handleToggleAll}
                  onToggleTG={handleToggleTG}
                  secondaryLabels={tgGroupLabel}
                />
              );
            })}

        {activeTab === "systems" &&
          systems
            .filter((sys) => matchesSection(sys.label, sys.talkgroups ?? []))
            .map((sys) => {
              const key = `systems-${sys.id}`;
              return (
                <Section
                  key={key}
                  label={sys.label}
                  talkgroups={filterTGs(sys.talkgroups ?? [])}
                  tgSelection={tgSelection}
                  avoidMap={avoidMap}
                  heldTGs={heldTGs}
                  now={now}
                  expanded={!!expandedSections[key]}
                  onToggleExpand={() => toggleExpand(key)}
                  onToggleAll={handleToggleAll}
                  onToggleTG={handleToggleTG}
                  secondaryLabels={tgTagLabel}
                />
              );
            })}
      </div>
    </div>
  );
}
