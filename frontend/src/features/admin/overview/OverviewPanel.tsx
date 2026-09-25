// Overview: what needs attention, whether ingest is healthy, and how busy
// the chosen range was. The attention list and health strip come from the
// Shell's shared data; the chart, busiest talkgroups and recent admin
// activity are this page's own queries.
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import {
  Card,
  FilterChips,
  PageHeader,
  StatGrid,
  StatTile,
  formatDay,
  formatTime,
  useHour12,
  useNow,
  useWsQuery,
} from "@/features/admin/_shell";
import type { ActivityChart, ActivityRange, AdminAuditRow, TopTalkgroups } from "@/types";
import { CallsChart } from "./CallsChart";
import { averageOf, fillSeries, peakOf } from "./chart";
import type { DetailPart, Tone } from "./attention";
import { useOverviewData } from "./useOverviewSources";

const RANGES: { id: ActivityRange; label: string; words: string }[] = [
  { id: "24h", label: "24 h", words: "last 24 h" },
  { id: "7d", label: "7 d", words: "last 7 days" },
  { id: "30d", label: "30 d", words: "last 30 days" },
];

function rangeFrom(raw: string | null): ActivityRange {
  return raw === "7d" || raw === "30d" ? raw : "24h";
}

const DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-error",
  off: "bg-admin-dim2",
};

function Detail({ parts }: { parts: DetailPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="font-mono">
            {p.mono}
          </span>
        ),
      )}
    </>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** "▲ 6% vs yesterday", compared with yesterday up to this time of day. */
function versusYesterday(today: number, yesterday: number): { text: string; tone: "up" | "down" | "flat" } {
  if (yesterday === 0) return { text: today ? "none yesterday by now" : "none yesterday either", tone: "flat" };
  const pct = Math.round(((today - yesterday) / yesterday) * 100);
  if (pct === 0) return { text: "same as yesterday", tone: "flat" };
  return pct > 0 ? { text: `▲ ${pct}% vs yesterday`, tone: "up" } : { text: `▼ ${-pct}% vs yesterday`, tone: "down" };
}

/** Days of this week so far, counting today, from Monday. */
function daysThisWeek(now: number): number {
  const day = new Date(now * 1000).getDay();
  return day === 0 ? 7 : day;
}

