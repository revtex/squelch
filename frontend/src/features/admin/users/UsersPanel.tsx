import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAppSelector } from "@/app/store";
import { selectUsername } from "@/features/auth";
import {
  DataTable,
  DetailsPanel,
  FilterChips,
  InlineConfirm,
  PageHeader,
  SearchBox,
  formatAgo,
  formatDate,
  plural,
  useCreateUserMutation,
  useDeleteUserMutation,
  useDetails,
  useOpenParam,
  useListSystemsQuery,
  useListUsersQuery,
  useSignOutUserMutation,
  useToast,
  useUpdateUserMutation,
  type Column,
} from "@/features/admin/_shell";
import type { AdminUser, CreateUserPayload, UpdateUserPayload } from "@/types";
import UserDetails, { type UserAction } from "./UserDetails";
import UserForm from "./UserForm";
import ResetPasswordForm from "./ResetPasswordForm";
import LockoutsCard from "./LockoutsCard";
import {
  matchesSearch,
  matchesStatus,
  systemsSummary,
  userStatus,
  type StatusFilter,
} from "./status";

type Panel =
  | { key: string; kind: "details"; id: number }
  | { key: string; kind: "edit"; id: number }
  | { key: string; kind: "create" }
  | { key: string; kind: "reset"; id: number }
  | { key: string; kind: "bulk"; action: BulkAction };

type BulkAction = "signout" | "disable" | "delete";

const BULK: Record<BulkAction, { title: string; text: string; button: string; danger: boolean }> = {
  signout: {
    title: "Sign out on every device?",
    text: "Each account's devices will need the password to sign in again.",
    button: "Sign out",
    danger: false,
  },
  disable: {
    title: "Disable these accounts?",
    text: "They are signed out everywhere and cannot sign in until enabled again. Nothing is deleted.",
    button: "Disable",
    danger: false,
  },
  delete: {
    title: "Delete these accounts?",
    text: "Their devices and bookmarks go with them. This cannot be undone.",
    button: "Delete",
    danger: true,
  },
};

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Everything the update op needs, from the row as it is now. */
function basePayload(u: AdminUser): UpdateUserPayload {
  return {
    username: u.username,
    role: u.role,
    disabled: u.disabled,
    systemsJson: u.systemsJson,
    expiration: u.expiration,
    limit: u.limit,
  };
}

