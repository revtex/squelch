import type { AdminAuditRow, AdminLog } from "@/types";

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LevelFilter = LogLevel | "all";
export type RangeId = "1h" | "24h" | "7d" | "all";
export type Tab = "server" | "audit";

export const RANGES: readonly { id: RangeId; label: string; seconds: number | null }[] = [
  { id: "1h", label: "Last hour", seconds: 3600 },
  { id: "24h", label: "24 h", seconds: 86_400 },
  { id: "7d", label: "7 days", seconds: 7 * 86_400 },
  { id: "all", label: "All", seconds: null },
];

export const LIMITS = [200, 500, 1000, 2500, 5000] as const;

export function tabFrom(raw: string | null): Tab {
  return raw === "audit" ? "audit" : "server";
}

export function levelBadge(level: string): string {
  switch (level) {
    case "error":
      return "badge-error";
    case "warn":
      return "badge-warning";
    case "info":
      return "badge-info";
    default:
      return "badge-ghost";
  }
}

export interface LogChip {
  key: string;
  value: string;
  tone?: "default" | "error";
}

export interface ParsedLog {
  /** The line is an HTTP request; method, path and status are set. */
  isRequest: boolean;
  method?: string;
  path?: string;
  status?: number;
  latencyMs?: number;
  summary: string;
  chips: LogChip[];
}

const SHORT_KEYS: Record<string, string> = {
  call_id: "call",
  system_id: "sys",
  talkgroup_id: "tg",
  user_id: "user",
  downstream_id: "ds",
  webhook_id: "hook",
  duration_ms: "dur",
  segments: "seg",
  language: "lang",
  attempt: "try",
  username: "user",
};

const CHIP_PRIORITY = [
  "call_id",
  "id",
  "user_id",
  "username",
  "system_id",
  "talkgroup_id",
  "downstream_id",
  "webhook_id",
  "attempt",
  "status",
  "error",
];

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Turns a log line into a summary and a few short chips for the row. */
export function parseLog(log: AdminLog): ParsedLog {
  const attrs = log.attrs ?? {};
  if (log.message === "request" && attrs.method && attrs.path) {
    return {
      isRequest: true,
      method: attrs.method,
      path: attrs.path,
      status: attrs.status ? Number(attrs.status) : undefined,
      latencyMs: attrs.latency_ms ? Number(attrs.latency_ms) : undefined,
      summary: `${attrs.method} ${attrs.path}`,
      chips: [],
    };
  }
  const chips: LogChip[] = [];
  const used = new Set<string>();
  for (const k of CHIP_PRIORITY) {
    if (chips.length >= 3) break;
    const v = attrs[k];
    if (v === undefined || v === "") continue;
    used.add(k);
    chips.push({
      key: SHORT_KEYS[k] ?? k,
      value: k === "error" ? truncate(v, 60) : truncate(v, 40),
      tone: k === "error" ? "error" : "default",
    });
  }
  if (chips.length === 0) {
    for (const [k, v] of Object.entries(attrs)) {
      if (chips.length >= 2) break;
      if (v === "" || used.has(k) || k === "request_id") continue;
      chips.push({ key: SHORT_KEYS[k] ?? k, value: truncate(v, 40) });
    }
  }
  return { isRequest: false, summary: log.message, chips };
}

export function statusClass(status?: number): string {
  if (!status) return "";
  if (status >= 500) return "text-error font-semibold";
  if (status >= 400) return "text-warning font-semibold";
  if (status >= 300) return "text-base-content/60";
  return "text-success";
}

export interface RelatedLink {
  to: string;
  label: string;
}

/** Where the thing a line is about lives in the admin, when there is one. */
export function relatedLink(log: AdminLog): RelatedLink | null {
  const a = log.attrs ?? {};
  if (log.message.startsWith("dirmonitor") || a.dir) {
    return { to: "/admin/dirmonitors", label: "Open Folder monitors" };
  }
  if (log.message.startsWith("downstream") || a.downstream_id) {
    return { to: "/admin/forwarding", label: "Open Forwarding" };
  }
  if (log.message.startsWith("webhook") || a.webhook_id) {
    return { to: "/admin/forwarding?tab=webhooks", label: "Open Webhooks" };
  }
  if (log.message.startsWith("transcri")) {
    return { to: "/admin/transcription", label: "Open Transcription" };
  }
  if (log.message.startsWith("trmqtt") || log.message.startsWith("tr:")) {
    return { to: "/admin/trunk-recorder", label: "Open Trunk Recorder" };
  }
  if (a.username || a.user_id) {
    return { to: "/admin/users", label: "Open Users" };
  }
  if (a.api_key || a.key_id || log.message.includes("api key")) {
    return { to: "/admin/apikeys", label: "Open API keys" };
  }
  return null;
}

/** Where an audit line's subject lives, judged from its wording. */
export function auditLink(row: AdminAuditRow): RelatedLink | null {
  const m = row.message.toLowerCase();
  const pairs: [string, RelatedLink][] = [
    ["folder monitor", { to: "/admin/dirmonitors", label: "Open Folder monitors" }],
    ["downstream", { to: "/admin/forwarding", label: "Open Forwarding" }],
    ["webhook", { to: "/admin/forwarding?tab=webhooks", label: "Open Webhooks" }],
    ["api key", { to: "/admin/apikeys", label: "Open API keys" }],
    ["shared link", { to: "/admin/shared-links", label: "Open Shared links" }],
    ["group", { to: "/admin/groups", label: "Open Groups & tags" }],
    ["tag", { to: "/admin/groups", label: "Open Groups & tags" }],
    ["blocked", { to: "/admin/connections", label: "Open Connections" }],
    ["unblocked", { to: "/admin/connections", label: "Open Connections" }],
    ["user", { to: "/admin/users", label: "Open Users" }],
    ["signed in", { to: "/admin/users", label: "Open Users" }],
    ["login", { to: "/admin/users", label: "Open Users" }],
    ["setting", { to: "/admin/options", label: "Open Settings" }],
  ];
  for (const [needle, link] of pairs) {
    if (m.includes(needle)) return link;
  }
  return null;
}

/** The whole line as JSON, for the details view and copying. */
export function lineJson(log: AdminLog): string {
  return JSON.stringify(
    { time: new Date(log.dateTime * 1000).toISOString(), level: log.level, msg: log.message, ...(log.attrs ?? {}) },
    null,
    2,
  );
}

/** One text line per entry, for the download. */
export function linesAsText(logs: AdminLog[]): string {
  return logs
    .map((l) => {
      const attrs = Object.entries(l.attrs ?? {})
        .map(([k, v]) => `${k}=${/\s/.test(v) ? JSON.stringify(v) : v}`)
        .join(" ");
      return `${new Date(l.dateTime * 1000).toISOString()} ${l.level.toUpperCase().padEnd(5)} ${l.message}${attrs ? " " + attrs : ""}`;
    })
    .join("\n");
}

export function auditAsText(rows: AdminAuditRow[]): string {
  return rows
    .map((r) => `${new Date(r.dateTime * 1000).toISOString()} ${r.level.toUpperCase().padEnd(5)} ${r.message}`)
    .join("\n");
}
