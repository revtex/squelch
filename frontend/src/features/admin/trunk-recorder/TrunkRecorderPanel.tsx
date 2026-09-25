// The Trunk Recorder page: one recorder at a time, chosen in the header and
// kept in the URL, with a connection banner, four tiles and the live tabs.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Settings2 } from "lucide-react";
import { PageHeader, plural, useDetails } from "@/features/admin/_shell";
import { useAppDispatch } from "@/app/store";
import CallsTab from "./CallsTab";
import ConfigTab from "./ConfigTab";
import DashboardTab from "./DashboardTab";
import InstancePanel from "./InstancePanel";
import MessagesTab from "./MessagesTab";
import RecordersTab from "./RecordersTab";
import UnitsTab from "./UnitsTab";
import { useGetTrSnapshotQuery, useListTrInstancesQuery } from "./trMqttApi";
import { setSnapshot } from "./trMqttSlice";
import { useTrMqttState } from "./useTrMqtt";
import {
  STATE_LABEL,
  activeCallRows,
  formatFrameAge,
  instanceState,
  isRecording,
  pickInstance,
  pluginVersion,
  rateWindow,
  recorderRows,
  systemRows,
  tabFrom,
  type Tab,
} from "./trunk";
import type { TrInstance } from "./types";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "calls", label: "Calls" },
  { id: "recorders", label: "Recorders" },
  { id: "units", label: "Units" },
  { id: "messages", label: "Messages" },
  { id: "config", label: "Config" },
];

type Panel = { kind: "create" } | { kind: "edit" };

const SETTINGS_LINK = "/admin/settings?q=Trunk%20Recorder#settings-integrations";

function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-box border border-base-300 bg-base-100 p-3">
      <p className="text-xs text-base-content/60">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="truncate text-xs text-base-content/60">{detail}</p>}
    </div>
  );
}

