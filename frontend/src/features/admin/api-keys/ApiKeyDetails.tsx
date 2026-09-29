import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Copy, RefreshCw, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  Notice,
  PanelSection,
  formatAgo,
  formatDateTime,
  formatDay,
  plural,
  useToast,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";
import { KeyFields } from "./ApiKeyForm";
import { useKeyForm, type ApiKeyFormValues } from "./useKeyForm";
import { keyName, keyStatus, systemsLabel, testCommand } from "./keys";

export type KeyAction = "disable" | "enable" | "rotate" | "delete";

export interface ApiKeyDetailsProps {
  apiKey: AdminApiKey;
  systems: AdminSystem[];
  defaultRate: number;
  busy: boolean;
  /** Set when the last save failed. */
  saveError: string | null;
  /** Resolves to true once saved; a failure shows through saveError. */
  onSave: (values: ApiKeyFormValues) => Promise<boolean>;
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
        text: "Uploads with this key get 401 until you enable it again. Nothing is deleted.",
        button: "Disable key",
        danger: false,
      };
    case "enable":
      return {
        title: `Enable ${name}?`,
        text: "Uploads with this key are accepted again.",
        button: "Enable key",
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
        text: "Uploads with this key fail immediately. Calls it already uploaded are kept. This can't be undone.",
        button: "Delete key",
        danger: true,
      };
  }
}

/** Everything about one API key, its settings, and what an admin can do about it. */
export default function ApiKeyDetails({
  apiKey: k,
  systems,
  defaultRate,
  busy,
  saveError,
  onSave,
  onAction,
  onClose,
}: ApiKeyDetailsProps) {
  const id = useId();
  const toast = useToast();
  const keyForm = useKeyForm(k);
  const [pending, setPending] = useState<KeyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = keyStatus(k);
  const name = keyName(k);
  const formId = `${id}-form`;

  const run = async (action: KeyAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const copyTest = async () => {
    try {
      await navigator.clipboard.writeText(testCommand("<secret>", window.location.origin));
      toast.success("Test command copied. Put the key's secret in place of <secret>.");
    } catch {
      toast.error("Could not copy the test command.");
    }
  };

  const facts: Fact[] = [
    { label: "Systems", value: systemsLabel(k, systems) },
    {
      label: "Rate limit",
      value:
        k.callRateLimit != null
          ? `${k.callRateLimit} / min`
          : `${defaultRate} / min (server default)`,
    },
    {
      label: "Last used",
      value: k.lastUsedAt ? (
        <>
          {formatAgo(k.lastUsedAt)}
          {k.lastUsedIp && (
            <>
              {" from "}
              <span className="font-mono">{k.lastUsedIp}</span>
            </>
          )}
        </>
      ) : (
        "Never"
      ),
    },
    { label: "Calls 24 h", value: k.calls24h.toLocaleString() },
  ];

  const ask = pending ? question(pending, k) : null;
  const shownError = error ?? saveError;

  return (
    <DetailsPanel
      title={name}
      subtitle={
        <>
          <span className="font-mono">{k.fingerprint}</span> · created {formatDay(k.createdAt)}
        </>
      }
      badges={<span className={`badge ${status.badge}`}>{status.label}</span>}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={busy || !keyForm.dirty}
          >
            Save
          </button>
        </>
      }
    >
      {k.legacy24h > 0 && (
        <Notice tone="warn">
          Still uploading to the deprecated <span className="font-mono">/api/*</span>{" "}
          path. {plural(k.legacy24h, "request")} in 24 h. Point the recorder at{" "}
          <span className="font-mono">/api/v1</span>.{" "}
          <Link to="/admin/logs" className="link">
            See the requests
          </Link>
        </Notice>
      )}
      {status.id === "rotating" && k.previousKeyExpiresAt && (
        <Notice tone="warn">
          The secret was rotated. The old one keeps working until{" "}
          {formatDateTime(k.previousKeyExpiresAt)}.
        </Notice>
      )}

      <FactList facts={facts} />

      {shownError && (
        <Notice tone="bad" role="alert">
          {shownError}
        </Notice>
      )}

      <form
        id={formId}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ ...keyForm.values(), disabled: k.disabled }).then((ok) => {
            if (ok) keyForm.markSaved();
          });
        }}
      >
        <KeyFields
          keyForm={keyForm}
          systems={systems}
          defaultRate={defaultRate}
          creating={false}
        />
      </form>

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
        <PanelSection title="Actions">
          <ActionButton
            icon={<Copy className="h-4 w-4" />}
            label="Copy test command"
            hint="Runs the connectivity check the uploader uses."
            onClick={() => void copyTest()}
          />
          {k.disabled === 1 ? (
            <ActionButton
              icon={<CheckCircle2 className="h-4 w-4" />}
              label="Enable key"
              hint="Accept uploads with this key again."
              onClick={() => setPending("enable")}
            />
          ) : (
            <ActionButton
              icon={<Ban className="h-4 w-4" />}
              label="Disable key"
              hint="Uploads get 401 until re-enabled."
              onClick={() => setPending("disable")}
            />
          )}
          <ActionButton
            icon={<RefreshCw className="h-4 w-4" />}
            label="Rotate secret"
            hint="New secret shown once; the old one keeps working for 24 h."
            onClick={() => setPending("rotate")}
          />
          <ActionButton
            icon={<Trash2 className="h-4 w-4" />}
            label="Delete key"
            hint="Uploads with it fail immediately."
            danger
            onClick={() => setPending("delete")}
          />
        </PanelSection>
      )}
    </DetailsPanel>
  );
}
