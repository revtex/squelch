import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Headphones, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  formatAgo,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminGroup, AdminTag, AdminTalkgroup, AdminTalkgroupInput } from "@/types";
import TalkgroupFields from "./TalkgroupFields";
import { formatSeconds, fromTalkgroup, talkgroupTitle, toInput, type TalkgroupFormState } from "./systems";

export interface TalkgroupDetailsProps {
  systemRowId: number;
  talkgroup: AdminTalkgroup;
  groups: AdminGroup[];
  tags: AdminTag[];
  blocked: boolean;
  busy: boolean;
  error: string | null;
  onSave: (values: AdminTalkgroupInput) => void;
  onBlock: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** One talkgroup: activity, its fields to edit in place, and the rarer actions. */
export default function TalkgroupDetails({
  systemRowId,
  talkgroup,
  groups,
  tags,
  blocked,
  busy,
  error,
  onSave,
  onBlock,
  onDelete,
  onClose,
}: TalkgroupDetailsProps) {
  const id = useId();
  const [form, setForm] = useState<TalkgroupFormState>(() => fromTalkgroup(talkgroup));
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "block" | null>(null);
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

  return (
    <DetailsPanel
      title={talkgroupTitle(talkgroup)}
      subtitle={talkgroup.name ?? undefined}
      badges={blocked ? <span className="badge badge-warning badge-sm">blocked</span> : undefined}
      onClose={onClose}
      footer={
        confirm ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <FactList
        facts={[
          { label: "Calls, 24 h", value: (talkgroup.calls24h ?? 0).toLocaleString() },
          { label: "Last heard", value: talkgroup.lastHeard ? formatAgo(talkgroup.lastHeard) : "never" },
          { label: "Average length", value: formatSeconds(talkgroup.avgDurationMs) },
        ]}
      />

      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDirty(false);
          onSave(toInput(talkgroup.systemId, { ...form, talkgroupId: String(talkgroup.talkgroupId) }, talkgroup.order));
        }}
      >
        {error && (
          <p role="alert" className="alert alert-error text-sm">
            {error}
          </p>
        )}
        <TalkgroupFields id={id} form={form} groups={groups} tags={tags} numberEditable={false} onChange={set} />
      </form>

      <PanelSection title="More">
        {confirm === "delete" ? (
          <InlineConfirm
            title={`Delete ${talkgroupTitle(talkgroup)}?`}
            text="Its calls stay and show the number only. With auto-populate on, the next upload recreates it unlabeled unless you block it."
            button="Delete"
            danger
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={onDelete}
          />
        ) : confirm === "block" ? (
          <InlineConfirm
            title={`Block ${talkgroup.talkgroupId}?`}
            text="Uploads for this talkgroup are dropped from now on. The talkgroup and its calls stay until you delete them."
            button="Block"
            danger
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={onBlock}
          />
        ) : (
          <div className="space-y-1">
            <Link
              to={`/?system=${systemRowId}&talkgroup=${talkgroup.id}`}
              className="flex items-center gap-3 rounded-box px-2 py-2 text-sm hover:bg-base-200"
            >
              <Headphones className="h-4 w-4" aria-hidden="true" />
              <span>
                <span className="block">Listen to recent calls</span>
                <span className="block text-xs text-base-content-dim">Opens the scanner search on this talkgroup.</span>
              </span>
            </Link>
            {!blocked && (
              <ActionButton
                icon={<Ban className="h-4 w-4" />}
                label="Block from uploads"
                hint="Drop future calls on this talkgroup."
                disabled={busy}
                onClick={() => setConfirm("block")}
              />
            )}
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete talkgroup"
              hint="Calls stay, labelled by number."
              danger
              disabled={busy}
              onClick={() => setConfirm("delete")}
            />
          </div>
        )}
      </PanelSection>
    </DetailsPanel>
  );
}
