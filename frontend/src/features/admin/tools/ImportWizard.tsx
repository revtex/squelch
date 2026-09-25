// One import wizard for talkgroups, units, groups, tags and RadioReference
// files: choose a file (and a system when the data belongs to one), review
// what it would change, apply the rows that are left ticked.
import { useId, useMemo, useState } from "react";
import {
  DetailsPanel,
  FilterChips,
  plural,
  useApplyGroupImportMutation,
  useApplyTagImportMutation,
  useApplyTalkgroupImportMutation,
  useApplyUnitImportMutation,
  usePreviewGroupImportMutation,
  usePreviewTagImportMutation,
  usePreviewTalkgroupImportMutation,
  usePreviewUnitImportMutation,
} from "@/features/admin/_shell";
import type { AdminSystem, ImportMode, ImportPreviewRow, ImportRow, UnitImportPreviewRow, UnitImportRow } from "@/types";
import {
  ENTITY_LABEL,
  FORMAT_LABEL,
  NEEDS_SYSTEM,
  applicableChanges,
  importSummary,
  reviewChangeCount,
  reviewChanges,
  reviewLabels,
  reviewRowsToApply,
  reviewTalkgroups,
  reviewUnits,
  type ImportEntity,
  type Review,
  type ReviewRow,
} from "./tools";

export interface ImportWizardProps {
  entity: ImportEntity;
  /** The systems to pick from when none is given. */
  systems?: AdminSystem[];
  /** The system to import into, when the page already knows it. */
  system?: AdminSystem;
  /** A different title, e.g. for RadioReference enrichment. */
  title?: string;
  onClose: () => void;
  /** Called with the toast line once the rows are applied. */
  onDone: (summary: string) => void;
}

type View = "changes" | "all" | "problems";

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "object" && e !== null && "data" in e) {
    const data = (e as { data?: { error?: { message?: string } } }).data;
    if (data?.error?.message) return data.error.message;
  }
  return fallback;
}

function toImportRow(r: ImportPreviewRow): ImportRow {
  const { status: _s, changes: _c, ...row } = r;
  return row;
}

function toUnitRow(r: UnitImportPreviewRow): UnitImportRow {
  const { status: _s, changes: _c, ...row } = r;
  return row;
}

const HINT: Record<ImportEntity, string> = {
  talkgroups:
    "Nothing changes until you review the result. Existing talkgroups are matched by number; groups and tags named in the file are created if missing.",
  units: "Nothing changes until you review the result. Existing units are matched by number; only labels are compared.",
  groups: "One label per row, with or without a header. Labels that already exist are left alone.",
  tags: "One label per row, with or without a header. Labels that already exist are left alone.",
};

const SUBTITLE: Record<ImportEntity, string> = {
  talkgroups: "Squelch, rdio-scanner and RadioReference CSV files are recognised.",
  units: "unit_id, label and order columns; a Squelch export with a system column works too.",
  groups: "A CSV with one group label per row.",
  tags: "A CSV with one tag label per row.",
};

