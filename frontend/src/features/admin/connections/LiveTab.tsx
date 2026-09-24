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
import RowActions, { type RowAction } from "./RowActions";
import type { ConnectionActions } from "./useConnectionActions";

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
  actions,
}: {
  search: string;
  onShowHistory: HistoryLink;
  actions: ConnectionActions;
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
        <table className="table table-zebra table-sm w-full">
          <thead>
            <tr>
              <th>User</th>
              <th>Type</th>
              <th>Address</th>
              {showCountry && <th>Country</th>}
              <th>Client</th>
              <th>Connected</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.userId !== null ? (
                    <button
                      type="button"
                      className="link link-hover"
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
                    <span className="badge badge-ghost badge-xs ml-1">
                      admin
                    </span>
                  )}
                  {c.self && (
                    <span className="badge badge-info badge-xs ml-1">
                      this session
                    </span>
                  )}
                </td>
                <td>
                  <span className="badge badge-outline badge-sm">
                    {KIND_LABELS[c.kind]}
                  </span>
                </td>
                <td className="font-mono text-xs">
                  {c.ip ? (
                    <button
                      type="button"
                      className="link link-hover"
                      onClick={() => onShowHistory({ ip: c.ip ?? undefined })}
                      title={`Show connection history for ${c.ip}`}
                    >
                      {c.ip}
                    </button>
                  ) : (
                    "-"
                  )}
                  {c.trusted && (
                    <span
                      className="badge badge-ghost badge-xs ml-1"
                      title="On the server's trusted list: can never be blocked"
                    >
                      trusted
                    </span>
                  )}
                </td>
                {showCountry && (
                  <td>
                    <CountryCell place={c} />
                  </td>
                )}
                <td title={c.userAgent || undefined}>
                  {clientLabel(c.native)}
                </td>
                <td className="whitespace-nowrap text-sm">
                  <span title={formatDateTime(c.connectedAt)}>
                    {formatDuration(now - c.connectedAt)}
                  </span>
                </td>
                <td className="text-right">
                  <RowActions
                    label={`Actions for ${c.username || "anonymous"} (${KIND_LABELS[c.kind]})`}
                    actions={liveActions(c, actions)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GeoIPCredit geoip={data?.geoip} />
    </div>
  );
}

function liveActions(
  c: AdminConnection,
  actions: ConnectionActions,
): RowAction[] {
  const out: RowAction[] = [
    {
      label: "Disconnect",
      onSelect: () =>
        void actions.disconnect({
          id: c.id,
          kind: c.kind,
          username: c.username,
          self: c.self,
        }),
    },
  ];
  if (c.familyId) {
    const familyId = c.familyId;
    out.push({
      label: "Sign out device",
      onSelect: () =>
        void actions.signOutDevice({
          familyId,
          username: c.username,
          current: c.self,
        }),
    });
  }
  if (c.userId !== null) {
    const userId = c.userId;
    out.push({
      label: "Sign out everywhere",
      danger: true,
      onSelect: () =>
        void actions.signOutEverywhere({ userId, username: c.username }),
    });
  }
  if (c.ip && !c.trusted) {
    const ip = c.ip;
    out.push({
      label: "Block address",
      danger: true,
      onSelect: () => actions.openBlock(ip),
    });
  }
  return out;
}
