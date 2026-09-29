// The broker settings for one recorder. Password is tri-state on edit, as
// the PATCH contract needs: keep (field omitted), clear (""), or set.
import { useState, type FormEvent } from "react";
import { Field, Segmented, SwitchRow } from "@/features/admin/_shell";
import type { TrInstance } from "./types";

export interface InstanceFormValues {
  label: string;
  instanceId: string;
  brokerUrl: string;
  baseTopic: string;
  unitTopic: string;
  messageTopic: string;
  username: string;
  qos: number;
  tlsSkipVerify: boolean;
  enabled: boolean;
  passwordMode: "keep" | "clear" | "set";
  password: string;
}

const DEFAULTS: InstanceFormValues = {
  label: "",
  instanceId: "",
  brokerUrl: "tcp://localhost:1883",
  baseTopic: "trunk-recorder",
  unitTopic: "trunk-recorder/units",
  messageTopic: "trunk-recorder/messages",
  username: "",
  qos: 0,
  tlsSkipVerify: false,
  enabled: true,
  passwordMode: "set",
  password: "",
};

function fromInstance(inst: TrInstance): InstanceFormValues {
  return {
    label: inst.label,
    instanceId: inst.instanceId,
    brokerUrl: inst.brokerUrl,
    baseTopic: inst.baseTopic,
    unitTopic: inst.unitTopic ?? "",
    messageTopic: inst.messageTopic ?? "",
    username: inst.username ?? "",
    qos: inst.qos,
    tlsSkipVerify: inst.tlsSkipVerify,
    enabled: inst.enabled,
    passwordMode: "keep",
    password: "",
  };
}

export const INSTANCE_FORM_ID = "tr-instance-form";

interface InstanceFormProps {
  editing?: TrInstance;
  /** A message from the server after a failed save. */
  serverError?: string | null;
  onSubmit: (values: InstanceFormValues) => void;
  /** Called with every edit so the panel can guard navigation. */
  onDirty?: (dirty: boolean) => void;
  /** Lets the panel test the broker with what is typed, not what is saved. */
  onValues?: (values: InstanceFormValues) => void;
}

