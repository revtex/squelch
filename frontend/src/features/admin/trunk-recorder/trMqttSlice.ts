// Redux slice that consumes `tr.*` admin WebSocket events and surfaces a
// per-instance live view for the Trunk Recorder dashboards.
//
// The reducer is the single entry point for every WS topic — components
// never parse frames directly. A REST snapshot fetch (via trMqttApi) can
// hydrate `snapshots` independently when a panel mounts.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  InstanceConnectionState,
  MessageEntry,
  PluginStatusInfo,
  RateSample,
  RecentCallEntry,
  SnapshotView,
  SystemRateInfo,
  TrEventEnvelope,
  UnitEventEntry,
} from "./types";

// Caps mirror the plan: rolling windows are bounded so memory stays flat
// even on a busy P25 system.
const RATE_CAP = 300; // ~5 min at 1 Hz
const UNIT_EVENT_CAP = 200;
const MESSAGE_CAP = 500;
const RECENT_CALL_CAP = 100;

export interface TrMqttState {
  instances: Record<number, InstanceConnectionState>;
  snapshots: Record<number, SnapshotView>;
  rates: Record<number, RateSample[]>;
  /** Latest decode rate per `sys_name` keyed off the most recent rates frame. */
  systemRates: Record<number, Record<string, SystemRateInfo>>;
  recorders: Record<number, unknown>;
  callsActive: Record<number, unknown>;
  systems: Record<number, unknown>;
  config: Record<number, unknown>;
  pluginStatus: Record<number, PluginStatusInfo>;
  unitEvents: Record<number, UnitEventEntry[]>;
  recentCalls: Record<number, RecentCallEntry[]>;
  trunkingMessages: Record<number, MessageEntry[]>;
  /** Unix millis of the last `tr.warn.lag` event for each instance. */
  lagWarning: Record<number, number>;
}

const initialState: TrMqttState = {
  instances: {},
  snapshots: {},
  rates: {},
  systemRates: {},
  recorders: {},
  callsActive: {},
  systems: {},
  config: {},
  pluginStatus: {},
  unitEvents: {},
  recentCalls: {},
  trunkingMessages: {},
  lagWarning: {},
};

