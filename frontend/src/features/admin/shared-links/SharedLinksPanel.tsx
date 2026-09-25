import { useMemo, useState } from "react";
import { Copy, ExternalLink, Link2Off, Trash2 } from "lucide-react";
import {
  ActionButton,
  DataTable,
  DetailsPanel,
  FactList,
  FilterChips,
  InlineConfirm,
  PageHeader,
  PanelSection,
  SearchBox,
  formatAgo,
  formatDateTime,
  formatDuration,
  formatUntil,
  plural,
  useDeleteSharedLinkMutation,
  useDetails,
  useGetSharedLinksQuery,
  useRestoreSharedLinkMutation,
  useRevokeExpiredSharedLinksMutation,
  useToast,
  type Column,
  type Fact,
} from "@/features/admin/_shell";
import type { SharedLinkAdmin } from "@/types";

type Filter = "all" | "active" | "expired";

type Panel =
  | { key: string; kind: "details"; id: number }
  | { key: string; kind: "bulk" }
  | { key: string; kind: "expired" };

function callTitle(l: SharedLinkAdmin): string {
  return l.talkgroupLabel || l.talkgroupName || `Call ${l.callId}`;
}

function linkUrl(l: SharedLinkAdmin): string {
  return `${window.location.origin}/call/${l.token}`;
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
  const [deleteLink] = useDeleteSharedLinkMutation();
  const [restoreLink] = useRestoreSharedLinkMutation();
  const [revokeExpired] = useRevokeExpiredSharedLinksMutation();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
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
  const current = p?.kind === "details" ? (all.find((l) => l.id === p.id) ?? null) : null;

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

  const revokeOne = async (l: SharedLinkAdmin): Promise<string | null> => {
    setBusy(true);
    try {
      await deleteLink(l.id).unwrap();
      toast.success(`Revoked the link to ${callTitle(l)}.`, { undo: undoRevoke(l) });
      return null;
    } catch (e) {
      return message(e, "Could not revoke the link.");
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError(null);
    try {
      const { revoked } = await revokeExpired().unwrap();
      panel.close();
      toast.success(
        revoked === 0 ? "No expired links to revoke." : `Revoked ${plural(revoked, "expired link")}.`,
      );
    } catch (e) {
      setError(message(e, "Could not revoke expired links."));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<SharedLinkAdmin>[] = [
    {
      id: "call",
      header: "Call",
      phone: "title",
      sortValue: callTitle,
      cell: (l) => (
        <span className={`block ${l.expired ? "opacity-60" : ""}`}>
          <span className="font-medium">{callTitle(l)}</span>
          <span className="block text-xs text-base-content/60">
            {l.systemLabel || "Unknown system"}
            {l.talkgroupName && l.talkgroupLabel ? ` · ${l.talkgroupName}` : ""}
          </span>
        </span>
      ),
    },
    {
      id: "when",
      header: "Recorded",
      sortValue: (l) => l.dateTime,
      cell: (l) => (
        <span>
          {formatDateTime(l.dateTime)}
          <span className="ml-1 text-xs text-base-content/60">{formatDuration(l.duration)}</span>
        </span>
      ),
    },
    {
      id: "shared",
      header: "Shared",
      sortValue: (l) => l.createdAt,
      cell: (l) => (
        <span>
          {formatAgo(l.createdAt)}
          <span className="block text-xs text-base-content/60">by {l.sharedBy || "unknown"}</span>
        </span>
      ),
    },
    {
      id: "opens",
      header: "Opens",
      align: "right",
      sortValue: (l) => l.opens,
      cell: (l) => (l.opens > 0 ? l.opens.toLocaleString() : "—"),
    },
    {
      id: "expires",
      header: "Expires",
      sortValue: (l) => l.effectiveExpiresAt ?? Number.MAX_SAFE_INTEGER,
      cell: (l) =>
        l.expired ? (
          <span className="badge badge-ghost badge-sm">expired</span>
        ) : l.effectiveExpiresAt ? (
          formatUntil(l.effectiveExpiresAt)
        ) : (
          <span className="text-base-content/60">never</span>
        ),
    },
  ];

  const facts: Fact[] = current
    ? [
        { label: "System", value: current.systemLabel || "Unknown" },
        {
          label: "Talkgroup",
          value: current.talkgroupName
            ? `${current.talkgroupLabel} · ${current.talkgroupName}`
            : current.talkgroupLabel || "Unknown",
        },
        {
          label: "Recorded",
          value: `${formatDateTime(current.dateTime)} · ${formatDuration(current.duration)}`,
        },
        { label: "Shared", value: `${formatDateTime(current.createdAt)} by ${current.sharedBy || "unknown"}` },
        {
          label: "Expires",
          value: current.expired
            ? `Expired ${formatAgo(current.effectiveExpiresAt ?? current.createdAt)}`
            : current.effectiveExpiresAt
              ? formatDateTime(current.effectiveExpiresAt)
              : "Never",
        },
        {
          label: "Opened",
          value:
            current.opens > 0
              ? `${plural(current.opens, "time")}, last ${formatAgo(current.lastOpenedAt ?? current.createdAt)}`
              : "Not yet",
        },
        { label: "Link", value: <span className="break-all font-mono text-xs">{linkUrl(current)}</span> },
      ]
    : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shared links"
        subtitle="Calls listeners have shared by link. Anyone with a link can play that one call until it expires or you revoke it."
        actions={
          expiredCount > 0 ? (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setError(null);
                panel.open({ key: "expired", kind: "expired" });
              }}
            >
              <Link2Off className="h-4 w-4" aria-hidden="true" />
              Revoke {plural(expiredCount, "expired link")}
            </button>
          ) : undefined
        }
      />

      {isError && (
        <div role="alert" className="alert alert-error text-sm">
          Failed to load shared links.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Search by talkgroup, system or user"
          className="w-full sm:w-80"
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
        loading={isLoading}
        empty={all.length === 0 ? "No calls have been shared yet." : "No link matches that search."}
        defaultSort={{ id: "shared", dir: "desc" }}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          <button
            type="button"
            className="btn btn-xs btn-error btn-outline"
            onClick={() => {
              setError(null);
              panel.open({ key: "bulk", kind: "bulk" });
            }}
          >
            Revoke
          </button>
        }
        onOpen={(l, trigger) => panel.open({ key: `details:${l.id}`, kind: "details", id: l.id }, trigger)}
        rowLabel={callTitle}
        openKey={p?.kind === "details" ? p.id : null}
        rowClassName={(l) => (l.expired ? "text-base-content/70" : "")}
      />

      {p?.kind === "details" && current && (
        <DetailsPanel
          key={current.id}
          title={callTitle(current)}
          subtitle="Shared link"
          badges={
            current.expired ? (
              <span className="badge badge-ghost badge-sm">expired</span>
            ) : (
              <span className="badge badge-success badge-sm">active</span>
            )
          }
          onClose={() => {
            setPending(false);
            setError(null);
            panel.close();
          }}
        >
          <FactList facts={facts} />
          {error && (
            <div role="alert" className="alert alert-error text-sm">
              {error}
            </div>
          )}
          {pending ? (
            <InlineConfirm
              title="Revoke this link?"
              text="Anyone who has the link loses access to the call. The call itself is kept. You can undo for ten seconds."
              button="Revoke"
              danger
              busy={busy}
              onCancel={() => setPending(false)}
              onConfirm={() =>
                void revokeOne(current).then((failed) => {
                  setPending(false);
                  if (failed !== null) setError(failed);
                  else panel.close();
                })
              }
            />
          ) : (
            <PanelSection title="Link">
              <ActionButton
                icon={<Copy className="h-4 w-4" />}
                label="Copy link"
                hint="Puts the public address on the clipboard."
                disabled={current.expired}
                onClick={() => void copy(current)}
              />
              <a
                href={`/call/${current.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-block justify-start gap-3 text-left font-normal"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <span>
                  <span className="block font-medium">Open shared page</span>
                  <span className="block text-xs text-base-content/60">
                    Plays the call the way a visitor sees it, in a new tab.
                  </span>
                </span>
              </a>
              <ActionButton
                icon={<Trash2 className="h-4 w-4" />}
                label="Revoke"
                hint="The link stops working. The call is kept."
                danger
                onClick={() => setPending(true)}
              />
            </PanelSection>
          )}
        </DetailsPanel>
      )}

      {p?.kind === "bulk" && (
        <DetailsPanel
          title={`${plural(selected.size, "link")} selected`}
          onClose={panel.close}
        >
          {error && (
            <div role="alert" className="alert alert-error text-sm">
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

      {p?.kind === "expired" && (
        <DetailsPanel title="Revoke expired links" onClose={panel.close}>
          {error && (
            <div role="alert" className="alert alert-error text-sm">
              {error}
            </div>
          )}
          <InlineConfirm
            title={`Revoke ${plural(expiredCount, "expired link")}?`}
            text="They no longer work anyway; this just tidies the list. The calls are kept."
            button="Revoke expired"
            busy={busy}
            onCancel={panel.close}
            onConfirm={() => void revokeAllExpired()}
          />
        </DetailsPanel>
      )}
    </div>
  );
}
