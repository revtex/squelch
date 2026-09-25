import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Copy } from "lucide-react";
import {
  COUNT,
  DataTable,
  DetailsPanel,
  FilterChips,
  InlineConfirm,
  PageHeader,
  SearchBox,
  formatAgo,
  formatDateTime,
  formatDay,
  formatUntil,
  formatWhen,
  plural,
  useDeleteSharedLinkMutation,
  useDetails,
  useGetConfigQuery,
  useGetSharedLinksQuery,
  useHour12,
  useRestoreSharedLinkMutation,
  useRevokeExpiredSharedLinksMutation,
  useToast,
  type Column,
} from "@/features/admin/_shell";
import type { SharedLinkAdmin } from "@/types";

type Filter = "all" | "active" | "expired";

type Panel = { key: string; kind: "bulk" };

function callTitle(l: SharedLinkAdmin): string {
  return l.talkgroupLabel || l.talkgroupName || `Call ${l.callId}`;
}

function linkUrl(l: SharedLinkAdmin): string {
  return `${window.location.origin}/call/${l.token}`;
}

/** "0:41", "1:12", "12:05". */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function matches(l: SharedLinkAdmin, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${l.talkgroupLabel} ${l.talkgroupName} ${l.systemLabel} ${l.sharedBy}`
    .toLowerCase()
    .includes(needle);
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Calls listeners have shared by link: who, when, how often opened, and a way to take a link back. */
export default function SharedLinksPanel() {
  const { data: links, isLoading, isError } = useGetSharedLinksQuery();
  const { data: config } = useGetConfigQuery();
  const [deleteLink] = useDeleteSharedLinkMutation();
  const [restoreLink] = useRestoreSharedLinkMutation();
  const [revokeExpired, { isLoading: revokingExpired }] = useRevokeExpiredSharedLinksMutation();
  const toast = useToast();
  const hour12 = useHour12();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const p = panel.selected;

  const all = useMemo(() => links ?? [], [links]);
  const expiredCount = all.filter((l) => l.expired).length;
  const rows = useMemo(
    () =>
      all.filter(
        (l) =>
          (filter === "all" || (filter === "expired") === l.expired) && matches(l, query),
      ),
    [all, filter, query],
  );
  const expiryDays = Number(
    config?.settings.find((s) => s.key === "sharedLinkExpiry")?.value ?? "0",
  );

  const copy = async (l: SharedLinkAdmin) => {
    try {
      await navigator.clipboard.writeText(linkUrl(l));
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy. Open the link and copy it from the address bar.");
    }
  };

  const undoRevoke = (l: SharedLinkAdmin) => async () => {
    try {
      await restoreLink({
        callId: l.callId,
        userId: l.userId,
        token: l.token,
        createdAt: l.createdAt,
        expiresAt: l.expiresAt,
      }).unwrap();
    } catch (e) {
      toast.error(message(e, "Could not put the link back."));
    }
  };

  const revokeOne = async (l: SharedLinkAdmin) => {
    try {
      await deleteLink(l.id).unwrap();
      toast.success(
        l.expired ? `Removed the link to ${callTitle(l)}.` : `Revoked the link to ${callTitle(l)}.`,
        { undo: undoRevoke(l) },
      );
    } catch (e) {
      toast.error(message(e, "Could not revoke the link."));
    }
  };

  const revokeSelected = async () => {
    setBusy(true);
    setError(null);
    const chosen = all.filter((l) => selected.has(l.id));
    let done = 0;
    let failed: string | null = null;
    for (const l of chosen) {
      try {
        await deleteLink(l.id).unwrap();
        done++;
      } catch (e) {
        failed = message(e, "Could not revoke a link.");
      }
    }
    setBusy(false);
    if (failed && done === 0) {
      setError(failed);
      return;
    }
    setSelected(new Set());
    panel.close();
    toast.success(`Revoked ${plural(done, "link")}.`);
    if (failed) toast.error(failed);
  };

  const revokeAllExpired = async () => {
    try {
      const { revoked } = await revokeExpired().unwrap();
      toast.success(
        revoked === 0 ? "No expired links to revoke." : `Revoked ${plural(revoked, "expired link")}.`,
      );
    } catch (e) {
      toast.error(message(e, "Could not revoke expired links."));
    }
  };

  const columns: Column<SharedLinkAdmin>[] = [
    {
      id: "call",
      header: "Call",
      phone: "title",
      sortValue: (l) => -l.dateTime,
      cell: (l) => (
        <>
          <span>
            <b className="font-semibold">{callTitle(l)}</b>
            {" · "}
            <span title={formatDateTime(l.dateTime)}>{formatWhen(l.dateTime, { hour12 })}</span>
            {" · "}
            <span className="tabular-nums">{clock(l.duration / 1000)}</span>
          </span>
          <span className="block text-xs text-base-content-dim">
            {l.systemLabel || "Unknown system"}
            {l.talkgroupName && l.talkgroupLabel ? ` · ${l.talkgroupName}` : ""}
          </span>
        </>
      ),
    },
    {
      id: "shared",
      header: "Shared by",
      sortValue: (l) => -l.createdAt,
      cell: (l) => (
        <span title={formatDateTime(l.createdAt)}>
          {l.sharedBy || "unknown"} · {formatAgo(l.createdAt)}
        </span>
      ),
    },
    {
      id: "opens",
      header: "Opened",
      sortValue: (l) => l.opens,
      cell: (l) => (
        <span
          className="tabular-nums"
          title={l.lastOpenedAt ? `Last opened ${formatDateTime(l.lastOpenedAt)}` : undefined}
        >
          {plural(l.opens, "time")}
        </span>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      sortValue: (l) => l.effectiveExpiresAt ?? Number.MAX_SAFE_INTEGER,
      cell: (l) =>
        l.expired ? (
          <span className="badge badge-neutral">
            expired{l.effectiveExpiresAt ? ` ${formatDay(l.effectiveExpiresAt)}` : ""}
          </span>
        ) : l.effectiveExpiresAt ? (
          <span title={formatDateTime(l.effectiveExpiresAt)}>
            {formatUntil(l.effectiveExpiresAt)}
          </span>
        ) : (
          "Never"
        ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      phone: "wide",
      cell: (l) => (
        <span className="inline-flex flex-wrap justify-end gap-1.5 max-sm:flex max-sm:justify-start">
          {!l.expired && (
            <button
              type="button"
              className="btn btn-sm"
              aria-label={`Copy the link to ${callTitle(l)}`}
              onClick={() => void copy(l)}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy link
            </button>
          )}
          <a
            href={`/call/${l.token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            aria-label={`Listen to ${callTitle(l)}`}
          >
            Listen
          </a>
          <button
            type="button"
            className={`btn btn-ghost btn-sm ${l.expired ? "" : "text-error"}`}
            aria-label={`${l.expired ? "Remove" : "Revoke"} the link to ${callTitle(l)}`}
            onClick={() => void revokeOne(l)}
          >
            {l.expired ? "Remove" : "Revoke"}
          </button>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader
        title="Shared links"
        subtitle="Calls listeners have shared publicly. A shared call is kept past the prune window until its link expires or is revoked."
        actions={
          expiredCount > 0 ? (
            <button
              type="button"
              className="btn"
              disabled={revokingExpired}
              onClick={() => void revokeAllExpired()}
            >
              Revoke expired
              <span className={COUNT}>{expiredCount}</span>
            </button>
          ) : undefined
        }
      />

      {isError && (
        <div role="alert" className="alert alert-error">
          Failed to load shared links.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Filter by talkgroup, system or user"
          className="w-full md:min-w-[200px] md:max-w-[340px] md:flex-[1_1_240px]"
        />
        <FilterChips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: all.length },
            { id: "active", label: "Active", count: all.length - expiredCount },
            { id: "expired", label: "Expired", count: expiredCount },
          ]}
        />
      </div>

      <DataTable
        caption="Shared links"
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        rowLabel={callTitle}
        loading={isLoading}
        empty={all.length === 0 ? "No calls have been shared yet." : "No link matches that search."}
        defaultSort={{ id: "shared", dir: "asc" }}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          <button
            type="button"
            className="btn btn-sm btn-error"
            onClick={() => {
              setError(null);
              panel.open({ key: "bulk", kind: "bulk" });
            }}
          >
            Revoke
          </button>
        }
        rowClassName={(l) => (l.expired ? "opacity-60" : "")}
      />

      <p className="text-xs text-base-content-dim">
        {expiryDays > 0
          ? `Links expire after ${plural(expiryDays, "day")}.`
          : "Links don't expire unless their own share set a date."}{" "}
        <Link to="/admin/settings?q=Links%20expire" className="link text-secondary">
          Change in Settings
        </Link>
        .
      </p>

      {p?.kind === "bulk" && (
        <DetailsPanel
          title={`${plural(selected.size, "link")} selected`}
          onClose={panel.close}
        >
          {error && (
            <div role="alert" className="alert alert-error">
              {error}
            </div>
          )}
          <InlineConfirm
            title="Revoke these links?"
            text="Anyone who has them loses access to those calls. The calls are kept."
            button="Revoke"
            danger
            busy={busy}
            onCancel={panel.close}
            onConfirm={() => void revokeSelected()}
          />
        </DetailsPanel>
      )}
    </div>
  );
}
