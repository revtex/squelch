// The recorder's own config, as the plugin published it on connect.
import { useMemo } from "react";
import { DataTable, FactList, type Column } from "@/features/admin/_shell";
import { fmtFreqMHz } from "./format";
import { configFacts, sourceRows, type SourceRow } from "./trunk";

export default function ConfigTab({ payload }: { payload: unknown }) {
  const facts = useMemo(() => configFacts(payload), [payload]);
  const sources = useMemo(() => sourceRows(payload), [payload]);
  if (!payload) {
    return <p className="text-sm text-base-content-dim">No config yet. The plugin publishes it once when it connects; reconnect the recorder to get it again.</p>;
  }
  const columns: Column<SourceRow>[] = [
    { id: "driver", header: "Driver", phone: "title", sortValue: (r) => r.driver, cell: (r) => r.driver ?? "—" },
    { id: "device", header: "Device", phone: "show", sortValue: (r) => r.device, cell: (r) => <span className="font-mono text-xs break-all">{r.device ?? "—"}</span> },
    { id: "center", header: "Center", phone: "show", sortValue: (r) => r.center, cell: (r) => <span className="font-mono text-xs">{fmtFreqMHz(r.center)}</span> },
    { id: "rate", header: "Sample rate", phone: "show", align: "right", sortValue: (r) => r.rate, cell: (r) => (r.rate != null ? `${(r.rate / 1e6).toFixed(2)} Msps` : "—") },
    { id: "gain", header: "Gain", phone: "show", sortValue: (r) => r.gain, cell: (r) => r.gain ?? "—" },
    { id: "ppm", header: "PPM", phone: "hide", sortValue: (r) => r.ppm, cell: (r) => r.ppm ?? "—" },
    { id: "digital", header: "Digital recorders", phone: "show", align: "right", sortValue: (r) => r.digital, cell: (r) => r.digital ?? "—" },
    { id: "analog", header: "Analog recorders", phone: "hide", align: "right", sortValue: (r) => r.analog, cell: (r) => r.analog ?? "—" },
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-box border border-admin-line bg-base-100 p-3">
        <h3 className="mb-2 text-sm font-semibold">Recorder settings</h3>
        {facts.length === 0 ? <p className="text-sm text-base-content-dim">The config frame has none of the usual settings.</p> : <FactList facts={facts} />}
      </section>
      <DataTable columns={columns} rows={sources} rowKey={(r) => r.key} caption="SDR sources" empty="No SDR sources in the config." />
      <details className="rounded-box border border-admin-line bg-base-100">
        <summary className="cursor-pointer p-3 text-sm font-semibold">Raw config</summary>
        <pre className="overflow-x-auto p-3 text-[11px]">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </div>
  );
}
