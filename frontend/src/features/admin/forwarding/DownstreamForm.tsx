import { useEffect, useId, useState } from "react";
import {
  DetailsPanel,
  Field,
  SwitchRow,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminDownstream, AdminSystem } from "@/types";
import SystemsPicker from "./SystemsPicker";
import { allowedSystemIds, targetName } from "./targets";

export interface DownstreamFormValues {
  label: string;
  url: string;
  /** Blank keeps the current key when editing. */
  apiKey: string;
  systemsJson: string | null;
  disabled: number;
}

interface FormState {
  label: string;
  url: string;
  apiKey: string;
  systems: number[];
  enabled: boolean;
}

function fromDownstream(d: AdminDownstream | null): FormState {
  return {
    label: d?.label ?? "",
    url: d?.url ?? "",
    apiKey: "",
    systems: d ? allowedSystemIds(d) : [],
    enabled: d ? d.disabled === 0 : true,
  };
}

export interface DownstreamFormProps {
  downstream: AdminDownstream | null;
  systems: AdminSystem[];
  busy: boolean;
  error: string | null;
  onSubmit: (values: DownstreamFormValues) => void;
  onClose: () => void;
}

/** Create or edit a downstream: another Squelch server that gets our calls. */
export default function DownstreamForm({
  downstream,
  systems,
  busy,
  error,
  onSubmit,
  onClose,
}: DownstreamFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromDownstream(downstream));
  const [dirty, setDirty] = useState(false);
  const { setGuard } = useNavigationGuard();
  const creating = downstream === null;

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
      apiKey: form.apiKey,
      systemsJson: form.systems.length === 0 ? null : JSON.stringify(form.systems),
      disabled: form.enabled ? 0 : 1,
    });
  };

  const formId = `${id}-form`;

  return (
    <DetailsPanel
      title={creating ? "New downstream" : `Edit ${targetName(downstream)}`}
      subtitle={
        creating
          ? "Another Squelch server that receives a copy of new calls."
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
            {creating ? "Add downstream" : "Save"}
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
          hint="How the server is named in lists and the audit log, e.g. the site."
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
        <Field
          htmlFor={`${id}-url`}
          label="Server address"
          hint={
            <>
              The other server's base address. Calls are uploaded to its{" "}
              <code className="font-mono">/api/v1/calls</code> endpoint.
            </>
          }
        >
          <input
            id={`${id}-url`}
            type="url"
            className="input w-full"
            value={form.url}
            placeholder="https://scanner.example.org"
            onChange={(e) => set("url", e.target.value)}
            required
          />
        </Field>
        <Field
          htmlFor={`${id}-key`}
          label="API key"
          hint={
            creating
              ? "An API key created on the other server. It is stored encrypted and never shown again."
              : "Leave blank to keep the current key, or paste a new one to replace it."
          }
        >
          <input
            id={`${id}-key`}
            type="password"
            className="input w-full font-mono"
            value={form.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            required={creating}
            autoComplete="off"
          />
        </Field>

        <SystemsPicker
          systems={systems}
          value={form.systems}
          onChange={(ids) => set("systems", ids)}
        />

        <SwitchRow
          id={`${id}-enabled`}
          label="Enabled"
          hint="Turn off to stop sending without deleting the downstream."
          checked={form.enabled}
          onChange={(v) => set("enabled", v)}
        />
      </form>
    </DetailsPanel>
  );
}
