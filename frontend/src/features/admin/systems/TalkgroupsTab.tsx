import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  CHIP,
  CHIP_OFF,
  CHIP_ON,
  DataTable,
  InlineConfirm,
  SearchBox,
  formatAgo,
  plural,
  type Column,
} from "@/features/admin/_shell";
import type { AdminGroup, AdminTag, AdminTalkgroup } from "@/types";
import { LED_COLORS, isUnlabeled, labelMap, ledCss, matchesTalkgroup } from "./systems";

export interface BulkChange {
  ids: number[];
  groupId?: number | null;
  tagId?: number | null;
  led?: string | null;
}

export interface TalkgroupsTabProps {
  systemRowId: number;
  talkgroups: AdminTalkgroup[];
  groups: AdminGroup[];
  tags: AdminTag[];
  blocked: ReadonlySet<number>;
  loading: boolean;
  busy: boolean;
  /** Prefilled from `?group=` / `?tag=` links. */
  initialGroup: number | null;
  initialTag: number | null;
  openId: number | null;
  onOpen: (tg: AdminTalkgroup, trigger: HTMLElement) => void;
  onAdd: () => void;
  onBulk: (change: BulkChange) => Promise<boolean>;
  onBlockMany: (talkgroupIds: number[]) => Promise<boolean>;
  onDeleteMany: (ids: number[]) => Promise<boolean>;
}

type Pending = { kind: "block" } | { kind: "delete" } | null;

