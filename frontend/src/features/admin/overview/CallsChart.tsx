// Calls over the chosen range as an area chart, drawn to one scale, with a
// text summary for assistive tech and the numbers in a hidden table.
import { formatDay, formatTime } from "@/features/admin/_shell";
import { niceTop, peakOf, type Series } from "./chart";

const W = 640;
const H = 220;
const L = 44;
const R = 12;
const T = 16;
const B = 24;

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function when(at: number, unit: Series["unit"], hour12: boolean): string {
  return unit === "day" ? formatDay(at) : `${formatDay(at)} ${formatTime(at, { hour12 })}`;
}

function tickLabel(at: number, unit: Series["unit"], spanDays: number, hour12: boolean): string {
  if (unit === "day") return formatDay(at).slice(5);
  if (spanDays > 1) return new Date(at * 1000).toLocaleDateString(undefined, { weekday: "short" });
  return formatTime(at, { hour12 });
}

export function CallsChart({ series, hour12, label }: { series: Series; hour12: boolean; label: string }) {
  const pts = series.points;
  if (pts.length < 2) {
    return <p className="text-sm text-base-content-dim">The chart fills in as calls arrive.</p>;
  }
  const top = niceTop(Math.max(...pts.map((p) => p.count)));
  const n = pts.length;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");
  const area = `M ${x(0)},${y(0)} L ${line.split(" ").join(" L ")} L ${x(n - 1)},${y(0)} Z`;
  const peak = peakOf(pts);
  const peakIndex = peak ? pts.indexOf(peak) : -1;
  const spanDays = (pts[n - 1].at - pts[0].at) / 86_400;

  // Ticks on round boundaries: every 6 h over a day, each midnight over a
  // week, each week over a month.
  const ticks = pts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => {
      const d = new Date(p.at * 1000);
      if (series.unit === "day") return (p.at - pts[0].at) % (7 * 86_400) < 3600;
      if (spanDays > 1) return d.getHours() === 0;
      return d.getHours() % 6 === 0;
    });

  const unitWord = series.unit === "day" ? "day" : "hour";
  const summary = peak
    ? `${label}. Peak ${peak.count.toLocaleString()} calls in the ${unitWord} of ${when(peak.at, series.unit, hour12)}.`
    : `${label}. No calls in this range.`;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={summary}>
        {[0, 1, 2, 3, 4].map((k) => {
          const v = (top / 4) * k;
          return (
            <g key={k}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={k === 0 ? 0.25 : 0.1} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                {compact.format(v)}
              </text>
            </g>
          );
        })}
        {ticks.map(({ p, i }) => (
          <text key={p.at} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
            {tickLabel(p.at, series.unit, spanDays, hour12)}
          </text>
        ))}
        <path d={area} fill="currentColor" fillOpacity={0.14} className="text-info" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" className="text-info" />
        {peak && (
          <g className="text-secondary">
            <circle cx={x(peakIndex)} cy={y(peak.count)} r={4} fill="currentColor" />
            <text
              x={Math.min(Math.max(x(peakIndex), L + 16), W - R - 16)}
              y={Math.max(y(peak.count) - 8, 11)}
              textAnchor="middle"
              fontSize={11}
              fill="currentColor"
            >
              {peak.count.toLocaleString()}
            </text>
          </g>
        )}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{series.unit === "day" ? "Day" : "Hour"}</th>
            <th scope="col">Calls</th>
          </tr>
        </thead>
        <tbody>
          {pts.map((p) => (
            <tr key={p.at}>
              <td>{when(p.at, series.unit, hour12)}</td>
              <td>{p.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
