import { useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Pencil, Send, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  formatAgo,
  formatDateTime,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminSystem, DeliveryResult, ForwardingTarget } from "@/types";
import { deliveryState, resultLine, systemsLabel, targetName } from "./targets";

export type TargetAction = "disable" | "enable" | "delete";

export interface TargetDetailsProps {
  target: ForwardingTarget;
  /** "Downstream" or "Webhook", for the subtitle and the questions. */
  kindLabel: string;
  systems: AdminSystem[];
  /** Facts particular to the kind, shown after the address. */
  extraFacts?: Fact[];
  /** More content under the facts, e.g. a payload preview. */
  children?: ReactNode;
  busy: boolean;
  onEdit: () => void;
  /** Sends a test; rejects with an Error when the server refused to try. */
  onTest: () => Promise<DeliveryResult>;
  /** Resolves to the error message, or null when it worked. */
  onAction: (action: TargetAction) => Promise<string | null>;
  onClose: () => void;
}

function question(action: TargetAction, name: string, kindLabel: string) {
  const kind = kindLabel.toLowerCase();
  switch (action) {
    case "disable":
      return {
        title: `Disable ${name}?`,
        text: `Nothing is sent to this ${kind} until you enable it again. Nothing is deleted.`,
        button: "Disable",
        danger: false,
      };
    case "enable":
      return {
        title: `Enable ${name}?`,
        text: `New calls are sent to this ${kind} again.`,
        button: "Enable",
        danger: false,
      };
    case "delete":
      return {
        title: `Delete ${name}?`,
        text: `The ${kind} and its delivery history are removed. This cannot be undone.`,
        button: "Delete",
        danger: true,
      };
  }
}

/** Everything about one downstream or webhook and what an admin can do. */
export default function TargetDetails({
  target: t,
  kindLabel,
  systems,
  extraFacts = [],
  children,
  busy,
  onEdit,
  onTest,
  onAction,
  onClose,
}: TargetDetailsProps) {
  const [pending, setPending] = useState<TargetAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<DeliveryResult | { refused: string } | null>(null);
  const state = deliveryState(t);
  const name = targetName(t);

  const run = async (action: TargetAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const sendTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await onTest());
    } catch (e) {
      setTest({ refused: e instanceof Error && e.message ? e.message : "The test could not be sent." });
    } finally {
      setTesting(false);
    }
  };

  const facts: Fact[] = [
    { label: "Address", value: <span className="font-mono break-all">{t.url}</span> },
    ...extraFacts,
    { label: "Systems", value: systemsLabel(t, systems) },
    {
      label: "Last delivery",
      value: t.last
        ? `${formatAgo(t.last.at)}, ${t.last.ok ? "ok" : "failed"}${
            t.last.status ? ` (${t.last.status})` : ""
          }`
        : "Nothing sent yet",
    },
    { label: "Last success", value: t.lastOkAt ? formatDateTime(t.lastOkAt) : "Never" },
    { label: "Sent, 24 h", value: t.sent24h.toLocaleString() },
    { label: "Failed, 24 h", value: t.failed24h.toLocaleString() },
  ];

  const ask = pending ? question(pending, name, kindLabel) : null;

  return (
    <DetailsPanel
      title={name}
      subtitle={kindLabel}
      badges={<span className={`badge badge-sm ${state.badge}`}>{state.label}</span>}
      onClose={onClose}
    >
      <FactList facts={facts} />

      {state.id === "failing" && t.last && (
        <div className="alert alert-error text-sm">
          <span>
            The last delivery failed: {t.last.error || `status ${t.last.status}`}. Calls
            are retried three times and then dropped for this {kindLabel.toLowerCase()}.
          </span>
        </div>
      )}
      {children}
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
          <PanelSection title="Check">
            <ActionButton
              icon={<Send className="h-4 w-4" />}
              label={testing ? "Sending a test…" : "Send a test"}
              hint="Posts a test message and shows what the other end answered."
              disabled={testing || busy}
              onClick={() => void sendTest()}
            />
            {test && "refused" in test && (
              <div role="alert" className="alert alert-error text-sm">
                {test.refused}
              </div>
            )}
            {test && "ok" in test && (
              <div
                role={test.ok ? "status" : "alert"}
                className={`alert text-sm ${test.ok ? "alert-success" : "alert-error"}`}
              >
                {test.ok ? "Test passed. " : "Test failed. "}
                {resultLine(test)}
              </div>
            )}
          </PanelSection>

          <PanelSection title={kindLabel}>
            <ActionButton
              icon={<Pencil className="h-4 w-4" />}
              label="Edit"
              hint="Label, address, systems and the secret."
              onClick={onEdit}
            />
          </PanelSection>

          <PanelSection title="Danger zone">
            {t.disabled === 1 ? (
              <ActionButton
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Enable"
                hint="Send new calls here again."
                onClick={() => setPending("enable")}
              />
            ) : (
              <ActionButton
                icon={<Ban className="h-4 w-4" />}
                label="Disable"
                hint="Stop sending without deleting anything."
                onClick={() => setPending("disable")}
              />
            )}
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              hint="Removes it for good."
              danger
              onClick={() => setPending("delete")}
            />
          </PanelSection>
        </>
      )}
    </DetailsPanel>
  );
}
