import { useId, useMemo, useState } from "react";
import { DetailsPanel, FilterChips, plural, usePreviewTalkgroupImportMutation, useApplyTalkgroupImportMutation } from "@/features/admin/_shell";
import type { AdminSystem, ImportMode, ImportPreviewRow, ImportRow, TalkgroupImportPreview, TalkgroupImportResult } from "@/types";
import { FORMAT_LABEL, applicableChanges, rowsToApply } from "./systems";

export interface ImportWizardProps {
  system: AdminSystem;
  onClose: () => void;
  onDone: (result: TalkgroupImportResult) => void;
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

/** Choose a CSV, review what it would change, apply it. */
export default function ImportWizard({ system, onClose, onDone }: ImportWizardProps) {
  const id = useId();
  const [preview, { isLoading: previewing }] = usePreviewTalkgroupImportMutation();
  const [apply, { isLoading: applying }] = useApplyTalkgroupImportMutation();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TalkgroupImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("fill");
  const [view, setView] = useState<View>("changes");
  const [excluded, setExcluded] = useState<Set<number>>(() => new Set());

  const toApply = useMemo(() => (result ? rowsToApply(result.rows, mode, excluded) : []), [result, mode, excluded]);
  const changeCount = useMemo(
    () => toApply.reduce((n, r) => n + (r.status === "new" ? 1 : applicableChanges(r, mode).length), 0),
    [toApply, mode],
  );

  const runPreview = async () => {
    if (!file) return;
    setError(null);
    const body = new FormData();
    body.append("system_id", String(system.id));
    body.append("file", file);
    try {
      const p = await preview(body).unwrap();
      setResult(p);
      setExcluded(new Set());
      setView(p.changed + p.new > 0 ? "changes" : p.problems.length > 0 ? "problems" : "all");
    } catch (e) {
      setError(messageOf(e, "The file could not be read."));
    }
  };

  const runApply = async () => {
    if (!result) return;
    setError(null);
    try {
      const r = await apply({ systemId: system.id, mode, rows: toApply.map(toImportRow) }).unwrap();
      onDone(r);
    } catch (e) {
      setError(messageOf(e, "The import failed."));
    }
  };

  const visible: ImportPreviewRow[] = useMemo(() => {
    if (!result) return [];
    if (view === "all") return result.rows;
    if (view === "changes") return result.rows.filter((r) => r.status === "new" || applicableChanges(r, mode).length > 0);
    return [];
  }, [result, view, mode]);

  const busy = previewing || applying;

  return (
    <DetailsPanel
      title={`Import talkgroups into ${system.label}`}
      subtitle={result ? `${FORMAT_LABEL[result.format] ?? result.format} file · ${plural(result.rows.length, "row")}` : "Squelch, rdio-scanner and RadioReference CSV files are recognised."}
      size="wide"
      onClose={onClose}
      footer={
        result ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)} disabled={busy}>
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
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void runPreview()}>
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

      {!result ? (
        <div className="space-y-3">
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
          <p className="text-sm text-base-content/70">
            Nothing changes until you review the result. Existing talkgroups are matched by number; groups and tags named in the file are created if missing.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{plural(result.new, "new talkgroup")}</strong>, <strong>{plural(result.changed, "change")}</strong>,{" "}
            {result.unchanged} unchanged
            {result.problems.length > 0 && (
              <>
                , <strong className="text-warning">{plural(result.problems.length, "row")} skipped</strong>
              </>
            )}
            .
          </p>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Existing talkgroups</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" className="radio radio-sm" name={`${id}-mode`} checked={mode === "fill"} onChange={() => setMode("fill")} />
              Fill in blanks only
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" className="radio radio-sm" name={`${id}-mode`} checked={mode === "overwrite"} onChange={() => setMode("overwrite")} />
              Overwrite label, name, group and tag
            </label>
          </fieldset>

          <FilterChips
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { id: "changes", label: "Changes only", count: result.new + result.changed },
              { id: "all", label: "All rows", count: result.rows.length },
              { id: "problems", label: "Problems", count: result.problems.length },
            ]}
          />

          {view === "problems" ? (
            result.problems.length === 0 ? (
              <p className="text-sm text-base-content/60">Every row was read.</p>
            ) : (
              <ul className="list-inside list-disc text-sm">
                {result.problems.map((p) => (
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
                    <th>TG</th>
                    <th>Field</th>
                    <th>Now</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-base-content/60">
                        Nothing would change in this mode.
                      </td>
                    </tr>
                  )}
                  {visible.map((r) => {
                    const changes = r.status === "new" ? [] : applicableChanges(r, mode);
                    const off = excluded.has(r.talkgroupId);
                    const toggle = (
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        aria-label={`Apply ${r.talkgroupId}`}
                        checked={!off}
                        onChange={() =>
                          setExcluded((s) => {
                            const n = new Set(s);
                            if (n.has(r.talkgroupId)) n.delete(r.talkgroupId);
                            else n.add(r.talkgroupId);
                            return n;
                          })
                        }
                      />
                    );
                    if (r.status === "new") {
                      return (
                        <tr key={r.talkgroupId} className={off ? "opacity-50" : ""}>
                          <td>{toggle}</td>
                          <td className="font-mono">{r.talkgroupId}</td>
                          <td>
                            <span className="badge badge-success badge-sm">new</span>
                          </td>
                          <td className="text-base-content/40">—</td>
                          <td>{[r.label, r.name].filter(Boolean).join(" · ") || "unlabeled"}</td>
                        </tr>
                      );
                    }
                    if (changes.length === 0) {
                      return (
                        <tr key={r.talkgroupId} className="opacity-60">
                          <td />
                          <td className="font-mono">{r.talkgroupId}</td>
                          <td colSpan={3}>unchanged</td>
                        </tr>
                      );
                    }
                    return changes.map((c, i) => (
                      <tr key={`${r.talkgroupId}-${c.field}`} className={off ? "opacity-50" : ""}>
                        <td>{i === 0 ? toggle : null}</td>
                        <td className="font-mono">{i === 0 ? r.talkgroupId : ""}</td>
                        <td>{c.field}</td>
                        <td className="text-base-content/60">{c.now || <span className="italic">blank</span>}</td>
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
