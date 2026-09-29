import { Fragment, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Plus, X } from "lucide-react";
import { Card, InlineConfirm, plural, useToast } from "@/features/admin/_shell";
import type { DeleteLabelPayload, DeleteLabelResult } from "@/types";

export interface LabelItem {
  id: number;
  label: string;
  talkgroups: number;
}

export interface LabelCardProps {
  /** "group" or "tag": used in every sentence and in the Systems link. */
  kind: "group" | "tag";
  title: string;
  /** What this kind is for, in a sentence. */
  help: string;
  items: LabelItem[] | undefined;
  loading: boolean;
  onCreate: (label: string) => Promise<unknown>;
  onRename: (id: number, label: string) => Promise<unknown>;
  onDelete: (payload: DeleteLabelPayload) => Promise<DeleteLabelResult>;
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * One list of labels (groups or tags): add a label in place, rename it in
 * place, and delete it with a question about where its talkgroups go.
 */
export default function LabelCard({
  kind,
  title,
  help,
  items,
  loading,
  onCreate,
  onRename,
  onDelete,
}: LabelCardProps) {
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The row being renamed or deleted, and which of the two. */
  const [editing, setEditing] = useState<{ id: number; mode: "rename" | "delete" } | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [moveTo, setMoveTo] = useState<string>("");
  const [rowError, setRowError] = useState<string | null>(null);

  const list = items ?? [];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const label = draft.trim();
    if (!label) return;
    setBusy(true);
    setAddError(null);
    try {
      await onCreate(label);
      setDraft("");
      toast.success(`Added ${kind} "${label}".`);
    } catch (err) {
      setAddError(message(err, `Failed to add the ${kind}.`));
    } finally {
      setBusy(false);
    }
  };

  const startRename = (item: LabelItem) => {
    setRowError(null);
    setRenameDraft(item.label);
    setEditing({ id: item.id, mode: "rename" });
  };

  const startDelete = (item: LabelItem) => {
    setRowError(null);
    setMoveTo("");
    setEditing({ id: item.id, mode: "delete" });
  };

  const cancel = () => {
    setEditing(null);
    setRowError(null);
  };