export default function OverviewPanel() {
  const [search, setSearch] = useSearchParams();
  const range = rangeFrom(search.get("range"));
  const hour12 = useHour12();
  const data = useOverviewData();
  const stats = data?.stats;
  const ownNow = useNow(30_000);
  const now = data?.now ?? ownNow;

  // The day's view follows new calls; the long ranges cost more and change
  // slowly, so they refresh every five minutes instead.
  const live = range === "24h";
  const params = useMemo(() => ({ range }), [range]);
  const chart = useWsQuery<ActivityChart>("activity.chart", params, live ? "activity.updated" : undefined, live ? 60_000 : 300_000, {
    debounceMs: 5_000,
  });
  const top = useWsQuery<TopTalkgroups>("activity.top-talkgroups", params, live ? "activity.updated" : undefined, live ? 60_000 : 300_000, {
    debounceMs: 5_000,
  });
  const audit = useWsQuery<AdminAuditRow[]>("logs.audit", { limit: 4 }, undefined, 60_000);

  const series = useMemo(() => fillSeries(chart.data?.buckets ?? [], range, now), [chart.data, range, now]);
  const peak = peakOf(series.points);
  const words = RANGES.find((r) => r.id === range)?.words ?? "";
  const unit = series.unit === "day" ? "day" : "hour";
  const chartTitle = `Calls per ${unit} · ${words}`;

  const attention = data?.attention ?? [];
  const pills = data?.pills ?? [];
  const talkgroups = (top.data?.talkgroups ?? []).slice(0, 5);
  const busiest = talkgroups[0]?.callCount ?? 0;

  const setRange = (next: ActivityRange) => {
    const p = new URLSearchParams(search);
    if (next === "24h") p.delete("range");
    else p.set("range", next);
    setSearch(p, { replace: true });
  };

  const vs = stats ? versusYesterday(stats.callsToday, stats.callsYesterday) : null;
  const share =
    data?.sources.transcription && stats
      ? (() => {
          const t = data.sources.transcription;
          if (!t.calls24h) return "no calls yet";
          const pct = Math.round((t.recent24h / t.calls24h) * 100);
          return pct > 100 ? "includes older calls" : `${pct}% of calls`;
        })()
      : null;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Overview"
        subtitle="What needs attention, whether ingest is healthy, and how busy the last day was."
        actions={<FilterChips label="Time range" options={RANGES} value={range} onChange={setRange} />}
      />

      <Card
        title="Needs attention"
        count={attention.length}
        meta={attention.length ? "Cleared automatically when fixed" : undefined}
        bodyClassName=""
      >
        {attention.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-base-content-dim">Nothing needs you right now.</p>
        ) : (
          <ul>
            {attention.map((a) => (
              <li
                key={a.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-admin-line2 px-4 py-3 last:border-b-0"
              >
                <span className={`badge ${a.tone === "bad" ? "badge-error" : "badge-warning"}`}>{a.tone === "bad" ? "error" : "warn"}</span>
                <div className="min-w-0 flex-1 basis-60">
                  <b className="block font-semibold [overflow-wrap:anywhere]">{a.title}</b>
                  <small className="block text-xs text-base-content-dim [overflow-wrap:anywhere]">
                    <Detail parts={a.detail} />
                  </small>
                </div>
                <Link to={a.action.to} className="btn btn-sm">
                  {a.action.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <nav aria-label="Service health" className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <Link
            key={p.id}
            to={p.to}
            className="inline-flex min-h-9 items-center gap-2 rounded-full border border-admin-line bg-base-200 px-3 py-1.5 text-[13px] hover:bg-base-300"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[p.tone]}`} aria-hidden="true" />
            {p.text}
            {p.tone !== "ok" && <span className="sr-only">({p.tone === "off" ? "off" : p.tone === "warn" ? "needs a look" : "failing"})</span>}
          </Link>
        ))}
      </nav>

      <StatGrid className="grid-cols-2 md:grid-cols-5">
        <StatTile
          label="Calls today"
          to="/admin/systems"
          value={stats ? stats.callsToday.toLocaleString() : "…"}
          detail={
            vs && (
              <span className={vs.tone === "up" ? "text-success" : vs.tone === "down" ? "text-warning" : ""}>{vs.text}</span>
            )
          }
        />
        <StatTile
          label="This week"
          to="/admin/systems"
          value={stats ? stats.callsThisWeek.toLocaleString() : "…"}
          detail={stats ? `avg ${Math.round(stats.callsThisWeek / daysThisWeek(now)).toLocaleString()} / day` : undefined}
        />
        <StatTile
          label="Listeners now"
          to="/admin/connections"
          value={data?.sources.listeners ?? "…"}
          detail="live connections, admins not counted"
        />
        <StatTile
          label="Transcribed 24 h"
          to="/admin/transcription"
          value={data?.sources.transcription ? data.sources.transcription.recent24h.toLocaleString() : "…"}
          detail={
            data?.sources.transcription && !data.sources.transcription.poolEnabled
              ? "transcription is off"
              : share && `${share} · queue ${data?.sources.transcription?.queueDepth ?? 0}`
          }
        />
        <StatTile
          label="Uptime"
          to="/admin/logs"
          value={stats ? formatUptime(stats.uptime) : "…"}
          detail={stats ? `${stats.version} · restarted ${formatDay(stats.startedAt)}` : undefined}
        />
      </StatGrid>

      <div className="grid items-start gap-[18px] xl:grid-cols-[3fr_2fr]">
        <Card
          title={chartTitle}
          meta={
            peak
              ? `Peak ${peak.count.toLocaleString()} at ${series.unit === "day" ? formatDay(peak.at) : formatTime(peak.at, { hour12 })} · Avg ${averageOf(series.points).toLocaleString()}`
              : undefined
          }
        >
          <CallsChart series={series} hour12={hour12} label={chartTitle} />
        </Card>

        <Card
          title="Busiest talkgroups"
          bodyClassName=""
          meta={
            <Link to="/admin/systems" className="btn btn-ghost btn-sm">
              All systems
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          }
        >
          {talkgroups.length === 0 ? (
            <p className="px-4 py-3.5 text-sm text-base-content-dim">No calls in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <caption className="sr-only">Busiest talkgroups, {words}</caption>
                <thead>
                  <tr>
                    <th>Talkgroup</th>
                    <th className="max-sm:hidden">System</th>
                    <th className="text-right">Calls</th>
                    <th className="w-24 max-sm:hidden">
                      <span className="sr-only">Share of the busiest</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {talkgroups.map((t) => {
                    const name = t.talkgroupLabel || (t.talkgroupNumber ? `TG ${t.talkgroupNumber}` : "No talkgroup");
                    return (
                      <tr key={`${t.systemId}-${t.talkgroupId}`}>
                        <td className="min-w-0">
                          {t.talkgroupId ? (
                            <Link to={`/admin/systems?system=${t.systemId}&open=${t.talkgroupId}`} className="link link-hover font-medium">
                              {name}
                            </Link>
                          ) : (
                            <span className="font-medium">{name}</span>
                          )}
                          {t.talkgroupName && <span className="block text-xs text-base-content-dim">{t.talkgroupName}</span>}
                          <span className="block text-xs text-base-content-dim sm:hidden">{t.systemLabel}</span>
                        </td>
                        <td className="whitespace-nowrap max-sm:hidden">{t.systemLabel}</td>
                        <td className="text-right tabular-nums">{t.callCount.toLocaleString()}</td>
                        <td className="max-sm:hidden">
                          <div className="h-1.5 rounded-full bg-base-300" aria-hidden="true">
                            <div
                              className="h-1.5 rounded-full bg-info"
                              style={{ width: `${busiest ? Math.max(4, Math.round((t.callCount / busiest) * 100)) : 0}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent admin activity"
        bodyClassName=""
        meta={
          <Link to="/admin/logs?tab=audit" className="btn btn-ghost btn-sm">
            Audit log
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      >
        {(audit.data ?? []).length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-base-content-dim">{audit.isLoading ? "Loading…" : "No admin activity yet."}</p>
        ) : (
          <ul>
            {(audit.data ?? []).map((row) => (
              <li key={row.id} className="flex gap-3 border-b border-admin-line2 px-4 py-2.5 text-sm last:border-b-0">
                <time dateTime={new Date(row.dateTime * 1000).toISOString()} className="shrink-0 font-mono text-xs leading-5 text-base-content-dim">
                  {formatTime(row.dateTime, { hour12 })}
                </time>
                <span className="min-w-0 [overflow-wrap:anywhere]">{row.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
