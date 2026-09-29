import { useEffect, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  Field,
  InlineConfirm,
  PanelSection,
  SwitchRow,
  plural,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type { AdminSystem, AdminSystemInput } from "@/types";
import { LED_COLORS } from "./systems";

export interface SystemFormProps {
  /** null creates a system. */
  system: AdminSystem | null;
  /** Where a new system goes in the list. */
  nextOrder: number;
  busy: boolean;
  error: string | null;
  onSubmit: (values: AdminSystemInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

interface FormState {
  systemId: string;
  label: string;
  led: string;
  autoPopulate: boolean;
}

function fromSystem(s: AdminSystem | null): FormState {
  return {
    systemId: s ? String(s.systemId) : "",
    label: s?.label ?? "",
    led: s?.led ?? "",
    autoPopulate: s ? s.autoPopulateTalkgroups === 1 : true,
  };
}

/** Create or edit a system; editing also offers the guarded delete. */
export default function SystemForm({ system, nextOrder, busy, error, onSubmit, onDelete, onClose }: SystemFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromSystem(system));
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const { setGuard } = useNavigationGuard();
  const creating = system === null;

  useEffect(() => {
    setGuard(dirty ? () => true : null);
    return () => setGuard(null);
  }, [dirty, setGuard]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const numberChanged = !creating && form.systemId !== String(system.systemId);
  const formId = `${id}-form`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setDirty(false);
    onSubmit({
      systemId: Number(form.systemId),
      label: form.label.trim(),
      led: form.led || null,
      autoPopulateTalkgroups: form.autoPopulate ? 1 : 0,
      blacklistsJson: system?.blacklistsJson ?? null,
      order: system?.order ?? nextOrder,
    });
  };

  return (
    <DetailsPanel
      title={creating ? "Add system" : `${system.label} settings`}
      subtitle={
        creating
          ? "Most systems appear on their own when uploads may create them."
          : `System ${system.systemId} · ${plural(system.talkgroups, "talkgroup")}`
      }
      onClose={onClose}
      footer={
        confirming ? null : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !form.label.trim() || form.systemId === ""}>
              {busy ? "Saving…" : creating ? "Create system" : "Save"}
            </button>
          </>
        )
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        {error && (
          <p role="alert" className="alert alert-error text-sm">
            {error}
          </p>
        )}
        <Field
          htmlFor={`${id}-number`}
          label="System number"
          hint={
            numberChanged
              ? `Changing this stops uploads that still use ${system.systemId}.`
              : "Must match the system number your recorder sends."
          }
          error={null}
        >
          <input
            id={`${id}-number`}
            type="number"
            min={0}
            inputMode="numeric"
            className={`input w-full ${numberChanged ? "input-warning" : ""}`}
            value={form.systemId}
            required
            onChange={(e) => set("systemId", e.target.value)}
          />
        </Field>
        <Field htmlFor={`${id}-label`} label="Label" hint="Shown on the scanner display and in the admin.">
          <input
            id={`${id}-label`}
            type="text"
            className="input w-full"
            maxLength={64}
            value={form.label}
            required
            onChange={(e) => set("label", e.target.value)}
          />
        </Field>
        <Field htmlFor={`${id}-led`} label="LED colour" hint="Talkgroups without their own colour light this one.">
          <select id={`${id}-led`} className="select w-full" value={form.led} onChange={(e) => set("led", e.target.value)}>
            <option value="">Green (default)</option>
            {LED_COLORS.filter((c) => c !== "green").map((c) => (
              <option key={c} value={c}>
                {c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </Field>
        <SwitchRow
          id={`${id}-auto`}
          label="Auto-populate talkgroups"
          hint="Unknown talkgroups get created from uploads, unlabeled, so you can name them later."
          checked={form.autoPopulate}
          onChange={(v) => set("autoPopulate", v)}
        />
      </form>

      {!creating && (
        <PanelSection title="Danger">
          {confirming ? (
            <InlineConfirm
              title={`Delete ${system.label}?`}
              text={`Removes the system, ${plural(system.talkgroups, "talkgroup")} and ${plural(system.units, "unit")}. Calls stay, labelled by their numbers only. Type the label to confirm.`}
              button="Delete system"
              danger
              busy={busy}
              ready={typed.trim() === system.label}
              onCancel={() => {
                setConfirming(false);
                setTyped("");
              }}
              onConfirm={onDelete}
            >
              <input
                type="text"
                className="input input-sm w-full"
                aria-label={`Type ${system.label} to confirm`}
                placeholder={`Type ${system.label}`}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
            </InlineConfirm>
          ) : (
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete system"
              hint="Also deletes its talkgroups and units."
              danger
              disabled={busy}
              onClick={() => setConfirming(true)}
            />
          )}
        </PanelSection>
      )}
    </DetailsPanel>
  );
}