  const rename = async (item: LabelItem) => {
    const label = renameDraft.trim();
    if (!label || label === item.label) {
      cancel();
      return;
    }
    setBusy(true);
    setRowError(null);
    try {
      await onRename(item.id, label);
      setEditing(null);
      toast.success(`Renamed "${item.label}" to "${label}".`);
    } catch (err) {
      setRowError(message(err, `Failed to rename the ${kind}.`));
    } finally {
      setBusy(false);
    }
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>, item: LabelItem) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void rename(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const remove = async (item: LabelItem) => {
    setBusy(true);
    setRowError(null);
    const target = moveTo === "" ? null : Number(moveTo);
    const targetLabel = target === null ? `no ${kind}` : list.find((i) => i.id === target)?.label;
    try {
      const result =
        item.talkgroups > 0
          ? await onDelete({ id: item.id, reassign: true, moveTo: target })
          : await onDelete({ id: item.id });
      setEditing(null);
      if (result.moved > 0) {
        toast.success(
          `Deleted ${kind} "${item.label}". ${plural(result.moved, "talkgroup")} moved to ${targetLabel}.`,
        );
      } else {
        toast.success(`Deleted ${kind} "${item.label}".`, {
          undo: async () => {
            try {
              await onCreate(item.label);
            } catch (err) {
              toast.error(message(err, `Could not bring "${item.label}" back.`));
            }
          },
        });
      }
    } catch (err) {
      setRowError(message(err, `Failed to delete the ${kind}.`));
    } finally {
      setBusy(false);
    }
  };

  const addRow = (
    <form onSubmit={(e) => void add(e)} className="flex gap-2">
      <input
        type="text"
        className="input min-w-0 flex-1"
        aria-label={`New ${kind}`}
        placeholder={`New ${kind} name`}
        value={draft}
        maxLength={64}
        onChange={(e) => setDraft(e.target.value)}
        disabled={busy}
      />
      <button
        type="submit"
        className="btn shrink-0"
        aria-label={`Add ${kind}`}
        disabled={busy || draft.trim() === ""}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add
      </button>
    </form>
  );

  const Label = kind === "group" ? "Group" : "Tag";

  return (
    <Card title={title} count={list.length} meta={<span className="text-xs text-base-content-dim">{help}</span>} bodyClassName="">
      {loading && list.length === 0 ? (
        <div className="flex justify-center py-8">
          <span className="loading loading-spinner loading-sm" />
          <span className="sr-only">Loading</span>
        </div>
      ) : (
        <table className="table max-sm:block" aria-label={title}>
          <thead className="max-sm:hidden">
            <tr>
              <th scope="col">{Label}</th>
              <th scope="col">Talkgroups</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {list.length === 0 && (
              <tr className="max-sm:block">
                <td colSpan={3} className="py-6 text-center text-base-content-dim max-sm:block">
                  No {kind}s yet. Add one below.
                </td>
              </tr>
            )}
            {list.map((item) => {
              const active = editing?.id === item.id ? editing.mode : null;
              const others = list.filter((i) => i.id !== item.id);
              return (
                <Fragment key={item.id}>
                  <tr className="max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:px-4 max-sm:py-3 max-sm:[&>td]:border-0 max-sm:[&>td]:p-0">
                    {active === "rename" ? (
                      <td colSpan={3} className="max-sm:col-span-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            className="input min-w-0 flex-1"
                            aria-label={`New name for ${item.label}`}
                            value={renameDraft}
                            maxLength={64}
                            autoFocus
                            disabled={busy}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => onRenameKey(e, item)}
                          />
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busy}
                            onClick={() => void rename(item)}
                          >
                            <Check className="h-4 w-4" aria-hidden="true" />
                            Save
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
                            <X className="h-4 w-4" aria-hidden="true" />
                            Cancel
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td>
                          <span className="flex flex-wrap items-center gap-2">
                            {item.label}
                            {item.talkgroups === 0 && <span className="badge badge-neutral">unused</span>}
                          </span>
                        </td>
                        <td className="tabular-nums max-sm:text-right">
                          <span className="block text-[11px] uppercase tracking-wide text-base-content-dim sm:hidden">
                            Talkgroups
                          </span>
                          {item.talkgroups.toLocaleString()}
                        </td>
                        <td className="max-sm:col-span-2 max-sm:pt-2">
                          <span className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-label={`Rename ${item.label}`}
                              disabled={busy}
                              onClick={() => startRename(item)}
                            >
                              Rename
                            </button>
                            {item.talkgroups > 0 && (
                              <Link
                                to={`/admin/systems?${kind}=${item.id}`}
                                className="btn btn-ghost btn-sm"
                                aria-label={`Show ${plural(item.talkgroups, "talkgroup")} in ${item.label}`}
                              >
                                Show
                              </Link>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm text-error"
                              aria-label={`Delete ${item.label}`}
                              disabled={busy}
                              onClick={() => startDelete(item)}
                            >
                              Delete
                            </button>
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                  {(active === "delete" || (active && rowError)) && (
                    <tr className="max-sm:block">
                      <td colSpan={3} className="max-sm:block">
                        {active === "delete" && (
                          <InlineConfirm
                            title={`Delete ${kind} "${item.label}"?`}
                            text={
                              item.talkgroups > 0
                                ? `${plural(item.talkgroups, "talkgroup")} ${item.talkgroups === 1 ? "uses" : "use"} it. Choose where ${item.talkgroups === 1 ? "it goes" : "they go"} first.`
                                : "Nothing uses it. You can undo for ten seconds afterwards."
                            }
                            button={item.talkgroups > 0 ? "Move and delete" : "Delete"}
                            danger
                            busy={busy}
                            onCancel={cancel}
                            onConfirm={() => void remove(item)}
                          >
                            {item.talkgroups > 0 && (
                              <label className="fieldset">
                                <span className="fieldset-legend">Move its talkgroups to</span>
                                <select
                                  className="select w-full"
                                  value={moveTo}
                                  onChange={(e) => setMoveTo(e.target.value)}
                                >
                                  <option value="">No {kind}</option>
                                  {others.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                          </InlineConfirm>
                        )}
                        {rowError && (
                          <p role="alert" className="mt-1 text-sm text-error">
                            {rowError}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            <tr className="max-sm:block">
              <td colSpan={3} className="max-sm:block">
                {addRow}
                {addError && (
                  <p role="alert" className="mt-2 text-sm text-error">
                    {addError}
                  </p>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}
