import { useEffect, useId, useState } from "react";
import { DetailsPanel, useNavigationGuard } from "@/features/admin/_shell";
import type { AdminGroup, AdminTag, AdminTalkgroupInput } from "@/types";
import TalkgroupFields from "./TalkgroupFields";
import { fromTalkgroup, toInput, type TalkgroupFormState } from "./systems";

export interface TalkgroupFormProps {
  systemId: number;
  groups: AdminGroup[];
  tags: AdminTag[];
  busy: boolean;
  error: string | null;
  /** `again` keeps the form open for the next talkgroup. */
  onSubmit: (values: AdminTalkgroupInput, again: boolean) => Promise<boolean>;
  onClose: () => void;
}

/** Add a talkgroup to a system, optionally staying open for the next one. */
export default function TalkgroupForm({ systemId, groups, tags, busy, error, onSubmit, onClose }: TalkgroupFormProps) {
  const id = useId();
  const [form, setForm] = useState<TalkgroupFormState>(() => fromTalkgroup(null));
  const [dirty, setDirty] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const { setGuard } = useNavigationGuard();
  const formId = `${id}-form`;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof TalkgroupFormState>(key: K, value: TalkgroupFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = async (again: boolean) => {
    const values = toInput(systemId, form, 0);
    setDirty(false);
    const ok = await onSubmit(values, again);
    if (ok && again) {
      setAdded((a) => [...a, form.label.trim() ? `${form.talkgroupId} ${form.label.trim()}` : form.talkgroupId]);
      // Keep the group, tag and colour: the next talkgroup is usually a neighbour.
      setForm((f) => ({ ...fromTalkgroup(null), groupId: f.groupId, tagId: f.tagId, led: f.led }));
    }
  };

  return (
    <DetailsPanel
      title="Add talkgroup"
      subtitle={added.length > 0 ? `Added so far: ${added.join(", ")}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {added.length > 0 ? "Done" : "Cancel"}
          </button>
          <button type="button" className="btn" disabled={busy || form.talkgroupId === ""} onClick={() => void save(true)}>
            Save and add another
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy || form.talkgroupId === ""}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {error && (
          <p role="alert" className="alert alert-error text-sm">
            {error}
          </p>
        )}
        <TalkgroupFields id={id} form={form} groups={groups} tags={tags} numberEditable onChange={set} />
      </form>
    </DetailsPanel>
  );
}
