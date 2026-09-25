import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ban, History, LogOut, Smartphone, Unplug, X } from "lucide-react";
import { KIND_LABELS } from "./format";
import { CountryCell } from "./Country";
import type { Selection } from "./selection";
import type { HistoryLink } from "./types";
import type { ConnectionActions } from "./useConnectionActions";

type ActionKind = "disconnect" | "device" | "account";

interface Question {
  title: string;
  text: string;
  button: string;
  danger: boolean;
}

function question(
  kind: ActionKind,
  s: Selection,
  myUsername: string | null,
): Question {
  const who = s.anonymous ? "the anonymous listener" : s.title;
  switch (kind) {
    case "disconnect":
      return s.self
        ? {
            title: "Disconnect your own session?",
            text: "This page will reconnect on its own.",
            button: "Disconnect",
            danger: false,
          }
        : {
            title: `Disconnect ${who}?`,
            text: "A signed-in app or browser can reconnect straight away. To keep them out, sign the device out or block the address.",
            button: "Disconnect",
            danger: false,
          };
    case "device":
      return s.self
        ? {
            title: "Sign out the device you are using?",
            text: "You will need to sign in again.",
            button: "Sign out device",
            danger: false,
          }
        : {
            title: `Sign out this device of ${s.title}?`,
            text: "It will need the password to sign in again. Their other devices stay signed in.",
            button: "Sign out device",
            danger: false,
          };
    case "account":
      return s.account?.username === myUsername
        ? {
            title: "Sign yourself out everywhere?",
            text: "Every device, including this one, will need the password to sign in again.",
            button: "Sign out everywhere",
            danger: true,
          }
        : {
            title: `Sign ${s.title} out everywhere?`,
            text: `Every device and browser ${s.title} uses will need the password to sign in again. Use this if you think someone else has the account.`,
            button: "Sign out everywhere",
            danger: true,
          };
  }
}

