import { useState } from "react";
import { X } from "lucide-react";
import {
  CHIP,
  CHIP_ON,
  DataTable,
  FilterChips,
  formatDateTime,
  formatDuration,
  formatWhen,
  useConnectionHistoryQuery,
  useHour12,
  type Column,
} from "@/features/admin/_shell";
import type {
  AdminConnectionHistoryEntry,
  ConnectionHistoryFilter,
  ConnectionKind,
} from "@/types";
import {
  KIND_BADGE,
  KIND_LABELS,
  deviceLabel,
  reasonLabel,
} from "./format";
import { AddressCell, CountryCell, GeoIPCredit } from "./Country";
import { historySelection, type OpenDetails } from "./selection";

const PAGE_SIZE = 100;

const RANGES = [
  { id: "1", label: "24 h" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "all", label: "Everything kept" },
] as const;
type Range = (typeof RANGES)[number]["id"];

type KindFilter = ConnectionKind | "any";
const KINDS: readonly { id: KindFilter; label: string }[] = [
  { id: "any", label: "All types" },
  ...(["listener", "stream", "admin"] as const).map((k) => ({ id: k, label: KIND_LABELS[k] })),
];

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
  const hour12 = useHour12();
  const [range, setRange] = useState<Range>("7");
  // Anchored when the range is picked (or refreshed), not on every render,
  // so the query stays put between renders.
  const [since, setSince] = useState<number | undefined>(() => sinceFor("7"));
  const [kind, setKind] = useState<KindFilter>("any");
  const [page, setPage] = useState(1);

  const filter: ConnectionHistoryFilter = {
    page,
    pageSize: PAGE_SIZE,
    ...(scope.ip ? { ip: scope.ip } : {}),
    ...(scope.userId !== undefined ? { userId: scope.userId } : {}),
    ...(kind !== "any" ? { kind } : {}),
    ...(since !== undefined ? { since } : {}),
  };
  const { data, isLoading, isError, refetch } =
    useConnectionHistoryQuery(filter);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const showCountry = data?.geoip.enabled ?? false;

  const columns: Column<AdminConnectionHistoryEntry>[] = [
    {
      id: "who",
      header: "Who",
      phone: "title",
      cell: (e) => (
        <>
          {e.userId !== null ? (
            <button
              type="button"
              className="link link-hover font-medium"
              onClick={() => {
                onScope({ userId: e.userId ?? undefined, label: e.username ?? undefined });
                setPage(1);
              }}
              title={`Show only ${e.username ?? "this user"}`}
            >
              {e.username ?? `#${e.userId}`}
            </button>
          ) : (
            <span className="text-base-content-dim">Public listener</span>
          )}
          <div className="text-xs text-base-content-dim" title={e.userAgent ?? undefined}>
            {deviceLabel(e.userAgent, e.native)}
          </div>
        </>
      ),
    },
    {
      id: "type",
      header: "Type",
      cell: (e) => (
        <span className={`badge ${KIND_BADGE[e.kind] ?? ""}`}>
          {KIND_LABELS[e.kind] ?? e.kind}
        </span>
      ),
    },
    {
      id: "from",
      header: "From",
      cell: (e) => (
        <AddressCell
          ip={e.ip}
          trusted={e.trusted}
          place={showCountry ? <CountryCell place={e} /> : null}
          onShowHistory={(f) => {
            onScope(f);
            setPage(1);
          }}
        />
      ),
    },
    {
      id: "when",
      header: "When",
      cell: (e) => (
        <>
          <div className="whitespace-nowrap" title={formatDateTime(e.connectedAt)}>
            {formatWhen(e.connectedAt, { hour12 })}
          </div>
          <div className="whitespace-nowrap text-xs text-base-content-dim">
            {e.disconnectedAt !== null ? (
              `for ${formatDuration(e.disconnectedAt - e.connectedAt)}`
            ) : (
              <span className="badge badge-success">connected</span>
            )}
          </div>
        </>
      ),
    },
    {
      id: "ended",
      header: "Ended",
      cell: (e) => reasonLabel(e.disconnectReason) || <span className="text-admin-dim2">-</span>,
    },
  ];

  const first = data ? (page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.total, page * data.pageSize) : 0;

  return (
    <div className="flex flex-col gap-3">
      {data?.retentionDays === 0 && (
        <div className="alert">
          Connection history is turned off. Turn it on under Settings →
          Storage.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterChips
          label="Time range"
          options={RANGES}
          value={range}
          onChange={(next) => {
            setRange(next);
            setSince(sinceFor(next));
            setPage(1);
          }}
        />
        <FilterChips
          label="Connection type"
          options={KINDS}
          value={kind}
          onChange={(next) => {
            setKind(next);
            setPage(1);
          }}
        />
        {(scope.ip || scope.userId !== undefined) && (
          <span className={`${CHIP} ${CHIP_ON} pr-1.5`}>
            {scope.ip ? (
              <>
                Address <span className="font-mono">{scope.ip}</span>
              </>
            ) : (
              `User ${scope.label ?? scope.userId}`
            )}
            <button
              type="button"
              className="grid h-6 w-6 cursor-pointer place-items-center rounded-full hover:bg-base-100/20"
              aria-label="Clear filter"
              onClick={() => {
                onClearScope();
                setPage(1);
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
        <button
          type="button"
          className="btn btn-sm ml-auto"
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
        <div className="alert alert-error">Failed to load connection history.</div>
      ) : (
        <>
          <DataTable
            caption="Connection history"
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(e) => `history:${e.id}`}
            rowLabel={(e) => `${e.username ?? "anonymous"} at ${e.ip}`}
            loading={isLoading && !data}
            empty="No connections in this range."
            pageSize={0}
            openKey={openKey ?? null}
            onOpen={(e, el) => onOpen(historySelection(e, showCountry), el)}
          />
          <GeoIPCredit geoip={data?.geoip} />
          {data && data.total > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
              <span className="mr-auto text-base-content-dim tabular-nums">
                Showing {first}–{last} of {data.total}
              </span>
              {page > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage((p) => p - 1)}
                >
                  <span aria-hidden="true">←</span> Previous
                </button>
              )}
              <span className="text-base-content-dim tabular-nums">
                Page {page} of {pages}
              </span>
              {page < pages && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
