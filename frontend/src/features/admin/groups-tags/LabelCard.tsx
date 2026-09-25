import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { InlineConfirm, plural, useToast } from "@/features/admin/_shell";
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
  const id = useId();
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
  const inUse = list.filter((i) => i.talkgroups > 0).length;

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

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-box border border-admin-line bg-base-200"
    >
      <div className="border-b border-admin-line px-4 py-3">
        <h3 id={`${id}-title`} className="font-semibold">
          {title}{" "}
          <span className="text-sm font-normal text-base-content-dim">
            {list.length} · {inUse} in use
          </span>
        </h3>
        <p className="mt-0.5 text-xs text-base-content-dim">{help}</p>
      </div>

      <form onSubmit={(e) => void add(e)} className="flex gap-2 px-4 py-3">
        <input
          type="text"
          className="input input-sm w-full"
          aria-label={`New ${kind}`}
          placeholder={`New ${kind}`}
          value={draft}
          maxLength={64}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm shrink-0"
          disabled={busy || draft.trim() === ""}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add {kind}
        </button>
      </form>
      {addError && (
        <p role="alert" className="px-4 pb-2 text-sm text-error">
          {addError}
        </p>
      )}

      {loading && list.length === 0 ? (
        <div className="flex justify-center py-8">
          <span className="loading loading-spinner loading-sm" />
          <span className="sr-only">Loading</span>
        </div>
      ) : list.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-base-content-dim">
          No {kind}s yet. Add one above.
        </p>
      ) : (
        <ul className="divide-y divide-admin-line" aria-label={title}>
          {list.map((item) => {
            const active = editing?.id === item.id ? editing.mode : null;
            const others = list.filter((i) => i.id !== item.id);
            return (
              <li key={item.id} className="px-4 py-2">
                {active === "rename" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      className="input input-sm min-w-0 flex-1"
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
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                      onClick={cancel}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="min-w-0 flex-1 font-medium">{item.label}</span>
                    {item.talkgroups > 0 ? (
                      <Link
                        to={`/admin/systems?${kind}=${item.id}`}
                        className="badge badge-sm badge-ghost hover:badge-primary"
                        aria-label={`Show ${plural(item.talkgroups, "talkgroup")} in ${item.label}`}
                      >
                        {plural(item.talkgroups, "talkgroup")}
                      </Link>
                    ) : (
                      <span className="badge badge-sm badge-ghost opacity-60">unused</span>
                    )}
                    <span className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        aria-label={`Rename ${item.label}`}
                        title="Rename"
                        disabled={busy}
                        onClick={() => startRename(item)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        aria-label={`Delete ${item.label}`}
                        title="Delete"
                        disabled={busy}
                        onClick={() => startDelete(item)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                )}

                {active === "delete" && (
                  <div className="mt-2">
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
                            className="select select-sm w-full"
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
                  </div>
                )}
                {active && rowError && (
                  <p role="alert" className="mt-1 text-sm text-error">
                    {rowError}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
