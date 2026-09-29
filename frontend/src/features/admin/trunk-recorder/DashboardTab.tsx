// The decode-rate chart for the last five minutes and one row per system.
import { useMemo } from "react";
import { Card, DataTable, useElementWidth, type Column } from "@/features/admin/_shell";
import { fmtFreqMHz, fmtHexId } from "./format";
import { systemHealth, systemRows, type SystemRow } from "./trunk";
import type { RateSample, SystemRateInfo } from "./types";

function RateChart({ samples }: { samples: RateSample[] }) {
  // Drawn at the card's real width so the labels stay 11 px whether the
  // card is half the page or all of it.
  const [ref, measured] = useElementWidth<HTMLElement>();
  const W = measured > 0 ? measured : 600;
  const H = 150;
  const L = 36;
  const PAD = 6;
  if (samples.length < 2) {
    return (
      <figure ref={ref} className="m-0">
        <p className="text-sm text-base-content-dim">The chart fills in as rate frames arrive, one a second.</p>
      </figure>
    );
  }
  const max = Math.max(1, ...samples.map((s) => s.rate));
  const top = Math.ceil(max / 10) * 10 || 10;
  const n = samples.length;
  const x = (i: number) => L + PAD + (i / (n - 1)) * (W - L - 2 * PAD);
  const y = (v: number) => PAD + (1 - v / top) * (H - 2 * PAD - 16);
  const points = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.rate).toFixed(1)}`).join(" ");
  const ticks = [0, top / 2, top];
  const last = samples[n - 1].rate;
  const spanSec = Math.round((samples[n - 1].at - samples[0].at) / 1000);
  const summary = `Decode rate over the last ${spanSec} seconds: now ${last.toFixed(1)} messages a second, peak ${max.toFixed(1)}.`;
  return (
    <figure ref={ref} className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full"
        role="img"
        aria-label={summary}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
              {t}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} className="text-info" />
        <circle cx={x(n - 1)} cy={y(last)} r={3.5} fill="currentColor" className="text-secondary" />
        <text x={L + PAD} y={H - 2} fontSize={11} fill="currentColor" fillOpacity={0.6}>
          −{Math.max(1, Math.round(spanSec / 60))} min
        </text>
        <text x={W - PAD} y={H - 2} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
          now
        </text>
      </svg>
    </figure>
  );
}

export interface DashboardTabProps {
  samples: RateSample[];
  systemRates: Record<string, SystemRateInfo>;
  systems: unknown;
  config: unknown;
  /** The broker connection is up; without it no rate is current. */
  connected: boolean;
  now: number;
}

export default function DashboardTab({ samples, systemRates, systems, config, connected, now }: DashboardTabProps) {
  const rows = useMemo(() => systemRows(systems, config, systemRates), [systems, config, systemRates]);
  const columns: Column<SystemRow>[] = [
    {
      id: "name",
      header: "System",
      phone: "title",
      sortValue: (r) => r.name,
      cell: (r) => {
        // One line of identifiers that never wraps, so each row stays two
        // lines and the other columns keep their width.
        const ids = [
          r.type?.toUpperCase(),
          r.sysid && `sysid ${fmtHexId(r.sysid)}`,
          r.wacn && `wacn ${fmtHexId(r.wacn)}`,
          r.nac && `nac ${fmtHexId(r.nac)}`,
        ].filter(Boolean);
        return (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-medium">{r.name}</span>
            {ids.length > 0 && (
              <span className="whitespace-nowrap font-mono text-xs text-base-content-dim">{ids.join(" · ")}</span>
            )}
          </span>
        );
      },
    },
    {
      id: "rate",
      header: "Rate",
      phone: "show",
      sortValue: (r) => r.rate,
      cell: (r) => (r.rate != null ? <span className="whitespace-nowrap tabular-nums">{r.rate.toFixed(1)} /s</span> : "—"),
    },
    {
      id: "cc",
      header: "Control channel",
      phone: "show",
      sortValue: (r) => r.controlChannel,
      cell: (r) => <span className="whitespace-nowrap font-mono text-[13px]">{fmtFreqMHz(r.controlChannel)}</span>,
    },
    {
      id: "health",
      header: "Health",
      phone: "show",
      sortValue: (r) => systemHealth(r, connected, now).label,
      cell: (r) => {
        const h = systemHealth(r, connected, now);
        return <span className={`badge ${h.badge}`}>{h.label}</span>;
      },
    },
  ];
  // Side by side only when the Per system table fits its half without
  // scrolling; a narrower page stacks the two cards.
  return (
    <div className="@container">
      <div className="grid items-start gap-[18px] @min-[1200px]:grid-cols-2">
        <Card title="Decode rate · last 5 min" meta={<span className="text-xs text-base-content-dim">msgs / s</span>}>
          <RateChart samples={samples} />
        </Card>
        <Card title="Per system" bodyClassName="[&_:is(th,td)]:px-2.5">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            caption="Systems"
            defaultSort={{ id: "name", dir: "asc" }}
            empty="No systems yet. The recorder lists them when it connects."
            bare
          />
        </Card>
      </div>
    </div>
  );
}
