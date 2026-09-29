import { useState } from "react";
import {
  Card,
  DataTable,
  InlineConfirm,
  formatDateTime,
  formatWhen,
  useDeleteIPBlockMutation,
  useHour12,
  useListIPBlocksQuery,
  type Column,
} from "@/features/admin/_shell";
import type { AdminIPBlock } from "@/types";

import type { ConnectionActions } from "./useConnectionActions";

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function BlocksTab({ actions }: { actions: ConnectionActions }) {
  const { data, isLoading, isError } = useListIPBlocksQuery();
  const [remove, { isLoading: removing }] = useDeleteIPBlockMutation();
  const hour12 = useHour12();
  const [pending, setPending] = useState<AdminIPBlock | null>(null);
  const { setNotice, openBlock } = actions;

  if (isLoading && !data) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="alert alert-error">Failed to load blocked addresses.</div>
    );
  }
  if (!data.enabled) {
    return (
      <div className="alert">
        Address blocking is not available on this server.
      </div>
    );
  }

  const handleRemove = async (b: AdminIPBlock) => {
    try {
      await remove(b.id).unwrap();
      setNotice({ kind: "success", text: `Removed the block on ${b.cidr}.` });
    } catch (e) {
      setNotice({
        kind: "error",
        text: messageOf(e, "Failed to remove the block."),
      });
    }
    setPending(null);
  };

  const when = (unix: number) => (
    <span className="whitespace-nowrap" title={formatDateTime(unix)}>
      {formatWhen(unix, { hour12 })}
    </span>
  );

  const columns: Column<AdminIPBlock>[] = [
    {
      id: "cidr",
      header: "Address",
      phone: "title",
      sortValue: (b) => b.cidr,
      cell: (b) => <span className="break-all font-mono">{b.cidr}</span>,
    },
    {
      id: "reason",
      header: "Reason",
      cell: (b) => b.reason || <span className="text-admin-dim2">-</span>,
    },
    {
      id: "by",
      header: "Added by",
      sortValue: (b) => b.createdBy,
      cell: (b) => b.createdBy ?? <span className="text-admin-dim2">-</span>,
    },
    {
      id: "added",
      header: "Added",
      sortValue: (b) => -b.createdAt,
      cell: (b) => when(b.createdAt),
    },
    {
      id: "expires",
      header: "Expires",
      sortValue: (b) => b.expiresAt ?? Number.MAX_SAFE_INTEGER,
      cell: (b) => (b.expiresAt ? when(b.expiresAt) : "Never"),
    },
    {
      id: "remove",
      header: "",
      align: "right",
      phone: "wide",
      cell: (b) => (
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`Remove the block on ${b.cidr}`}
          onClick={() => setPending(b)}
        >
          Remove
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[62ch] text-sm text-base-content-dim">
          Blocked addresses cannot reach this server at all, including uploads
          from recorders.
          {data.yourAddress && (
            <>
              {" "}
              You are connected from{" "}
              <span className="font-mono">{data.yourAddress}</span>.
            </>
          )}
        </p>
        <button
          type="button"
          className="btn btn-error"
          onClick={() => openBlock("")}
        >
          Block an address
        </button>
      </div>

      {pending && (
        <InlineConfirm
          title={`Remove the block on ${pending.cidr}?`}
          text="It can reach this server again straight away."
          button="Remove block"
          busy={removing}
          onCancel={() => setPending(null)}
          onConfirm={() => void handleRemove(pending)}
        />
      )}

      <DataTable
        caption="Blocked addresses"
        columns={columns}
        rows={data.blocks}
        rowKey={(b) => b.id}
        empty="No addresses are blocked."
        pageSize={0}
      />

      <Card title="Never blocked" count={data.trusted.length}>
        <p className="text-sm text-base-content-dim">
          These addresses can never be blocked from here. The list is set on the
          server with <code>--trusted-addresses</code>, so an admin account
          cannot change it.
        </p>
        <ul className="flex flex-wrap gap-2">
          {data.trusted.map((t) => (
            <li key={t} className="badge badge-outline font-mono">
              {t}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
