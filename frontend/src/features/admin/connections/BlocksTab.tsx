import {
  useDeleteIPBlockMutation,
  useListIPBlocksQuery,
} from "@/features/admin/_shell";
import { formatDateTime } from "./format";
import type { ConnectionActions } from "./useConnectionActions";

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export default function BlocksTab({ actions }: { actions: ConnectionActions }) {
  const { data, isLoading, isError } = useListIPBlocksQuery();
  const [remove] = useDeleteIPBlockMutation();
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

  const handleRemove = async (id: number, cidr: string) => {
    if (!window.confirm(`Remove the block on ${cidr}?`)) return;
    try {
      await remove(id).unwrap();
      setNotice({ kind: "success", text: `Removed the block on ${cidr}.` });
    } catch (e) {
      setNotice({
        kind: "error",
        text: messageOf(e, "Failed to remove the block."),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-base-content-dim">
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
          className="btn btn-sm btn-error"
          onClick={() => openBlock("")}
        >
          Block an address
        </button>
      </div>

      {data.blocks.length === 0 ? (
        <div className="text-base-content-dim py-6 text-center">
          No addresses are blocked.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-admin-line bg-base-200/40">
          <table className="table table-zebra table-sm w-full">
            <thead>
              <tr>
                <th>Address</th>
                <th>Reason</th>
                <th>Added by</th>
                <th>Added</th>
                <th>Expires</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.blocks.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs">{b.cidr}</td>
                  <td className="text-sm">{b.reason || "-"}</td>
                  <td className="text-sm">{b.createdBy ?? "-"}</td>
                  <td className="whitespace-nowrap text-sm">
                    {formatDateTime(b.createdAt)}
                  </td>
                  <td className="whitespace-nowrap text-sm">
                    {b.expiresAt ? formatDateTime(b.expiresAt) : "Never"}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      aria-label={`Remove the block on ${b.cidr}`}
                      onClick={() => void handleRemove(b.id, b.cidr)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="never-blocked" className="space-y-1">
        <h3 id="never-blocked" className="font-semibold">
          Never blocked
        </h3>
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
      </section>
    </div>
  );
}
