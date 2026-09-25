import { useListConnectionsQuery } from "@/features/admin/_shell";
import type { AdminConnection } from "@/types";
import {
  KIND_LABELS,
  clientLabel,
  formatDateTime,
  formatDuration,
} from "./format";
import { useNow } from "./useNow";
import type { HistoryLink } from "./types";
import { CountryCell, GeoIPCredit } from "./Country";
import { placeText } from "./place";
import OpenButton from "./OpenButton";
import { liveSelection, type OpenDetails } from "./selection";

function matches(c: AdminConnection, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    (c.username || "anonymous").toLowerCase().includes(needle) ||
    (c.ip ?? "").includes(needle) ||
    placeText(c).includes(needle)
  );
}

export default function LiveTab({
  search,
  onShowHistory,
  onOpen,
  openKey,
}: {
  search: string;
  onShowHistory: HistoryLink;
  onOpen: OpenDetails;
  openKey: string | undefined;
}) {
  const { data, isLoading, isError } = useListConnectionsQuery();
  const now = useNow(15_000);

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (isError) {
    return <div className="alert alert-error">Failed to load connections.</div>;
  }

  const rows = (data?.connections ?? []).filter((c) => matches(c, search));
  const showCountry = data?.geoip.enabled ?? false;
  if (rows.length === 0) {
    return (
      <div className="text-base-content/60 py-8 text-center">
        {search ? "No connections match." : "Nobody is connected right now."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-200/40">
        <table className="table table-sm w-full [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-3 sm:[&_th]:px-3">
          <thead>
            <tr>
              <th>Who</th>
              <th className="hidden sm:table-cell">Type</th>
              <th>From</th>
              <th className="hidden sm:table-cell">Connected</th>
              <th className="w-px">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const key = `live:${c.id}`;
              return (
                <tr
                  key={c.id}
                  className={
                    key === openKey ? "bg-base-300" : "hover:bg-base-200"
                  }
                >
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {c.userId !== null ? (
                        <button
                          type="button"
                          className="link link-hover font-medium"
                          onClick={() =>
                            onShowHistory({
                              userId: c.userId ?? undefined,
                              label: c.username,
                            })
                          }
                          title={`Show ${c.username}'s connection history`}
                        >
                          {c.username}
                        </button>
                      ) : (
                        <span className="text-base-content/60">Anonymous</span>
                      )}
                      {c.role === "admin" && (
                        <span className="badge badge-ghost badge-xs">
                          admin
                        </span>
                      )}
                      {c.self && (
                        <span className="badge badge-info badge-xs">you</span>
                      )}
                    </div>
                    <span className="badge badge-outline badge-xs sm:hidden">
                      {KIND_LABELS[c.kind]}
                    </span>
                    <div
                      className="text-xs text-base-content/60"
                      title={c.userAgent || undefined}
                    >
                      {clientLabel(c.native)}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className="badge badge-outline badge-sm">
                      {KIND_LABELS[c.kind]}
                    </span>
                  </td>
                  <td>
                    <div className="break-all font-mono text-xs">
                      {c.ip ? (
                        <button
                          type="button"
                          className="link link-hover text-left"
                          onClick={() =>
                            onShowHistory({ ip: c.ip ?? undefined })
                          }
                          title={`Show connection history for ${c.ip}`}
                        >
                          {c.ip}
                        </button>
                      ) : (
                        "-"
                      )}
                      {c.trusted && (
                        <span
                          className="badge badge-ghost badge-xs ml-1 font-sans"
                          title="On the server's trusted list: can never be blocked"
                        >
                          trusted
                        </span>
                      )}
                    </div>
                    {showCountry && (
                      <div className="text-xs">
                        <CountryCell place={c} />
                      </div>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap text-sm sm:table-cell">
                    <span title={formatDateTime(c.connectedAt)}>
                      {formatDuration(now - c.connectedAt)}
                    </span>
                  </td>
                  <td className="text-right">
                    <OpenButton
                      label={`Details for ${c.username || "anonymous"} (${KIND_LABELS[c.kind]})`}
                      open={key === openKey}
                      onOpen={(el) =>
                        onOpen(liveSelection(c, now, showCountry), el)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <GeoIPCredit geoip={data?.geoip} />
    </div>
  );
}
