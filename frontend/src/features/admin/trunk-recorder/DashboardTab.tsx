// The decode-rate chart for the last five minutes and one row per system.
import { useMemo } from "react";
import { DataTable, type Column } from "@/features/admin/_shell";
import { fmtFreqMHz } from "./format";
import { systemRows, type SystemRow } from "./trunk";
import type { RateSample, SystemRateInfo } from "./types";

function RateChart({ samples }: { samples: RateSample[] }) {
  const W = 600;
  const H = 120;
  const L = 36;
  const PAD = 6;
  if (samples.length < 2) {
    return <p className="text-sm text-base-content/60">The chart fills in as rate frames arrive, one a second.</p>;
  }
  const max = Math.max(1, ...samples.map((s) => s.rate));
  const top = Math.ceil(max / 10) * 10 || 10;
  const n = samples.length;
  const x = (i: number) => L + PAD + (i / (n - 1)) * (W - L - 2 * PAD);
  const y = (v: number) => PAD + (1 - v / top) * (H - 2 * PAD);
  const points = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.rate).toFixed(1)}`).join(" ");
  const ticks = [0, top / 2, top];
  const last = samples[n - 1].rate;
  const spanSec = Math.round((samples[n - 1].at - samples[0].at) / 1000);
  const summary = `Decode rate over the last ${spanSec} seconds: now ${last.toFixed(1)} messages a second, peak ${max.toFixed(1)}.`;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.15} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
              {t}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="currentColor" strokeWidth={1.5} points={points} className="text-primary" />
      </svg>
      <figcaption className="text-xs text-base-content/60">msgs / s · last 5 min · y-axis 0 to {top}</figcaption>
    </figure>
  );
}

export interface DashboardTabProps {
  samples: RateSample[];
  systemRates: Record<string, SystemRateInfo>;
  systems: unknown;
  config: unknown;
}

export default function DashboardTab({ samples, systemRates, systems, config }: DashboardTabProps) {
  const rows = useMemo(() => systemRows(systems, config, systemRates), [systems, config, systemRates]);
  const columns: Column<SystemRow>[] = [
    { id: "name", header: "System", phone: "title", sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "type", header: "Type", phone: "show", sortValue: (r) => r.type, cell: (r) => r.type ?? "—" },
    {
      id: "rate",
      header: "Decode rate",
      phone: "show",
      align: "right",
      sortValue: (r) => r.rate,
      cell: (r) => (r.rate != null ? <span className="tabular-nums">{r.rate.toFixed(1)} /s</span> : "—"),
    },
    { id: "cc", header: "Control channel", phone: "show", sortValue: (r) => r.controlChannel, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.controlChannel)}</span> },
    { id: "sysid", header: "SYSID", phone: "hide", sortValue: (r) => r.sysid, cell: (r) => <span className="font-mono text-xs">{r.sysid ?? "—"}</span> },
    { id: "wacn", header: "WACN", phone: "hide", sortValue: (r) => r.wacn, cell: (r) => <span className="font-mono text-xs">{r.wacn ?? "—"}</span> },
    { id: "nac", header: "NAC", phone: "hide", sortValue: (r) => r.nac, cell: (r) => <span className="font-mono text-xs">{r.nac ?? "—"}</span> },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-box border border-base-300 bg-base-100 p-3">
        <h3 className="mb-2 text-sm font-semibold">Decode rate</h3>
        <RateChart samples={samples} />
      </section>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        caption="Systems"
        defaultSort={{ id: "name", dir: "asc" }}
        empty="No systems yet. The recorder lists them when it connects."
      />
    </div>
  );
}
