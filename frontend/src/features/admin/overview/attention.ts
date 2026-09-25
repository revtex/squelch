// What the Overview says needs attention, the health strip under it, and
// the counts the sidebar shows. Pure functions over data the pages already
// load, so "stopped" and "failing" here mean what they mean on those pages.
import { formatAgo, formatBytes, formatTime, plural } from "@/features/admin/_shell";
import { deliveryState, targetName } from "@/features/admin/forwarding";
import type { InstanceState } from "@/features/admin/trunk-recorder";
import type {
  AdminApiKey,
  AdminDirMonitor,
  AdminDownstream,
  AdminUser,
  AdminWebhook,
  LegacyUsageEntry,
  StorageInfo,
  TranscriptionStats,
} from "@/types";

/** No call for this long turns the Ingest pill amber. */
export const INGEST_QUIET_SECONDS = 30 * 60;
/** Calls waiting for transcription at or above this turn it amber. */
export const TRANSCRIPTION_QUEUE_WARN = 25;
/** Free space on the recordings volume below these shares: amber, then red. */
export const STORAGE_FREE_WARN = 0.1;
export const STORAGE_FREE_BAD = 0.05;

export type Tone = "ok" | "warn" | "bad" | "off";

/** Plain text, or a run shown in the monospace face (a path, a key name). */
export type DetailPart = string | { mono: string };

export interface AttentionItem {
  key: string;
  tone: "bad" | "warn";
  title: string;
  detail: DetailPart[];
  action: { label: string; to: string };
}

export interface HealthPill {
  id: "ingest" | "listeners" | "trunk" | "transcription" | "forwarding" | "storage";
  tone: Tone;
  text: string;
  to: string;
}

export interface TrInstanceSummary {
  id: number;
  label: string;
  enabled: boolean;
  state: InstanceState;
}

export interface OverviewSources {
  /** Unix seconds. */
  now: number;
  hour12: boolean;
  monitors?: AdminDirMonitor[];
  downstreams?: AdminDownstream[];
  webhooks?: AdminWebhook[];
  legacy?: LegacyUsageEntry[];
  apiKeys?: AdminApiKey[];
  users?: AdminUser[];
  transcription?: TranscriptionStats;
  storage?: StorageInfo;
  /** Days calls are kept; 0 keeps them for good. */
  pruneDays?: number;
  /** null while the Trunk Recorder integration is off. */
  trInstances?: TrInstanceSummary[] | null;
  listeners?: number;
  lastCallAt?: number;
}

function monitorItems(s: OverviewSources): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const m of s.monitors ?? []) {
    const st = m.status;
    const to = `/admin/dirmonitors?open=${m.id}`;
    if (st.state === "stopped") {
      const since = st.since ? ` since ${formatTime(st.since, { hour12: s.hour12 })}` : "";
      out.push({
        key: `monitor-${m.id}`,
        tone: "bad",
        title: `Folder monitor ${m.directory} stopped`,
        detail: [`${st.error || "Stopped"}${since}. ${plural(st.ingested24h, "file")} ingested in 24 h.`],
        action: { label: "Open monitor", to },
      });
    } else if ((st.state === "watching" || st.state === "polling") && st.error) {
      out.push({
        key: `monitor-${m.id}`,
        tone: "warn",
        title: `Folder monitor ${m.directory} has trouble`,
        detail: [`${st.error}. It keeps ${st.state}.`],
        action: { label: "Open monitor", to },
      });
    }
  }
  return out;
}

/** "401 Unauthorized. 3 failures in 24 h." with the count only when known. */
function failureLine(error: string, status: number, failed24h: number | undefined): string {
  const reason = (error || `The last try answered ${status}`).replace(/[.\s]+$/, "");
  const reasonText = reason.charAt(0).toUpperCase() + reason.slice(1);
  return failed24h ? `${reasonText}. ${plural(failed24h, "failure")} in 24 h.` : `${reasonText}.`;
}

function forwardingItems(s: OverviewSources): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const d of s.downstreams ?? []) {
    if (deliveryState(d).id !== "failing" || !d.last) continue;
    out.push({
      key: `downstream-${d.id}`,
      tone: "warn",
      title: `Downstream ${targetName(d)} is failing`,
      detail: [failureLine(d.last.error, d.last.status, d.failed24h)],
      action: { label: "Open downstream", to: `/admin/forwarding?open=${d.id}` },
    });
  }
  for (const w of s.webhooks ?? []) {
    if (deliveryState(w).id !== "failing" || !w.last) continue;
    out.push({
      key: `webhook-${w.id}`,
      tone: "warn",
      title: `Webhook ${targetName(w)} is failing`,
      detail: [failureLine(w.last.error, w.last.status, w.failed24h)],
      action: { label: "Open webhooks", to: "/admin/forwarding?tab=webhooks" },
    });
  }
  return out;
}

