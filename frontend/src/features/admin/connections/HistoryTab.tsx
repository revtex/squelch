import { useState } from "react";
import { X } from "lucide-react";
import { useConnectionHistoryQuery, OpenButton } from "@/features/admin/_shell";
import type { ConnectionHistoryFilter, ConnectionKind } from "@/types";
import {
  KIND_LABELS,
  clientLabel,
  formatDateTime,
  formatDuration,
  reasonLabel,
} from "./format";
import { CountryCell, GeoIPCredit } from "./Country";
import { historySelection, type OpenDetails } from "./selection";

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
  onOpen,
  openKey,
}: {
  scope: HistoryScope;
  onClearScope: () => void;
  onScope: (scope: HistoryScope) => void;
  onOpen: OpenDetails;
  openKey: string | undefined;
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
          Connection history is turned off. Turn it on under Settings →
          Storage.
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
        <div className="text-base-content-dim py-8 text-center">
          No connections in this range.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-admin-line bg-base-200/40">
            <table className="table table-sm w-full [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-3 sm:[&_th]:px-3">
              <thead>
                <tr>
                  <th>Who</th>
                  <th className="hidden sm:table-cell">Type</th>
                  <th>From</th>
                  <th>When</th>
                  <th className="hidden sm:table-cell">Ended</th>
                  <th className="w-px">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => {
                  const key = `history:${e.id}`;
                  return (
                    <tr
                      key={e.id}
                      className={
                        key === openKey ? "bg-base-300" : "hover:bg-base-200"
                      }
                    >
                      <td>
                        {e.userId !== null ? (
                          <button
                            type="button"
                            className="link link-hover font-medium"
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
                          <span className="text-base-content-dim">
                            Anonymous
                          </span>
                        )}
                        <span className="badge badge-outline badge-xs sm:hidden">
                          {KIND_LABELS[e.kind] ?? e.kind}
                        </span>
                        <div
                          className="text-xs text-base-content-dim"
                          title={e.userAgent ?? undefined}
                        >
                          {clientLabel(e.native)}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell">
                        <span className="badge badge-outline badge-sm">
                          {KIND_LABELS[e.kind] ?? e.kind}
                        </span>
                      </td>
                      <td>
                        <div className="break-all font-mono text-xs">
                          <button
                            type="button"
                            className="link link-hover text-left"
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
                              className="badge badge-ghost badge-xs ml-1 font-sans"
                              title="On the server's trusted list: can never be blocked"
                            >
                              trusted
                            </span>
                          )}
                        </div>
                        {data.geoip.enabled && (
                          <div className="text-xs">
                            <CountryCell place={e} />
                          </div>
                        )}
                      </td>
                      <td className="text-sm">
                        <div className="sm:whitespace-nowrap">
                          {formatDateTime(e.connectedAt)}
                        </div>
                        <div className="sm:whitespace-nowrap text-xs text-base-content-dim">
                          {e.disconnectedAt !== null ? (
                            `for ${formatDuration(e.disconnectedAt - e.connectedAt)}`
                          ) : (
                            <span className="badge badge-success badge-xs">
                              Connected
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden text-sm sm:table-cell">
                        {reasonLabel(e.disconnectReason)}
                      </td>
                      <td className="text-right">
                        <OpenButton
                          label={`Details for ${e.username ?? "anonymous"} at ${e.ip}`}
                          open={key === openKey}
                          onOpen={(el) =>
                            onOpen(historySelection(e, data.geoip.enabled), el)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <GeoIPCredit geoip={data.geoip} />

          <div className="flex items-center justify-between text-sm">
            <span className="text-base-content-dim">
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
