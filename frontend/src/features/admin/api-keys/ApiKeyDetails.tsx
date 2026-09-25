import { useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  formatAgo,
  formatDateTime,
  plural,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";
import CopyField from "./CopyField";
import { keyName, keyStatus, systemsLabel, testCommand } from "./keys";

export type KeyAction = "disable" | "enable" | "rotate" | "delete";

export interface ApiKeyDetailsProps {
  apiKey: AdminApiKey;
  systems: AdminSystem[];
  defaultRate: number;
  busy: boolean;
  onEdit: () => void;
  /** Resolves to the error message, or null when it worked. */
  onAction: (action: KeyAction) => Promise<string | null>;
  onClose: () => void;
}

function question(action: KeyAction, k: AdminApiKey) {
  const name = keyName(k);
  switch (action) {
    case "disable":
      return {
        title: `Disable ${name}?`,
        text: "Uploads with this key are refused until you enable it again. Nothing is deleted.",
        button: "Disable",
        danger: false,
      };
    case "enable":
      return {
        title: `Enable ${name}?`,
        text: "Uploads with this key are accepted again.",
        button: "Enable",
        danger: false,
      };
    case "rotate":
      return {
        title: `Rotate the secret for ${name}?`,
        text: "You get a new secret to put in the recorder. The old one keeps working for 24 hours, then stops.",
        button: "Rotate secret",
        danger: false,
      };
    case "delete":
      return {
        title: `Delete ${name}?`,
        text: "Uploads with this key stop at once. Calls it already uploaded are kept. This cannot be undone.",
        button: "Delete",
        danger: true,
      };
  }
}

/** Everything about one API key and what an admin can do about it. */
export default function ApiKeyDetails({
  apiKey: k,
  systems,
  defaultRate,
  busy,
  onEdit,
  onAction,
  onClose,
}: ApiKeyDetailsProps) {
  const [pending, setPending] = useState<KeyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = keyStatus(k);
  const name = keyName(k);

  const run = async (action: KeyAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const facts: Fact[] = [
    { label: "Fingerprint", value: <span className="font-mono">{k.fingerprint}</span> },
    { label: "Status", value: status.label },
    { label: "Systems", value: systemsLabel(k, systems) },
    {
      label: "Rate limit",
      value:
        k.callRateLimit != null
          ? `${k.callRateLimit} calls a minute`
          : `Server default (${defaultRate} a minute)`,
    },
    {
      label: "Last used",
      value: k.lastUsedAt
        ? `${formatAgo(k.lastUsedAt)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ""}`
        : "Never",
    },
    { label: "Calls, 24 h", value: k.calls24h.toLocaleString() },
    { label: "Created", value: formatDateTime(k.createdAt) },
  ];

  const ask = pending ? question(pending, k) : null;

  return (
    <DetailsPanel
      title={name}
      subtitle="API key"
      badges={
        <>
          <span className={`badge badge-sm ${status.badge}`}>{status.label}</span>
          {k.legacy24h > 0 && (
            <span className="badge badge-warning badge-sm">legacy uploads</span>
          )}
        </>
      }
      onClose={onClose}
    >
      <FactList facts={facts} />

      {status.id === "rotating" && k.previousKeyExpiresAt && (
        <div className="alert alert-warning text-sm">
          The secret was rotated. The old one keeps working until{" "}
          {formatDateTime(k.previousKeyExpiresAt)}.
        </div>
      )}
      {k.legacy24h > 0 && (
        <div className="alert alert-warning text-sm">
          <span>
            {plural(k.legacy24h, "request")} in the last 24 hours used the
            deprecated <code className="font-mono">/api/*</code> upload path.
            Point the recorder at <code className="font-mono">/api/v1</code>{" "}
            before the old path is removed. See{" "}
            <Link to="/admin/logs" className="link">
              Logs
            </Link>{" "}
            for the requests.
          </span>
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
          <PanelSection title="Key">
            <ActionButton
              icon={<Pencil className="h-4 w-4" />}
              label="Edit"
              hint="Label, systems, rate limit."
              onClick={onEdit}
            />
            <ActionButton
              icon={<RefreshCw className="h-4 w-4" />}
              label="Rotate secret"
              hint="Get a new secret; the old one works for another 24 hours."
              onClick={() => setPending("rotate")}
            />
            <CopyField
              label="Test command"
              value={testCommand("<secret>", window.location.origin)}
              multiline
              hint="Put the key's secret in place of <secret>. A 200 means the key and the address work."
            />
          </PanelSection>

          <PanelSection title="Danger zone">
            {k.disabled === 1 ? (
              <ActionButton
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Enable"
                hint="Accept uploads with this key again."
                onClick={() => setPending("enable")}
              />
            ) : (
              <ActionButton
                icon={<Ban className="h-4 w-4" />}
                label="Disable"
                hint="Refuse uploads with this key. Nothing is deleted."
                onClick={() => setPending("disable")}
              />
            )}
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete"
              hint="Removes the key for good. Its calls are kept."
              danger
              onClick={() => setPending("delete")}
            />
          </PanelSection>
        </>
      )}
    </DetailsPanel>
  );
}