function legacyItems(s: OverviewSources): AttentionItem[] {
  // The report cuts a key's label to six characters, so group by the key's
  // id and name it from the key list; requests without a key group apart.
  const groups = new Map<string, { count: number; keyId?: number; ident: string }>();
  for (const e of s.legacy ?? []) {
    const k = e.apiKeyId ? `key-${e.apiKeyId}` : `ident-${e.apiKeyIdent}`;
    const g = groups.get(k) ?? { count: 0, keyId: e.apiKeyId, ident: e.apiKeyIdent };
    g.count += e.count;
    groups.set(k, g);
  }
  const out: AttentionItem[] = [];
  for (const [k, g] of groups) {
    const key = g.keyId ? s.apiKeys?.find((a) => a.id === g.keyId) : undefined;
    const name = key?.ident || g.ident;
    const tail = " Move the uploader to /api/v1/calls.";
    out.push({
      key: `legacy-${k}`,
      tone: "warn",
      title: "Legacy /api/* uploads still arriving",
      detail: name
        ? [`${plural(g.count, "request")} from key `, { mono: name }, ` in 24 h.${tail}`]
        : [`${plural(g.count, "request")} without an API key in 24 h.${tail}`],
      action: key ? { label: "Open key", to: `/admin/apikeys?open=${key.id}` } : { label: "API keys", to: "/admin/apikeys" },
    });
  }
  return out;
}

function userItems(s: OverviewSources): AttentionItem[] {
  const temp = (s.users ?? []).filter((u) => u.passwordNeedChange === 1 && u.disabled === 0);
  if (temp.length === 0) return [];
  const names = temp.slice(0, 4).map((u) => u.username);
  const more = temp.length > names.length ? `, and ${temp.length - names.length} more` : "";
  return [
    {
      key: "temporary-passwords",
      tone: "warn",
      title: `${plural(temp.length, "user")} still on a temporary password`,
      detail: [`${names.join(", ")}${more}. They must change it at next sign in.`],
      action: { label: "Show users", to: "/admin/users" },
    },
  ];
}

function transcriptionItems(s: OverviewSources): AttentionItem[] {
  const t = s.transcription;
  if (!t || !t.poolEnabled) return [];
  const out: AttentionItem[] = [];
  if (t.failed24h > 0) {
    out.push({
      key: "transcription-failed",
      tone: "warn",
      title: `${plural(t.failed24h, "transcription")} failed in 24 h`,
      detail: ["Recent jobs lists each one with its error and a Retry."],
      action: { label: "Show failures", to: "/admin/transcription?tab=jobs&status=failed" },
    });
  }
  if (t.queueDepth >= TRANSCRIPTION_QUEUE_WARN) {
    out.push({
      key: "transcription-queue",
      tone: "warn",
      title: `Transcription queue at ${t.queueDepth}`,
      detail: ["Calls are arriving faster than they can be transcribed. More workers or a faster sidecar will catch up."],
      action: { label: "Open transcription", to: "/admin/transcription" },
    });
  }
  return out;
}

function storageItems(s: OverviewSources): AttentionItem[] {
  const st = s.storage;
  if (!st || st.volumeTotalBytes <= 0) return [];
  const free = st.volumeFreeBytes / st.volumeTotalBytes;
  if (free >= STORAGE_FREE_WARN) return [];
  return [
    {
      key: "storage",
      tone: free < STORAGE_FREE_BAD ? "bad" : "warn",
      title: "The recordings disk is almost full",
      detail: [`${formatBytes(st.volumeFreeBytes)} free of ${formatBytes(st.volumeTotalBytes)}. Shorten how long calls are kept, or add space.`],
      action: { label: "Open storage", to: "/admin/settings#settings-storage" },
    },
  ];
}

function trunkItems(s: OverviewSources): AttentionItem[] {
  return (s.trInstances ?? [])
    .filter((i) => i.enabled && i.state === "error")
    .map((i) => ({
      key: `tr-${i.id}`,
      tone: "warn" as const,
      title: `Trunk Recorder ${i.label} can't reach its broker`,
      detail: ["The page shows the reason and a Test broker button."],
      action: { label: "Open recorder", to: `/admin/trunk-recorder?instance=${i.id}` },
    }));
}

/** Everything that needs a person, worst first. Empty when all is well. */
export function attentionItems(s: OverviewSources): AttentionItem[] {
  const all = [
    ...monitorItems(s),
    ...storageItems(s),
    ...forwardingItems(s),
    ...trunkItems(s),
    ...transcriptionItems(s),
    ...legacyItems(s),
    ...userItems(s),
  ];
  return [...all.filter((i) => i.tone === "bad"), ...all.filter((i) => i.tone === "warn")];
}

