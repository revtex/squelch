import { useEffect, useId, useState } from "react";
import {
  DetailsPanel,
  Field,
  Segmented,
  SwitchRow,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminSystem, AdminWebhook, WebhookType } from "@/types";
import SystemsPicker from "./SystemsPicker";
import { allowedSystemIds, targetName } from "./targets";

export interface WebhookFormValues {
  label: string;
  url: string;
  type: WebhookType;
  /** Blank keeps the current secret when editing. */
  secret: string;
  clearSecret: boolean;
  systemsJson: string | null;
  disabled: number;
}

interface FormState {
  label: string;
  url: string;
  type: WebhookType;
  secret: string;
  clearSecret: boolean;
  systems: number[];
  enabled: boolean;
}

function fromWebhook(w: AdminWebhook | null): FormState {
  return {
    label: w?.label ?? "",
    url: w?.url ?? "",
    type: w?.type ?? "generic",
    secret: "",
    clearSecret: false,
    systems: w ? allowedSystemIds(w) : [],
    enabled: w ? w.disabled === 0 : true,
  };
}

const TYPES = [
  { id: "generic", label: "Generic JSON", hint: "Squelch's own payload, signed when a secret is set." },
  { id: "discord", label: "Discord", hint: "A message in a Discord channel." },
] as const;

export interface WebhookFormProps {
  webhook: AdminWebhook | null;
  systems: AdminSystem[];
  busy: boolean;
  error: string | null;
  onSubmit: (values: WebhookFormValues) => void;
  onClose: () => void;
}

/** Create or edit a webhook: a URL that gets a message for every call. */
export default function WebhookForm({
  webhook,
  systems,
  busy,
  error,
  onSubmit,
  onClose,
}: WebhookFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromWebhook(webhook));
  const [dirty, setDirty] = useState(false);
  const { setGuard } = useNavigationGuard();
  const creating = webhook === null;
  const hasSecret = webhook?.hasSecret ?? false;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDirty(false);
    onSubmit({
      label: form.label.trim(),
      url: form.url.trim(),
      type: form.type,
      secret: form.type === "generic" ? form.secret : "",
      clearSecret: form.type === "generic" && form.clearSecret,
      systemsJson: form.systems.length === 0 ? null : JSON.stringify(form.systems),
      disabled: form.enabled ? 0 : 1,
    });
  };

  const formId = `${id}-form`;

  return (
    <DetailsPanel
      title={creating ? "New webhook" : `Edit ${targetName(webhook)}`}
      subtitle={
        creating
          ? "A URL that is sent a message for every new call."
          : "Changes apply to the next call."
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-xs" />}
            {creating ? "Add webhook" : "Save"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            {error}
          </div>
        )}
        <Field
          htmlFor={`${id}-label`}
          label="Label"
          hint="How the webhook is named in lists and the audit log."
        >
          <input
            id={`${id}-label`}
            type="text"
            className="input w-full"
            value={form.label}
            onChange={(e) => set("label", e.target.value)}
            maxLength={64}
            autoFocus={creating}
          />
        </Field>

        <div className="fieldset">
          <span className="fieldset-legend">Type</span>
          <Segmented
            label="Type"
            options={TYPES}
            value={form.type}
            onChange={(v) => set("type", v)}
          />
          <p className="label whitespace-normal">
            {form.type === "discord"
              ? "Paste the webhook URL from the Discord channel's integrations settings."
              : "Your own service receives a JSON body with the call's details."}
          </p>
        </div>

        <Field htmlFor={`${id}-url`} label="URL">
          <input
            id={`${id}-url`}
            type="url"
            className="input w-full"
            value={form.url}
            placeholder={
              form.type === "discord"
                ? "https://discord.com/api/webhooks/…"
                : "https://example.org/hooks/squelch"
            }
            onChange={(e) => set("url", e.target.value)}
            required
          />
        </Field>

        {form.type === "generic" && (
          <>
            <Field
              htmlFor={`${id}-secret`}
              label="Secret"
              hint={
                hasSecret
                  ? "A secret is set. Leave blank to keep it, or enter a new one."
                  : "Optional. When set, every post carries an X-Squelch-Signature header your service can check."
              }
            >
              <input
                id={`${id}-secret`}
                type="password"
                className="input w-full font-mono"
                value={form.secret}
                onChange={(e) => set("secret", e.target.value)}
                disabled={form.clearSecret}
                autoComplete="off"
              />
            </Field>
            {hasSecret && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={form.clearSecret}
                  onChange={(e) => set("clearSecret", e.target.checked)}
                />
                Remove the secret and send unsigned posts
              </label>
            )}
          </>
        )}

        <SystemsPicker
          systems={systems}
          value={form.systems}
          onChange={(ids) => set("systems", ids)}
        />

        <SwitchRow
          id={`${id}-enabled`}
          label="Enabled"
          hint="Turn off to stop sending without deleting the webhook."
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
        />
      </form>
    </DetailsPanel>
  );
}
