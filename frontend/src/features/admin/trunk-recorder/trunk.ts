// Pure helpers for the Trunk Recorder page: reading the plugin's loose JSON
// frames into typed rows, the page's tabs, and CSV export.
import type { Column } from "@/features/admin/_shell";
import { asArray, asRecord, fmtFreqMHz } from "./format";
import type {
  InstanceConnectionState,
  MessageEntry,
  PluginStatusInfo,
  RateSample,
  SystemRateInfo,
  TrInstance,
} from "./types";

export type Tab = "dashboard" | "calls" | "recorders" | "units" | "messages" | "config";

const TABS: Tab[] = ["dashboard", "calls", "recorders", "units", "messages", "config"];

export function tabFrom(value: string | null): Tab {
  return TABS.includes(value as Tab) ? (value as Tab) : "dashboard";
}

export type InstanceState = "connected" | "disconnected" | "error" | "disabled";

/** The instance's state from the live socket when it has spoken, else the row. */
export function instanceState(inst: TrInstance, live: InstanceConnectionState | undefined): InstanceState {
  if (!inst.enabled) return "disabled";
  if (live?.connected) return "connected";
  if (live?.lastError) return "error";
  if (live === undefined) {
    if (inst.status === "connected" || inst.status === "error" || inst.status === "disconnected") return inst.status;
  }
  return "disconnected";
}

export const STATE_LABEL: Record<InstanceState, string> = {
  connected: "connected",
  disconnected: "not connected",
  error: "connection failed",
  disabled: "off",
};

/** Picks the instance to show: the URL's, else the first that is talking. */
export function pickInstance(instances: TrInstance[], wanted: number | null): TrInstance | null {
  if (instances.length === 0) return null;
  if (wanted != null) {
    const hit = instances.find((i) => i.id === wanted);
    if (hit) return hit;
  }
  return instances.find((i) => i.enabled && i.status === "connected") ?? instances.find((i) => i.enabled) ?? instances[0];
}

// ── Frames → rows ────────────────────────────────────────────────────────

