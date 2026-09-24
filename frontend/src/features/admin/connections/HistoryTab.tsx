import { useState } from "react";
import { X } from "lucide-react";
import { useConnectionHistoryQuery } from "@/features/admin/_shell";
import type {
  AdminConnectionHistoryEntry,
  ConnectionHistoryFilter,
  ConnectionKind,
} from "@/types";
import {
  KIND_LABELS,
  clientLabel,
  formatDateTime,
  formatDuration,
  reasonLabel,
} from "./format";
import { CountryCell, GeoIPCredit } from "./Country";
import RowActions, { type RowAction } from "./RowActions";
import type { ConnectionActions } from "./useConnectionActions";

const PAGE_SIZE = 100;

const RANGES = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "all", label: "Everything kept" },
] as const;
type Range = (typeof RANGES)[number]["value"];

function sinceFor(range: Range): number | undefined {
  if (range === "all") return undefined;
  return Math.floor(Date.now() / 1000) - Number(range) * 86_400;
}

/** Filters set from outside: a click on an address or a user elsewhere. */
export interface HistoryScope {
  ip?: string;
  userId?: number;
  label?: string;
}

export default function HistoryTab({
  scope,
  onClearScope,
  onScope,
  actions,
}: {
  scope: HistoryScope;
  onClearScope: () => void;
  onScope: (scope: HistoryScope) => void;
  actions: ConnectionActions;
}) {
  const [range, setRange] = useState<Range>("7");
  // Anchored when the range is picked (or refreshed), not on every render,
  // so the query stays put between renders.
  const [since, setSince] = useState<number | undefined>(() => sinceFor("7"));
  const [kind, setKind] = useState<ConnectionKind | "">("");
  const [page, setPage] = useState(1);

  const filter: ConnectionHistoryFilter = {
    page,
    pageSize: PAGE_SIZE,
    ...(scope.ip ? { ip: scope.ip } : {}),
    ...(scope.userId !== undefined ? { userId: scope.userId } : {}),
    ...(kind ? { kind } : {}),
    ...(since !== undefined ? { since } : {}),
  };
  const { data, isLoading, isError, refetch } =
    useConnectionHistoryQuery(filter);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-3">
      {data?.retentionDays === 0 && (
        <div className="alert alert-info">
          Connection history is turned off. Turn it on under Options →
          Connections.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select select-sm w-auto"
          aria-label="Time range"
          value={range}
          onChange={(e) => {
            const next = e.target.value as Range;
            setRange(next);
            setSince(sinceFor(next));
            setPage(1);
          }}
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          className="select select-sm w-auto"
          aria-label="Connection type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ConnectionKind | "");
            setPage(1);
          }}
        >
          <option value="">All types</option>
          {(Object.keys(KIND_LABELS) as ConnectionKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {(scope.ip || scope.userId !== undefined) && (
          <span className="badge badge-primary gap-1 py-3">
            {scope.ip
              ? `Address ${scope.ip}`
              : `User ${scope.label ?? scope.userId}`}
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-circle"
              aria-label="Clear filter"
              onClick={() => {
                onClearScope();
                setPage(1);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm ml-auto"
          onClick={() => {
            // A new anchor moves the window to now, which refetches; with
            // "everything kept" there is no anchor to move.
            if (range === "all") refetch();
            else setSince(sinceFor(range));
          }}
        >
          Refresh
        </button>
      </div>

      {isError ? (
        <div className="alert alert-error">
          Failed to load connection history.
        </div>
      ) : isLoading && !data ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : !data?.items.length ? (
        <div className="text-base-content/60 py-8 text-center">
          No connections in this range.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-200/40">
            <table className="table table-zebra table-sm w-full">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Type</th>
                  <th>Address</th>
                  {data.geoip.enabled && <th>Country</th>}
                  <th>Client</th>
                  <th>Connected</th>
                  <th>Lasted</th>
                  <th>Ended</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.userId !== null ? (
                        <button
                          type="button"
                          className="link link-hover"
                          onClick={() => {
                            onScope({
                              userId: e.userId ?? undefined,
                              label: e.username ?? undefined,
                            });
                            setPage(1);
                          }}
                          title={`Show only ${e.username ?? "this user"}`}
                        >
                          {e.username ?? `#${e.userId}`}
                        </button>
                      ) : (
                        <span className="text-base-content/60">Anonymous</span>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-outline badge-sm">
                        {KIND_LABELS[e.kind] ?? e.kind}
                      </span>
                    </td>
                    <td className="font-mono text-xs">
                      <button
                        type="button"
                        className="link link-hover"
                        onClick={() => {
                          onScope({ ip: e.ip });
                          setPage(1);
                        }}
                        title={`Show only ${e.ip}`}
                      >
                        {e.ip}
                      </button>
                      {e.trusted && (
                        <span
                          className="badge badge-ghost badge-xs ml-1"
                          title="On the server's trusted list: can never be blocked"
                        >
                          trusted
                        </span>
                      )}
                    </td>
                    {data.geoip.enabled && (
                      <td>
                        <CountryCell place={e} />
                      </td>
                    )}
                    <td title={e.userAgent ?? undefined}>
                      {clientLabel(e.native)}
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {formatDateTime(e.connectedAt)}
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {e.disconnectedAt !== null ? (
                        formatDuration(e.disconnectedAt - e.connectedAt)
                      ) : (
                        <span className="badge badge-success badge-sm">
                          Connected
                        </span>
                      )}
                    </td>
                    <td className="text-sm">
                      {reasonLabel(e.disconnectReason)}
                    </td>
                    <td className="text-right">
                      <RowActions
                        label={`Actions for ${e.username ?? "anonymous"} at ${e.ip}`}
                        actions={historyActions(e, actions)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <GeoIPCredit geoip={data.geoip} />

          <div className="flex items-center justify-between text-sm">
            <span className="text-base-content/60">
              {data.total} connection{data.total === 1 ? "" : "s"}
            </span>
            <div className="join">
              <button
                type="button"
                className="join-item btn btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="join-item btn btn-sm btn-disabled">
                Page {page} of {pages}
              </span>
              <button
                type="button"
                className="join-item btn btn-sm"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A past connection can still point at a device or account that is signed
 * in. The server says so if it no longer is.
 */
function historyActions(
  e: AdminConnectionHistoryEntry,
  actions: ConnectionActions,
): RowAction[] {
  const out: RowAction[] = [];
  const username = e.username ?? `user #${e.userId}`;
  if (e.familyId) {
    const familyId = e.familyId;
    out.push({
      label: "Sign out device",
      onSelect: () =>
        void actions.signOutDevice({ familyId, username, current: false }),
    });
  }
  if (e.userId !== null) {
    const userId = e.userId;
    out.push({
      label: "Sign out everywhere",
      danger: true,
      onSelect: () => void actions.signOutEverywhere({ userId, username }),
    });
  }
  if (!e.trusted) {
    out.push({
      label: "Block address",
      danger: true,
      onSelect: () => actions.openBlock(e.ip),
    });
  }
  return out;
}
