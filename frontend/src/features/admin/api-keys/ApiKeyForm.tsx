import { useId } from "react";
import { DetailsPanel, Field, SwitchRow, SystemPicker } from "@/features/admin/_shell";
import type { AdminSystem } from "@/types";
import { useKeyForm, type ApiKeyFormValues, type KeyForm } from "./useKeyForm";

export type { ApiKeyFormValues } from "./useKeyForm";

/** Label, systems and rate limit; the Enabled switch only when creating. */
export function KeyFields({
  keyForm,
  systems,
  defaultRate,
  creating,
}: {
  keyForm: KeyForm;
  systems: AdminSystem[];
  defaultRate: number;
  creating: boolean;
}) {
  const id = useId();
  const { form, set } = keyForm;
  return (
    <>
      <Field
        htmlFor={`${id}-ident`}
        label="Label"
        hint={creating ? "Name the recorder or site, so the audit log reads well." : undefined}
      >
        <input
          id={`${id}-ident`}
          type="text"
          className="input w-full"
          value={form.ident}
          placeholder={creating ? "e.g. TR-Geauga-Chardon" : undefined}
          onChange={(e) => set("ident", e.target.value)}
          required
          maxLength={64}
          autoFocus={creating}
        />
      </Field>

      {systems.length > 0 ? (
        <SystemPicker
          label="Systems this key may upload to"
          systems={systems}
          value={form.systems}
          onChange={(next) => set("systems", next)}
        />
      ) : (
        <p className="text-sm text-base-content-dim">
          No systems yet, so the key can upload to any system that gets created.
        </p>
      )}

      <Field
        htmlFor={`${id}-rate`}
        label="Rate limit (calls per minute)"
        hint={`Blank uses the server default of ${defaultRate}.`}
      >
        <input
          id={`${id}-rate`}
          type="number"
          min={1}
          max={600}
          className="input w-full"
          value={form.rate}
          placeholder={`Default ${defaultRate}`}
          onChange={(e) => set("rate", e.target.value)}
        />
      </Field>

      {creating && (
        <SwitchRow
          id={`${id}-enabled`}
          label="Enabled"
          hint="Turn off to prepare a key you will switch on later."
          checked={form.enabled}
          onChange={(on) => set("enabled", on)}
        />
      )}
    </>
  );
}

export interface ApiKeyFormProps {
  systems: AdminSystem[];
  /** The server-wide rate limit, shown as the placeholder. */
  defaultRate: number;
  busy: boolean;
  error: string | null;
  onSubmit: (values: ApiKeyFormValues) => void;
  onClose: () => void;
}

/** Create an API key, in the side panel. */
export default function ApiKeyForm({
  systems,
  defaultRate,
  busy,
  error,
  onSubmit,
  onClose,
}: ApiKeyFormProps) {
  const id = useId();
  const keyForm = useKeyForm(null);
  const formId = `${id}-form`;

  return (
    <DetailsPanel
      title="Create API key"
      subtitle="The secret is shown once, after you save."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy && <span className="loading loading-spinner loading-xs" />}
            Create key
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(keyForm.values());
        }}
        className="flex flex-col gap-4"
      >
        {error && (
          <div role="alert" className="alert alert-error text-sm">
            {error}
          </div>
        )}
        <KeyFields keyForm={keyForm} systems={systems} defaultRate={defaultRate} creating />
        <div className="rounded-md border border-admin-line bg-base-100 p-3 text-sm">
          <b className="block font-semibold">After saving</b>
          <span className="text-base-content-dim">
            You get the secret once, a copy button, and a ready-made{" "}
            <span className="font-mono">trunk-recorder</span> upload snippet.
          </span>
        </div>
      </form>
    </DetailsPanel>
  );
}
