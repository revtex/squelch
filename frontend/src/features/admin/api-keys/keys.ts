import type { AdminApiKey, AdminSystem } from "@/types";

/** The label, or the fingerprint for a key made before labels were required. */
export function keyName(k: AdminApiKey): string {
  return k.ident?.trim() || k.fingerprint;
}

/** System ids this key may upload to; empty means every system. */
export function allowedSystemIds(k: AdminApiKey): number[] {
  if (!k.systemsJson) return [];
  try {
    const parsed: unknown = JSON.parse(k.systemsJson);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number")
      : [];
  } catch {
    return [];
  }
}

/** The names of the systems a key is limited to, or "All systems". */
export function systemsLabel(k: AdminApiKey, systems: AdminSystem[]): string {
  const ids = allowedSystemIds(k);
  if (ids.length === 0) return "All systems";
  const names = ids.map((id) => systems.find((s) => s.id === id)?.label ?? `#${id}`);
  return names.join(", ");
}

export type KeyStatus = "active" | "disabled" | "rotating";

export interface StatusInfo {
  id: KeyStatus;
  label: string;
  badge: string;
}

export function keyStatus(k: AdminApiKey, now = Date.now() / 1000): StatusInfo {
  if (k.disabled === 1) return { id: "disabled", label: "disabled", badge: "badge-neutral" };
  if (k.previousKeyExpiresAt && k.previousKeyExpiresAt > now) {
    return { id: "rotating", label: "rotating", badge: "badge-warning" };
  }
  return { id: "active", label: "enabled", badge: "badge-success" };
}

export type StatusFilter = "all" | "active" | "disabled" | "legacy" | "unused";

export function matchesFilter(k: AdminApiKey, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return k.disabled === 0;
    case "disabled":
      return k.disabled === 1;
    case "legacy":
      return k.legacy24h > 0;
    case "unused":
      return k.lastUsedAt === null;
  }
}

export function matchesSearch(k: AdminApiKey, systems: AdminSystem[], q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${keyName(k)} ${k.fingerprint} ${systemsLabel(k, systems)} ${k.lastUsedIp ?? ""}`
    .toLowerCase()
    .includes(needle);
}

/**
 * A curl that checks the key against this server without uploading a call.
 * The endpoint answers 204 with no body, so the command prints the status.
 */
export function testCommand(secret: string, origin: string): string {
  return `curl -sS -o /dev/null -w "%{http_code}\\n" -X POST -H "Authorization: Bearer ${secret}" ${origin}/api/v1/calls/test`;
}

/** Which Trunk-Recorder plugin the snippet is written for. */
export type RecorderPlugin = "squelch" | "rdioscanner";

/** Where the Squelch uploader plugin's source and build steps live. */
export const SQUELCH_PLUGIN_URL = "https://github.com/revtex/squelch-tr-uploader";

/**
 * The Trunk-Recorder plugin entry for this server, ready to paste.
 *
 * The Squelch uploader posts to /api/v1/calls and takes one key for the whole
 * plugin. The rdio-scanner uploader ships with Trunk-Recorder but posts to
 * the deprecated /api/call-upload and wants the key on every system.
 */
export function trunkRecorderSnippet(
  plugin: RecorderPlugin,
  secret: string,
  origin: string,
  systems: AdminSystem[],
  allowed: number[],
): string {
  const chosen =
    allowed.length > 0 ? systems.filter((s) => allowed.includes(s.id)) : systems;
  const targets = (chosen.length > 0 ? chosen : [{ label: "your_system", systemId: 1 }]).map((s) => ({
    shortName: s.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    systemId: s.systemId,
  }));
  const entry =
    plugin === "squelch"
      ? {
          name: "Squelch",
          library: "libsquelch_uploader.so",
          server: origin,
          apiKey: secret,
          systems: targets,
        }
      : {
          name: "Squelch",
          library: "librdioscanner_uploader.so",
          server: origin,
          systems: targets.map((t) => ({ shortName: t.shortName, apiKey: secret, systemId: t.systemId })),
        };
  return JSON.stringify(entry, null, 2);
}
