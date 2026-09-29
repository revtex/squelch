import type { AdminSystem, ForwardingTarget } from "@/types";

export type Tab = "downstreams" | "webhooks";
export type StatusFilter = "all" | "active" | "failing" | "disabled";

export const TABS: readonly { id: Tab; label: string }[] = [
  { id: "downstreams", label: "Downstream servers" },
  { id: "webhooks", label: "Webhooks" },
];

export function tabFrom(raw: string | null): Tab {
  return raw === "webhooks" ? "webhooks" : "downstreams";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** The label, or the address's host when there is no label. */
export function targetName(t: ForwardingTarget): string {
  return t.label || hostOf(t.url);
}

export function allowedSystemIds(t: ForwardingTarget): number[] {
  if (!t.systemsJson) return [];
  try {
    const ids: unknown = JSON.parse(t.systemsJson);
    return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export function systemsLabel(t: ForwardingTarget, systems: AdminSystem[]): string {
  const ids = allowedSystemIds(t);
  if (ids.length === 0) return "All systems";
  return ids.map((id) => systems.find((s) => s.id === id)?.label ?? `#${id}`).join(", ");
}

export interface DeliveryState {
  id: "disabled" | "ok" | "failing" | "idle";
  label: string;
  badge: string;
}

/** What one target's status badge says. */
export function deliveryState(t: ForwardingTarget): DeliveryState {
  if (t.disabled === 1) return { id: "disabled", label: "disabled", badge: "badge-neutral" };
  if (t.last === null) return { id: "idle", label: "nothing sent yet", badge: "badge-neutral" };
  // A webhook sends a notice; a downstream delivers the call itself.
  if (t.last.ok) return { id: "ok", label: "type" in t ? "sending" : "delivering", badge: "badge-success" };
  return { id: "failing", label: "failing", badge: "badge-error" };
}

export function matchesFilter(t: ForwardingTarget, f: StatusFilter): boolean {
  const s = deliveryState(t).id;
  switch (f) {
    case "all":
      return true;
    case "active":
      return t.disabled === 0;
    case "failing":
      return s === "failing";
    case "disabled":
      return s === "disabled";
  }
}

export function matchesSearch(
  t: ForwardingTarget,
  systems: AdminSystem[],
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.label, t.url, systemsLabel(t, systems)].some((v) =>
    v.toLowerCase().includes(q),
  );
}

/** One line about a delivery result, e.g. for a toast or a fact. */
export function resultLine(r: { ok: boolean; status: number; error: string; millis: number }) {
  if (r.ok && !r.error) return `Answered ${r.status} in ${r.millis} ms.`;
  if (r.ok) return `${r.error} (${r.status} in ${r.millis} ms)`;
  return r.error || `Failed with status ${r.status}.`;
}
