import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import {
  ActionButton,
  DataTable,
  DetailsPanel,
  FactList,
  FilterChips,
  PageHeader,
  SearchBox,
  formatClock,
  formatDateTime,
  plural,
  useHour12,
  useDetails,
  type Column,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminAuditRow, AdminLog } from "@/types";
import LogDetails from "./LogDetails";
import {
  LIMITS,
  RANGES,
  auditAsText,
  auditLink,
  levelDot,
  linesAsText,
  parseLog,
  statusClass,
  tabFrom,
  type LevelFilter,
  type RangeId,
  type Tab,
} from "./logLines";
import { useAdminLogs, useAuditTrail } from "./useAdminLogs";

type Panel = { key: string; kind: "line"; index: number } | { key: string; kind: "audit"; id: number };

function timeCell(unix: number, hour12: boolean) {
  const d = new Date(unix * 1000);
  return (
    <time dateTime={d.toISOString()} title={formatDateTime(unix)} className="font-mono text-[13px] text-base-content-dim">
      {formatClock(unix, { hour12 })}
    </time>
  );
}

function levelCell(level: string) {
  return (
    <span className="flex items-center gap-1.5 max-sm:justify-end" title={level}>
      <span className={`h-2 w-2 rounded-full ${levelDot(level)}`} aria-hidden="true" />
      <span className="sr-only text-xs capitalize max-sm:not-sr-only">{level}</span>
    </span>
  );
}

const LEVEL_ORDER = ["error", "warn", "info", "debug"] as const;

function rangeWords(range: RangeId): string {
  switch (range) {
    case "1h":
      return "the last hour";
    case "24h":
      return "the last 24 hours";
    case "7d":
      return "the last 7 days";
    default:
      return "all";
  }
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
}