/** The talkgroup table with search, group/tag filters and the selection bar. */
export default function TalkgroupsTab({
  systemRowId,
  talkgroups,
  groups,
  tags,
  blocked,
  loading,
  busy,
  initialGroup,
  initialTag,
  openId,
  onOpen,
  onAdd,
  onBulk,
  onBlockMany,
  onDeleteMany,
}: TalkgroupsTabProps) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>(initialGroup != null ? String(initialGroup) : "");
  const [tag, setTag] = useState<string>(initialTag != null ? String(initialTag) : "");
  const [unlabeledOnly, setUnlabeledOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [pending, setPending] = useState<Pending>(null);

  const groupNames = useMemo(() => labelMap(groups), [groups]);
  const tagNames = useMemo(() => labelMap(tags), [tags]);

  const rows = useMemo(
    () =>
      talkgroups.filter(
        (tg) =>
          matchesTalkgroup(tg, query, groupNames, tagNames) &&
          (group === "" || (group === "none" ? tg.groupId == null : tg.groupId === Number(group))) &&
          (tag === "" || (tag === "none" ? tg.tagId == null : tg.tagId === Number(tag))) &&
          (!unlabeledOnly || isUnlabeled(tg)),
      ),
    [talkgroups, query, group, tag, unlabeledOnly, groupNames, tagNames],
  );
  const unlabeled = useMemo(() => talkgroups.filter(isUnlabeled).length, [talkgroups]);
  const ids = useMemo(() => [...selected], [selected]);

  const columns: Column<AdminTalkgroup>[] = [
    {
      id: "tg",
      header: "TG",
      phone: "show",
      sortValue: (tg) => tg.talkgroupId,
      cell: (tg) => (
        <span className="flex items-center gap-2">
          <span className="font-mono">{tg.talkgroupId}</span>
          {blocked.has(tg.talkgroupId) && <span className="badge badge-warning">blocked</span>}
        </span>
      ),
    },
    {
      id: "label",
      header: "Label · name",
      phone: "title",
      sortValue: (tg) => tg.label ?? "",
      className: "min-w-0",
      cell: (tg) =>
        isUnlabeled(tg) ? (
          <span className="block min-w-0">
            <span className="block text-base-content-dim">TG {tg.talkgroupId}</span>
            <span className="badge badge-warning mt-0.5">unlabeled</span>
          </span>
        ) : (
          <span className="block min-w-0">
            <span className="block truncate font-medium">{tg.label ?? "—"}</span>
            {(tg.name || tg.led) && (
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-base-content-dim">
                {tg.name && <span className="truncate">{tg.name}</span>}
                {tg.name && tg.led && <span aria-hidden="true">·</span>}
                {tg.led && (
                  <>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: ledCss(tg.led) }}
                      aria-hidden="true"
                    />
                    {tg.led}
                  </>
                )}
              </span>
            )}
          </span>
        ),
    },
    {
      id: "group",
      header: "Group",
      phone: "hide",
      sortValue: (tg) => (tg.groupId != null ? (groupNames.get(tg.groupId) ?? "") : ""),
      cell: (tg) => (tg.groupId != null ? (groupNames.get(tg.groupId) ?? "—") : <span className="text-admin-dim2">—</span>),
    },
    {
      id: "tag",
      header: "Tag",
      phone: "hide",
      sortValue: (tg) => (tg.tagId != null ? (tagNames.get(tg.tagId) ?? "") : ""),
      cell: (tg) => (tg.tagId != null ? (tagNames.get(tg.tagId) ?? "—") : <span className="text-admin-dim2">—</span>),
    },
    {
      id: "calls",
      header: "Calls 24 h",
      phone: "hide",
      sortValue: (tg) => tg.calls24h ?? 0,
      cell: (tg) => (tg.calls24h ? tg.calls24h.toLocaleString() : <span className="text-admin-dim2">0</span>),
    },
    {
      id: "last",
      header: "Last heard",
      phone: "show",
      sortValue: (tg) => tg.lastHeard ?? 0,
      cell: (tg) => (tg.lastHeard ? formatAgo(tg.lastHeard) : <span className="text-admin-dim2">never</span>),
    },
  ];

  const apply = async (change: Omit<BulkChange, "ids">) => {
    if (await onBulk({ ids, ...change })) setSelected(new Set());
  };

  const bulk =
    pending?.kind === "block" ? (
      <InlineConfirm
        title={`Block ${plural(ids.length, "talkgroup")}?`}
        text="Future uploads on them are dropped. The talkgroups and their calls stay."
        button="Block"
        danger
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const tgIds = talkgroups.filter((t) => selected.has(t.id)).map((t) => t.talkgroupId);
          void onBlockMany(tgIds).then((ok) => {
            setPending(null);
            if (ok) setSelected(new Set());
          });
        }}
      />
    ) : pending?.kind === "delete" ? (
      <InlineConfirm
        title={`Delete ${plural(ids.length, "talkgroup")}?`}
        text="Their calls stay, labelled by number. With auto-populate on they come back unlabeled on the next upload."
        button="Delete"
        danger
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          void onDeleteMany(ids).then((ok) => {
            setPending(null);
            if (ok) setSelected(new Set());
          });
        }}
      />
    ) : (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{plural(ids.length, "talkgroup")} selected</span>
        <select
          className="select select-sm w-40"
          aria-label="Set group"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "") return;
            void apply({ groupId: e.target.value === "none" ? null : Number(e.target.value) });
          }}
        >
          <option value="">Set group…</option>
          <option value="none">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select
          className="select select-sm w-40"
          aria-label="Set tag"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "") return;
            void apply({ tagId: e.target.value === "none" ? null : Number(e.target.value) });
          }}
        >
          <option value="">Set tag…</option>
          <option value="none">No tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          className="select select-sm w-40"
          aria-label="Set LED colour"
          value=""
          disabled={busy}
          onChange={(e) => {
            if (e.target.value === "") return;
            void apply({ led: e.target.value === "none" ? null : e.target.value });
          }}
        >
          <option value="">Set LED…</option>
          <option value="none">System default</option>
          {LED_COLORS.map((c) => (
            <option key={c} value={c}>
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setPending({ kind: "block" })}>
          Block
        </button>
        <button type="button" className="btn btn-sm btn-error btn-outline" disabled={busy} onClick={() => setPending({ kind: "delete" })}>
          Delete
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Filter by ID, label, name, group or tag"
          className="w-full md:max-w-[340px] md:min-w-[180px] md:flex-[1_1_200px]"
        />
        <select className="select w-36" aria-label="Filter by group" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Any group</option>
          <option value="none">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
        <select className="select w-36" aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">Any tag</option>
          <option value="none">No tag</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {unlabeled > 0 && (
          <button
            type="button"
            className={`${CHIP} ${unlabeledOnly ? CHIP_ON : CHIP_OFF}`}
            aria-pressed={unlabeledOnly}
            onClick={() => setUnlabeledOnly((v) => !v)}
          >
            {unlabeled} unlabeled
          </button>
        )}
        <button type="button" className="btn ms-auto" onClick={onAdd}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add talkgroup
        </button>
      </div>
      <DataTable
        key={systemRowId}
        columns={columns}
        rows={rows}
        rowKey={(tg) => tg.id}
        caption="Talkgroups"
        loading={loading}
        defaultSort={{ id: "tg", dir: "asc" }}
        pageSize={50}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={bulk}
        onOpen={onOpen}
        openKey={openId}
        rowLabel={(tg) => `${tg.talkgroupId}${tg.label ? ` ${tg.label}` : ""}`}
        empty={
          talkgroups.length === 0
            ? "No talkgroups yet. Import a CSV, add one, or let uploads create them."
            : "No talkgroups match."
        }
      />
    </div>
  );
}
