import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  Play,
  Download,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/app/store";
import { ShareCallButton } from "../components/ShareCallButton";
import {
  useSearchCallsQuery,
  type CallSearchParams,
  type CallSearchResult,
  toggleSystemFilter,
  toggleTalkgroupFilter,
  toggleGroupFilter,
  toggleTagFilter,
  setSystemFilters,
  setTalkgroupFilters,
  setGroupFilters,
  setTagFilters,
  setDateFrom,
  setDateTo,
  setSort,
  setPage,
  setBookmarkedOnly,
  setTranscript,
  resetFilters,
} from "../callsSlice";
import { useGetBookmarkIDsQuery, useToggleBookmarkMutation } from "@/app/api";
import { selectToken } from "@/features/auth";
import { audioPlayer } from "@/shared/services/audio/player";
import { sanitizeDownloadFilename } from "@/shared/services/download/filename";
import type { Call } from "../types";

interface SearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
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

// ── Filter section ────────────────────────────────────────────────────────────

interface FilterSectionProps {
  sectionId: string;
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: (sectionId: string) => void;
  onClear: () => void;
  children: React.ReactNode;
}

function FilterSection({
  sectionId,
  label,
  count,
  isOpen,
  onToggle,
  onClear,
  children,
}: FilterSectionProps) {
  return (
    <div className="rounded border border-base-300 bg-base-100">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => onToggle(sectionId)}
          className="flex flex-1 items-center gap-2 text-left"
          aria-expanded={isOpen}
        >
          <ChevronDown
            size={14}
            className={`shrink-0 text-base-content/60 transition-transform ${
              isOpen ? "rotate-0" : "-rotate-90"
            }`}
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
            {label}
          </span>
          {count > 0 && (
            <span className="badge badge-xs badge-primary">{count}</span>
          )}
        </button>
        {count > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-base-content/40 hover:text-error transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      {isOpen && <div className="space-y-0.5 px-3 pb-3">{children}</div>}
    </div>
  );
}

