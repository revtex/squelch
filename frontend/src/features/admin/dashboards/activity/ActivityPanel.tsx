import { useAdminActivity } from "./useAdminActivity";
import type { ChartBucket } from "./activitySlice";
import {
  Activity,
  Clock3,
  Headphones,
  Radio,
  Signal,
  TowerControl,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppSelector } from "@/app/store";
import { useGetConfigQuery } from "@/features/admin/_shell";

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatHourLabel(unixHour: number, hour12: boolean): string {
  const date = new Date(unixHour * 1000);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  });
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Sparkline({
  buckets,
  hour12,
}: {
  buckets: ChartBucket[];
  hour12: boolean;
}) {
  const W = 1000;
  const H = 160;
  const PAD = { top: 12, right: 2, bottom: 28, left: 2 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);
  const n = buckets.length;

  const xOf = (i: number) =>
    PAD.left + (n > 1 ? (i / (n - 1)) * chartW : chartW / 2);
  const yOf = (v: number) => PAD.top + chartH - (v / maxCount) * chartH;

  // Build smooth polyline points
  const pts = buckets.map((b, i) => `${xOf(i)},${yOf(b.count)}`).join(" ");
  // Closed area path
  const area = [
    `M ${xOf(0)},${yOf(buckets[0].count)}`,
    ...buckets.slice(1).map((b, i) => `L ${xOf(i + 1)},${yOf(b.count)}`),
    `L ${xOf(n - 1)},${PAD.top + chartH}`,
    `L ${xOf(0)},${PAD.top + chartH}`,
    "Z",
  ].join(" ");

  // Label every ~4th bucket
  const labelIdxs = buckets
    .map((_, i) => i)
    .filter((i) => i % 4 === 0 || i === n - 1);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);

  return (
    <div className="relative w-full rounded-xl border border-admin-line bg-base-100/60 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-40"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--color-primary)"
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor="var(--color-primary)"
              stopOpacity="0.02"
            />
          </linearGradient>
          {/* Horizontal grid lines */}
        </defs>

        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line
            key={frac}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + chartH * (1 - frac)}
            y2={PAD.top + chartH * (1 - frac)}
            stroke="currentColor"
            strokeOpacity={0.07}
            strokeWidth={1}
          />
        ))}

        {/* Area fill */}
        <path d={area} fill="url(#areaGrad)" />

        {/* Line */}
        <polyline
          points={pts}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dot + tooltip hit areas */}
        {buckets.map((b, i) => (
          <circle
            key={b.hour}
            cx={xOf(i)}
            cy={yOf(b.count)}
            r={6}
            fill="transparent"
            onMouseEnter={(e) => {
              const svg = (e.currentTarget as SVGCircleElement)
                .ownerSVGElement!;
              const rect = svg.getBoundingClientRect();
              const cx = rect.left + (xOf(i) / W) * rect.width;
              const cy = rect.top + (yOf(b.count) / H) * rect.height;
              setTooltip({
                x: cx - rect.left,
                y: cy - rect.top,
                text: `${formatHourLabel(b.hour, hour12)} — ${b.count.toLocaleString()} calls`,
              });
            }}
            onMouseLeave={() => setTooltip(null)}
          />
        ))}

        {/* X-axis labels */}
        {labelIdxs.map((i) => (
          <text
            key={i}
            x={xOf(i)}
            y={H - 4}
            textAnchor="middle"
            fontSize={18}
            fill="currentColor"
            fillOpacity={0.4}
          >
            {formatHourLabel(buckets[i].hour, hour12)}
          </text>
        ))}

        {/* Radar sweep */}
        <rect
          x={0}
          y={PAD.top}
          width={4}
          height={chartH}
          fill="var(--color-primary)"
          fillOpacity={0.5}
          rx={2}
          style={{
            animation: "radar-sweep 8s linear infinite",
            ["--sweep-width" as string]: `${W}px`,
          }}
        />
      </svg>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-admin-line bg-base-200 px-2.5 py-1.5 text-xs font-medium shadow-lg -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export default function ActivityPanel() {
  // Prefer the admin config (always available on admin pages) over the
  // scanner config (which requires a scanner WS handshake the admin route
  // may not have completed yet). Fall back to scanner.config if the admin
  // setting is missing for any reason.
  const { data: adminConfig } = useGetConfigQuery();
  const adminHour12 = useMemo(() => {
    const setting = adminConfig?.settings.find(
      (s) => s.key === "time12hFormat",
    );
    if (!setting) return undefined;
    return setting.value === "true";
  }, [adminConfig]);
  const scannerHour12 = useAppSelector((s) => s.scanner.config?.time12hFormat);
  const hour12 = adminHour12 ?? scannerHour12 ?? false;
  const { stats, chart, topTG, isLoading } = useAdminActivity();
  const statsLoading = isLoading;
  const chartLoading = isLoading;
  const topLoading = isLoading;

  const buckets = useMemo(() => chart?.buckets ?? [], [chart]);
  const peakBucket = useMemo(
    () =>
      buckets.reduce(
        (best, b) => (b.count > best.count ? b : best),
        buckets[0],
      ),
    [buckets],
  );
  const totalLast24h = useMemo(
    () => buckets.reduce((sum, b) => sum + b.count, 0),
    [buckets],
  );
  const avgPerHour =
    buckets.length > 0 ? Math.round(totalLast24h / buckets.length) : 0;
  const latestBucket = buckets.length > 0 ? buckets[buckets.length - 1] : null;
  const previousBucket =
    buckets.length > 1 ? buckets[buckets.length - 2] : null;
  const latestDelta =
    latestBucket && previousBucket
      ? latestBucket.count - previousBucket.count
      : 0;
  const topTalkgroupCount = topTG?.talkgroups?.[0]?.callCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-admin-line bg-linear-to-r from-base-200 via-base-200 to-primary/10 p-5">
        <div className="absolute -right-16 -top-16 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20 text-primary">
            <TowerControl className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-wide">
              Radio Operations Center
            </h1>
            <p className="text-sm text-base-content-dim">
              Live network activity across the last 24 hours and busiest
              channels.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs">
            <span className="h-2 w-2 animate-pulse rounded-full bg-success" />
            <span className="font-semibold text-success">
              Live via WebSocket
            </span>
          </div>
        </div>
      </div>

      {statsLoading ? (
        <div className="flex justify-center p-8">
          <span className="loading loading-spinner loading-md" />
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-admin-line bg-base-200 p-4">
              <div className="mb-2 flex items-center justify-between text-base-content-dim">
                <span className="text-sm font-medium">Calls Today</span>
                <Radio className="h-4 w-4" />
              </div>
              <div className="text-4xl font-black text-primary">
                {stats.callsToday.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-admin-line bg-base-200 p-4">
              <div className="mb-2 flex items-center justify-between text-base-content-dim">
                <span className="text-sm font-medium">This Week</span>
                <Activity className="h-4 w-4" />
              </div>
              <div className="text-4xl font-black">
                {stats.callsThisWeek.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-admin-line bg-base-200 p-4">
              <div className="mb-2 flex items-center justify-between text-base-content-dim">
                <span className="text-sm font-medium">Total Calls</span>
                <Signal className="h-4 w-4" />
              </div>
              <div className="text-4xl font-black">
                {stats.callsTotal.toLocaleString()}
              </div>
            </div>
            <div className="rounded-xl border border-admin-line bg-base-200 p-4">
              <div className="mb-2 flex items-center justify-between text-base-content-dim">
                <span className="text-sm font-medium">Listeners</span>
                <Headphones className="h-4 w-4" />
              </div>
              <div className="text-4xl font-black text-secondary">
                {stats.activeListeners}
              </div>
            </div>
            <div className="rounded-xl border border-admin-line bg-base-200 p-4">
              <div className="mb-2 flex items-center justify-between text-base-content-dim">
                <span className="text-sm font-medium">Uptime</span>
                <Clock3 className="h-4 w-4" />
              </div>
              <div className="text-4xl font-black">
                {formatUptime(stats.uptime)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-admin-line bg-base-200 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-base-content-dim">
                Last 24h Total
              </div>
              <div className="mt-1 text-xl font-bold">
                {totalLast24h.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-admin-line bg-base-200 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-base-content-dim">
                Average / Hour
              </div>
              <div className="mt-1 text-xl font-bold">
                {avgPerHour.toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-admin-line bg-base-200 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-base-content-dim">
                Peak Hour
              </div>
              <div className="mt-1 text-xl font-bold">
                {peakBucket
                  ? `${formatHourLabel(peakBucket.hour, hour12)} (${peakBucket.count.toLocaleString()})`
                  : "N/A"}
              </div>
            </div>
            <div className="rounded-lg border border-admin-line bg-base-200 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-base-content-dim">
                Current Trend
              </div>
              <div
                className={`mt-1 text-xl font-bold ${latestDelta >= 0 ? "text-success" : "text-warning"}`}
              >
                {latestBucket
                  ? `${latestBucket.count.toLocaleString()} (${latestDelta >= 0 ? "+" : ""}${latestDelta.toLocaleString()})`
                  : "N/A"}
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="card bg-base-200 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">
            Traffic Pattern (Calls / Hour - Last 24h)
          </h2>
          {chartLoading ? (
            <div className="flex justify-center p-4">
              <span className="loading loading-spinner loading-sm" />
            </div>
          ) : chart && chart.buckets.length > 0 ? (
            <Sparkline buckets={chart.buckets} hour12={hour12} />
          ) : (
            <p className="text-sm text-admin-dim2">No data available</p>
          )}
        </div>
      </div>

      <div className="card bg-base-200 shadow">
        <div className="card-body">
          <h2 className="card-title text-base">
            Top 10 Busiest Talkgroups (Last 24h)
          </h2>
          {topLoading ? (
            <div className="flex justify-center p-4">
              <span className="loading loading-spinner loading-sm" />
            </div>
          ) : topTG && topTG.talkgroups.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Talkgroup</th>
                    <th>Name</th>
                    <th>System</th>
                    <th>Channel Load</th>
                    <th className="text-right">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {topTG.talkgroups.map((tg, i) => (
                    <tr key={tg.talkgroupId}>
                      <td className="text-admin-dim2">{i + 1}</td>
                      <td className="font-semibold">{tg.talkgroupLabel}</td>
                      <td
                        className="text-base-content-dim max-w-40 truncate"
                        title={tg.talkgroupName || undefined}
                      >
                        {tg.talkgroupName || "—"}
                      </td>
                      <td className="text-base-content-dim">{tg.systemLabel}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <progress
                            className="progress progress-primary h-2 w-28"
                            value={
                              topTalkgroupCount > 0
                                ? Math.round(
                                    (tg.callCount / topTalkgroupCount) * 100,
                                  )
                                : 0
                            }
                            max={100}
                          />
                          <span className="text-xs text-base-content-dim">
                            {topTalkgroupCount > 0
                              ? `${Math.round((tg.callCount / topTalkgroupCount) * 100)}%`
                              : "0%"}
                          </span>
                        </div>
                      </td>
                      <td className="text-right font-mono">
                        {tg.callCount.toLocaleString()} (
                        {formatCompact(tg.callCount)})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-admin-dim2">No data available</p>
          )}
        </div>
      </div>
    </div>
  );
}