/** The fields, without buttons: the panel's footer submits by form id. */
export default function InstanceForm({ editing, serverError, onSubmit, onDirty, onValues }: InstanceFormProps) {
  const [values, setValues] = useState<InstanceFormValues>(editing ? fromInstance(editing) : DEFAULTS);
  const [errors, setErrors] = useState<Partial<Record<keyof InstanceFormValues, string>>>({});
  const [editingId, setEditingId] = useState<number | undefined>(editing?.id);
  if (editing?.id !== editingId) {
    setEditingId(editing?.id);
    setValues(editing ? fromInstance(editing) : DEFAULTS);
    setErrors({});
  }

  const isEdit = !!editing;

  function change<K extends keyof InstanceFormValues>(key: K, value: InstanceFormValues[K]) {
    setValues((v) => {
      const next = { ...v, [key]: value };
      // The plugin's convention is <base>/units and <base>/messages; fill
      // them in until the admin types their own.
      if (key === "baseTopic" && typeof value === "string") {
        const base = value.trim();
        const wasUnit = v.unitTopic === "" || v.unitTopic === `${v.baseTopic.trim()}/units`;
        const wasMsg = v.messageTopic === "" || v.messageTopic === `${v.baseTopic.trim()}/messages`;
        if (wasUnit) next.unitTopic = base ? `${base}/units` : "";
        if (wasMsg) next.messageTopic = base ? `${base}/messages` : "";
      }
      onDirty?.(true);
      onValues?.(next);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.label.trim()) next.label = "Give the recorder a name.";
    if (!values.instanceId.trim()) next.instanceId = "Copy instance_id from the recorder's config.";
    if (!values.brokerUrl.trim()) next.brokerUrl = "The broker's address is needed.";
    else if (!/^(mqtt|mqtts|tcp|ssl|tls|ws|wss):\/\/\S+/i.test(values.brokerUrl.trim()))
      next.brokerUrl = "Use a scheme and host, like tcp://broker:1883.";
    if (!values.baseTopic.trim()) next.baseTopic = "The base topic is needed.";
    if (values.passwordMode === "set" && isEdit && !values.password) next.password = "Type the new password, or keep the old one.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit(values);
  }

  return (
    <form id={INSTANCE_FORM_ID} onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field htmlFor="tr-label" label="Label" error={errors.label} hint="How this recorder is named on the page and in the audit trail.">
          <input
            id="tr-label"
            className="input input-sm w-full"
            value={values.label}
            onChange={(e) => change("label", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field htmlFor="tr-instance-id" label="Instance ID" error={errors.instanceId} hint="instance_id from the recorder's config; frames from other recorders on the same broker are ignored.">
          <input
            id="tr-instance-id"
            className="input input-sm w-full font-mono"
            value={values.instanceId}
            onChange={(e) => change("instanceId", e.target.value)}
            autoComplete="off"
            placeholder="tr-lake-north"
          />
        </Field>
      </div>

      <Field htmlFor="tr-broker" label="Broker URL" error={errors.brokerUrl} hint="Reachable from the server. mqtts:// or ssl:// for TLS.">
        <input
          id="tr-broker"
          className="input input-sm w-full font-mono"
          value={values.brokerUrl}
          onChange={(e) => change("brokerUrl", e.target.value)}
          placeholder="tcp://mqtt:1883"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field htmlFor="tr-base-topic" label="Base topic" error={errors.baseTopic} hint="Units and messages topics follow from it unless you change them.">
          <input
            id="tr-base-topic"
            className="input input-sm w-full font-mono"
            value={values.baseTopic}
            onChange={(e) => change("baseTopic", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field htmlFor="tr-unit-topic" label="Units topic">
          <input
            id="tr-unit-topic"
            className="input input-sm w-full font-mono"
            value={values.unitTopic}
            onChange={(e) => change("unitTopic", e.target.value)}
            placeholder="trunk-recorder/units"
            autoComplete="off"
          />
        </Field>
        <Field htmlFor="tr-message-topic" label="Messages topic">
          <input
            id="tr-message-topic"
            className="input input-sm w-full font-mono"
            value={values.messageTopic}
            onChange={(e) => change("messageTopic", e.target.value)}
            placeholder="trunk-recorder/messages"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field htmlFor="tr-username" label="Username" hint="Leave empty for a broker without authentication.">
          <input
            id="tr-username"
            className="input input-sm w-full"
            value={values.username}
            onChange={(e) => change("username", e.target.value)}
            autoComplete="off"
          />
        </Field>
        <div className="space-y-2">
          {isEdit && <span className="block text-sm font-medium">Password</span>}
          {isEdit && (
            <Segmented<InstanceFormValues["passwordMode"]>
              label="Password"
              value={values.passwordMode}
              onChange={(m) => change("passwordMode", m)}
              options={[
                { id: "keep", label: editing?.hasPassword ? "Keep" : "None" },
                { id: "set", label: "Set new" },
                { id: "clear", label: "Clear" },
              ]}
            />
          )}
          {(values.passwordMode === "set" || !isEdit) && (
            <Field htmlFor="tr-password" label={isEdit ? "New password" : "Password"} error={errors.password}>
              <input
                id="tr-password"
                type="password"
                className="input input-sm w-full"
                value={values.password}
                onChange={(e) => change("password", e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          )}
        </div>
      </div>

      <Field htmlFor="tr-qos" label="QoS" hint="0 is right for a live dashboard; 1 adds broker retransmits.">
        <select id="tr-qos" className="select select-sm" value={values.qos} onChange={(e) => change("qos", Number(e.target.value))}>
          <option value={0}>0 · at most once</option>
          <option value={1}>1 · at least once</option>
          <option value={2}>2 · exactly once</option>
        </select>
      </Field>

      <div className="space-y-3 rounded-box border border-admin-line p-3">
        <SwitchRow
          id="tr-tls-skip"
          label="Skip TLS verification"
          hint="Only for a self-signed broker on a private network."
          checked={values.tlsSkipVerify}
          onChange={(v) => change("tlsSkipVerify", v)}
        />
        <SwitchRow
          id="tr-enabled"
          label="Enabled"
          hint="Off keeps the settings but does not connect."
          checked={values.enabled}
          onChange={(v) => change("enabled", v)}
        />
      </div>

      {serverError && (
        <p role="alert" className="text-sm text-error">
          {serverError}
        </p>
      )}
    </form>
  );
}
