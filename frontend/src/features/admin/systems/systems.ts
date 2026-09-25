import type {
  AdminGroup,
  AdminSystem,
  AdminTag,
  AdminTalkgroup,
  AdminTalkgroupInput,
  AdminUnit,
  ImportChange,
  ImportMode,
  ImportPreviewRow,
} from "@/types";

export type Tab = "talkgroups" | "units" | "blocked";

export function tabFrom(raw: string | null): Tab {
  return raw === "units" || raw === "blocked" ? raw : "talkgroups";
}

/** The LED colours the scanner can show, in the order the picker lists them. */
export const LED_COLORS = ["green", "blue", "cyan", "magenta", "red", "white", "yellow", "orange"] as const;

/** A CSS colour for an LED swatch; the system default is green. */
export function ledCss(led: string | null | undefined): string {
  switch (led) {
    case "blue":
      return "#4c8dff";
    case "cyan":
      return "#3ec9d6";
    case "magenta":
      return "#d75ad0";
    case "red":
      return "#e5484d";
    case "white":
      return "#e8e8e8";
    case "yellow":
      return "#e5c34a";
    case "orange":
      return "#e58a3a";
    default:
      return "#6fbf8a";
  }
}

export function talkgroupTitle(tg: Pick<AdminTalkgroup, "talkgroupId" | "label">): string {
  return tg.label ? `${tg.talkgroupId} ${tg.label}` : `TG ${tg.talkgroupId}`;
}

export function unitTitle(u: Pick<AdminUnit, "unitId" | "label">): string {
  return u.label ? `${u.unitId} ${u.label}` : `Unit ${u.unitId}`;
}

export function isUnlabeled(tg: AdminTalkgroup): boolean {
  return !tg.label && !tg.name;
}

/** Talkgroups whose number, label, name, group or tag mention the search. */
export function matchesTalkgroup(
  tg: AdminTalkgroup,
  query: string,
  groups: Map<number, string>,
  tags: Map<number, string>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    String(tg.talkgroupId),
    tg.label ?? "",
    tg.name ?? "",
    tg.groupId != null ? (groups.get(tg.groupId) ?? "") : "",
    tg.tagId != null ? (tags.get(tg.tagId) ?? "") : "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

export function matchesUnit(u: AdminUnit, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${u.unitId} ${u.label ?? ""}`.toLowerCase().includes(q);
}

export function labelMap(items: Pick<AdminGroup | AdminTag, "id" | "label">[] | undefined): Map<number, string> {
  return new Map((items ?? []).map((i) => [i.id, i.label]));
}

/** "6.2 s" for an average call length in milliseconds. */
export function formatSeconds(ms: number | undefined): string {
  if (!ms) return "—";
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "853.9125 MHz" for a frequency in hertz. */
export function formatFrequency(hz: number | null | undefined): string {
  if (hz == null) return "—";
  return `${(hz / 1e6).toFixed(4)} MHz`;
}

export function systemsInOrder(systems: AdminSystem[] | undefined): AdminSystem[] {
  return systems ? [...systems].sort((a, b) => a.order - b.order || a.id - b.id) : [];
}

/** The changes an import row would make in a mode: all of them, or only blanks. */
export function applicableChanges(row: ImportPreviewRow, mode: ImportMode): ImportChange[] {
  const changes = row.changes ?? [];
  if (mode === "overwrite") return changes;
  return changes.filter((c) => c.now === "");
}

/** Rows an import would touch in a mode, excluding the ones ticked off. */
export function rowsToApply(rows: ImportPreviewRow[], mode: ImportMode, excluded: ReadonlySet<number>): ImportPreviewRow[] {
  return rows.filter((r) => !excluded.has(r.talkgroupId) && (r.status === "new" || applicableChanges(r, mode).length > 0));
}

export const FORMAT_LABEL: Record<string, string> = {
  squelch: "Squelch",
  "rdio-scanner": "rdio-scanner",
  radioreference: "RadioReference",
};

/** The talkgroup form's fields as strings, the way inputs hold them. */
export interface TalkgroupFormState {
  talkgroupId: string;
  label: string;
  name: string;
  groupId: string;
  tagId: string;
  led: string;
  frequency: string;
}

export function fromTalkgroup(tg: AdminTalkgroup | null): TalkgroupFormState {
  return {
    talkgroupId: tg ? String(tg.talkgroupId) : "",
    label: tg?.label ?? "",
    name: tg?.name ?? "",
    groupId: tg?.groupId != null ? String(tg.groupId) : "",
    tagId: tg?.tagId != null ? String(tg.tagId) : "",
    led: tg?.led ?? "",
    frequency: tg?.frequency != null ? String(tg.frequency / 1e6) : "",
  };
}

export function toInput(systemId: number, form: TalkgroupFormState, order: number): AdminTalkgroupInput {
  const freq = form.frequency.trim() === "" ? null : Math.round(Number(form.frequency) * 1e6);
  return {
    systemId,
    talkgroupId: Number(form.talkgroupId),
    label: form.label.trim() || null,
    name: form.name.trim() || null,
    frequency: freq,
    led: form.led || null,
    groupId: form.groupId === "" ? null : Number(form.groupId),
    tagId: form.tagId === "" ? null : Number(form.tagId),
    order,
  };
}