export function healthPills(s: OverviewSources): HealthPill[] {
  const pills: HealthPill[] = [];

  const last = s.lastCallAt ?? 0;
  pills.push({
    id: "ingest",
    tone: last === 0 ? "off" : s.now - last > INGEST_QUIET_SECONDS ? "warn" : "ok",
    text: last === 0 ? "Ingest · no calls yet" : `Ingest · last call ${formatAgo(last, s.now)}`,
    to: "/admin/dirmonitors",
  });

  pills.push({
    id: "listeners",
    tone: "ok",
    text: `Listeners · ${s.listeners ?? 0} live`,
    to: "/admin/connections",
  });

  const tr = (s.trInstances ?? []).filter((i) => i.enabled);
  const up = tr.filter((i) => i.state === "connected").length;
  pills.push({
    id: "trunk",
    tone: tr.length === 0 ? "off" : up === tr.length ? "ok" : "warn",
    text: tr.length === 0 ? "Trunk Recorder · off" : `Trunk Recorder · ${up} / ${tr.length} ${tr.length === 1 ? "broker" : "brokers"}`,
    to: "/admin/trunk-recorder",
  });

  const t = s.transcription;
  pills.push({
    id: "transcription",
    tone: !t || !t.poolEnabled ? "off" : t.queueDepth >= TRANSCRIPTION_QUEUE_WARN || t.failed24h > 0 ? "warn" : "ok",
    text: !t || !t.poolEnabled ? "Transcription · off" : `Transcription · queue ${t.queueDepth}`,
    to: "/admin/transcription",
  });

  const targets = [...(s.downstreams ?? []), ...(s.webhooks ?? [])].filter((x) => x.disabled === 0);
  const failingDown = (s.downstreams ?? []).filter((d) => deliveryState(d).id === "failing").length;
  const failingHooks = (s.webhooks ?? []).filter((w) => deliveryState(w).id === "failing").length;
  const failing: string[] = [];
  if (failingDown) failing.push(`${failingDown} ${failingDown === 1 ? "downstream" : "downstreams"}`);
  if (failingHooks) failing.push(`${failingHooks} ${failingHooks === 1 ? "webhook" : "webhooks"}`);
  pills.push({
    id: "forwarding",
    tone: targets.length === 0 ? "off" : failing.length ? "warn" : "ok",
    text: targets.length === 0 ? "Forwarding · none set up" : failing.length ? `Forwarding · ${failing.join(", ")} failing` : "Forwarding · all delivering",
    to: "/admin/forwarding",
  });

  const st = s.storage;
  if (st && st.volumeTotalBytes > 0) {
    const used = st.volumeTotalBytes - st.volumeFreeBytes;
    const free = st.volumeFreeBytes / st.volumeTotalBytes;
    const prune = s.pruneDays ? `prune ${s.pruneDays} d` : "kept for good";
    pills.push({
      id: "storage",
      tone: free < STORAGE_FREE_BAD ? "bad" : free < STORAGE_FREE_WARN ? "warn" : "ok",
      text: `Storage · ${formatBytes(used)} of ${formatBytes(st.volumeTotalBytes)}, ${prune}`,
      to: "/admin/settings#settings-storage",
    });
  } else {
    pills.push({ id: "storage", tone: "off", text: "Storage · measuring", to: "/admin/settings#settings-storage" });
  }
  return pills;
}

export interface NavBadge {
  count: number;
  tone: "neutral" | "warn" | "bad";
  /** What the number means, read after the section's name. */
  sr: string;
}

/** The counts beside sidebar items, keyed by the item's path. */
export function navBadges(s: OverviewSources, attention: AttentionItem[]): Record<string, NavBadge> {
  const out: Record<string, NavBadge> = {};
  if (attention.length) {
    out["/admin/overview"] = {
      count: attention.length,
      tone: attention.some((a) => a.tone === "bad") ? "bad" : "warn",
      sr: `${attention.length} need attention`,
    };
  }
  if (s.users?.length) out["/admin/users"] = { count: s.users.length, tone: "neutral", sr: plural(s.users.length, "user") };
  if (s.listeners) out["/admin/connections"] = { count: s.listeners, tone: "neutral", sr: `${s.listeners} live` };
  if (s.apiKeys?.length) out["/admin/apikeys"] = { count: s.apiKeys.length, tone: "neutral", sr: plural(s.apiKeys.length, "key") };
  const stopped = (s.monitors ?? []).filter((m) => m.status.state === "stopped").length;
  if (stopped) out["/admin/dirmonitors"] = { count: stopped, tone: "bad", sr: `${stopped} stopped` };
  const failing = [...(s.downstreams ?? []), ...(s.webhooks ?? [])].filter((t) => deliveryState(t).id === "failing").length;
  if (failing) out["/admin/forwarding"] = { count: failing, tone: "warn", sr: `${failing} failing` };
  return out;
}
