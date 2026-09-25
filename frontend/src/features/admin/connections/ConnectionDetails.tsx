import { useState } from "react";
import { Ban, History, LogOut, Smartphone, Unplug } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  type Fact,
} from "@/features/admin/_shell";
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

/**
 * Everything about one connection, device or past connection, and what an
 * admin can do about it.
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
  const [pending, setPending] = useState<ActionKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // The toast is behind the sheet, so a failure is said here too.
    if (failed === null) onClose();
    else setError(failed);
  };

  const ask = pending ? question(pending, s, actions.myUsername) : null;

  const facts: Fact[] = [
    {
      label: "Address",
      value: (
        <span className="break-all font-mono">
          {s.ip ?? "-"}
          {s.trusted && (
            <span className="badge badge-ghost badge-xs ml-2 font-sans">
              trusted
            </span>
          )}
        </span>
      ),
    },
    ...(s.showCountry
      ? [{ label: "Country", value: <CountryCell place={s.place} /> }]
      : []),
    ...s.facts,
  ];

  return (
    <DetailsPanel
      title={s.title}
      titleClassName={s.anonymous ? "text-base-content/70" : ""}
      subtitle={s.subtitle}
      badges={
        <>
          {s.kind && (
            <span className="badge badge-outline badge-sm">
              {KIND_LABELS[s.kind]}
            </span>
          )}
          {s.role === "admin" && s.kind !== "admin" && (
            <span className="badge badge-ghost badge-sm">admin</span>
          )}
          {s.self && <span className="badge badge-info badge-sm">you</span>}
        </>
      }
      onClose={onClose}
    >
      <FactList facts={facts} />

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
        <InlineConfirm
          title={ask.title}
          text={ask.text}
          button={ask.button}
          danger={ask.danger}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
        />
      ) : (
        <>
          <PanelSection title="History">
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
          </PanelSection>

          {(s.disconnect ?? s.device ?? s.account ?? (s.ip && !s.trusted)) && (
            <PanelSection title="Actions">
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
            </PanelSection>
          )}
        </>
      )}
    </DetailsPanel>
  );
}