export default function UsersPanel() {
  const { data: users, isLoading } = useListUsersQuery();
  const { data: systems } = useListSystemsQuery();
  const [createUser] = useCreateUserMutation();
  const [updateUser] = useUpdateUserMutation();
  const [deleteUser] = useDeleteUserMutation();
  const [signOutUser] = useSignOutUserMutation();
  const toast = useToast();
  const myUsername = useAppSelector(selectUsername);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const panel = useDetails<Panel>();
  const userIds = useMemo(() => users?.map((u) => u.id), [users]);
  useOpenParam(userIds, (id) => panel.open({ key: `user:${id}`, kind: "details", id }));

  const now = Date.now() / 1000;
  const all = useMemo(() => users ?? [], [users]);
  const systemList = useMemo(() => systems ?? [], [systems]);
  const rows = useMemo(
    () =>
      all.filter(
        (u) => matchesStatus(u, status, now) && matchesSearch(u, search, systemList),
      ),
    [all, status, search, systemList, now],
  );
  const counts = useMemo(() => {
    const c = { all: all.length, active: 0, disabled: 0, expired: 0, temporary: 0 };
    for (const u of all) {
      c[userStatus(u, now).id]++;
      if (u.passwordNeedChange === 1) c.temporary++;
    }
    return c;
  }, [all, now]);

  const byId = (id: number) => all.find((u) => u.id === id) ?? null;
  const isSelf = (u: AdminUser) => u.username === myUsername;

  const openDetails = (u: AdminUser, el?: HTMLElement) =>
    panel.open({ key: `user:${u.id}`, kind: "details", id: u.id }, el);

  const closeForm = () => {
    setFormError(null);
    panel.close();
  };

  const onCreate = async (payload: CreateUserPayload) => {
    setBusy(true);
    setFormError(null);
    try {
      await createUser(payload).unwrap();
      toast.success(
        payload.passwordNeedChange === 0
          ? `Created ${payload.username}.`
          : `Created ${payload.username}. They will pick a new password at first sign-in.`,
      );
      closeForm();
    } catch (e) {
      setFormError(messageOf(e, "Failed to create the user."));
    } finally {
      setBusy(false);
    }
  };

  const onUpdate = async (id: number, payload: UpdateUserPayload, done: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await updateUser({ id, ...payload }).unwrap();
      toast.success(done);
      closeForm();
    } catch (e) {
      setFormError(messageOf(e, "Failed to save."));
    } finally {
      setBusy(false);
    }
  };

  /** One action on one user; resolves to the error, or null. */
  const act = async (u: AdminUser, action: UserAction): Promise<string | null> => {
    setBusy(true);
    try {
      switch (action) {
        case "signout":
          await signOutUser(u.id).unwrap();
          toast.success(`Signed ${u.username} out on every device.`);
          break;
        case "disable":
          await updateUser({ id: u.id, ...basePayload(u), disabled: 1 }).unwrap();
          toast.success(`Disabled ${u.username}.`);
          break;
        case "enable":
          await updateUser({ id: u.id, ...basePayload(u), disabled: 0 }).unwrap();
          toast.success(`Enabled ${u.username}.`);
          break;
        case "delete":
          await deleteUser(u.id).unwrap();
          toast.success(`Deleted ${u.username}.`);
          break;
      }
      return null;
    } catch (e) {
      const text = messageOf(e, "That did not work.");
      toast.error(text);
      return text;
    } finally {
      setBusy(false);
    }
  };

  const setNeedChange = async (u: AdminUser, on: boolean): Promise<string | null> => {
    setBusy(true);
    try {
      await updateUser({
        id: u.id,
        ...basePayload(u),
        passwordNeedChange: on ? 1 : 0,
      }).unwrap();
      toast.success(
        on
          ? `${u.username} must pick a new password at next sign-in.`
          : `${u.username} keeps their current password.`,
      );
      return null;
    } catch (e) {
      const text = messageOf(e, "Failed to change the flag.");
      toast.error(text);
      return text;
    } finally {
      setBusy(false);
    }
  };

  const runBulk = async (action: BulkAction) => {
    const targets = all.filter(
      (u) =>
        selected.has(u.id) &&
        !(action !== "signout" && (u.id === 1 || isSelf(u))),
    );
    setBusy(true);
    let failed = 0;
    for (const u of targets) {
      try {
        if (action === "signout") await signOutUser(u.id).unwrap();
        else if (action === "disable")
          await updateUser({ id: u.id, ...basePayload(u), disabled: 1 }).unwrap();
        else await deleteUser(u.id).unwrap();
      } catch {
        failed++;
      }
    }
    setBusy(false);
    const done = targets.length - failed;
    const verb = action === "signout" ? "Signed out" : action === "disable" ? "Disabled" : "Deleted";
    if (failed === 0) toast.success(`${verb} ${plural(done, "user")}.`);
    else toast.error(`${verb} ${done} of ${targets.length}; ${failed} failed.`);
    setSelected(new Set());
    panel.close();
  };

  const columns: Column<AdminUser>[] = [
    {
      id: "username",
      header: "User",
      phone: "title",
      sortValue: (u) => u.username,
      cell: (u) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{u.username}</span>
          {u.role === "admin" && (
            <span className="badge badge-primary badge-xs">admin</span>
          )}
          {isSelf(u) && <span className="badge badge-ghost badge-xs">you</span>}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortValue: (u) => userStatus(u, now).label,
      cell: (u) => {
        const s = userStatus(u, now);
        return (
          <span className="flex flex-wrap gap-1">
            <span className={`badge badge-sm ${s.badge}`}>{s.label}</span>
            {u.passwordNeedChange === 1 && (
              <span className="badge badge-info badge-sm">temporary password</span>
            )}
          </span>
        );
      },
    },
    {
      id: "systems",
      header: "Systems",
      cell: (u) => (
        <span className="text-base-content/80">{systemsSummary(u, systemList)}</span>
      ),
    },
    {
      id: "live",
      header: "Live",
      align: "right",
      sortValue: (u) => u.liveConnections,
      cell: (u) => (u.liveConnections > 0 ? u.liveConnections : "—"),
    },
    {
      id: "devices",
      header: "Devices",
      align: "right",
      sortValue: (u) => u.devices,
      cell: (u) => (u.devices > 0 ? u.devices : "—"),
    },
    {
      id: "lastSeen",
      header: "Last seen",
      sortValue: (u) => u.lastSeenAt ?? 0,
      cell: (u) =>
        u.lastSeenAt ? (
          <span title={u.lastSeenIp ?? undefined}>{formatAgo(u.lastSeenAt, now)}</span>
        ) : (
          <span className="text-admin-dim2">—</span>
        ),
    },
    {
      id: "expiration",
      header: "Expires",
      phone: "hide",
      sortValue: (u) => u.expiration ?? Number.MAX_SAFE_INTEGER,
      cell: (u) =>
        u.expiration ? formatDate(u.expiration) : <span className="text-admin-dim2">Never</span>,
    },
  ];

  const p = panel.selected;
  const current = p && "id" in p ? byId(p.id) : null;
  const selectedUsers = all.filter((u) => selected.has(u.id));

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Users"
        subtitle="Who can sign in, what they can hear, and where they are signed in."
        actions={
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={(e) =>
              panel.open({ key: "create", kind: "create" }, e.currentTarget)
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add user
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox
          value={search}
          onChange={setSearch}
          label="Search by name, role or system"
          className="w-full sm:w-72"
        />
        <FilterChips
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { id: "all", label: "All", count: counts.all },
            { id: "active", label: "Active", count: counts.active },
            { id: "disabled", label: "Disabled", count: counts.disabled },
            { id: "expired", label: "Expired", count: counts.expired },
            { id: "temporary", label: "Temporary password", count: counts.temporary },
          ]}
        />
      </div>

      <DataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={isLoading}
        empty={
          all.length === 0 ? "No users yet." : "No user matches that search."
        }
        defaultSort={{ id: "username", dir: "asc" }}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          <>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => panel.open({ key: "bulk", kind: "bulk", action: "signout" })}
            >
              Sign out
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => panel.open({ key: "bulk", kind: "bulk", action: "disable" })}
            >
              Disable
            </button>
            <button
              type="button"
              className="btn btn-xs btn-error btn-outline"
              onClick={() => panel.open({ key: "bulk", kind: "bulk", action: "delete" })}
            >
              Delete
            </button>
          </>
        }
        onOpen={openDetails}
        rowLabel={(u) => u.username}
        openKey={p?.kind === "details" ? p.id : null}
      />

      <LockoutsCard />

      {p?.kind === "details" && current && (
        <UserDetails
          key={current.id}
          user={current}
          systems={systemList}
          self={isSelf(current)}
          busy={busy}
          onEdit={() => panel.replace({ key: `edit:${current.id}`, kind: "edit", id: current.id })}
          onResetPassword={() =>
            panel.replace({ key: `reset:${current.id}`, kind: "reset", id: current.id })
          }
          onNeedChange={(on) => setNeedChange(current, on)}
          onAction={(action) => act(current, action)}
          onClose={panel.close}
        />
      )}

      {p?.kind === "create" && (
        <UserForm
          user={null}
          systems={systemList}
          busy={busy}
          error={formError}
          onCreate={(payload) => void onCreate(payload)}
          onUpdate={() => {}}
          onClose={closeForm}
        />
      )}

      {p?.kind === "edit" && current && (
        <UserForm
          key={current.id}
          user={current}
          systems={systemList}
          busy={busy}
          error={formError}
          onCreate={() => {}}
          onUpdate={(id, payload) =>
            void onUpdate(id, payload, `Saved ${payload.username ?? current.username}.`)
          }
          onClose={closeForm}
        />
      )}

      {p?.kind === "reset" && current && (
        <ResetPasswordForm
          key={current.id}
          user={current}
          self={isSelf(current)}
          busy={busy}
          error={formError}
          onSubmit={(payload) =>
            void onUpdate(
              current.id,
              payload,
              payload.signOut
                ? `Password set for ${current.username}; they are signed out everywhere.`
                : `Password set for ${current.username}.`,
            )
          }
          onClose={closeForm}
        />
      )}

      {p?.kind === "bulk" && (
        <DetailsPanel
          title={`${plural(selectedUsers.length, "user")} selected`}
          subtitle={selectedUsers.map((u) => u.username).join(", ")}
          onClose={panel.close}
        >
          {p.action !== "signout" &&
            selectedUsers.some((u) => u.id === 1 || isSelf(u)) && (
              <div className="alert text-sm">
                The primary admin and your own account are skipped.
              </div>
            )}
          <InlineConfirm
            title={BULK[p.action].title}
            text={BULK[p.action].text}
            button={BULK[p.action].button}
            danger={BULK[p.action].danger}
            busy={busy}
            onCancel={panel.close}
            onConfirm={() => void runBulk(p.action)}
          />
        </DetailsPanel>
      )}
    </div>
  );
}
