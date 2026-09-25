// The side panel for one recorder's broker settings: test, reconnect, edit,
// remove. Results show in the panel, next to the button that asked.
import { useState } from "react";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  InlineConfirm,
  PanelSection,
  useToast,
} from "@/features/admin/_shell";
import { useAppDispatch } from "@/app/store";
import InstanceForm, { INSTANCE_FORM_ID, type InstanceFormValues } from "./InstanceForm";
import { valuesToCreateBody, valuesToUpdateBody } from "./instanceFormBody";
import {
  useCreateTrInstanceMutation,
  useDeleteTrInstanceMutation,
  useReconnectTrInstanceMutation,
  useTestTrInstanceMutation,
  useUpdateTrInstanceMutation,
} from "./trMqttApi";
import { forgetInstance } from "./trMqttSlice";
import { STATE_LABEL, type InstanceState } from "./trunk";
import type { TrInstance } from "./types";

export interface InstancePanelProps {
  /** Undefined adds a new recorder. */
  instance?: TrInstance;
  state?: InstanceState;
  onClose: () => void;
  onSaved: (inst: TrInstance) => void;
  onDeleted: (id: number) => void;
}

function apiError(e: unknown, fallback: string): string {
  const err = e as { data?: { error?: string | { message?: string } }; status?: number };
  const body = err?.data?.error;
  if (typeof body === "string" && body) return body;
  if (body && typeof body === "object" && body.message) return body.message;
  if (err?.status) return `${fallback} (HTTP ${err.status}).`;
  return fallback;
}

const STATE_TONE: Record<InstanceState, string> = {
  connected: "badge-success",
  disconnected: "badge-warning",
  error: "badge-error",
  disabled: "badge-ghost",
};

export default function InstancePanel({ instance, state, onClose, onSaved, onDeleted }: InstancePanelProps) {
  const toast = useToast();
  const dispatch = useAppDispatch();
  const [create, { isLoading: creating }] = useCreateTrInstanceMutation();
  const [update, { isLoading: updating }] = useUpdateTrInstanceMutation();
  const [remove, { isLoading: removing }] = useDeleteTrInstanceMutation();
  const [test, { isLoading: testing }] = useTestTrInstanceMutation();
  const [reconnect, { isLoading: reconnecting }] = useReconnectTrInstanceMutation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isEdit = !!instance;

  async function save(values: InstanceFormValues) {
    setServerError(null);
    try {
      const saved = instance
        ? await update({ id: instance.id, body: valuesToUpdateBody(values) }).unwrap()
        : await create(valuesToCreateBody(values)).unwrap();
      toast.success(instance ? `${saved.label} saved.` : `${saved.label} added.`);
      onSaved(saved);
    } catch (e) {
      setServerError(apiError(e, "The instance could not be saved"));
    }
  }

  async function runTest() {
    if (!instance) return;
    setTestResult(null);
    try {
      const r = await test(instance.id).unwrap();
      setTestResult(r.ok ? { ok: true, text: "The broker answered and accepted the subscription." } : { ok: false, text: r.error ?? "The broker did not answer." });
    } catch (e) {
      setTestResult({ ok: false, text: apiError(e, "The test could not run") });
    }
  }

  async function runReconnect() {
    if (!instance) return;
    try {
      await reconnect(instance.id).unwrap();
      toast.success(`Reconnecting ${instance.label}.`);
    } catch (e) {
      toast.error(apiError(e, "The reconnect failed"));
    }
  }

  async function runRemove() {
    if (!instance) return;
    try {
      await remove(instance.id).unwrap();
      dispatch(forgetInstance(instance.id));
      toast.success(`${instance.label} removed.`);
      onDeleted(instance.id);
    } catch (e) {
      toast.error(apiError(e, "The instance could not be removed"));
    }
  }

  const busy = creating || updating;

  return (
    <DetailsPanel
      title={instance ? instance.label : "Add instance"}
      subtitle={instance ? instance.brokerUrl : "Broker settings for a trunk-recorder with the MQTT status plugin."}
      badges={instance && state ? <span className={`badge badge-sm ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span> : undefined}
      size="wide"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={INSTANCE_FORM_ID} className="btn btn-primary btn-sm" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save" : "Add"}
          </button>
        </div>
      }
    >
      {instance && (
        <PanelSection title="Broker">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => void runTest()} disabled={testing}>
              <Plug className="h-4 w-4" aria-hidden="true" />
              {testing ? "Testing…" : "Test broker"}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void runReconnect()} disabled={reconnecting || !instance.enabled}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reconnect
            </button>
          </div>
          <p role="status" className={`mt-2 text-sm ${testResult ? (testResult.ok ? "text-success" : "text-error") : "text-base-content/60"}`}>
            {testResult ? testResult.text : "Test tries the saved settings; save first after a change."}
          </p>
        </PanelSection>
      )}

      <PanelSection title="Settings">
        <InstanceForm editing={instance} serverError={serverError} onSubmit={(v) => void save(v)} />
      </PanelSection>

      {instance && (
        <PanelSection title="Remove">
          {confirmRemove ? (
            <InlineConfirm
              title={`Remove ${instance.label}?`}
              text="Squelch stops listening to its broker and drops the live data shown here. The recorder itself keeps running."
              button="Remove"
              danger
              busy={removing}
              onCancel={() => setConfirmRemove(false)}
              onConfirm={() => void runRemove()}
            />
          ) : (
            <ActionButton
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              label="Remove instance"
              hint="Forget the broker settings for this instance."
              danger
              onClick={() => setConfirmRemove(true)}
            />
          )}
        </PanelSection>
      )}
    </DetailsPanel>
  );
}
