import { useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, Pencil, ShieldCheck, Trash2, UserX, UserCheck } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  InlineConfirm,
  Notice,
  PanelSection,
  formatDay,
  formatDuration,
  formatWhen,
  plural,
  useHour12,
  useListConnectionsQuery,
  useNow,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminSystem, AdminUser, ConnectionKind } from "@/types";
import { systemsLabel, userStatus } from "./status";

const KIND: Record<ConnectionKind, string> = {
  listener: "LIVE",
  stream: "BKGND",
  admin: "Admin",
};

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
        text: "The account, its devices and its bookmarks are removed for good. Calls and recordings are not affected. This can't be undone.",
        button: "Delete user",
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
  const hour12 = useHour12();
  const [pending, setPending] = useState<UserAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: connData } = useListConnectionsQuery();
  const status = userStatus(u);
  const primary = u.id === 1;
  const now = useNow(15_000);
  const live = (connData?.connections ?? []).filter((c) => c.userId === u.id);

  const run = async (action: UserAction) => {
    setError(null);
    const failed = await onAction(action);
    setPending(null);
    if (failed !== null) setError(failed);
    else if (action === "delete") onClose();
  };

  const openConnections = (tab: "live" | "devices") => {
    onClose();
    const params = new URLSearchParams({ tab, q: u.username });
    navigate(`/admin/connections?${params.toString()}`);
  };

  const facts: Fact[] = [
    { label: "Role", value: u.role === "admin" ? "Admin" : "Listener" },
    { label: "Systems", value: systemsLabel(u, systems) },
    {
      label: "Expires",
      value: u.expiration
        ? `${u.expiration < now ? "Expired" : ""} ${formatDay(u.expiration)}`.trim()
        : "Never",
    },
    {
      label: "Connection limit",
      value: u.limit ? String(u.limit) : "Unlimited",
    },
    { label: "Devices", value: `${u.devices} signed in` },
    {
      label: "Last sign-in",
      value: u.lastSeenAt ? (
        <>
          {formatWhen(u.lastSeenAt, { hour12 })}
          {u.lastSeenIp && (
            <>
              {" from "}
              <span className="font-mono">{u.lastSeenIp}</span>
            </>
          )}
        </>
      ) : (
        "Not in the last 30 days"
      ),
    },
  ];
  if (u.passwordNeedChange === 1) {
    facts.push({ label: "Password", value: "Temporary. Must change it at next sign in." });
  }

  const ask = pending ? question(pending, u, self) : null;
  const created = `created ${formatDay(u.createdAt)}`;
  const subtitle = primary
    ? `Primary admin · ${created}`
    : `${u.role === "admin" ? "Admin" : "Listener"} · ${created}`;

  return (
    <DetailsPanel
      title={u.username}
      subtitle={subtitle}
      badges={
        <>
          {u.role === "admin" && <span className="badge admin-badge-role">admin</span>}
          <span className={`badge ${status.badge}`}>{status.label}</span>
          {u.passwordNeedChange === 1 && (
            <span className="badge badge-warning">temporary password</span>
          )}
          {self && <span className="badge badge-secondary">you</span>}
        </>
      }
      onClose={onClose}
    >
      {primary && (
        <Notice>
          The primary admin can't be disabled, deleted or demoted.
        </Notice>
      )}

      <FactList facts={facts} />

      {error && (
        <Notice tone="bad" role="alert">
          {error}
        </Notice>
      )}

      <PanelSection title={`Live now · ${live.length}`}>
        {live.length > 0 ? (
          <ul className="rounded-lg border border-admin-line bg-base-200">
            {live.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 border-b border-admin-line2 px-3 py-2.5 last:border-b-0"
              >
                <span className="badge badge-info">{KIND[c.kind]}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate" title={c.userAgent || undefined}>
                    {c.native ? "Squelch app" : "Browser"}
                    {c.self && " · this browser"}
                  </span>
                  <span className="block text-xs text-base-content-dim">
                    {c.ip && <span className="font-mono">{c.ip}</span>}
                    {c.ip && " · "}connected {formatDuration(now - c.connectedAt)}
                  </span>
                </span>
                <button type="button" className="btn btn-sm" onClick={() => openConnections("live")}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-base-content-dim">Not connected right now.</p>
        )}
        {u.devices > 0 && (
          <p className="text-sm text-base-content-dim">
            {plural(u.devices, "signed-in device")} can reconnect without a password.{" "}
            <button
              type="button"
              className="link link-hover text-secondary"
              onClick={() => openConnections("devices")}
            >
              See devices
            </button>
          </p>
        )}
      </PanelSection>

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
        <PanelSection title="Actions">
          <ActionButton
            icon={<Pencil className="h-4 w-4" />}
            label="Edit details"
            hint={
              primary
                ? "Name and system access."
                : "Role, expiry, connection limit, system access."
            }
            onClick={onEdit}
          />
          <ActionButton
            icon={<KeyRound className="h-4 w-4" />}
            label="Reset password"
            hint="Sets a temporary password you hand over."
            onClick={onResetPassword}
          />
          <label
            htmlFor={`${id}-needchange`}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-admin-line bg-base-200 px-3.5 py-2.5"
          >
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">Require password change</span>
              <span className="block text-xs text-base-content-dim">
                {u.passwordNeedChange === 1 ? "On." : "Off."} Cleared automatically
                once they set a new one.
              </span>
            </span>
            <input
              id={`${id}-needchange`}
              type="checkbox"
              role="switch"
              className="toggle shrink-0"
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
          <ActionButton
            icon={<LogOut className="h-4 w-4" />}
            label="Sign out everywhere"
            hint={
              u.devices > 0 || u.liveConnections > 0
                ? `Drops ${plural(u.liveConnections, "live connection")} and ${plural(u.devices, "device")}. They sign in again with their password.`
                : "No device is signed in right now."
            }
            disabled={u.devices === 0 && u.liveConnections === 0}
            onClick={() => setPending("signout")}
          />
          {!primary &&
            (u.disabled === 1 ? (
              <ActionButton
                icon={<UserCheck className="h-4 w-4" />}
                label="Enable account"
                hint="Lets them sign in again."
                onClick={() => setPending("enable")}
              />
            ) : (
              <ActionButton
                icon={<UserX className="h-4 w-4" />}
                label="Disable account"
                hint="Blocks sign-in and drops live connections. Reversible."
                disabled={self}
                onClick={() => setPending("disable")}
              />
            ))}
          {!primary && (
            <ActionButton
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete user"
              hint="Permanent."
              danger
              disabled={self}
              onClick={() => setPending("delete")}
            />
          )}
        </PanelSection>
      )}
    </DetailsPanel>
  );
}
