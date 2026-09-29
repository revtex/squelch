import {
  DataTable,
  formatDateTime,
  formatDuration,
  useListConnectionsQuery,
  useNow,
  type Column,
} from "@/features/admin/_shell";
import type { AdminConnection } from "@/types";
import {
  KIND_BADGE,
  KIND_LABELS,
  deviceLabel,
} from "./format";
import type { HistoryLink } from "./types";
import { AddressCell, CountryCell, GeoIPCredit } from "./Country";
import { placeText } from "./place";
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

  if (isError) {
    return <div className="alert alert-error">Failed to load connections.</div>;
  }

  const rows = (data?.connections ?? []).filter((c) => matches(c, search));
  const showCountry = data?.geoip.enabled ?? false;

  const columns: Column<AdminConnection>[] = [
    {
      id: "who",
      header: "Who",
      phone: "title",
      sortValue: (c) => c.username || "~",
      cell: (c) => (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {c.userId !== null ? (
              <button
                type="button"
                className="link link-hover font-medium"
                onClick={() =>
                  onShowHistory({ userId: c.userId ?? undefined, label: c.username })
                }
                title={`Show ${c.username}'s connection history`}
              >
                {c.username}
              </button>
            ) : (
              <span className="text-base-content-dim">Public listener</span>
            )}
            {c.role === "admin" && <span className="badge admin-badge-role">admin</span>}
            {c.self && <span className="badge badge-secondary">you</span>}
          </div>
          <div className="text-xs text-base-content-dim" title={c.userAgent || undefined}>
            {deviceLabel(c.userAgent, c.native)}
          </div>
        </>
      ),
    },
    {
      id: "type",
      header: "Type",
      sortValue: (c) => KIND_LABELS[c.kind],
      cell: (c) => <span className={`badge ${KIND_BADGE[c.kind]}`}>{KIND_LABELS[c.kind]}</span>,
    },
    {
      id: "from",
      header: "From",
      sortValue: (c) => c.ip,
      cell: (c) => (
        <AddressCell
          ip={c.ip}
          trusted={c.trusted}
          place={showCountry ? <CountryCell place={c} /> : null}
          onShowHistory={onShowHistory}
        />
      ),
    },
    {
      id: "connected",
      header: "Connected",
      sortValue: (c) => -c.connectedAt,
      className: "whitespace-nowrap",
      cell: (c) => (
        <span title={formatDateTime(c.connectedAt)}>
          {formatDuration(now - c.connectedAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <DataTable
        caption="Live connections"
        columns={columns}
        rows={rows}
        rowKey={(c) => `live:${c.id}`}
        rowLabel={(c) => `${c.username || "anonymous"} (${KIND_LABELS[c.kind]})`}
        loading={isLoading && !data}
        empty={search ? "No connections match." : "Nobody is connected right now."}
        pageSize={0}
        openKey={openKey ?? null}
        onOpen={(c, el) => onOpen(liveSelection(c, now, showCountry), el)}
      />
      <GeoIPCredit geoip={data?.geoip} />
    </div>
  );
}