export default function ImportWizard({ entity, systems = [], system: preset, title, onClose, onDone }: ImportWizardProps) {
  const id = useId();
  const [previewTalkgroups, tgPreview] = usePreviewTalkgroupImportMutation();
  const [previewUnits, unitPreview] = usePreviewUnitImportMutation();
  const [previewGroups, groupPreview] = usePreviewGroupImportMutation();
  const [previewTags, tagPreview] = usePreviewTagImportMutation();
  const [applyTalkgroups, tgApply] = useApplyTalkgroupImportMutation();
  const [applyUnits, unitApply] = useApplyUnitImportMutation();
  const [applyGroups, groupApply] = useApplyGroupImportMutation();
  const [applyTags, tagApply] = useApplyTagImportMutation();

  const [systemId, setSystemId] = useState<number>(preset?.id ?? systems[0]?.id ?? 0);
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [raw, setRaw] = useState<{ talkgroups?: ImportPreviewRow[]; units?: UnitImportPreviewRow[] }>({});
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("fill");
  const [view, setView] = useState<View>("changes");
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());

  const needsSystem = NEEDS_SYSTEM[entity];
  const system = preset ?? systems.find((s) => s.id === systemId) ?? null;
  const previewing = tgPreview.isLoading || unitPreview.isLoading || groupPreview.isLoading || tagPreview.isLoading;
  const applying = tgApply.isLoading || unitApply.isLoading || groupApply.isLoading || tagApply.isLoading;
  const busy = previewing || applying;

  const toApply = useMemo(() => (review ? reviewRowsToApply(review.rows, mode, excluded) : []), [review, mode, excluded]);
  const changeCount = useMemo(() => reviewChangeCount(toApply, mode), [toApply, mode]);
  const visible: ReviewRow[] = useMemo(() => {
    if (!review) return [];
    if (view === "all") return review.rows;
    if (view === "changes") return reviewChanges(review.rows, mode);
    return [];
  }, [review, view, mode]);

  const runPreview = async () => {
    if (!file || (needsSystem && !system)) return;
    setError(null);
    const body = new FormData();
    if (needsSystem && system) body.append("system_id", String(system.id));
    body.append("file", file);
    try {
      let next: Review;
      if (entity === "talkgroups") {
        const p = await previewTalkgroups(body).unwrap();
        setRaw({ talkgroups: p.rows });
        next = reviewTalkgroups(p);
      } else if (entity === "units") {
        const p = await previewUnits(body).unwrap();
        setRaw({ units: p.rows });
        next = reviewUnits(p);
      } else {
        const p = await (entity === "groups" ? previewGroups(body) : previewTags(body)).unwrap();
        next = reviewLabels(p);
      }
      setReview(next);
      setExcluded(new Set());
      setView(next.changed + next.new > 0 ? "changes" : next.problems.length > 0 ? "problems" : "all");
    } catch (e) {
      setError(messageOf(e, "The file could not be read."));
    }
  };

  const runApply = async () => {
    if (!review) return;
    setError(null);
    const keys = new Set(toApply.map((r) => r.key));
    try {
      if (entity === "talkgroups" && system) {
        const rows = (raw.talkgroups ?? []).filter((r) => keys.has(String(r.talkgroupId))).map(toImportRow);
        onDone(importSummary(entity, await applyTalkgroups({ systemId: system.id, mode, rows }).unwrap()));
      } else if (entity === "units" && system) {
        const rows = (raw.units ?? []).filter((r) => keys.has(String(r.unitId))).map(toUnitRow);
        onDone(importSummary(entity, await applyUnits({ systemId: system.id, mode, rows }).unwrap()));
      } else {
        const labels = toApply.map((r) => r.id);
        const r = await (entity === "groups" ? applyGroups({ labels }) : applyTags({ labels })).unwrap();
        onDone(importSummary(entity, r));
      }
    } catch (e) {
      setError(messageOf(e, "The import failed."));
    }
  };

  const noun = ENTITY_LABEL[entity];
  const heading = title ?? (system && needsSystem ? `Import ${noun} into ${system.label}` : `Import ${noun}`);
  const subtitle = review
    ? `${review.format ? `${FORMAT_LABEL[review.format] ?? review.format} file · ` : ""}${plural(review.rows.length, "row")}`
    : SUBTITLE[entity];
  const idHeader = entity === "talkgroups" ? "TG" : entity === "units" ? "Unit" : "Label";
  const newNoun = entity === "talkgroups" ? "new talkgroup" : entity === "units" ? "new unit" : entity === "groups" ? "new group" : "new tag";

  return (
    <DetailsPanel
      title={heading}
      subtitle={subtitle}
      size="wide"
      onClose={onClose}
      footer={
        review ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setReview(null)} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || toApply.length === 0} onClick={() => void runApply()}>
              {applying ? "Applying…" : `Apply ${plural(changeCount, "change")}`}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!file || (needsSystem && !system) || busy} onClick={() => void runPreview()}>
              {previewing ? "Reading…" : "Review changes"}
            </button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="alert alert-error text-sm">
          {error}
        </p>
      )}

      {!review ? (
        <div className="space-y-3">
          {needsSystem && !preset && (
            <div>
              <label htmlFor={`${id}-system`} className="block text-sm font-medium">
                System
              </label>
              <select id={`${id}-system`} className="select w-full" value={systemId} onChange={(e) => setSystemId(Number(e.target.value))}>
                {systems.length === 0 && <option value={0}>No systems yet</option>}
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <label htmlFor={`${id}-file`} className="block text-sm font-medium">
            CSV file
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept=".csv,text/csv"
            className="file-input w-full"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-base-content-dim">{HINT[entity]}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{plural(review.new, newNoun)}</strong>
            {review.hasModes && (
              <>
                , <strong>{plural(review.changed, "change")}</strong>
              </>
            )}
            , {review.unchanged} unchanged
            {review.problems.length > 0 && (
              <>
                , <strong className="text-warning">{plural(review.problems.length, "row")} skipped</strong>
              </>
            )}
            .
          </p>

          {review.hasModes && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Existing {noun}</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" className="radio radio-sm" name={`${id}-mode`} checked={mode === "fill"} onChange={() => setMode("fill")} />
                Fill in blanks only
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" className="radio radio-sm" name={`${id}-mode`} checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
                {entity === "units" ? "Overwrite labels" : "Overwrite label, name, group and tag"}
              </label>
            </fieldset>
          )}

          <FilterChips
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { id: "changes", label: "Changes only", count: review.new + review.changed },
              { id: "all", label: "All rows", count: review.rows.length },
              { id: "problems", label: "Problems", count: review.problems.length },
            ]}
          />

          {view === "problems" ? (
            review.problems.length === 0 ? (
              <p className="text-sm text-base-content-dim">Every row was read.</p>
            ) : (
              <ul className="list-inside list-disc text-sm">
                {review.problems.map((p) => (
                  <li key={`${p.row}-${p.reason}`}>
                    Row {p.row}: {p.reason}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              <table className="table table-sm table-pin-rows">
                <caption className="sr-only">Import changes</caption>
                <thead>
                  <tr>
                    <th className="w-8">
                      <span className="sr-only">Apply</span>
                    </th>
                    <th>{idHeader}</th>
                    {review.hasModes ? (
                      <>
                        <th>Field</th>
                        <th>Now</th>
                        <th>After</th>
                      </>
                    ) : (
                      <th>Result</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-base-content-dim">
                        {review.hasModes ? "Nothing would change in this mode." : "Nothing new in the file."}
                      </td>
                    </tr>
                  )}
                  {visible.map((r) => {
                    const changes = r.status === "new" ? [] : applicableChanges(r, mode);
                    const off = excluded.has(r.key);
                    const toggle = (
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`Apply ${r.id}`}
                        checked={!off}
                        onChange={() =>
                          setExcluded((s) => {
                            const n = new Set(s);
                            if (n.has(r.key)) n.delete(r.key);
                            else n.add(r.key);
                            return n;
                          })
                        }
                      />
                    );
                    if (r.status === "new") {
                      return (
                        <tr key={r.key} className={off ? "opacity-50" : ""}>
                          <td>{toggle}</td>
                          <td className={review.hasModes ? "font-mono" : ""}>{r.id}</td>
                          {review.hasModes ? (
                            <>
                              <td>
                                <span className="badge badge-success badge-sm">new</span>
                              </td>
                              <td className="text-admin-dim2">—</td>
                              <td>{r.summary}</td>
                            </>
                          ) : (
                            <td>
                              <span className="badge badge-success badge-sm">new</span>
                            </td>
                          )}
                        </tr>
                      );
                    }
                    if (changes.length === 0) {
                      return (
                        <tr key={r.key} className="opacity-60">
                          <td />
                          <td className={review.hasModes ? "font-mono" : ""}>{r.id}</td>
                          <td colSpan={3}>{review.hasModes ? "unchanged" : "already there"}</td>
                        </tr>
                      );
                    }
                    return changes.map((c, i) => (
                      <tr key={`${r.key}-${c.field}`} className={off ? "opacity-50" : ""}>
                        <td>{i === 0 ? toggle : null}</td>
                        <td className="font-mono">{i === 0 ? r.id : ""}</td>
                        <td>{c.field}</td>
                        <td className="text-base-content-dim">{c.now || <span className="italic">blank</span>}</td>
                        <td>{c.after}</td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </DetailsPanel>
  );
}