function CheckItem({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  title?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-1 px-1 -mx-1 cursor-pointer rounded hover:bg-base-200 group">
      <input
        type="checkbox"
        className="checkbox checkbox-sm checkbox-primary shrink-0"
        checked={checked}
        onChange={onChange}
      />
      <span
        className="text-sm truncate text-base-content/80 group-hover:text-base-content"
        title={title}
      >
        {label}
      </span>
    </label>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SearchPanel({ isOpen, onClose }: SearchPanelProps) {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((s) => s.calls);
  const config = useAppSelector((s) => s.scanner.config);
  const token = useAppSelector(selectToken);
  const isAuthenticated = !!token;
  const shareableLinks = config?.shareableLinks ?? false;

  const { data: bookmarkData } = useGetBookmarkIDsQuery(undefined, {
    skip: !isAuthenticated,
  });
  const [toggleBookmark] = useToggleBookmarkMutation();
  const bookmarkedCallIds = bookmarkData?.callIds ?? [];
  const parentRef = useRef<HTMLDivElement>(null);
  const [openFilterSection, setOpenFilterSection] = useState<string>("");
  const [systemFilterSearch, setSystemFilterSearch] = useState("");
  const [talkgroupFilterSearch, setTalkgroupFilterSearch] = useState("");
  const [groupFilterSearch, setGroupFilterSearch] = useState("");
  const [tagFilterSearch, setTagFilterSearch] = useState("");

  const systems = useMemo(() => config?.systems ?? [], [config]);

  const allTalkgroups = useMemo(() => {
    return systems.flatMap((sys) =>
      (sys.talkgroups ?? []).map((tg) => ({
        ...tg,
        systemId: sys.id,
        systemLabel: sys.label,
      })),
    );
  }, [systems]);

  const filterRows = useMemo(
    () =>
      allTalkgroups.map((tg) => ({
        systemId: tg.systemId,
        talkgroupId: tg.id,
        group: tg.group ?? "",
        tag: tg.tag ?? "",
      })),
    [allTalkgroups],
  );

  const selectedSystemIds = filters.systemIds;
  const selectedTalkgroupIds = filters.talkgroupIds;
  const selectedGroups = filters.groupFilters;
  const selectedTags = filters.tagFilters;

  const matchWith = useCallback(
    (
      row: {
        systemId: number;
        talkgroupId: number;
        group: string;
        tag: string;
      },
      opts: {
        systemIds?: number[];
        talkgroupIds?: number[];
        groups?: string[];
        tags?: string[];
      },
    ) => {
      if (opts.systemIds && opts.systemIds.length > 0) {
        if (!opts.systemIds.includes(row.systemId)) return false;
      }
      if (opts.talkgroupIds && opts.talkgroupIds.length > 0) {
        if (!opts.talkgroupIds.includes(row.talkgroupId)) return false;
      }
      if (opts.groups && opts.groups.length > 0) {
        if (!opts.groups.includes(row.group)) return false;
      }
      if (opts.tags && opts.tags.length > 0) {
        if (!opts.tags.includes(row.tag)) return false;
      }
      return true;
    },
    [],
  );

  const availableSystemIds = useMemo(() => {
    const out = new Set<number>();
    for (const row of filterRows) {
      if (
        matchWith(row, {
          talkgroupIds: selectedTalkgroupIds,
          groups: selectedGroups,
          tags: selectedTags,
        })
      ) {
        out.add(row.systemId);
      }
    }
    return out;
  }, [
    filterRows,
    matchWith,
    selectedTalkgroupIds,
    selectedGroups,
    selectedTags,
  ]);

  const availableTalkgroupIds = useMemo(() => {
    const out = new Set<number>();
    for (const row of filterRows) {
      if (
        matchWith(row, {
          systemIds: selectedSystemIds,
          groups: selectedGroups,
          tags: selectedTags,
        })
      ) {
        out.add(row.talkgroupId);
      }
    }
    return out;
  }, [filterRows, matchWith, selectedSystemIds, selectedGroups, selectedTags]);

  const availableGroups = useMemo(() => {
    const out = new Set<string>();
    for (const row of filterRows) {
      if (
        matchWith(row, {
          systemIds: selectedSystemIds,
          talkgroupIds: selectedTalkgroupIds,
          tags: selectedTags,
        })
      ) {
        if (row.group) out.add(row.group);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [
    filterRows,
    matchWith,
    selectedSystemIds,
    selectedTalkgroupIds,
    selectedTags,
  ]);

  const availableTags = useMemo(() => {
    const out = new Set<string>();
    for (const row of filterRows) {
      if (
        matchWith(row, {
          systemIds: selectedSystemIds,
          talkgroupIds: selectedTalkgroupIds,
          groups: selectedGroups,
        })
      ) {
        if (row.tag) out.add(row.tag);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }, [
    filterRows,
    matchWith,
    selectedSystemIds,
    selectedTalkgroupIds,
    selectedGroups,
  ]);

  const availableSystems = useMemo(
    () => systems.filter((sys) => availableSystemIds.has(sys.id)),
    [systems, availableSystemIds],
  );
  const availableTalkgroups = useMemo(
    () => allTalkgroups.filter((tg) => availableTalkgroupIds.has(tg.id)),
    [allTalkgroups, availableTalkgroupIds],
  );

  const filteredSystems = useMemo(() => {
    const q = systemFilterSearch.trim().toLowerCase();
    if (!q) return availableSystems;
    return availableSystems.filter((sys) =>
      sys.label.toLowerCase().includes(q),
    );
  }, [availableSystems, systemFilterSearch]);

  const filteredTalkgroups = useMemo(() => {
    const q = talkgroupFilterSearch.trim().toLowerCase();
    if (!q) return availableTalkgroups;
    return availableTalkgroups.filter((tg) => {
      const combined = formatTalkgroupLabelName(
        tg.label,
        tg.name,
        tg.talkgroupId,
      ).toLowerCase();
      return combined.includes(q);
    });
  }, [availableTalkgroups, talkgroupFilterSearch]);

  const filteredGroups = useMemo(() => {
    const q = groupFilterSearch.trim().toLowerCase();
    if (!q) return availableGroups;
    return availableGroups.filter((g) => g.toLowerCase().includes(q));
  }, [availableGroups, groupFilterSearch]);

  const filteredTags = useMemo(() => {
    const q = tagFilterSearch.trim().toLowerCase();
    if (!q) return availableTags;
    return availableTags.filter((t) => t.toLowerCase().includes(q));
  }, [availableTags, tagFilterSearch]);

  // Keep selected filters valid when options are narrowed by other selections.
  // Until the config has arrived there are no options at all, and filters set
  // before it (a deep link from the admin) must survive that first render.
  const optionsReady = filterRows.length > 0;
  useEffect(() => {
    if (!optionsReady) return;
    const cleaned = selectedSystemIds.filter((id) =>
      availableSystemIds.has(id),
    );
    if (cleaned.length !== selectedSystemIds.length) {
      dispatch(setSystemFilters(cleaned));
    }
  }, [dispatch, optionsReady, selectedSystemIds, availableSystemIds]);

  useEffect(() => {
    if (!optionsReady) return;
    const cleaned = selectedTalkgroupIds.filter((id) =>
      availableTalkgroupIds.has(id),
    );
    if (cleaned.length !== selectedTalkgroupIds.length) {
      dispatch(setTalkgroupFilters(cleaned));
    }
  }, [dispatch, optionsReady, selectedTalkgroupIds, availableTalkgroupIds]);

  useEffect(() => {
    if (!optionsReady) return;
    const cleaned = selectedGroups.filter((g) => availableGroups.includes(g));
    if (cleaned.length !== selectedGroups.length) {
      dispatch(setGroupFilters(cleaned));
    }
  }, [dispatch, optionsReady, selectedGroups, availableGroups]);

  useEffect(() => {
    if (!optionsReady) return;
    const cleaned = selectedTags.filter((t) => availableTags.includes(t));
    if (cleaned.length !== selectedTags.length) {
      dispatch(setTagFilters(cleaned));
    }
  }, [dispatch, optionsReady, selectedTags, availableTags]);

  // Build query params
  const queryParams = useMemo(() => {
    const params: CallSearchParams = {
      systemIds: filters.systemIds,
      talkgroupIds: filters.talkgroupIds,
      groupFilters: filters.groupFilters,
      tagFilters: filters.tagFilters,
      transcript: filters.transcript,
      page: filters.page,
      limit: filters.limit,
      sort: filters.sort,
    };
    if (filters.dateFrom) {
      params.dateFrom = Math.floor(new Date(filters.dateFrom).getTime() / 1000);
    }
    if (filters.dateTo) {
      // End of day
      params.dateTo = Math.floor(
        new Date(filters.dateTo + "T23:59:59").getTime() / 1000,
      );
    }
    if (filters.bookmarkedOnly) {
      params.bookmarkedOnly = true;
    }
    return params;
  }, [filters]);

  const { data, isFetching, refetch } = useSearchCallsQuery(queryParams, {
    skip: !isOpen,
  });

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));

  const [expandedTranscripts, setExpandedTranscripts] = useState(
    () => new Set<number>(),
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: calls.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const call = calls[index];
      return call && expandedTranscripts.has(call.id) ? 120 : 62;
    },
    overscan: 5,
  });

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.systemIds.length > 0) count++;
    if (filters.talkgroupIds.length > 0) count++;
    if (filters.groupFilters.length > 0) count++;
    if (filters.tagFilters.length > 0) count++;
    if (filters.dateFrom) count++;
    if (filters.dateTo) count++;
    if (filters.bookmarkedOnly) count++;
    if (filters.transcript) count++;
    if (filters.sort !== "desc") count++;
    return count;
  }, [filters]);

  const handleRowClick = useCallback(async (call: CallSearchResult) => {
    const playCall: Call = {
      id: call.id,
      audioName: call.audioName || `call-${call.id}`,
      audioType: call.audioType || "audio/mpeg",
      dateTime: call.dateTime,
      systemId: call.systemId,
      system: call.systemId,
      talkgroupId: call.talkgroupId,
      talkgroup: call.talkgroupId,
      frequency: call.frequency,
      duration: call.duration,
      source: call.source,
      site: call.site,
      channel: call.channel,
      decoder: call.decoder,
      errorCount: call.errorCount,
      spikeCount: call.spikeCount,
      talkerAlias: call.talkerAlias,
      systemLabel: call.systemLabel,
      talkgroupLabel: call.talkgroupLabel,
      talkgroupName: call.talkgroupName,
      talkgroupTag: call.talkgroupTag,
      talkgroupGroup: call.talkgroupGroup,
      transcript: call.transcript,
    };

    audioPlayer.playNow(playCall);
  }, []);

  const [showFilters, setShowFilters] = useState(false);

  const handleToggleSection = useCallback((sectionId: string) => {
    setOpenFilterSection((prev) => (prev === sectionId ? "" : sectionId));
  }, []);

  const handleDownload = useCallback((call: CallSearchResult) => {
    const a = document.createElement("a");
    a.href = `/api/v1/calls/${call.id}/audio`;
    a.download = sanitizeDownloadFilename(
      call.audioName,
      `call-${call.id}.mp3`,
    );
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-base-100">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b border-base-300 px-4 py-3 shrink-0">
        <h2 className="text-lg font-semibold">Search Calls</h2>
        {activeFilterCount > 0 && (
          <span className="badge badge-primary badge-sm">
            {activeFilterCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {/* Mobile: toggle filter panel */}
          <button
            className="btn btn-ghost btn-sm btn-circle md:hidden"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Toggle filters"
          >
            <SlidersHorizontal
              size={16}
              className={showFilters ? "text-primary" : ""}
            />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={() => refetch()}
            aria-label="Refresh"
            disabled={isFetching}
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Body: filters sidebar + results ── */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        {/* ── Filters sidebar ── */}
        <div
          className={`${
            showFilters ? "flex" : "hidden"
          } md:flex flex-col w-full md:w-80 xl:w-136 2xl:w-xl shrink-0 border-b md:border-b-0 md:border-r border-base-300 overflow-y-auto`}
        >
          <div className="p-4 space-y-5">
            {/* Transcript */}
            <div className="rounded border border-base-300 bg-base-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
                  Transcript
                </span>
                {filters.transcript && (
                  <button
                    type="button"
                    onClick={() => dispatch(setTranscript(undefined))}
                    className="text-xs text-base-content/40 hover:text-error transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                type="text"
                className="input input-sm w-full"
                placeholder="Search transcripts..."
                value={filters.transcript ?? ""}
                onChange={(e) =>
                  dispatch(setTranscript(e.target.value || undefined))
                }
              />
            </div>

            {/* System */}
            <FilterSection
              sectionId="system"
              label="System"
              count={filters.systemIds.length}
              isOpen={openFilterSection === "system"}
              onToggle={handleToggleSection}
              onClear={() => dispatch(setSystemFilters([]))}
            >
              <input
                type="text"
                className="input input-xs w-full mb-2"
                placeholder="Search systems..."
                value={systemFilterSearch}
                onChange={(e) => setSystemFilterSearch(e.target.value)}
              />
              <div className="max-h-44 overflow-y-auto pr-1 space-y-0.5">
                {filteredSystems.map((sys) => (
                  <CheckItem
                    key={sys.id}
                    checked={filters.systemIds.includes(sys.id)}
                    onChange={() => dispatch(toggleSystemFilter(sys.id))}
                    label={sys.label}
                  />
                ))}
              </div>
            </FilterSection>

            {/* Talkgroup */}
            <FilterSection
              sectionId="talkgroup"
              label="Talkgroup"
              count={filters.talkgroupIds.length}
              isOpen={openFilterSection === "talkgroup"}
              onToggle={handleToggleSection}
              onClear={() => dispatch(setTalkgroupFilters([]))}
            >
              <input
                type="text"
                className="input input-xs w-full mb-2"
                placeholder="Search talkgroups..."
                value={talkgroupFilterSearch}
                onChange={(e) => setTalkgroupFilterSearch(e.target.value)}
              />
              <div className="max-h-56 overflow-y-auto pr-1 space-y-0.5">
                {filteredTalkgroups.map((tg) => (
                  <CheckItem
                    key={tg.id}
                    checked={filters.talkgroupIds.includes(tg.id)}
                    onChange={() => dispatch(toggleTalkgroupFilter(tg.id))}
                    label={formatTalkgroupLabelName(
                      tg.label,
                      tg.name,
                      tg.talkgroupId,
                    )}
                    title={formatTalkgroupLabelName(
                      tg.label,
                      tg.name,
                      tg.talkgroupId,
                    )}
                  />
                ))}
              </div>
            </FilterSection>

            {/* Group */}
            <FilterSection
              sectionId="group"
              label="Group"
              count={filters.groupFilters.length}
              isOpen={openFilterSection === "group"}
              onToggle={handleToggleSection}
              onClear={() => dispatch(setGroupFilters([]))}
            >
              <input
                type="text"
                className="input input-xs w-full mb-2"
                placeholder="Search groups..."
                value={groupFilterSearch}
                onChange={(e) => setGroupFilterSearch(e.target.value)}
              />
              <div className="max-h-44 overflow-y-auto pr-1 space-y-0.5">
                {filteredGroups.map((g) => (
                  <CheckItem
                    key={g}
                    checked={filters.groupFilters.includes(g)}
                    onChange={() => dispatch(toggleGroupFilter(g))}
                    label={g}
                  />
                ))}
              </div>
            </FilterSection>

            {/* Tag */}
            <FilterSection
              sectionId="tag"
              label="Tag"
              count={filters.tagFilters.length}
              isOpen={openFilterSection === "tag"}
              onToggle={handleToggleSection}
              onClear={() => dispatch(setTagFilters([]))}
            >
              <input
                type="text"
                className="input input-xs w-full mb-2"
                placeholder="Search tags..."
                value={tagFilterSearch}
                onChange={(e) => setTagFilterSearch(e.target.value)}
              />
              <div className="max-h-44 overflow-y-auto pr-1 space-y-0.5">
                {filteredTags.map((t) => (
                  <CheckItem
                    key={t}
                    checked={filters.tagFilters.includes(t)}
                    onChange={() => dispatch(toggleTagFilter(t))}
                    label={t}
                  />
                ))}
              </div>
            </FilterSection>

            {/* Date range */}
            <div className="rounded border border-base-300 bg-base-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
                  Date range
                </span>
                {(filters.dateFrom || filters.dateTo) && (
                  <button
                    type="button"
                    onClick={() => {
                      dispatch(setDateFrom(undefined));
                      dispatch(setDateTo(undefined));
                    }}
                    className="text-xs text-base-content/40 hover:text-error transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  type="date"
                  className="input input-sm w-full"
                  value={filters.dateFrom ?? ""}
                  onChange={(e) =>
                    dispatch(setDateFrom(e.target.value || undefined))
                  }
                />
                <input
                  type="date"
                  className="input input-sm w-full"
                  value={filters.dateTo ?? ""}
                  onChange={(e) =>
                    dispatch(setDateTo(e.target.value || undefined))
                  }
                />
              </div>
            </div>

            {/* Sort */}
            <div className="rounded border border-base-300 bg-base-100 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
                  Sort
                </span>
                {filters.sort !== "desc" && (
                  <button
                    type="button"
                    onClick={() => dispatch(setSort("desc"))}
                    className="text-xs text-base-content/40 hover:text-error transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              <select
                className="select select-sm w-full"
                value={filters.sort}
                onChange={(e) =>
                  dispatch(setSort(e.target.value as "asc" | "desc"))
                }
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </select>
            </div>

            {/* Bookmarked only */}
            {isAuthenticated && (
              <div className="rounded border border-base-300 bg-base-100 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">
                    Bookmarks
                  </span>
                  {filters.bookmarkedOnly && (
                    <button
                      type="button"
                      onClick={() => dispatch(setBookmarkedOnly(false))}
                      className="text-xs text-base-content/40 hover:text-error transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-primary"
                    checked={filters.bookmarkedOnly}
                    onChange={(e) =>
                      dispatch(setBookmarkedOnly(e.target.checked))
                    }
                  />
                  <span className="text-sm">Bookmarked only</span>
                </label>
              </div>
            )}

            {/* Reset */}
            <button
              className="btn btn-ghost btn-sm w-full justify-start gap-2"
              onClick={() => dispatch(resetFilters())}
            >
              <RotateCcw size={14} />
              Reset filters
            </button>

            {/* Mobile: back to results */}
            <button
              className="btn btn-primary btn-sm w-full md:hidden"
              onClick={() => setShowFilters(false)}
            >
              Show results
            </button>
          </div>
        </div>

        {/* ── Results ── */}
        <div
          className={`${
            !showFilters ? "flex" : "hidden"
          } md:flex flex-1 flex-col min-h-0`}
        >
          {/* Paginator */}
          <div className="flex items-center justify-between border-b border-base-300 px-4 py-2 shrink-0">
            <div className="join">
              <button
                className="join-item btn btn-sm"
                disabled={filters.page <= 1}
                onClick={() => dispatch(setPage(filters.page - 1))}
              >
                <ChevronLeft size={14} />
                Prev
              </button>
              <button className="join-item btn btn-sm btn-disabled pointer-events-none">
                Page {filters.page} of {totalPages}
              </button>
              <button
                className="join-item btn btn-sm"
                disabled={filters.page >= totalPages}
                onClick={() => dispatch(setPage(filters.page + 1))}
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
            {total > 0 && (
              <span className="text-xs text-base-content/40">
                {total.toLocaleString()} calls
              </span>
            )}
          </div>

          {/* Results list */}
          <div ref={parentRef} className="relative flex-1 overflow-y-auto">
            {isFetching && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-base-100/60">
                <span className="loading loading-spinner loading-md" />
              </div>
            )}

            {calls.length === 0 && !isFetching && (
              <div className="flex h-32 items-center justify-center text-base-content/50">
                No results
              </div>
            )}

            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const call = calls[virtualRow.index];
                return (
                  <div
                    key={call.id}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className="absolute left-0 flex w-full items-start gap-2 border-b border-base-300 px-3 py-2 hover:bg-base-200 overflow-hidden"
                    style={{ top: virtualRow.start }}
                  >
                    {/* Call details */}
                    <div className="min-w-0 flex-1">
                      {/* Row 1: talkgroup name */}
                      <div className="text-xs font-medium truncate">
                        {formatTalkgroupLabelName(
                          call.talkgroupLabel,
                          call.talkgroupName,
                          call.talkgroupId,
                        )}
                      </div>
                      {/* Row 2: system */}
                      <div className="text-[11px] text-base-content/60 truncate">
                        {call.systemLabel}
                      </div>
                      {/* Row 3: freq, UID, TGID */}
                      <div className="flex items-center gap-2 text-[11px] text-base-content/40">
                        {call.frequency > 0 && (
                          <span>{(call.frequency / 1e6).toFixed(4)} MHz</span>
                        )}
                        {call.source > 0 && <span>UID: {call.source}</span>}
                        {call.talkerAlias && <span>{call.talkerAlias}</span>}
                        {call.talkgroupId > 0 && (
                          <span>TGID: {call.talkgroupId}</span>
                        )}
                        {call.errorCount != null && call.errorCount > 0 && (
                          <span>E:{call.errorCount}</span>
                        )}
                        {call.spikeCount != null && call.spikeCount > 0 && (
                          <span>S:{call.spikeCount}</span>
                        )}
                      </div>
                      {/* Row 4: transcript fold-down */}
                      {call.transcript && (
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[10px] text-base-content/50 hover:text-base-content/70 mt-0.5"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedTranscripts((prev) => {
                              const next = new Set(prev);
                              if (next.has(call.id)) next.delete(call.id);
                              else next.add(call.id);
                              return next;
                            });
                          }}
                        >
                          <ChevronDown
                            size={12}
                            className={`transition-transform ${
                              expandedTranscripts.has(call.id)
                                ? "rotate-180"
                                : ""
                            }`}
                          />
                          Transcription
                        </button>
                      )}
                      {call.transcript && expandedTranscripts.has(call.id) && (
                        <div className="text-[11px] italic text-base-content/60 whitespace-pre-wrap mt-0.5">
                          {call.transcript}
                        </div>
                      )}
                    </div>
                    {/* Date/time + action buttons */}
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[11px] text-base-content/60">
                        {formatDate(call.dateTime)} {formatTime(call.dateTime)}
                      </span>
                      {call.duration > 0 && (
                        <span className="text-[11px] text-base-content/40">
                          {formatDuration(call.duration)}
                        </span>
                      )}
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => void handleRowClick(call)}
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label="Play call"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownload(call);
                          }}
                          className="btn btn-ghost btn-xs btn-square"
                          aria-label="Download call"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                        {isAuthenticated && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void toggleBookmark(call.id);
                            }}
                            className={`btn btn-ghost btn-xs btn-square ${
                              bookmarkedCallIds.includes(call.id)
                                ? "text-warning"
                                : ""
                            }`}
                            aria-label="Toggle bookmark"
                          >
                            <Star
                              className={`w-3 h-3 ${
                                bookmarkedCallIds.includes(call.id)
                                  ? "fill-current"
                                  : ""
                              }`}
                            />
                          </button>
                        )}
                        {isAuthenticated && shareableLinks && (
                          <ShareCallButton callId={call.id} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
