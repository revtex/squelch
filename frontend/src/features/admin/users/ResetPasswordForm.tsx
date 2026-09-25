import { useId, useState } from "react";
import { Dices } from "lucide-react";
import {
  DetailsPanel,
  Field,
  SwitchRow,
  plural,
} from "@/features/admin/_shell";
import type { AdminUser, UpdateUserPayload } from "@/types";
import { generatePassword } from "./status";

export interface ResetPasswordFormProps {
  user: AdminUser;
  /** The admin is resetting their own password. */
  self: boolean;
  busy: boolean;
  error: string | null;
  onSubmit: (payload: UpdateUserPayload) => void;
  onClose: () => void;
}

/** Set a temporary password for a user who lost theirs. */
export default function ResetPasswordForm({
  user,
  self,
  busy,
  error,
  onSubmit,
  onClose,
}: ResetPasswordFormProps) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [needChange, setNeedChange] = useState(!self);
  const [signOut, setSignOut] = useState(!self);
  const formId = `${id}-form`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      username: user.username,
      role: user.role,
      disabled: user.disabled,
      systemsJson: user.systemsJson,
      expiration: user.expiration,
      limit: user.limit,
      password,
      passwordNeedChange: needChange ? 1 : 0,
      signOut,
    });
  };

  return (
    <DetailsPanel
      title={`Reset password for ${user.username}`}
      subtitle="Sets a new password now. The old one stops working at once."
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
            Set password
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
          htmlFor={`${id}-password`}
          label="New password"
          hint="At least 8 characters. It is shown here so you can pass it on."
        >
          <div className="join w-full">
            <input
              id={`${id}-password`}
              type="text"
              className="input join-item w-full font-mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="off"
            />
            <button
              type="button"
              className="btn join-item"
              onClick={() => setPassword(generatePassword())}
            >
              <Dices className="h-4 w-4" aria-hidden="true" />
              Generate
            </button>
          </div>
        </Field>
        <SwitchRow
          id={`${id}-needchange`}
          label="Require a new password at next sign-in"
          hint="The user is asked to pick their own password before they can listen."
          checked={needChange}
          onChange={setNeedChange}
        />
        <SwitchRow
          id={`${id}-signout`}
          label="Sign out everywhere"
          hint={
            self
              ? "Including this browser: you will sign in again with the new password."
              : `${plural(user.devices, "device")} will need the new password. Use this if the old one may have leaked.`
          }
          checked={signOut}
          onChange={setSignOut}
        />
      </form>
    </DetailsPanel>
  );
}
