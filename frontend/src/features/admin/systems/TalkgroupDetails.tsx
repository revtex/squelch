import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Headphones, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  InlineConfirm,
  PanelSection,
  StatGrid,
  StatTile,
  formatAgo,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminGroup, AdminTag, AdminTalkgroup, AdminTalkgroupInput } from "@/types";
import TalkgroupFields from "./TalkgroupFields";
import { formatSeconds, fromTalkgroup, talkgroupTitle, toInput, type TalkgroupFormState } from "./systems";

export interface TalkgroupDetailsProps {
  systemRowId: number;
  /** The system's name, for the panel's subtitle. */
  systemName: string;
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
  systemName,
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
      subtitle={[talkgroup.name, systemName].filter(Boolean).join(" · ")}
      badges={blocked ? <span className="badge badge-warning">blocked</span> : undefined}
      onClose={onClose}
      footer={
        confirm ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <StatGrid className="grid-cols-3">
        <StatTile label="Calls 24 h" value={(talkgroup.calls24h ?? 0).toLocaleString()} />
        <StatTile label="Last heard" small value={talkgroup.lastHeard ? formatAgo(talkgroup.lastHeard) : "never"} />
        <StatTile label="Avg length" small value={formatSeconds(talkgroup.avgDurationMs)} />
      </StatGrid>

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
          <div className="flex flex-col gap-2">
            <Link
              to={`/?system=${systemRowId}&talkgroup=${talkgroup.id}`}
              className="btn btn-block min-h-11 justify-start whitespace-normal px-3.5 py-2.5 text-left"
            >
              <Headphones className="h-4 w-4" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="font-medium">Listen to recent calls</span>
                <span className="mt-0.5 text-xs font-normal text-base-content-dim">Opens the scanner search on this talkgroup.</span>
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
