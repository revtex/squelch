// Types for the Trunk Recorder MQTT admin dashboards.
//
// These mirror the JSON shapes returned by /api/v1/admin/tr/* and the
// `tr.*` admin-WS event payloads emitted by `cmd/server/main.go`. Many TR
// frame payloads are kept opaque (`unknown`) on the frontend — the
// dashboard surfaces them generically and only specific keys are read
// inside components when present.

/** A row from /admin/tr/instances. */
export interface TrInstance {
  id: number;
  label: string;
  instanceId: string;
  brokerUrl: string;
  baseTopic: string;
  unitTopic?: string;
  messageTopic?: string;
  username?: string;
  hasPassword: boolean;
  tlsSkipVerify: boolean;
  qos: number;
  enabled: boolean;
  status: string;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Body for POST /admin/tr/instances. `password` is optional — omit to
 * leave broker authentication empty, send a non-empty string to set one.
 */
export interface TrInstanceCreatePayload {
  label: string;
  instanceId: string;
  brokerUrl: string;
  baseTopic: string;
  unitTopic?: string;
  messageTopic?: string;
  username?: string;
  password?: string;
  tlsSkipVerify: boolean;
  qos: number;
  enabled?: boolean;
}

/**
 * Body for PATCH /admin/tr/instances/:id. Password is tri-state per
 * backend contract:
 * - field omitted     → keep existing
 * - field `""`        → clear
 * - field `"…"`       → replace with new plaintext (server encrypts)
 */
export interface TrInstanceUpdatePayload {
  label?: string;
  instanceId?: string;
  brokerUrl?: string;
  baseTopic?: string;
  unitTopic?: string;
  messageTopic?: string;
  username?: string;
  password?: string;
  tlsSkipVerify?: boolean;
  qos?: number;
  enabled?: boolean;
}

export interface TrInstanceTestResponse {
  ok: boolean;
  error?: string;
}

/**
 * Generic envelope shipped under every `tr.*` admin event. The backend
 * publishes `{instanceId, label, payload, error?}`.
 */
export interface TrEventEnvelope {
  instanceId: number;
  label: string;
  payload: unknown;
  error?: string;
}

// ── In-slice in-memory derived state ──────────────────────────────────

export interface InstanceConnectionState {
  connected: boolean;
  lastError?: string;
  lastSeenAt?: number;
}

export interface RateSample {
  /** Unix millis. */
  at: number;
  /** Aggregate decode rate across systems for this sample. */
  rate: number;
}

/**
 * Latest decode-rate breakdown per system. The `tr.rates` envelope
 * carries `rates: [{sys_num, sys_name, decoderate, decoderate_interval,
 * control_channel}]`; we keep the most recent one per sys_name.
 */
export interface SystemRateInfo {
  sysNum?: number;
  sysName: string;
  decoderate: number;
  decoderateInterval?: number;
  controlChannel?: number;
  at: number;
}

/**
 * Plugin lifecycle ping (`tr.pluginStatus`). Status is "connected" or
 * "disconnected" per the upstream plugin's open/close LWT messages.
 */
export interface PluginStatusInfo {
  status: string;
  clientId?: string;
  instanceId?: string;
  at: number;
}

/**
 * Recent-calls feed entry. Captures both `tr.callStart` and `tr.callEnd`
 * frames; `kind` distinguishes them and `endedAt` is set on call_end.
 */
export interface RecentCallEntry {
  at: number;
  kind: "start" | "end";
  callId?: string;
  callNum?: string;
  sysName?: string;
  sysNum?: number;
  freq?: number;
  unit?: string;
  unitAlpha?: string;
  talkgroup?: string;
  talkgroupAlpha?: string;
  talkgroupGroup?: string;
  talkgroupTag?: string;
  talkgroupDescription?: string;
  encrypted?: boolean;
  emergency?: boolean;
  conventional?: boolean;
  callState?: string;
  monState?: string;
  recState?: string;
  audioType?: string;
  length?: number;
  startTime?: number;
  stopTime?: number;
  callFilename?: string;
  raw: unknown;
}

export interface UnitEventEntry {
  at: number;
  topic: string;
  kind: string;
  shortname?: string;
  unitId?: string;
  unitAlpha?: string;
  talkgroupId?: string;
  talkgroupAlpha?: string;
  talkgroupGroup?: string;
  talkgroupTag?: string;
  talkgroupDescription?: string;
  talkgroupPatches?: string;
  freq?: number;
  callNum?: string;
  encrypted?: boolean;
  raw: unknown;
}

export interface MessageEntry {
  at: number;
  topic: string;
  type?: string;
  trunkMsg?: string;
  opcode?: string;
  opcodeType?: string;
  opcodeDesc?: string;
  shortname?: string;
  sysNum?: number;
  meta?: string;
  raw: unknown;
}

/**
 * Snapshot view as returned by GET /admin/tr/instances/:id/snapshot. The
 * backend SnapshotView struct has no JSON tags, so fields ship in
 * PascalCase. Most payload shapes are kept loose.
 */
export interface SnapshotView {
  InstanceID: number;
  Label: string;
  PluginInstanceID: string;
  Connection: {
    Connected: boolean;
    LastConnected?: string;
    LastError?: string;
  };
  Rates?: unknown;
  Recorders?: unknown;
  CallsActive?: unknown;
  Systems?: unknown;
  Config?: unknown;
  PluginStatus?: unknown;
  SystemFrames?: Record<string, unknown>;
  UnitEvents?: unknown[];
  Messages?: unknown[];
  RateSamples?: unknown[];
}
