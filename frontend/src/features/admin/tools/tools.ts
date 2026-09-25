// Helpers for the Backup & import page: what each kind of radio data is
// called, how a reviewed import's rows are judged, and what the restore
// review says about each table.
import type {
  AdminSystem,
  BackupEntity,
  ImportChange,
  ImportMode,
  ImportPreviewRow,
  LabelImportPreview,
  RestoreMode,
  TalkgroupImportPreview,
  UnitImportPreview,
  UnitImportPreviewRow,
} from "@/types";
import { plural } from "@/features/admin/_shell";

export type ImportEntity = "talkgroups" | "units" | "groups" | "tags";

export const ENTITY_LABEL: Record<ImportEntity, string> = {
  talkgroups: "talkgroups",
  units: "units",
  groups: "groups",
  tags: "tags",
};

/** Talkgroups and units belong to a system; groups and tags do not. */
export const NEEDS_SYSTEM: Record<ImportEntity, boolean> = {
  talkgroups: true,
  units: true,
  groups: false,
  tags: false,
};

export const FORMAT_LABEL: Record<string, string> = {
  squelch: "Squelch",
  "rdio-scanner": "rdio-scanner",
  radioreference: "RadioReference",
};

/** The changes an import row would make in a mode: all of them, or only blanks. */
export function applicableChanges(row: { changes?: ImportChange[] }, mode: ImportMode): ImportChange[] {
  const changes = row.changes ?? [];
  if (mode === "overwrite") return changes;
  return changes.filter((c) => c.now === "");
}

/** Rows an import would touch in a mode, excluding the ones ticked off. */
export function rowsToApply(rows: ImportPreviewRow[], mode: ImportMode, excluded: ReadonlySet<number>): ImportPreviewRow[] {
  return rows.filter((r) => !excluded.has(r.talkgroupId) && (r.status === "new" || applicableChanges(r, mode).length > 0));
}

/** One row of any import's review, so a single table can show them all. */
export interface ReviewRow {
  /** What the checkbox and the exclusion set go by. */
  key: string;
  /** The first column: a talkgroup or unit number, or a label. */
  id: string;
  status: "new" | "unchanged" | "changed";
  changes: ImportChange[];
  /** What a new row would be created as. */
  summary: string;
}

export interface Review {
  rows: ReviewRow[];
  problems: { row: number; reason: string }[];
  new: number;
  changed: number;
  unchanged: number;
  /** The file's format, when the parser tells it apart. */
  format?: string;
  /** Whether the review offers fill vs overwrite. */
  hasModes: boolean;
}

export function reviewTalkgroups(p: TalkgroupImportPreview): Review {
  return {
    rows: p.rows.map((r) => ({
      key: String(r.talkgroupId),
      id: String(r.talkgroupId),
      status: r.status,
      changes: r.changes ?? [],
      summary: [r.label, r.name].filter(Boolean).join(" · ") || "unlabeled",
    })),
    problems: p.problems,
    new: p.new,
    changed: p.changed,
    unchanged: p.unchanged,
    format: p.format,
    hasModes: true,
  };
}

export function reviewUnits(p: UnitImportPreview): Review {
  return {
    rows: p.rows.map((r: UnitImportPreviewRow) => ({
      key: String(r.unitId),
      id: String(r.unitId),
      status: r.status,
      changes: r.changes ?? [],
      summary: r.label || "unlabeled",
    })),
    problems: p.problems,
    new: p.new,
    changed: p.changed,
    unchanged: p.unchanged,
    hasModes: true,
  };
}

export function reviewLabels(p: LabelImportPreview): Review {
  return {
    rows: p.rows.map((r) => ({ key: r.label.toLowerCase(), id: r.label, status: r.status, changes: [], summary: r.label })),
    problems: p.problems,
    new: p.new,
    changed: 0,
    unchanged: p.unchanged,
    hasModes: false,
  };
}

/** Review rows an import would touch in a mode, minus the ones ticked off. */
export function reviewRowsToApply(rows: ReviewRow[], mode: ImportMode, excluded: ReadonlySet<string>): ReviewRow[] {
  return rows.filter((r) => !excluded.has(r.key) && (r.status === "new" || applicableChanges(r, mode).length > 0));
}

/** Rows an import shows when it is showing changes only. */
export function reviewChanges(rows: ReviewRow[], mode: ImportMode): ReviewRow[] {
  return rows.filter((r) => r.status === "new" || applicableChanges(r, mode).length > 0);
}

/** How many things an import would write: one per new row, one per field otherwise. */
export function reviewChangeCount(rows: ReviewRow[], mode: ImportMode): number {
  return rows.reduce((n, r) => n + (r.status === "new" ? 1 : applicableChanges(r, mode).length), 0);
}

/** What the toast says once an import is applied. */
export function importSummary(entity: ImportEntity, r: { created: number; updated?: number; unchanged: number }): string {
  const one = entity === "talkgroups" ? "new talkgroup" : entity === "units" ? "new unit" : entity === "groups" ? "new group" : "new tag";
  const parts = [plural(r.created, one)];
  if (r.updated != null) parts.push(`${r.updated} updated`);
  parts.push(`${r.unchanged} unchanged`);
  return `Imported: ${parts.join(", ")}.`;
}

export function slug(label: string): string {
  return label.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
}

/** The CSV a row's Export button downloads: one system's or every system's. */
export function exportFilename(entity: ImportEntity, system: AdminSystem | null): string {
  return system ? `${slug(system.label)}-${entity}.csv` : `all-systems-${entity}.csv`;
}

export function downloadText(name: string, text: string, type = "text/csv"): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** What a restore's review says about one table in the chosen mode. */
export function restoreNote(e: BackupEntity, mode: RestoreMode): string {
  if (!e.included) return "not in the file; left alone";
  const parts: string[] = [];
  if (e.added > 0) parts.push(`${e.added} added`);
  if (e.changed > 0) parts.push(`${e.changed} differ`);
  if (e.removed > 0) {
    const names = e.examples.length > 0 ? ` (${e.examples.join(", ")}${e.removed > e.examples.length ? ", …" : ""})` : "";
    parts.push(mode === "replace" ? `${e.removed} not in the file would be removed${names}` : `${e.removed} not in the file, kept${names}`);
  }
  return parts.length > 0 ? parts.join("; ") : "same";
}

/** The totals under a restore's review. */
export function restoreTotals(entities: BackupEntity[], mode: RestoreMode): { added: number; changed: number; removed: number } {
  return entities.reduce(
    (t, e) => (e.included ? { added: t.added + e.added, changed: t.changed + e.changed, removed: t.removed + (mode === "replace" ? e.removed : 0) } : t),
    { added: 0, changed: 0, removed: 0 },
  );
}

/** The word typed to confirm a restore. */
export const RESTORE_WORD = "RESTORE";
