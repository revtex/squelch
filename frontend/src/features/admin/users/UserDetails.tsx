import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Cable, KeyRound, LogOut, Pencil, Trash2, UserX, UserCheck } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  PanelSection,
  formatAgo,
  formatDate,
  formatDateTime,
  plural,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminSystem, AdminUser } from "@/types";
import { systemsLabel, userStatus } from "./status";

export type UserAction = "signout" | "disable" | "enable" | "delete";

interface Question {
  title: string;
  text: string;
  button: string;
  danger: boolean;
}

function question(action: UserAction, u: AdminUser, self: boolean): Question {
  switch (action) {
    case "signout":
      return self
        ? {
            title: "Sign yourself out everywhere?",
            text: "Every device, including this one, will need the password to sign in again.",
            button: "Sign out everywhere",
            danger: true,
          }
        : {
            title: `Sign ${u.username} out everywhere?`,
            text: `${plural(u.devices, "device")} will need the password to sign in again. Use this if you think someone else has the account.`,
            button: "Sign out everywhere",
            danger: false,
          };
    case "disable":
      return {
        title: `Disable ${u.username}?`,
        text: "They are signed out everywhere and cannot sign in until you enable the account again. Nothing is deleted.",
        button: "Disable",
        danger: false,
      };
    case "enable":
      return {
        title: `Enable ${u.username}?`,
        text: "They can sign in again with their password.",
        button: "Enable",
        danger: false,
      };
    case "delete":
      return {
        title: `Delete ${u.username}?`,
        text: "The account, its devices and its bookmarks are removed for good. This cannot be undone.",
        button: "Delete",
        danger: true,
      };
  }
}

export interface UserDetailsProps {
  user: AdminUser;
  systems: AdminSystem[];
  /** The signed-in admin is looking at their own account. */
  self: boolean;
  busy: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onNeedChange: (needChange: boolean) => Promise<string | null>;
  /** Resolves to the error message, or null when it worked. */
  onAction: (action: UserAction) => Promise<string | null>;
  onClose: () => void;
}

/** Everything about one user and what an admin can do about them. */
export default function UserDetails({
  user: u,
  systems,
  self,
  busy,
  onEdit,
  onResetPassword,
  onNeedChange,
  onAction,
  onClose,
}: UserDetailsProps) {
  const id = useId();
  const navigate = useNavigate();
  const [pending, setPending] = useState<UserAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = userStatus(u);
  const primary = u.id === 1;

  const run = async (action: UserAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const facts: Fact[] = [
    { label: "Role", value: u.role === "admin" ? "Admin" : "Listener" },
    { label: "Status", value: status.label },
    { label: "Systems", value: systemsLabel(u, systems) },
    {
      label: "Expires",
      value: u.expiration ? formatDate(u.expiration) : "Never",
    },
    {
      label: "Connections",
      value:
        u.limit != null
          ? `${plural(u.liveConnections, "open connection")} · limit ${u.limit}`
          : plural(u.liveConnections, "open connection"),
    },
    { label: "Devices", value: plural(u.devices, "signed-in device") },
    {
      label: "Last seen",
      value: u.lastSeenAt
        ? `${formatAgo(u.lastSeenAt)}${u.lastSeenIp ? ` from ${u.lastSeenIp}` : ""}`
        : "Not in the last 30 days",
    },
    { label: "Created", value: formatDateTime(u.createdAt) },
  ];

  const ask = pending ? question(pending, u, self) : null;

  return (
    <DetailsPanel
      title={u.username}
      subtitle={u.role === "admin" ? "Admin account" : "Listener account"}
      badges={
        <>
          <span className={`badge badge-sm ${status.badge}`}>{status.label}</span>
          {u.passwordNeedChange === 1 && (
            <span className="badge badge-info badge-sm">temporary password</span>
          )}
          {self && <span className="badge badge-ghost badge-sm">you</span>}
        </>
      }
      onClose={onClose}
    >
      <FactList facts={facts} />

      {u.passwordNeedChange === 1 && (
        <div className="alert alert-info text-sm">
          This user must pick a new password the next time they sign in.
        </div>
      )}
      {primary && (
        <div className="alert text-sm">
          This is the primary admin. It cannot be disabled or deleted.
        </div>
      )}
      {error && (
        <div role="alert" className="alert alert-error text-sm">
          {error}
        </div>
      )}

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
        <>
          <PanelSection title="Account">
            <ActionButton
              icon={<Pencil className="h-4 w-4" />}
              label="Edit"
              hint="Name, role, systems, expiry and connection limit."
              onClick={onEdit}
            />
            <ActionButton
              icon={<KeyRound className="h-4 w-4" />}
              label="Reset password"
              hint="Set a temporary password and, if you like, sign them out."
              onClick={onResetPassword}
            />
            <label
              htmlFor={`${id}-needchange`}
              className="flex cursor-pointer items-start justify-between gap-4 rounded-box border border-admin-line px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block font-medium">Require password change</span>
                <span className="block text-xs text-base-content-dim">
                  Asks for a new password at the next sign-in.
                </span>
              </span>
              <input
                id={`${id}-needchange`}
                type="checkbox"
                role="switch"
                className="toggle toggle-primary shrink-0"
                checked={u.passwordNeedChange === 1}
                disabled={busy}
                onChange={(e) => {
                  setError(null);
                  void onNeedChange(e.target.checked).then((failed) => {
                    if (failed !== null) setError(failed);
                  });
                }}
              />
            </label>
          </PanelSection>

          <PanelSection title="Sessions">
            {u.liveConnections > 0 && (
              <ActionButton
                icon={<Cable className="h-4 w-4" />}
                label={`See ${plural(u.liveConnections, "live connection")}`}
                hint="Opens Connections filtered to this user."
                onClick={() => {
                  onClose();
                  navigate(
                    `/admin/connections?user=${u.id}&name=${encodeURIComponent(u.username)}`,
                  );
                }}
              />
            )}
            <ActionButton
              icon={<LogOut className="h-4 w-4" />}
              label="Sign out everywhere"
              hint={
                u.devices > 0
                  ? `${plural(u.devices, "device")} will need the password again.`
                  : "No device is signed in right now."
              }
              disabled={u.devices === 0 && u.liveConnections === 0}
              onClick={() => setPending("signout")}
            />
          </PanelSection>

          {!primary && (
            <PanelSection title="Danger zone">
              {u.disabled === 1 ? (
                <ActionButton
                  icon={<UserCheck className="h-4 w-4" />}
                  label="Enable"
                  hint="Lets them sign in again."
                  onClick={() => setPending("enable")}
                />
              ) : (
                <ActionButton
                  icon={<UserX className="h-4 w-4" />}
                  label="Disable"
                  hint="Signs them out everywhere and refuses sign-in. Nothing is deleted."
                  disabled={self}
                  onClick={() => setPending("disable")}
                />
              )}
              <ActionButton
                icon={<Trash2 className="h-4 w-4" />}
                label="Delete"
                hint="Removes the account for good."
                danger
                disabled={self}
                onClick={() => setPending("delete")}
              />
            </PanelSection>
          )}
        </>
      )}
    </DetailsPanel>
  );
}