function ActionButton({
  icon,
  label,
  hint,
  danger = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const hintId = useId();
  return (
    <button
      type="button"
      aria-describedby={hintId}
      className={`btn btn-block h-auto min-h-12 justify-start gap-3 py-2 text-left font-normal ${
        danger ? "btn-outline btn-error" : ""
      }`}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span id={hintId} aria-hidden="true" className="text-xs opacity-70">
          {hint}
        </span>
      </span>
    </button>
  );
}

/**
 * Everything about one connection, device or past connection, and what an
 * admin can do about it. A side sheet on wide screens, a bottom sheet on a
 * phone; it sits outside the table so nothing clips it.
 */
export default function ConnectionDetails({
  selection: s,
  actions,
  onShowHistory,
  onClose,
}: {
  selection: Selection;
  actions: ConnectionActions;
  onShowHistory: HistoryLink;
  onClose: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opened (the host remounts it per row): focus goes inside the sheet.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const run = async (kind: ActionKind) => {
    setBusy(true);
    setError(null);
    let failed: string | null = null;
    if (kind === "disconnect" && s.disconnect) {
      failed = await actions.disconnect(s.disconnect);
    } else if (kind === "device" && s.device) {
      failed = await actions.signOutDevice(s.device);
    } else if (kind === "account" && s.account) {
      failed = await actions.signOutEverywhere(s.account);
    }
    setBusy(false);
    setPending(null);
    // The page's notice is behind the sheet, so a failure is said here too.
    if (failed === null) onClose();
    else setError(failed);
  };

  const ask = pending ? question(pending, s, actions.myUsername) : null;

  return (
    <dialog
      open
      className="modal modal-open modal-bottom sm:modal-end"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="modal-box flex max-h-[85vh] flex-col gap-5 sm:h-full sm:max-h-none sm:w-[26rem] sm:max-w-none sm:rounded-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id={titleId}
                className={`truncate text-lg font-bold ${s.anonymous ? "text-base-content/70" : ""}`}
              >
                {s.title}
              </h3>
              {s.kind && (
                <span className="badge badge-outline badge-sm">
                  {KIND_LABELS[s.kind]}
                </span>
              )}
              {s.role === "admin" && s.kind !== "admin" && (
                <span className="badge badge-ghost badge-sm">admin</span>
              )}
              {s.self && <span className="badge badge-info badge-sm">you</span>}
            </div>
            <p className="text-sm text-base-content/60">{s.subtitle}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            aria-label="Close details"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-base-content/60">Address</dt>
          <dd className="break-all font-mono">
            {s.ip ?? "-"}
            {s.trusted && (
              <span className="badge badge-ghost badge-xs ml-2 font-sans">
                trusted
              </span>
            )}
          </dd>
          {s.showCountry && (
            <>
              <dt className="text-base-content/60">Country</dt>
              <dd>
                <CountryCell place={s.place} />
              </dd>
            </>
          )}
          {s.facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-base-content/60">{f.label}</dt>
              <dd className="break-words">{f.value}</dd>
            </div>
          ))}
        </dl>

        {s.self && (
          <div className="alert alert-warning text-sm">
            This is your own {s.kind ? "session" : "device"}. Signing it out
            signs you out.
          </div>
        )}
        {s.trusted && (
          <div className="alert text-sm">
            This address is on the server&apos;s trusted list, so it can&apos;t
            be blocked from here.
          </div>
        )}
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            {error}
          </div>
        )}

        {ask && pending ? (
          <div
            role="group"
            aria-label="Confirm"
            className="space-y-3 rounded-box border border-base-300 bg-base-200 p-4"
          >
            <p className="font-semibold">{ask.title}</p>
            <p className="text-sm text-base-content/70">{ask.text}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPending(null)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn btn-sm ${ask.danger ? "btn-error" : "btn-primary"}`}
                onClick={() => void run(pending)}
                disabled={busy}
              >
                {busy && (
                  <span className="loading loading-spinner loading-xs" />
                )}
                {ask.button}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-base-content/60">
              History
            </p>
            {s.ip && (
              <ActionButton
                icon={<History className="h-4 w-4" />}
                label="History for this address"
                hint={`Every connection from ${s.ip}`}
                onClick={() => onShowHistory({ ip: s.ip ?? undefined })}
              />
            )}
            {s.userId !== null && !s.anonymous && (
              <ActionButton
                icon={<History className="h-4 w-4" />}
                label={`History for ${s.title}`}
                hint="Every connection this account made"
                onClick={() =>
                  onShowHistory({
                    userId: s.userId ?? undefined,
                    label: s.title,
                  })
                }
              />
            )}

            {(s.disconnect ?? s.device ?? s.account) && (
              <p className="pt-2 text-xs font-medium uppercase tracking-wide text-base-content/60">
                Actions
              </p>
            )}
            {s.disconnect && (
              <ActionButton
                icon={<Unplug className="h-4 w-4" />}
                label="Disconnect"
                hint="Drops this connection. They can reconnect straight away."
                onClick={() => setPending("disconnect")}
              />
            )}
            {s.device && (
              <ActionButton
                icon={<Smartphone className="h-4 w-4" />}
                label="Sign out this device"
                hint="It needs the password again. Other devices stay signed in."
                onClick={() => setPending("device")}
              />
            )}
            {s.account && (
              <ActionButton
                icon={<LogOut className="h-4 w-4" />}
                label="Sign out everywhere"
                hint={`Every device ${s.title} uses needs the password again.`}
                onClick={() => setPending("account")}
              />
            )}
            {s.ip && !s.trusted && (
              <ActionButton
                icon={<Ban className="h-4 w-4" />}
                label="Block this address"
                hint={`Nothing from ${s.ip} can reach the server until you remove the block.`}
                danger
                onClick={() => {
                  onClose();
                  actions.openBlock(s.ip ?? "");
                }}
              />
            )}
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}
