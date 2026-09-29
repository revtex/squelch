// Restore from a backup, guarded: choose the file, review it against what
// is live, choose merge or replace, type RESTORE. The server saves the
// previous configuration beside the database before it writes.
import { useId, useMemo, useState } from "react";
import { DetailsPanel, InlineConfirm, useBackupPreviewMutation, useImportConfigMutation } from "@/features/admin/_shell";
import type { BackupPreview, RestoreMode, RestoreResult } from "@/types";
import { RESTORE_WORD, restoreNote, restoreTotals } from "./tools";

export interface RestorePanelProps {
  onClose: () => void;
  onDone: (result: RestoreResult) => void;
}

function messageOf(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Reads the chosen file as a backup object, or explains why it is not one. */
async function readBackup(file: File): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("The file is not JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("The file is not a Squelch backup.");
  }
  return parsed as Record<string, unknown>;
}

type Step = "choose" | "review" | "confirm";

export default function RestorePanel({ onClose, onDone }: RestorePanelProps) {
  const id = useId();
  const [preview, { isLoading: previewing }] = useBackupPreviewMutation();
  const [restore, { isLoading: restoring }] = useImportConfigMutation();
  const [file, setFile] = useState<File | null>(null);
  const [backup, setBackup] = useState<Record<string, unknown> | null>(null);
  const [review, setReview] = useState<BackupPreview | null>(null);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [step, setStep] = useState<Step>("choose");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const totals = useMemo(() => (review ? restoreTotals(review.entities, mode) : { added: 0, changed: 0, removed: 0 }), [review, mode]);
  const blocked = !!review && review.warnings.some((w) => w.includes("encryption key"));

  const runPreview = async () => {
    if (!file) return;
    setError(null);
    try {
      const data = await readBackup(file);
      const p = await preview(data).unwrap();
      setBackup(data);
      setReview(p);
      setStep("review");
    } catch (e) {
      setError(messageOf(e, "The file could not be compared with the live data."));
    }
  };

  const runRestore = async () => {
    if (!backup) return;
    setError(null);
    try {
      const r = await restore({ ...backup, mode }).unwrap();
      onDone(r);
    } catch (e) {
      setError(messageOf(e, "The restore failed; nothing was changed."));
      setStep("review");
    }
  };

  const busy = previewing || restoring;
  const stepIndex = step === "choose" ? 1 : step === "review" ? 2 : 3;

  return (
    <DetailsPanel
      title="Restore from backup"
      subtitle={file ? file.name : "A configuration backup downloaded from this page, or from another Squelch."}
      size="wide"
      onClose={onClose}
      footer={
        step === "choose" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!file || busy} onClick={() => void runPreview()}>
              {previewing ? "Comparing…" : "Review"}
            </button>
          </>
        ) : step === "review" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setStep("choose")} disabled={busy}>
              Back
            </button>
            <button type="button" className={`btn ${mode === "replace" ? "btn-error" : "btn-primary"}`} disabled={busy || blocked} onClick={() => setStep("confirm")}>
              {mode === "replace" ? "Replace everything…" : "Merge…"}
            </button>
          </>
        ) : null
      }
    >
      <ul className="steps steps-horizontal w-full text-xs" aria-label="Restore steps">
        {["Choose file", "Review", "Restore"].map((label, i) => (
          <li key={label} className={`step ${i < stepIndex ? "step-primary" : ""}`} aria-current={i + 1 === stepIndex ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="alert alert-error text-sm">
          {error}
        </p>
      )}

      {step === "choose" && (
        <div className="space-y-3">
          <label htmlFor={`${id}-file`} className="block text-sm font-medium">
            Backup file
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept=".json,application/json"
            className="file-input w-full"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-base-content-dim">
            Nothing changes until you have reviewed the file against what is here and confirmed. Passwords are never in a backup: a user the
            restore adds cannot sign in until an admin sets a password under Users.
          </p>
        </div>
      )}

      {step !== "choose" && review && (
        <div className="space-y-4">
          {review.warnings.map((w) => (
            <p key={w} role="alert" className="alert alert-warning text-sm">
              {w}
            </p>
          ))}

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">How to apply</legend>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="radio radio-sm mt-0.5" name={`${id}-mode`} checked={mode === "merge"} onChange={() => setMode("merge")} disabled={step === "confirm"} />
              <span>
                <span className="font-medium">Merge</span>: add and update, never delete.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="radio radio-sm mt-0.5" name={`${id}-mode`} checked={mode === "replace"} onChange={() => setMode("replace")} disabled={step === "confirm"} />
              <span>
                <span className="font-medium">Replace everything</span>: the tables in the file end up exactly as the file has them; what the file
                lacks is removed. Settings are only ever added or updated; your own account and the primary admin stay.
              </span>
            </label>
          </fieldset>

          <div className="overflow-x-auto">
            <table className="table table-sm">
              <caption className="sr-only">What the restore would change</caption>
              <thead>
                <tr>
                  <th>Data</th>
                  <th className="text-right">In file</th>
                  <th className="text-right">Now</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {review.entities.map((e) => (
                  <tr key={e.key} className={e.included ? "" : "opacity-60"}>
                    <td className="font-medium">{e.label}</td>
                    <td className="text-right tabular-nums">{e.included ? e.inFile : "—"}</td>
                    <td className="text-right tabular-nums">{e.now}</td>
                    <td className={mode === "replace" && e.removed > 0 ? "text-error" : ""}>{restoreNote(e, mode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm" role="status">
            {mode === "replace"
              ? `${totals.added} added, ${totals.changed} updated, ${totals.removed} removed.`
              : `${totals.added} added, ${totals.changed} updated, nothing removed.`}{" "}
            A copy of the current configuration is saved beside the database first.
          </p>

          {step === "confirm" && (
            <InlineConfirm
              title={mode === "replace" ? "Replace the configuration with this file?" : "Merge this file into the configuration?"}
              text={
                mode === "replace"
                  ? `${totals.removed} ${totals.removed === 1 ? "thing" : "things"} here and not in the file will be deleted. Type ${RESTORE_WORD} to continue.`
                  : `Type ${RESTORE_WORD} to continue.`
              }
              button={mode === "replace" ? "Replace everything" : "Merge"}
              danger={mode === "replace"}
              busy={restoring}
              ready={typed.trim().toUpperCase() === RESTORE_WORD}
              onCancel={() => {
                setTyped("");
                setStep("review");
              }}
              onConfirm={() => void runRestore()}
            >
              <label htmlFor={`${id}-typed`} className="sr-only">
                Type {RESTORE_WORD} to continue
              </label>
              <input
                id={`${id}-typed`}
                type="text"
                className="input input-sm w-full font-mono"
                autoComplete="off"
                placeholder={RESTORE_WORD}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </InlineConfirm>
          )}
        </div>
      )}
    </DetailsPanel>
  );
}
