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
  if (k.disabled === 1) return { id: "disabled", label: "Disabled", badge: "badge-ghost" };
  if (k.previousKeyExpiresAt && k.previousKeyExpiresAt > now) {
    return { id: "rotating", label: "Rotating", badge: "badge-warning" };
  }
  return { id: "active", label: "Active", badge: "badge-success" };
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

/** A curl that checks the key against this server without uploading a call. */
export function testCommand(secret: string, origin: string): string {
  return `curl -sS -X POST -H "Authorization: Bearer ${secret}" ${origin}/api/v1/calls/test`;
}

/** The Trunk-Recorder plugin entry for this server, ready to paste. */
export function trunkRecorderSnippet(
  secret: string,
  origin: string,
  systems: AdminSystem[],
  allowed: number[],
): string {
  const chosen =
    allowed.length > 0 ? systems.filter((s) => allowed.includes(s.id)) : systems;
  const entries = (chosen.length > 0 ? chosen : [{ label: "your_system", systemId: 1 }]).map(
    (s) => ({
      shortName: s.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      apiKey: secret,
      systemId: s.systemId,
    }),
  );
  return JSON.stringify(
    {
      name: "Squelch",
      library: "librdioscanner_uploader.so",
      server: origin,
      systems: entries,
    },
    null,
    2,
  );
}
