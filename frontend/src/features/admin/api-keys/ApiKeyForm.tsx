import { useEffect, useId, useState } from "react";
import {
  DetailsPanel,
  Field,
  SwitchRow,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminApiKey, AdminSystem } from "@/types";
import { allowedSystemIds } from "./keys";

export interface ApiKeyFormValues {
  ident: string;
  disabled: number;
  systemsJson: string | null;
  callRateLimit: number | null;
}

interface FormState {
  ident: string;
  enabled: boolean;
  systems: number[];
  rate: string;
}

function fromKey(k: AdminApiKey | null): FormState {
  return {
    ident: k?.ident ?? "",
    enabled: k ? k.disabled === 0 : true,
    systems: k ? allowedSystemIds(k) : [],
    rate: k?.callRateLimit != null ? String(k.callRateLimit) : "",
  };
}

export interface ApiKeyFormProps {
  /** The key being edited, or null to create one. */
  apiKey: AdminApiKey | null;
  systems: AdminSystem[];
  /** The server-wide rate limit, shown as the placeholder. */
  defaultRate: number;
  busy: boolean;
  error: string | null;
  onSubmit: (values: ApiKeyFormValues) => void;
  onClose: () => void;
}

/** Create or edit an API key, in the side panel. */
export default function ApiKeyForm({
  apiKey,
  systems,
  defaultRate,
  busy,
  error,
  onSubmit,
  onClose,
}: ApiKeyFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromKey(apiKey));
  const [dirty, setDirty] = useState(false);
  const { setGuard } = useNavigationGuard();
  const creating = apiKey === null;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const toggleSystem = (sid: number) => {
    set(
      "systems",
      form.systems.includes(sid)
        ? form.systems.filter((x) => x !== sid)
        : [...form.systems, sid],
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDirty(false);
    onSubmit({
      ident: form.ident.trim(),
      disabled: form.enabled ? 0 : 1,
      systemsJson: form.systems.length === 0 ? null : JSON.stringify(form.systems),
      callRateLimit: form.rate ? Number(form.rate) : null,
    });
  };

  const formId = `${id}-form`;
  const sorted = systems.slice().sort((a, b) => a.order - b.order);

  return (
    <DetailsPanel
      title={creating ? "New API key" : `Edit ${apiKey.ident || apiKey.fingerprint}`}
      subtitle={
        creating
          ? "The secret is shown once, after you save."
          : "Changes apply to the next upload."
      }
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={busy}
          >
            {busy && <span className="loading loading-spinner loading-xs" />}
            {creating ? "Create key" : "Save"}
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
          htmlFor={`${id}-ident`}
          label="Label"
          hint="Where the key is used, e.g. the recorder's name or site."
        >
          <input
            id={`${id}-ident`}
            type="text"
            className="input w-full"
            value={form.ident}
            onChange={(e) => set("ident", e.target.value)}
            required
            maxLength={64}
            autoFocus={creating}
          />
        </Field>

        <div className="fieldset">
          <span className="fieldset-legend">Systems</span>
          <p className="label whitespace-normal">
            Which systems the key may upload to. Pick none to allow them all.
          </p>
          {sorted.length === 0 ? (
            <p className="text-sm text-base-content-dim">
              No systems yet, so the key can upload to any system that gets
              created.
            </p>
          ) : (
            <div role="group" aria-label="Systems" className="flex flex-wrap gap-2">
              {sorted.map((s) => {
                const on = form.systems.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
                    onClick={() => toggleSystem(s.id)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Field
          htmlFor={`${id}-rate`}
          label="Rate limit"
          hint={`Calls a minute this key may upload. Empty uses the server default of ${defaultRate}.`}
        >
          <input
            id={`${id}-rate`}
            type="number"
            min={1}
            max={600}
            className="input w-full"
            value={form.rate}
            placeholder={`${defaultRate}`}
            onChange={(e) => set("rate", e.target.value)}
          />
        </Field>

        <SwitchRow
          id={`${id}-enabled`}
          label="Enabled"
          hint="Turn off to refuse uploads with this key without deleting it."
          checked={form.enabled}
          onChange={(on) => set("enabled", on)}
        />
      </form>
    </DetailsPanel>
  );
}