/** Logs & audit: the server's log, and the trail of who changed what. */
export default function LogsPanel() {
  const [search, setSearch] = useSearchParams();
  const tab = tabFrom(search.get("tab"));
  const [query, setQuery] = useState(() => search.get("q") ?? "");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [range, setRange] = useState<RangeId>("24h");
  const [limit, setLimit] = useState<number>(500);
  const [following, setFollowing] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const hour12 = useHour12();
  const panel = useDetails<Panel>();
  const p = panel.selected;

  // Following pauses while the reader has scrolled down into older lines.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 200);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const params = useMemo(() => {
    const seconds = RANGES.find((r) => r.id === range)?.seconds ?? null;
    return {
      sinceSeconds: seconds === null ? undefined : seconds,
      level: tab === "server" && level !== "all" ? level : undefined,
      q: query.trim() || undefined,
      limit,
    };
  }, [range, level, query, limit, tab]);

  const paused = scrolled || p !== null;
  const server = useAdminLogs(params, tab === "server" && following, paused);
  const audit = useAuditTrail(params, tab === "audit" && following, paused);

  const lines = useMemo(() => server.logs ?? [], [server.logs]);
  const auditRows = useMemo(() => audit.rows ?? [], [audit.rows]);
  const counts = useMemo(() => {
    const c: Record<LevelFilter, number> = { all: lines.length, debug: 0, info: 0, warn: 0, error: 0 };
    for (const l of lines) {
      if (l.level in c) c[l.level as LevelFilter]++;
    }
    return c;
  }, [lines]);

  const selectTab = (next: Tab) => {
    panel.reset();
    const sp = new URLSearchParams(search);
    if (next === "server") sp.delete("tab");
    else sp.set("tab", next);
    setSearch(sp, { replace: true });
  };

  const lineColumns: Column<AdminLog>[] = [
    { id: "time", header: "Time", phone: "plain", sortValue: (l) => l.dateTime, cell: (l) => timeCell(l.dateTime, hour12), className: "whitespace-nowrap" },
    {
      id: "level",
      header: "Level",
      phone: "plain",
      sortValue: (l) => l.level,
      cell: (l) => levelCell(l.level),
    },
    {
      id: "message",
      header: "Message",
      phone: "title",
      cell: (l) => {
        const parsed = parseLog(l);
        if (parsed.isRequest) {
          return (
            <span className="flex flex-wrap items-center gap-x-2 font-mono text-xs">
              <span className="font-semibold">{parsed.method}</span>
              <span className="break-all">{parsed.path}</span>
              {parsed.status != null && <span className={statusClass(parsed.status)}>{parsed.status}</span>}
              {parsed.latencyMs != null && <span className="text-admin-dim2">{parsed.latencyMs} ms</span>}
            </span>
          );
        }
        return (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-words">{parsed.summary}</span>
            {parsed.chips.map((c) => (
              <span
                key={c.key}
                className={`rounded px-1.5 py-px font-mono text-xs ${
                  c.tone === "error" ? "bg-admin-red-bg text-admin-red-fg" : "bg-base-300 text-base-content-dim"
                }`}
                title={`${c.key}=${c.value}`}
              >
                {c.key}={c.value}
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  const auditColumns: Column<AdminAuditRow>[] = [
    { id: "time", header: "Time", phone: "plain", sortValue: (r) => r.dateTime, cell: (r) => timeCell(r.dateTime, hour12), className: "whitespace-nowrap" },
    {
      id: "level",
      header: "Level",
      phone: "hide",
      sortValue: (r) => r.level,
      cell: (r) => levelCell(r.level),
    },
    { id: "event", header: "Event", phone: "title", cell: (r) => <span className="break-words">{r.message}</span> },
  ];

  const selectedLine = p?.kind === "line" ? (lines[p.index] ?? null) : null;
  const selectedAudit = p?.kind === "audit" ? (auditRows.find((r) => r.id === p.id) ?? null) : null;
  const auditFacts: Fact[] = selectedAudit
    ? [
        { label: "Time", value: formatDateTime(selectedAudit.dateTime) },
        { label: "Level", value: selectedAudit.level },
        { label: "Event", value: <span className="break-words">{selectedAudit.message}</span> },
      ]
    : [];
  const auditGo = selectedAudit ? auditLink(selectedAudit) : null;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Logs & audit"
        subtitle="Server log for troubleshooting, and the audit trail of who signed in and what admins changed."
      />

      <div role="tablist" aria-label="Log kind" className="tabs tabs-border">
        <button type="button" role="tab" aria-selected={tab === "server"} className={`tab ${tab === "server" ? "tab-active" : ""}`} onClick={() => selectTab("server")}>
          Server log
        </button>
        <button type="button" role="tab" aria-selected={tab === "audit"} className={`tab ${tab === "audit" ? "tab-active" : ""}`} onClick={() => selectTab("audit")}>
          Audit trail
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label={tab === "server" ? "Search messages" : "Search the audit trail"}
          className="w-full md:max-w-[340px] md:min-w-[200px] md:flex-[1_1_240px]"
        />
        {tab === "server" && (
          <FilterChips
            label="Level"
            value={level}
            onChange={setLevel}
            options={[
              { id: "all", label: "All", count: counts.all },
              ...LEVEL_ORDER.map((l) => ({
                id: l,
                label: l.charAt(0).toUpperCase() + l.slice(1),
                count: counts[l],
                dot: levelDot(l),
              })),
            ]}
          />
        )}
        <FilterChips
          label="Range"
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ id: r.id, label: r.label }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn"
          aria-pressed={following}
          title="Reloads every 5 seconds and after new calls."
          onClick={() => setFollowing((f) => !f)}
        >
          <span
            className={`h-2 w-2 rounded-full ${following && !paused ? "bg-success" : "bg-admin-dim2"}`}
            aria-hidden="true"
          />
          Following
        </button>
        <button
          type="button"
          className="btn"
          disabled={tab === "server" ? lines.length === 0 : auditRows.length === 0}
          onClick={() =>
            tab === "server"
              ? download(`squelch-log-${stamp()}.txt`, linesAsText(lines))
              : download(`squelch-audit-${stamp()}.txt`, auditAsText(auditRows))
          }
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Download
        </button>
        <label className="flex items-center gap-2">
          <span className="text-base-content-dim">Up to</span>
          <select className="select w-auto" aria-label="Lines to load" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {following && paused && (
          <span className="text-xs text-base-content-dim">Paused while you read; new lines arrive when you scroll back up.</span>
        )}
      </div>

      {tab === "server" ? (
        <DataTable
          key="server"
          caption="Server log"
          columns={lineColumns}
          rows={lines}
          rowKey={(l) => lines.indexOf(l)}
          loading={server.isLoading}
          empty={query || level !== "all" ? "No line matches." : "Nothing logged in this range."}
          defaultSort={{ id: "time", dir: "desc" }}
          onOpen={(l, trigger) => panel.open({ key: `line:${lines.indexOf(l)}`, kind: "line", index: lines.indexOf(l) }, trigger)}
          rowLabel={(l) => parseLog(l).summary}
          openKey={p?.kind === "line" ? p.index : null}
        />
      ) : (
        <DataTable
          key="audit"
          caption="Audit trail"
          columns={auditColumns}
          rows={auditRows}
          rowKey={(r) => r.id}
          loading={audit.isLoading}
          empty={query ? "No event matches." : "No events in this range. Sign-ins, admin changes, blocks and delivery failures land here."}
          defaultSort={{ id: "time", dir: "desc" }}
          onOpen={(r, trigger) => panel.open({ key: `audit:${r.id}`, kind: "audit", id: r.id }, trigger)}
          rowLabel={(r) => r.message}
          openKey={p?.kind === "audit" ? p.id : null}
        />
      )}

      <p className="text-right text-xs text-base-content-dim">
        Newest first · {plural(tab === "server" ? lines.length : auditRows.length, tab === "server" ? "line" : "event")}{" "}
        {range === "all" ? "loaded" : `in ${rangeWords(range)}`}
        {tab === "server" && (
          <>
            {" "}
            · the log level is set under{" "}
            <Link to="/admin/settings#settings-logging" className="link">
              Settings → Logging
            </Link>
          </>
        )}
      </p>

      {p?.kind === "line" && selectedLine && (
        <LogDetails
          key={p.key}
          log={selectedLine}
          index={p.index}
          count={lines.length}
          onMove={(i) => panel.replace({ key: `line:${i}`, kind: "line", index: i })}
          onShowSimilar={(m) => {
            setQuery(m);
            panel.close();
          }}
          onClose={panel.close}
        />
      )}
      {p?.kind === "audit" && selectedAudit && (
        <DetailsPanel key={p.key} title={selectedAudit.message} titleClassName="break-words text-base" subtitle="Audit event" onClose={panel.close}>
          <FactList facts={auditFacts} />
          <ActionButton
            icon={<RefreshCw className="h-4 w-4" />}
            label="Show similar events"
            hint="Searches the trail for this wording."
            onClick={() => {
              setQuery(selectedAudit.message.split(" by ")[0]);
              panel.close();
            }}
          />
          {auditGo && (
            <Link to={auditGo.to} className="btn btn-ghost btn-sm justify-start gap-2">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {auditGo.label}
            </Link>
          )}
        </DetailsPanel>
      )}
    </div>
  );
}
