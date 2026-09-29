import { useState } from "react";
import { useCreateIPBlockMutation } from "@/features/admin/_shell";
import type { CreateIPBlockPayload, CreateIPBlockResult } from "@/types";
import type { Notice } from "./useConnectionActions";

const EXPIRIES = [
  { value: "3600", label: "1 hour" },
  { value: "86400", label: "24 hours" },
  { value: "604800", label: "7 days" },
  { value: "never", label: "Until removed" },
] as const;
type Expiry = (typeof EXPIRIES)[number]["value"];

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Blocks an address or range. Opened with an address filled in (from a
 * row) or empty (from the Blocked addresses tab).
 */
export default function BlockAddressDialog({
  initialAddress,
  onClose,
  onDone,
}: {
  initialAddress: string;
  onClose: () => void;
  onDone: (notice: Notice) => void;
}) {
  const [address, setAddress] = useState(initialAddress);
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("86400");
  const [error, setError] = useState<string | null>(null);
  // The server's warning that the range holds this admin's own address;
  // submitting again sends it anyway.
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [create] = useCreateIPBlockMutation();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const payload: CreateIPBlockPayload = {
      address: address.trim(),
      reason: reason.trim(),
      expiresAt:
        expiry === "never"
          ? undefined
          : Math.floor(Date.now() / 1000) + Number(expiry),
      ...(warning ? { force: true } : {}),
    };
    try {
      let result: CreateIPBlockResult;
      try {
        result = await create(payload).unwrap();
      } catch (err) {
        // Blocking your own address closes this connection, so the reply
        // may never arrive. The block was made.
        if (warning) {
          onDone({
            kind: "success",
            text: `Blocked ${address.trim()}. This page lost its connection because the block includes your address.`,
          });
          return;
        }
        throw err;
      }
      if ("needsConfirm" in result) {
        setWarning(result.message);
        setBusy(false);
        return;
      }
      if ("ok" in result) {
        const dropped =
          result.closed > 0
            ? ` ${result.closed} connection${result.closed === 1 ? " was" : "s were"} dropped.`
            : "";
        onDone({ kind: "success", text: `Blocked ${result.cidr}.${dropped}` });
      }
    } catch (err) {
      setError(messageOf(err, "Failed to block the address."));
      setBusy(false);
    }
  };

  return (
    <dialog
      open
      className="modal modal-open"
      aria-labelledby="block-address-title"
    >
      <div className="modal-box max-w-md">
        <h3 id="block-address-title" className="text-lg font-bold">
          Block an address
        </h3>
        <p className="py-2 text-sm text-base-content-dim">
          Everything from this address is refused: listening, the admin
          dashboard and uploads from recorders. Anyone connected from it now is
          dropped.
        </p>
        <form className="space-y-3" onSubmit={(e) => void submit(e)}>
          <label className="form-control w-full">
            <span className="label-text">Address or range</span>
            <input
              className="input input-bordered w-full font-mono"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setWarning(null);
              }}
              placeholder="203.0.113.9 or 203.0.113.0/24"
              required
              autoFocus
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text">Reason (optional)</span>
            <input
              className="input input-bordered w-full"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <fieldset className="space-y-1">
            <legend className="label-text">For</legend>
            <div className="flex flex-wrap gap-2">
              {EXPIRIES.map((x) => (
                <button
                  key={x.value}
                  type="button"
                  className={`btn btn-sm ${expiry === x.value ? "btn-primary" : "btn-outline"}`}
                  aria-pressed={expiry === x.value}
                  onClick={() => setExpiry(x.value)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </fieldset>
          {warning && (
            <div role="alert" className="alert alert-warning text-sm">
              {warning} Block it anyway?
            </div>
          )}
          {error && (
            <div role="alert" className="alert alert-error text-sm">
              {error}
            </div>
          )}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-error" disabled={busy}>
              {busy && <span className="loading loading-spinner loading-xs" />}
              {warning ? "Block anyway" : "Block"}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
