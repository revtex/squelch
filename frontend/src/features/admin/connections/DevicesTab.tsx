import {
  DataTable,
  formatDateTime,
  formatWhen,
  useHour12,
  useListSessionsQuery,
  type Column,
} from "@/features/admin/_shell";
import type { AdminSession } from "@/types";
import {
  deviceLabel,
} from "./format";
import type { HistoryLink } from "./types";
import { AddressCell, CountryCell, GeoIPCredit } from "./Country";
import { placeText } from "./place";
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
  const hour12 = useHour12();

  if (isError) {
    return (
      <div className="alert alert-error">Failed to load signed-in devices.</div>
    );
  }

  const rows = (data?.sessions ?? []).filter((s) => matches(s, search));
  const showCountry = data?.geoip.enabled ?? false;

  const columns: Column<AdminSession>[] = [
    {
      id: "who",
      header: "Who",
      phone: "title",
      sortValue: (s) => s.username,
      cell: (s) => (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="link link-hover font-medium"
              onClick={() => onShowHistory({ userId: s.userId, label: s.username })}
              title={`Show ${s.username}'s connection history`}
            >
              {s.username}
            </button>
            {s.role === "admin" && <span className="badge admin-badge-role">admin</span>}
            {s.current && <span className="badge badge-secondary">this device</span>}
          </div>
          <div className="text-xs text-base-content-dim" title={s.userAgent ?? undefined}>
            {deviceLabel(s.userAgent, s.native)}
          </div>
        </>
      ),
    },
    {
      id: "from",
      header: "Last seen from",
      sortValue: (s) => s.ip,
      cell: (s) => (
        <AddressCell
          ip={s.ip}
          trusted={s.trusted}
          place={showCountry ? <CountryCell place={s} /> : null}
          onShowHistory={onShowHistory}
        />
      ),
    },
    {
      id: "signedin",
      header: "Signed in",
      sortValue: (s) => -(s.signedInAt ?? 0),
      cell: (s) => (
        <>
          <div
            className="whitespace-nowrap"
            title={s.signedInAt ? formatDateTime(s.signedInAt) : undefined}
          >
            {s.signedInAt ? formatWhen(s.signedInAt, { hour12 }) : "-"}
          </div>
          <div className="whitespace-nowrap text-xs text-base-content-dim">
            Last used {formatWhen(s.lastUsedAt, { hour12 })}
          </div>
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (s) => (s.liveConnections > 0 ? 0 : 1),
      cell: (s) =>
        s.liveConnections > 0 ? (
          <span className="badge badge-success">online</span>
        ) : (
          <span className="badge">offline</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-base-content-dim">
        Every device that can sign back in without a password, whether or not it
        is connected right now. The address is where it last refreshed its
        sign-in from.
      </p>
      <DataTable
        caption="Signed-in devices"
        columns={columns}
        rows={rows}
        rowKey={(s) => `device:${s.familyId}`}
        rowLabel={(s) => `${s.username}'s device`}
        loading={isLoading && !data}
        empty={search ? "No devices match." : "No devices are signed in."}
        pageSize={0}
        openKey={openKey ?? null}
        onOpen={(s, el) => onOpen(deviceSelection(s, showCountry), el)}
      />
      <GeoIPCredit geoip={data?.geoip} />
    </div>
  );
}
