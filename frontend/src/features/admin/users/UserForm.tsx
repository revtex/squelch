import { useEffect, useId, useState } from "react";
import { Dices } from "lucide-react";
import {
  DetailsPanel,
  Field,
  Segmented,
  SwitchRow,
  fromDateInput,
  toDateInput,
  useNavigationGuard,
} from "@/features/admin/_shell";
import type {
  AdminSystem,
  AdminUser,
  CreateUserPayload,
  UpdateUserPayload,
} from "@/types";
import { allowedSystemIds, generatePassword } from "./status";

interface FormState {
  username: string;
  password: string;
  needChange: boolean;
  role: "admin" | "listener";
  disabled: boolean;
  systems: number[];
  expiration: string;
  limit: string;
}

function fromUser(u: AdminUser | null): FormState {
  return {
    username: u?.username ?? "",
    password: "",
    needChange: true,
    role: u?.role ?? "listener",
    disabled: u?.disabled === 1,
    systems: u ? allowedSystemIds(u) : [],
    expiration: u?.expiration ? toDateInput(u.expiration) : "",
    limit: u?.limit != null ? String(u.limit) : "",
  };
}

const ROLES = [
  { id: "listener", label: "Listener", hint: "Can listen only" },
  { id: "admin", label: "Admin", hint: "Can change everything here" },
] as const;

export interface UserFormProps {
  /** The user being edited, or null to create one. */
  user: AdminUser | null;
  systems: AdminSystem[];
  busy: boolean;
  error: string | null;
  onCreate: (payload: CreateUserPayload) => void;
  onUpdate: (id: number, payload: UpdateUserPayload) => void;
  onClose: () => void;
}

/** Create or edit a user, in the side panel. */
export default function UserForm({
  user,
  systems,
  busy,
  error,
  onCreate,
  onUpdate,
  onClose,
}: UserFormProps) {
  const id = useId();
  const [form, setForm] = useState<FormState>(() => fromUser(user));
  const [dirty, setDirty] = useState(false);
  const { setGuard } = useNavigationGuard();
  const primary = user?.id === 1;
  const creating = user === null;

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
    const common = {
      username: form.username.trim(),
      role: form.role,
      systemsJson:
        primary || form.systems.length === 0
          ? null
          : JSON.stringify(form.systems),
      expiration: primary ? null : fromDateInput(form.expiration),
      limit: primary || !form.limit ? null : Number(form.limit),
    };
    setDirty(false);
    if (creating) {
      onCreate({
        ...common,
        password: form.password,
        disabled: form.disabled ? 1 : 0,
        passwordNeedChange: form.needChange ? 1 : 0,
      });
    } else {
      onUpdate(user.id, { ...common, disabled: form.disabled ? 1 : 0 });
    }
  };

  const formId = `${id}-form`;
  const sorted = systems.slice().sort((a, b) => a.order - b.order);

  return (
    <DetailsPanel
      title={creating ? "New user" : `Edit ${user.username}`}
      subtitle={
        creating
          ? "They can sign in as soon as you save."
          : "Changes apply at once; the user stays signed in."
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
            {creating ? "Create user" : "Save"}
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
        {primary && (
          <div className="alert text-sm">
            This is the primary admin. Its role, expiry, connection limit and
            systems are fixed.
          </div>
        )}

        <Field htmlFor={`${id}-username`} label="Username">
          <input
            id={`${id}-username`}
            type="text"
            className="input w-full"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            required
            maxLength={64}
            autoComplete="off"
          />
        </Field>

        {creating && (
          <>
            <Field
              htmlFor={`${id}-password`}
              label="Temporary password"
              hint="At least 8 characters. Give it to the user however you like."
            >
              <div className="join w-full">
                <input
                  id={`${id}-password`}
                  type="text"
                  className="input join-item w-full font-mono"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="btn join-item"
                  onClick={() => set("password", generatePassword())}
                >
                  <Dices className="h-4 w-4" aria-hidden="true" />
                  Generate
                </button>
              </div>
            </Field>
            <SwitchRow
              id={`${id}-needchange`}
              label="Require a new password at first sign-in"
              hint="Leave this on unless the user chose the password themselves."
              checked={form.needChange}
              onChange={(v) => set("needChange", v)}
            />
          </>
        )}

        <div className="fieldset">
          <span className="fieldset-legend">Role</span>
          <Segmented
            label="Role"
            options={ROLES}
            value={form.role}
            disabled={primary}
            onChange={(v) => set("role", v)}
          />
        </div>

        {!creating && !primary && (
          <SwitchRow
            id={`${id}-disabled`}
            label="Disabled"
            hint="Keeps the account but refuses sign-in. Disabling signs the user out everywhere."
            checked={form.disabled}
            onChange={(v) => set("disabled", v)}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            htmlFor={`${id}-expiration`}
            label="Expires"
            hint={primary ? "Never for the primary admin." : "Optional. The account stops working at the end of this day."}
          >
            <input
              id={`${id}-expiration`}
              type="date"
              className="input w-full"
              value={form.expiration}
              disabled={primary}
              onChange={(e) => set("expiration", e.target.value)}
            />
          </Field>
          <Field
            htmlFor={`${id}-limit`}
            label="Connection limit"
            hint={primary ? "Unlimited for the primary admin." : "Optional. How many connections at once; empty means no limit."}
          >
            <input
              id={`${id}-limit`}
              type="number"
              className="input w-full"
              value={form.limit}
              disabled={primary}
              min={1}
              placeholder="Unlimited"
              onChange={(e) => set("limit", e.target.value)}
            />
          </Field>
        </div>

        {sorted.length > 0 && (
          <div className="fieldset">
            <span className="fieldset-legend">Systems</span>
            <p className="label whitespace-normal">
              {primary
                ? "The primary admin always hears every system."
                : "Pick the systems this user can hear. With none picked, they hear every system."}
            </p>
            <div
              role="group"
              aria-label="Systems"
              className="flex flex-wrap gap-2"
            >
              {sorted.map((s) => {
                const on = primary || form.systems.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={on}
                    disabled={primary}
                    className={`btn btn-sm ${on ? "btn-primary" : "btn-outline"}`}
                    onClick={() => toggleSystem(s.id)}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </form>
    </DetailsPanel>
  );
}