export interface ActiveCallRow {
  key: string;
  callNum?: string;
  sysName?: string;
  freq?: number;
  unit?: string;
  unitAlpha?: string;
  talkgroup?: string;
  talkgroupAlpha?: string;
  talkgroupGroup?: string;
  talkgroupTag?: string;
  encrypted: boolean;
  emergency: boolean;
  callState?: string;
  recState?: string;
  startTime?: number;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function activeCallRows(payload: unknown): ActiveCallRow[] {
  const rec = asRecord(payload);
  return asArray(rec?.calls ?? rec?.callsActive).map((it, idx) => {
    const c = asRecord(it) ?? {};
    return {
      key: String(c.call_num ?? c.id ?? idx),
      callNum: str(c.call_num),
      sysName: str(c.sys_name) ?? str(c.short_name),
      freq: num(c.freq),
      unit: str(c.unit),
      unitAlpha: str(c.unit_alpha_tag),
      talkgroup: str(c.talkgroup),
      talkgroupAlpha: str(c.talkgroup_alpha_tag),
      talkgroupGroup: str(c.talkgroup_group),
      talkgroupTag: str(c.talkgroup_tag),
      encrypted: c.encrypted === true,
      emergency: c.emergency === true,
      callState: str(c.call_state_type),
      recState: str(c.rec_state_type),
      startTime: num(c.start_time),
    };
  });
}

export interface RecorderRow {
  id: string;
  source?: string;
  recNum?: string;
  type?: string;
  state: string;
  freq?: number;
  duration?: number;
  calls?: number;
  squelched?: string;
}

export function recorderRows(payload: unknown): RecorderRow[] {
  return asArray(asRecord(payload)?.recorders).map((it, idx) => {
    const r = asRecord(it) ?? {};
    return {
      id: str(r.id) ?? str(r.rec_num) ?? String(idx),
      source: str(r.src_num),
      recNum: str(r.rec_num),
      type: str(r.type),
      state: (str(r.rec_state_type) ?? "unknown").toLowerCase(),
      freq: num(r.freq),
      duration: num(r.duration),
      calls: num(r.count),
      squelched: str(r.squelched),
    };
  });
}

/** Recorder states that mean it is busy with a call. */
export function isRecording(state: string): boolean {
  return state === "active" || state === "recording";
}

export const RECORDER_STATE_TONE: Record<string, string> = {
  idle: "badge-ghost",
  available: "badge-ghost",
  active: "badge-success",
  recording: "badge-success",
  stopped: "badge-warning",
  ignore: "badge-ghost",
  error: "badge-error",
};

export interface SystemRow {
  key: string;
  sysNum?: string;
  name: string;
  type?: string;
  sysid?: string;
  wacn?: string;
  nac?: string;
  controlChannel?: number;
  rate?: number;
  rateInterval?: number;
  /** When the last rate frame for this system arrived (ms). */
  rateAt?: number;
}

/** Systems from the systems frame (or the config's list) with each one's decode rate. */
export function systemRows(systems: unknown, config: unknown, rates: Record<string, SystemRateInfo>): SystemRow[] {
  const sysRec = asRecord(systems);
  const items = asArray(sysRec?.systems).length > 0 ? asArray(sysRec?.systems) : asArray(unwrapConfig(config).systems);
  const rows: SystemRow[] = items.map((it, idx) => {
    const r = asRecord(it) ?? {};
    const name = str(r.sys_name) ?? str(r.short_name) ?? `system ${idx + 1}`;
    const rate = rates[name] ?? rates[str(r.sys_num) ?? ""];
    return {
      key: str(r.sys_num) ?? name,
      sysNum: str(r.sys_num),
      name,
      type: str(r.system_type) ?? str(r.type),
      sysid: str(r.sysid),
      wacn: str(r.wacn),
      nac: str(r.nac),
      controlChannel: num(r.control_channel) ?? rate?.controlChannel,
      rate: rate?.decoderate,
      rateInterval: rate?.decoderateInterval,
      rateAt: rate?.at,
    };
  });
  // A rates frame can name a system the systems frame has not listed yet.
  for (const r of Object.values(rates)) {
    if (!rows.some((row) => row.name === r.sysName)) {
      rows.push({
        key: r.sysName,
        sysNum: r.sysNum != null ? String(r.sysNum) : undefined,
        name: r.sysName,
        controlChannel: r.controlChannel,
        rate: r.decoderate,
        rateInterval: r.decoderateInterval,
        rateAt: r.at,
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** The plugin wraps everything under `config`: `{type, config:{sources, systems, …}}`. */
export function unwrapConfig(payload: unknown): Record<string, unknown> {
  const top = asRecord(payload);
  return asRecord(top?.config) ?? top ?? {};
}

export interface SourceRow {
  key: string;
  driver?: string;
  device?: string;
  center?: number;
  rate?: number;
  gain?: string;
  ppm?: string;
  digital?: number;
  analog?: number;
}

export function sourceRows(payload: unknown): SourceRow[] {
  return asArray(unwrapConfig(payload).sources).map((it, idx) => {
    const r = asRecord(it) ?? {};
    return {
      key: str(r.device) ?? String(idx),
      driver: str(r.driver),
      device: str(r.device),
      center: num(r.center),
      rate: num(r.rate),
      gain: str(r.gain),
      ppm: str(r.ppm),
      digital: num(r.digital_recorders),
      analog: num(r.analog_recorders),
    };
  });
}

/** One line per SDR for the Config tile, e.g. "2 × Airspy · 10.0 Msps". */
export function sourcesSummary(rows: SourceRow[]): string {
  if (rows.length === 0) return "no SDR sources";
  const byDriver = new Map<string, number>();
  for (const r of rows) byDriver.set(r.driver ?? "unknown", (byDriver.get(r.driver ?? "unknown") ?? 0) + 1);
  return [...byDriver.entries()].map(([d, n]) => `${n} × ${d}`).join(", ");
}

const CONFIG_FACTS: { key: string; label: string }[] = [
  { key: "instance_id", label: "Instance ID" },
  { key: "capture_dir", label: "Capture folder" },
  { key: "upload_server", label: "Upload server" },
  { key: "default_mode", label: "Default mode" },
  { key: "call_timeout", label: "Call timeout" },
  { key: "control_message_warn_rate", label: "Warn below" },
  { key: "control_retune_limit", label: "Retune limit" },
  { key: "log_file", label: "Log file" },
  { key: "log_dir", label: "Log folder" },
  { key: "audio_archive", label: "Audio archive" },
  { key: "call_log", label: "Call log" },
  { key: "compress_wav", label: "Compress WAV" },
];

export function configFacts(payload: unknown): { label: string; value: string }[] {
  const cfg = unwrapConfig(payload);
  const out: { label: string; value: string }[] = [];
  for (const { key, label } of CONFIG_FACTS) {
    const v = cfg[key];
    if (v == null || v === "") continue;
    out.push({ label, value: String(v) });
  }
  return out;
}

/** The plugin's version, when a frame carries one; the plugin does not always say. */
export function pluginVersion(config: unknown, status: PluginStatusInfo | undefined): string | undefined {
  const cfg = unwrapConfig(config);
  const fromConfig = str(cfg.plugin_version) ?? str(cfg.version) ?? str(asRecord(config)?.plugin_version);
  if (fromConfig) return fromConfig;
  const s = status as (PluginStatusInfo & { version?: string }) | undefined;
  return s?.version;
}

// ── Numbers for the tiles ────────────────────────────────────────────────

export interface RateWindow {
  last: number;
  min: number;
  max: number;
}

export function rateWindow(samples: RateSample[]): RateWindow | null {
  if (samples.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const s of samples) {
    if (s.rate < min) min = s.rate;
    if (s.rate > max) max = s.rate;
  }
  return { last: samples[samples.length - 1].rate, min, max };
}

/** "3 s ago" for the banner; seconds only, since frames arrive every second. */
export function formatFrameAge(atMs: number | undefined, nowMs = Date.now()): string {
  if (!atMs) return "no frames yet";
  const s = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ── Messages ─────────────────────────────────────────────────────────────

export interface MessageStat {
  key: string;
  type: string;
  opcode: string;
  opcodeType: string;
  systems: string;
  count: number;
  lastSeen: number;
  description: string;
}

export function messageStats(msgs: MessageEntry[]): MessageStat[] {
  const map = new Map<string, MessageStat & { sys: Set<string> }>();
  for (const m of msgs) {
    const k = `${m.opcode ?? "?"}|${m.opcodeType ?? "?"}|${m.type ?? "?"}`;
    const sys = m.shortname ?? "?";
    const desc = m.meta ?? m.opcodeDesc ?? m.trunkMsg ?? "";
    const cur = map.get(k);
    if (cur) {
      cur.count++;
      cur.sys.add(sys);
      if (m.at > cur.lastSeen) {
        cur.lastSeen = m.at;
        cur.description = desc;
      }
    } else {
      map.set(k, {
        key: k,
        type: m.type ?? "—",
        opcode: m.opcode ?? "—",
        opcodeType: m.opcodeType ?? "—",
        systems: "",
        count: 1,
        lastSeen: m.at,
        description: desc,
        sys: new Set([sys]),
      });
    }
  }
  return [...map.values()]
    .map(({ sys, ...rest }) => ({ ...rest, systems: [...sys].sort().join(", ") }))
    .sort((a, b) => b.count - a.count);
}

// ── CSV ──────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV of the given columns, using each column's sort value as the plain cell. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const cols = columns.filter((c) => c.sortValue && c.header);
  const head = cols.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(c.sortValue?.(r))).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvName(instance: TrInstance, what: string): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return `${instance.label.replace(/[^\w.-]+/g, "_")}-${what}-${stamp}.csv`;
}

export { fmtFreqMHz };

/** A rate older than this (or three of the plugin's intervals) no longer says the system is healthy. */
export const RATE_STALE_MS = 30_000;

/**
 * Decoding means the control channel is being heard; zero means it is not.
 * A rate held from before a disconnect, or one that stopped arriving, says
 * nothing about now, so it never reads "ok".
 */
export function systemHealth(r: SystemRow, connected: boolean, now: number): { label: string; badge: string } {
  if (!connected) return { label: "no feed", badge: "badge-neutral" };
  if (r.rate == null) return { label: "waiting", badge: "badge-neutral" };
  const limit = Math.max(RATE_STALE_MS, (r.rateInterval ?? 0) * 3000);
  if (r.rateAt == null || now - r.rateAt > limit) return { label: "no recent rate", badge: "badge-warning" };
  if (r.rate > 0) return { label: "ok", badge: "badge-success" };
  return { label: "not decoding", badge: "badge-warning" };
}