function pushCapped<T>(arr: T[] | undefined, item: T, cap: number): T[] {
  const next = arr ? [...arr, item] : [item];
  if (next.length > cap) {
    return next.slice(next.length - cap);
  }
  return next;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function normalizeEventAt(at: number | undefined): number {
  if (typeof at !== "number" || !Number.isFinite(at)) return Date.now();
  // Admin WS `at` is emitted as Unix seconds. Convert plausible epoch-second
  // values to milliseconds; leave small synthetic test numbers untouched.
  if (at >= 100_000_000 && at < 10_000_000_000) return at * 1000;
  return at;
}

/**
 * Plugin LWT delivers a one-shot `disconnected` frame and the explicit
 * `connected` is only published on plugin start, so a reconnected plugin
 * can leave us with a stale "disconnected" badge. Any data frame proves
 * the plugin is alive — refresh the badge accordingly.
 */
function refreshPluginAlive(state: TrMqttState, id: number, now: number): void {
  const cur = state.pluginStatus[id];
  if (cur && cur.status === "connected") return;
  state.pluginStatus[id] = {
    status: "connected",
    clientId: cur?.clientId,
    instanceId: cur?.instanceId,
    at: now,
  };
}

function aggregateRate(payload: unknown): number {
  // TR `rates` payload is `{rates: [{...}]}` or similar — sum any numeric
  // `decoderate` / `rate` field present, gracefully fall back to 0.
  const rec = asRecord(payload);
  if (!rec) return 0;
  const rates = rec.rates;
  if (!Array.isArray(rates)) {
    const r = rec.rate;
    return typeof r === "number" ? r : 0;
  }
  let total = 0;
  for (const r of rates) {
    const sub = asRecord(r);
    if (!sub) continue;
    const v = sub.decoderate ?? sub.rate;
    if (typeof v === "number") total += v;
  }
  return total;
}

function extractSystemRates(
  payload: unknown,
  at: number,
): Record<string, SystemRateInfo> {
  const rec = asRecord(payload);
  const arr = Array.isArray(rec?.rates) ? rec.rates : [];
  const out: Record<string, SystemRateInfo> = {};
  for (const item of arr) {
    const sub = asRecord(item);
    if (!sub) continue;
    const sysName = asString(sub.sys_name) ?? asString(sub.sys_num);
    if (!sysName) continue;
    out[sysName] = {
      sysNum: asNumber(sub.sys_num),
      sysName,
      decoderate: asNumber(sub.decoderate) ?? asNumber(sub.rate) ?? 0,
      decoderateInterval: asNumber(sub.decoderate_interval),
      controlChannel: asNumber(sub.control_channel),
      at,
    };
  }
  return out;
}

function extractCall(
  rec: Record<string, unknown> | null,
  at: number,
  kind: "start" | "end",
  raw: unknown,
): RecentCallEntry {
  return {
    at,
    kind,
    callId: asString(rec?.id),
    callNum: asString(rec?.call_num),
    sysName: asString(rec?.sys_name) ?? asString(rec?.short_name),
    sysNum: asNumber(rec?.sys_num),
    freq: asNumber(rec?.freq),
    unit: asString(rec?.unit),
    unitAlpha: asString(rec?.unit_alpha_tag),
    talkgroup: asString(rec?.talkgroup),
    talkgroupAlpha: asString(rec?.talkgroup_alpha_tag),
    talkgroupGroup: asString(rec?.talkgroup_group),
    talkgroupTag: asString(rec?.talkgroup_tag),
    talkgroupDescription: asString(rec?.talkgroup_description),
    encrypted: asBool(rec?.encrypted),
    emergency: asBool(rec?.emergency),
    conventional: asBool(rec?.conventional),
    callState: asString(rec?.call_state_type),
    monState: asString(rec?.mon_state_type),
    recState: asString(rec?.rec_state_type),
    audioType: asString(rec?.audio_type),
    length: asNumber(rec?.length),
    startTime: asNumber(rec?.start_time),
    stopTime: asNumber(rec?.stop_time),
    callFilename: asString(rec?.call_filename),
    raw,
  };
}

function unitKindFromTopic(topic: string): string {
  // "tr.unit.on" → "on"
  const last = topic.split(".").pop();
  return last ?? topic;
}

function parseTime(v: unknown): number {
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  if (typeof v === "number") return normalizeEventAt(v);
  return Date.now();
}

/**
 * Fills the live views from the server's snapshot, but only where nothing
 * live has arrived yet: a page opened mid-stream catches up without
 * clobbering frames it has already seen.
 */
function hydrateFromSnapshot(state: TrMqttState, id: number, snapshot: SnapshotView): void {
  const now = Date.now();
  if (state.recorders[id] === undefined && asArray(asRecord(snapshot.Recorders)?.recorders).length > 0) {
    state.recorders[id] = snapshot.Recorders;
  }
  if (state.callsActive[id] === undefined && asRecord(snapshot.CallsActive)?.calls !== undefined) {
    state.callsActive[id] = snapshot.CallsActive;
  }
  if (state.systems[id] === undefined && asArray(asRecord(snapshot.Systems)?.systems).length > 0) {
    state.systems[id] = snapshot.Systems;
  }
  if (state.config[id] === undefined && asRecord(snapshot.Config)?.config !== undefined) {
    state.config[id] = snapshot.Config;
  }
  const status = asString(asRecord(snapshot.PluginStatus)?.status);
  if (state.pluginStatus[id] === undefined && status) {
    state.pluginStatus[id] = { status, at: now };
  }
  {
    // Per-system samples, one per system per second: sum them by second,
    // then put the ones older than anything seen live in front of it. The
    // socket usually delivers a frame or two before the snapshot answers.
    const live = state.rates[id] ?? [];
    const firstLive = live.length > 0 ? live[0].at : Infinity;
    const bySecond = new Map<number, number>();
    for (const item of asArray(snapshot.RateSamples)) {
      const r = asRecord(item);
      const at = Math.floor(parseTime(r?.At) / 1000) * 1000;
      if (at >= firstLive - 500) continue;
      const rate = asNumber(r?.Rate) ?? 0;
      bySecond.set(at, (bySecond.get(at) ?? 0) + rate);
    }
    if (bySecond.size > 0) {
      const older = [...bySecond.entries()].sort((a, b) => a[0] - b[0]).map(([at, rate]) => ({ at, rate }));
      state.rates[id] = [...older, ...live].slice(-RATE_CAP);
    }
    if (Object.keys(state.systemRates[id] ?? {}).length === 0 && asArray(asRecord(snapshot.Rates)?.rates).length > 0) {
      state.systemRates[id] = extractSystemRates(snapshot.Rates, now);
    }
  }
  if ((state.unitEvents[id] ?? []).length === 0) {
    const entries: UnitEventEntry[] = [];
    for (const item of asArray(snapshot.UnitEvents)) {
      const e = asRecord(item);
      const f = asRecord(e?.Frame);
      if (!f) continue;
      const kind = asString(f.kind) ?? "event";
      entries.push({
        at: parseTime(e?.ReceivedAt),
        topic: `tr.unit.${kind}`,
        kind,
        shortname: asString(f.sys_name ?? f.shortname),
        unitId: asString(f.unit ?? f.unit_id),
        unitAlpha: asString(f.unit_alpha_tag),
        talkgroupId: asString(f.talkgroup),
        talkgroupAlpha: asString(f.talkgroup_alpha_tag),
        talkgroupGroup: asString(f.talkgroup_group),
        talkgroupTag: asString(f.talkgroup_tag),
        talkgroupPatches: asString(f.talkgroup_patches),
        freq: asNumber(f.freq),
        callNum: asString(f.call_num),
        encrypted: asBool(f.encrypted),
        raw: f,
      });
    }
    if (entries.length > 0) state.unitEvents[id] = entries.slice(-UNIT_EVENT_CAP);
  }
  if ((state.trunkingMessages[id] ?? []).length === 0) {
    const entries: MessageEntry[] = [];
    for (const item of asArray(snapshot.Messages)) {
      const e = asRecord(item);
      const f = asRecord(e?.Frame);
      const msg = asRecord(f?.message) ?? f;
      if (!msg) continue;
      entries.push({
        at: parseTime(e?.ReceivedAt),
        topic: "tr.message",
        type: asString(msg.trunk_msg_type ?? msg.message_type),
        trunkMsg: asString(msg.trunk_msg),
        opcode: asString(msg.opcode),
        opcodeType: asString(msg.opcode_type),
        opcodeDesc: asString(msg.opcode_desc),
        shortname: asString(msg.sys_name ?? msg.shortname),
        sysNum: asNumber(msg.sys_num),
        meta: asString(msg.meta),
        raw: f,
      });
    }
    if (entries.length > 0) state.trunkingMessages[id] = entries.slice(-MESSAGE_CAP);
  }
}

export interface ApplyTrEventArgs {
  topic: string;
  envelope: TrEventEnvelope;
  at?: number;
}

export const trMqttSlice = createSlice({
  name: "trMqtt",
  initialState,
  reducers: {
    /** Hydrate the snapshot for one instance from the REST endpoint. */
    setSnapshot: (
      state,
      action: PayloadAction<{ id: number; snapshot: SnapshotView }>,
    ) => {
      const { id, snapshot } = action.payload;
      state.snapshots[id] = snapshot;
      state.instances[id] = {
        connected: snapshot.Connection?.Connected ?? false,
        lastError: snapshot.Connection?.LastError || undefined,
        lastSeenAt: state.instances[id]?.lastSeenAt,
      };
      hydrateFromSnapshot(state, id, snapshot);
    },
    /** Drop all per-instance state (e.g. when an instance is deleted). */
    forgetInstance: (state, action: PayloadAction<number>) => {
      const id = action.payload;
      delete state.instances[id];
      delete state.snapshots[id];
      delete state.rates[id];
      delete state.systemRates[id];
      delete state.recorders[id];
      delete state.callsActive[id];
      delete state.systems[id];
      delete state.config[id];
      delete state.pluginStatus[id];
      delete state.unitEvents[id];
      delete state.recentCalls[id];
      delete state.trunkingMessages[id];
      delete state.lagWarning[id];
    },
    /** Single entry point for every `tr.*` admin WS event. */
    applyTrEvent: (state, action: PayloadAction<ApplyTrEventArgs>) => {
      const { topic, envelope, at: ts } = action.payload;
      const id = envelope.instanceId;
      const now = normalizeEventAt(ts);
      const conn: InstanceConnectionState = state.instances[id] ?? {
        connected: false,
      };

      // Any *known* data-bearing frame is proof the plugin is publishing.
      // Use it to keep the plugin badge honest when the explicit
      // `tr.pluginStatus` LWT goes stale (the LWT only re-publishes on
      // plugin restart, so a flapping broker can leave us showing
      // "disconnected" forever otherwise).
      const isDataTopic =
        topic === "tr.rates" ||
        topic === "tr.recorders" ||
        topic === "tr.callsActive" ||
        topic === "tr.callStart" ||
        topic === "tr.callEnd" ||
        topic === "tr.systems" ||
        topic === "tr.system" ||
        topic === "tr.config" ||
        topic === "tr.message" ||
        topic.startsWith("tr.unit.");
      if (isDataTopic) refreshPluginAlive(state, id, now);

      switch (topic) {
        case "tr.instance.connected":
          state.instances[id] = {
            connected: true,
            lastError: undefined,
            lastSeenAt: now,
          };
          // Clear stale plugin status — the broker will re-deliver the
          // retained `tr.pluginStatus` topic after re-subscription, so any
          // value we held is no longer trustworthy.
          delete state.pluginStatus[id];
          return;
        case "tr.instance.disconnected":
          state.instances[id] = {
            connected: false,
            lastError: envelope.error || conn.lastError,
            lastSeenAt: conn.lastSeenAt,
          };
          // We can't observe the plugin while disconnected from the broker;
          // hide stale status until the next pluginStatus frame arrives.
          delete state.pluginStatus[id];
          return;
        case "tr.warn.lag":
          state.lagWarning[id] = now;
          return;
        case "tr.snapshot": {
          const snap = envelope.payload as SnapshotView | undefined;
          if (snap) state.snapshots[id] = snap;
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        }
        case "tr.rates": {
          state.rates[id] = pushCapped(
            state.rates[id],
            { at: now, rate: aggregateRate(envelope.payload) },
            RATE_CAP,
          );
          state.systemRates[id] = extractSystemRates(envelope.payload, now);
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        }
        case "tr.recorders":
          state.recorders[id] = envelope.payload;
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        case "tr.callsActive":
          state.callsActive[id] = envelope.payload;
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        case "tr.callStart":
        case "tr.callEnd": {
          // Plugin envelope: { type, call:{...}, timestamp, instance_id }
          const env = asRecord(envelope.payload);
          const call = asRecord(env?.call) ?? env;
          state.recentCalls[id] = pushCapped(
            state.recentCalls[id],
            extractCall(
              call,
              now,
              topic === "tr.callStart" ? "start" : "end",
              envelope.payload,
            ),
            RECENT_CALL_CAP,
          );
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        }
        case "tr.systems":
        case "tr.system":
          state.systems[id] = envelope.payload;
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        case "tr.config":
          state.config[id] = envelope.payload;
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        case "tr.pluginStatus": {
          const env = asRecord(envelope.payload);
          state.pluginStatus[id] = {
            status: asString(env?.status) ?? "unknown",
            clientId: asString(env?.client_id),
            instanceId: asString(env?.instance_id),
            at: now,
          };
          state.instances[id] = { ...conn, lastSeenAt: now };
          return;
        }
        case "tr.message": {
          // TR plugin envelope: { type, message:{ sys_num, sys_name,
          // trunk_msg, trunk_msg_type, opcode, opcode_type, opcode_desc,
          // meta }, timestamp, instance_id }
          const env = asRecord(envelope.payload);
          const msg = asRecord(env?.message) ?? env;
          state.trunkingMessages[id] = pushCapped(
            state.trunkingMessages[id],
            {
              at: now,
              topic,
              type: asString(msg?.trunk_msg_type ?? msg?.message_type),
              trunkMsg: asString(msg?.trunk_msg),
              opcode: asString(msg?.opcode),
              opcodeType: asString(msg?.opcode_type),
              opcodeDesc: asString(msg?.opcode_desc),
              shortname: asString(msg?.sys_name ?? msg?.shortname),
              sysNum: asNumber(msg?.sys_num),
              meta: asString(msg?.meta),
              raw: envelope.payload,
            },
            MESSAGE_CAP,
          );
          state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
          return;
        }
        default:
          break;
      }

      if (topic.startsWith("tr.unit.")) {
        const rec = asRecord(envelope.payload);
        // Backend flattens TR plugin's nested `{type, <kind>:{body}, ...}`
        // envelope into UnitFrame top-level fields with the plugin's own
        // names (sys_name, unit, unit_alpha_tag, talkgroup). Older shorthand
        // names (shortname, unit_id) are accepted as fallbacks.
        state.unitEvents[id] = pushCapped(
          state.unitEvents[id],
          {
            at: now,
            topic,
            kind: unitKindFromTopic(topic),
            shortname: asString(rec?.sys_name ?? rec?.shortname),
            unitId: asString(rec?.unit ?? rec?.unit_id),
            unitAlpha: asString(rec?.unit_alpha_tag ?? rec?.unit_alpha),
            talkgroupId: asString(rec?.talkgroup),
            talkgroupAlpha: asString(rec?.talkgroup_alpha_tag),
            talkgroupGroup: asString(rec?.talkgroup_group),
            talkgroupTag: asString(rec?.talkgroup_tag),
            talkgroupDescription: asString(rec?.talkgroup_description),
            talkgroupPatches: asString(rec?.talkgroup_patches),
            freq: asNumber(rec?.freq),
            callNum: asString(rec?.call_num),
            encrypted: asBool(rec?.encrypted),
            raw: envelope.payload,
          },
          UNIT_EVENT_CAP,
        );
        state.instances[id] = { ...conn, connected: true, lastSeenAt: now };
      }
      // Unknown tr.* topics are silently ignored (forward-compatible).
    },
  },
});

export const { applyTrEvent, setSnapshot, forgetInstance } =
  trMqttSlice.actions;
export default trMqttSlice.reducer;