/** Ticks once a second so "last frame 3 s ago" stays honest. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

function idParam(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function TrunkRecorderPanel() {
  const [search, setSearch] = useSearchParams();
  const dispatch = useAppDispatch();
  const { data: instances = [], error, isLoading } = useListTrInstancesQuery();
  const live = useTrMqttState();
  const panel = useDetails<Panel>();
  const now = useNow();

  const tab = tabFrom(search.get("tab"));
  const callsView = search.get("calls") === "recent" ? "recent" : "active";
  const selected = pickInstance(instances, idParam(search.get("instance")));
  const id = selected?.id ?? 0;

  // Catch up with what the server already holds; live frames keep it fresh.
  const snapshot = useGetTrSnapshotQuery(id, { skip: !selected });
  useEffect(() => {
    if (snapshot.data && id) dispatch(setSnapshot({ id, snapshot: snapshot.data }));
  }, [snapshot.data, id, dispatch]);

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(search);
    if (value == null) params.delete(key);
    else params.set(key, value);
    setSearch(params, { replace: true });
  };

  const selectInstance = (next: number) => {
    const params = new URLSearchParams(search);
    params.set("instance", String(next));
    setSearch(params);
  };

  const conn = selected ? live.instances[id] : undefined;
  const state = selected ? instanceState(selected, conn) : "disabled";
  const samples = live.rates[id] ?? [];
  const liveSystemRates = live.systemRates[id];
  const systemRates = useMemo(() => liveSystemRates ?? {}, [liveSystemRates]);
  const systems = useMemo(() => systemRows(live.systems[id], live.config[id], systemRates), [live.systems, live.config, id, systemRates]);
  const recorders = useMemo(() => recorderRows(live.recorders[id]), [live.recorders, id]);
  const calls = useMemo(() => activeCallRows(live.callsActive[id]), [live.callsActive, id]);
  const rate = rateWindow(samples);
  const plugin = live.pluginStatus[id];
  const version = pluginVersion(live.config[id], plugin);
  const lagging = live.lagWarning[id] != null && now - live.lagWarning[id] < 5000;

  const bannerParts: string[] = [];
  if (selected) {
    bannerParts.push(`broker ${selected.brokerUrl}`);
    bannerParts.push(STATE_LABEL[state]);
    if (state === "connected") {
      bannerParts.push(plugin ? `plugin ${plugin.status}${version ? ` ${version}` : ""}` : "plugin status not seen yet");
      bannerParts.push(`last frame ${formatFrameAge(conn?.lastSeenAt, now)}`);
    } else if (state === "error" && conn?.lastError) {
      bannerParts.push(conn.lastError);
    } else if (state === "disabled") {
      bannerParts.push("turn it on under Instance settings");
    }
    if (lagging) bannerParts.push("frames arriving faster than they can be shown");
  }

  const featureOff = !!error && (error as { status?: number }).status === 404;

  const closePanel = () => panel.close();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trunk Recorder"
        subtitle="Live telemetry from your recorders over MQTT: decode rates, active calls, recorders and control-channel health."
        actions={
          !featureOff && (
            <>
              {instances.length > 0 && (
                <select
                  aria-label="Instance"
                  className="select select-sm"
                  value={id}
                  onChange={(e) => selectInstance(Number(e.target.value))}
                >
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label} · {STATE_LABEL[instanceState(i, live.instances[i.id])]}
                    </option>
                  ))}
                </select>
              )}
              <button type="button" className="btn btn-primary btn-sm" onClick={(e) => panel.open({ kind: "create" }, e.currentTarget)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add instance
              </button>
            </>
          )
        }
      />

      {featureOff ? (
        <div role="alert" className="alert">
          <span>
            Trunk Recorder MQTT is off. Turn it on under{" "}
            <Link to={SETTINGS_LINK} className="link">
              Settings → Integrations
            </Link>{" "}
            to configure brokers here.
          </span>
        </div>
      ) : error ? (
        <div role="alert" className="alert alert-error">
          <span>The recorder list could not be loaded.</span>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-base-content/60">Loading…</p>
      ) : !selected ? (
        <div className="rounded-box border border-dashed border-base-300 p-6 text-center">
          <p className="font-medium">No recorders yet</p>
          <p className="mt-1 text-sm text-base-content/60">Add a trunk-recorder that runs the MQTT status plugin to see its decode rate, recorders and calls here.</p>
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={(e) => panel.open({ kind: "create" }, e.currentTarget)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add instance
          </button>
        </div>
      ) : (
        <>
          <div
            role="status"
            aria-label="Recorder connection"
            className={`flex flex-wrap items-center gap-3 rounded-box border px-3 py-2 text-sm ${
              state === "connected" ? "border-success/30 bg-success/10" : state === "disabled" ? "border-base-300 bg-base-200" : "border-warning/40 bg-warning/10"
            }`}
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${state === "connected" ? "bg-success" : state === "disabled" ? "bg-base-content/30" : "bg-warning"}`}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{selected.label}</span> · {bannerParts.join(" · ")}
            </span>
            <button type="button" className="btn btn-xs" onClick={(e) => panel.open({ kind: "edit" }, e.currentTarget)}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              Instance settings
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Systems" value={String(systems.length)} detail={systems.length ? systems.map((s) => s.name).join(" · ") : "none reported yet"} />
            <Tile
              label="Recorders"
              value={`${recorders.filter((r) => isRecording(r.state)).length} / ${recorders.length}`}
              detail="recording / total"
            />
            <Tile
              label="Active calls"
              value={String(calls.length)}
              detail={calls.length ? `${calls.filter((c) => c.encrypted).length} encrypted` : "nothing in progress"}
            />
            <Tile
              label="Decode rate"
              value={rate ? `${rate.last.toFixed(1)}` : "—"}
              detail={rate ? `msgs / s · min ${rate.min.toFixed(0)} · max ${rate.max.toFixed(0)}` : "no rate frames yet"}
            />
          </div>

          <div role="tablist" aria-label="Recorder views" className="tabs tabs-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                className={`tab ${t.id === tab ? "tab-active" : ""}`}
                onClick={() => setParam("tab", t.id === "dashboard" ? null : t.id)}
              >
                {t.label}
                {t.id === "calls" && calls.length > 0 && <span className="badge badge-ghost badge-sm ml-2">{calls.length}</span>}
              </button>
            ))}
          </div>

          {tab === "dashboard" && <DashboardTab samples={samples} systemRates={systemRates} systems={live.systems[id]} config={live.config[id]} />}
          {tab === "calls" && (
            <CallsTab
              instance={selected}
              active={live.callsActive[id]}
              recent={live.recentCalls[id] ?? []}
              view={callsView}
              onView={(v) => setParam("calls", v === "active" ? null : v)}
            />
          )}
          {tab === "recorders" && <RecordersTab instance={selected} payload={live.recorders[id]} />}
          {tab === "units" && <UnitsTab events={live.unitEvents[id] ?? []} />}
          {tab === "messages" && <MessagesTab messages={live.trunkingMessages[id] ?? []} />}
          {tab === "config" && <ConfigTab payload={live.config[id]} />}
          {instances.length > 1 && (
            <p className="text-xs text-base-content/60">{plural(instances.length, "instance")} configured; switch with the selector above.</p>
          )}
        </>
      )}

      {panel.selected?.kind === "create" && (
        <InstancePanel
          onClose={closePanel}
          onSaved={(inst: TrInstance) => {
            closePanel();
            selectInstance(inst.id);
          }}
          onDeleted={closePanel}
        />
      )}
      {panel.selected?.kind === "edit" && selected && (
        <InstancePanel
          instance={selected}
          state={state}
          onClose={closePanel}
          onSaved={closePanel}
          onDeleted={() => {
            closePanel();
            setParam("instance", null);
          }}
        />
      )}
    </div>
  );
}
