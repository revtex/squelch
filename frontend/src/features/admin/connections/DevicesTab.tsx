import { useListSessionsQuery } from "@/features/admin/_shell";
import type { AdminSession } from "@/types";
import { clientLabel, formatDateTime } from "./format";
import type { HistoryLink } from "./types";
import { CountryCell, GeoIPCredit } from "./Country";
import { placeText } from "./place";
import RowActions from "./RowActions";
import type { ConnectionActions } from "./useConnectionActions";

function matches(s: AdminSession, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    s.username.toLowerCase().includes(needle) ||
    (s.ip ?? "").includes(needle) ||
    placeText(s).includes(needle)
  );
}

export default function DevicesTab({
  search,
  onShowHistory,
  actions,
}: {
  search: string;
  onShowHistory: HistoryLink;
  actions: ConnectionActions;
}) {
  const { data, isLoading, isError } = useListSessionsQuery();

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="alert alert-error">Failed to load signed-in devices.</div>
    );
  }

  const rows = (data?.sessions ?? []).filter((s) => matches(s, search));
  const showCountry = data?.geoip.enabled ?? false;
  if (rows.length === 0) {
    return (
      <div className="text-base-content/60 py-8 text-center">
        {search ? "No devices match." : "No devices are signed in."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-base-content/60">
        Every device that can sign back in without a password, whether or not it
        is connected right now. The address is where it last refreshed its
        sign-in from.
      </p>
      <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-200/40">
        <table className="table table-zebra table-sm w-full">
          <thead>
            <tr>
              <th>User</th>
              <th>Client</th>
              <th>Last address</th>
              {showCountry && <th>Country</th>}
              <th>Signed in</th>
              <th>Last used</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.familyId}>
                <td>
                  <button
                    type="button"
                    className="link link-hover"
                    onClick={() =>
                      onShowHistory({ userId: s.userId, label: s.username })
                    }
                    title={`Show ${s.username}'s connection history`}
                  >
                    {s.username}
                  </button>
                  {s.role === "admin" && (
                    <span className="badge badge-ghost badge-xs ml-1">
                      admin
                    </span>
                  )}
                  {s.current && (
                    <span className="badge badge-info badge-xs ml-1">
                      this device
                    </span>
                  )}
                </td>
                <td title={s.userAgent ?? undefined}>
                  {clientLabel(s.native)}
                </td>
                <td className="font-mono text-xs">
                  {s.ip ? (
                    <button
                      type="button"
                      className="link link-hover"
                      onClick={() => onShowHistory({ ip: s.ip ?? undefined })}
                      title={`Show connection history for ${s.ip}`}
                    >
                      {s.ip}
                    </button>
                  ) : (
                    "-"
                  )}
                  {s.trusted && (
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
                    <CountryCell place={s} />
                  </td>
                )}
                <td className="whitespace-nowrap text-sm">
                  {s.signedInAt ? formatDateTime(s.signedInAt) : "-"}
                </td>
                <td className="whitespace-nowrap text-sm">
                  {formatDateTime(s.lastUsedAt)}
                </td>
                <td>
                  {s.liveConnections > 0 ? (
                    <span className="badge badge-success badge-sm">Online</span>
                  ) : (
                    <span className="badge badge-ghost badge-sm">Offline</span>
                  )}
                </td>
                <td className="text-right">
                  <RowActions
                    label={`Actions for ${s.username}'s device`}
                    actions={[
                      {
                        label: "Sign out device",
                        onSelect: () =>
                          void actions.signOutDevice({
                            familyId: s.familyId,
                            username: s.username,
                            current: s.current,
                          }),
                      },
                      {
                        label: "Sign out everywhere",
                        danger: true,
                        onSelect: () =>
                          void actions.signOutEverywhere({
                            userId: s.userId,
                            username: s.username,
                          }),
                      },
                      ...(s.ip && !s.trusted
                        ? [
                            {
                              label: "Block address",
                              danger: true,
                              onSelect: () => actions.openBlock(s.ip ?? ""),
                            },
                          ]
                        : []),
                    ]}
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
