import { useListSessionsQuery } from "@/features/admin/_shell";
import type { AdminSession } from "@/types";
import { clientLabel, formatDateTime } from "./format";
import type { HistoryLink } from "./types";
import { CountryCell, GeoIPCredit } from "./Country";
import { placeText } from "./place";
import OpenButton from "./OpenButton";
import { deviceSelection, type OpenDetails } from "./selection";

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
  onOpen,
  openKey,
}: {
  search: string;
  onShowHistory: HistoryLink;
  onOpen: OpenDetails;
  openKey: string | undefined;
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
        <table className="table table-sm w-full [&_td]:px-2 [&_th]:px-2 sm:[&_td]:px-3 sm:[&_th]:px-3">
          <thead>
            <tr>
              <th>Who</th>
              <th>Last seen from</th>
              <th className="hidden sm:table-cell">Signed in</th>
              <th>Status</th>
              <th className="w-px">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const key = `device:${s.familyId}`;
              return (
                <tr
                  key={s.familyId}
                  className={
                    key === openKey ? "bg-base-300" : "hover:bg-base-200"
                  }
                >
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="link link-hover font-medium"
                        onClick={() =>
                          onShowHistory({ userId: s.userId, label: s.username })
                        }
                        title={`Show ${s.username}'s connection history`}
                      >
                        {s.username}
                      </button>
                      {s.role === "admin" && (
                        <span className="badge badge-ghost badge-xs">
                          admin
                        </span>
                      )}
                      {s.current && (
                        <span className="badge badge-info badge-xs">
                          this device
                        </span>
                      )}
                    </div>
                    <div
                      className="text-xs text-base-content/60"
                      title={s.userAgent ?? undefined}
                    >
                      {clientLabel(s.native)}
                    </div>
                  </td>
                  <td>
                    <div className="break-all font-mono text-xs">
                      {s.ip ? (
                        <button
                          type="button"
                          className="link link-hover text-left"
                          onClick={() =>
                            onShowHistory({ ip: s.ip ?? undefined })
                          }
                          title={`Show connection history for ${s.ip}`}
                        >
                          {s.ip}
                        </button>
                      ) : (
                        "-"
                      )}
                      {s.trusted && (
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
                        <CountryCell place={s} />
                      </div>
                    )}
                  </td>
                  <td className="hidden text-sm sm:table-cell">
                    <div className="whitespace-nowrap">
                      {s.signedInAt ? formatDateTime(s.signedInAt) : "-"}
                    </div>
                    <div className="whitespace-nowrap text-xs text-base-content/60">
                      Last used {formatDateTime(s.lastUsedAt)}
                    </div>
                  </td>
                  <td>
                    {s.liveConnections > 0 ? (
                      <span className="badge badge-success badge-sm">
                        Online
                      </span>
                    ) : (
                      <span className="badge badge-ghost badge-sm">
                        Offline
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <OpenButton
                      label={`Details for ${s.username}'s device`}
                      open={key === openKey}
                      onOpen={(el) =>
                        onOpen(deviceSelection(s, showCountry), el)
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
