import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import UsersPanel from "./UsersPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { AdminLockoutsList, AdminSystem, AdminUser } from "@/types";

const now = Math.floor(Date.now() / 1000);

const users: AdminUser[] = [
  {
    id: 1,
    username: "admin",
    role: "admin",
    disabled: 0,
    systemsJson: null,
    expiration: null,
    limit: null,
    createdAt: now - 86_400,
    updatedAt: now,
    passwordNeedChange: 0,
    liveConnections: 1,
    devices: 2,
    lastSeenAt: now - 60,
    lastSeenIp: "203.0.113.9",
  },
  {
    id: 2,
    username: "alice",
    role: "listener",
    disabled: 0,
    systemsJson: "[10]",
    expiration: null,
    limit: 2,
    createdAt: now - 86_400,
    updatedAt: now,
    passwordNeedChange: 1,
    liveConnections: 0,
    devices: 1,
    lastSeenAt: now - 7200,
    lastSeenIp: "198.51.100.4",
  },
  {
    id: 3,
    username: "bob",
    role: "listener",
    disabled: 1,
    systemsJson: null,
    expiration: null,
    limit: null,
    createdAt: now - 86_400,
    updatedAt: now,
    passwordNeedChange: 0,
    liveConnections: 0,
    devices: 0,
    lastSeenAt: null,
    lastSeenIp: null,
  },
];

const systems: AdminSystem[] = [
  {
    id: 10,
    systemId: 1,
    label: "County PD",
    autoPopulateTalkgroups: 1,
    blacklistsJson: null,
    led: null,
    order: 0,
  },
];

type Op = (arg: unknown) => Promise<unknown>;
const createOp = vi.fn<Op>();
const updateOp = vi.fn<Op>();
const deleteOp = vi.fn<Op>();
const signOutOp = vi.fn<Op>();
const clearLockoutOp = vi.fn<Op>();
let lockouts: AdminLockoutsList;
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/app/store", () => ({
  useAppSelector: (select: (s: { auth: { username: string } }) => unknown) =>
    select({ auth: { username: "admin" } }),
}));

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useListUsersQuery: () => ({ data: users, isLoading: false }),
  useListSystemsQuery: () => ({ data: systems, isLoading: false }),
  useCreateUserMutation: () => mutation(createOp),
  useUpdateUserMutation: () => mutation(updateOp),
  useDeleteUserMutation: () => mutation(deleteOp),
  useSignOutUserMutation: () => mutation(signOutOp),
  useListLockoutsQuery: () => ({ data: lockouts, refetch: vi.fn() }),
  useClearLockoutMutation: () => mutation(clearLockoutOp),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <UsersPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function openDetails(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Details for ${name}` }));
  return within(screen.getByRole("dialog", { name }));
}

describe("UsersPanel", () => {
  beforeEach(() => {
    for (const op of [createOp, updateOp, deleteOp, signOutOp, clearLockoutOp]) {
      op.mockReset().mockResolvedValue(undefined);
    }
    lockouts = { lockouts: [] };
  });

  it("lists users with status, systems and counts", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Users" });
    const alice = within(table).getByText("alice").closest("tr")!;
    expect(within(alice).getByText("temporary password")).toBeInTheDocument();
    expect(within(alice).getByText("County PD")).toBeInTheDocument();
    expect(within(alice).getByText("2h ago")).toBeInTheDocument();
    const bob = within(table).getByText("bob").closest("tr")!;
    expect(within(bob).getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
  });

  it("filters by search and by status chip", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByRole("searchbox"), "county");
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("bob")).toBeNull();
    await user.clear(screen.getByRole("searchbox"));
    await user.click(screen.getByRole("radio", { name: /Disabled/ }));
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.queryByText("alice")).toBeNull();
  });

  it("creates a user who must pick a password at first sign-in", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = within(screen.getByRole("dialog", { name: "New user" }));
    await user.type(dialog.getByLabelText("Username"), "carol");
    await user.type(dialog.getByLabelText("Temporary password"), "welcome-123");
    await user.click(dialog.getByRole("radio", { name: "Admin" }));
    await user.click(dialog.getByRole("button", { name: "County PD" }));
    await user.click(dialog.getByRole("button", { name: "Create user" }));
    expect(createOp).toHaveBeenCalledWith({
      username: "carol",
      password: "welcome-123",
      role: "admin",
      disabled: 0,
      systemsJson: "[10]",
      expiration: null,
      limit: null,
      passwordNeedChange: 1,
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Created carol");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resets a password from the details panel, asking for a change and signing out", async () => {
    const user = userEvent.setup();
    renderPanel();
    const panel = await openDetails(user, "alice");
    expect(panel.getByText("1 signed-in device")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Reset password" }));
    const reset = within(
      screen.getByRole("dialog", { name: "Reset password for alice" }),
    );
    await user.type(reset.getByLabelText("New password"), "fresh-start-1");
    expect(reset.getByRole("switch", { name: /Require a new password/ })).toBeChecked();
    expect(reset.getByRole("switch", { name: /Sign out everywhere/ })).toBeChecked();
    await user.click(reset.getByRole("button", { name: "Set password" }));
    expect(updateOp).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        username: "alice",
        password: "fresh-start-1",
        passwordNeedChange: 1,
        signOut: true,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Password set for alice; they are signed out everywhere.",
    );
  });

  it("toggles the require-change flag in place", async () => {
    const user = userEvent.setup();
    renderPanel();
    const panel = await openDetails(user, "alice");
    const toggle = panel.getByRole("switch", { name: /Require password change/ });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(updateOp).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, passwordNeedChange: 0 }),
    );
  });

  it("asks before deleting and reports server errors in the panel", async () => {
    const user = userEvent.setup();
    deleteOp.mockRejectedValueOnce(new Error("cannot delete the primary admin account"));
    renderPanel();
    const panel = await openDetails(user, "bob");
    await user.click(panel.getByRole("button", { name: "Delete" }));
    expect(deleteOp).not.toHaveBeenCalled();
    expect(panel.getByText("Delete bob?")).toBeInTheDocument();
    await user.click(panel.getByRole("button", { name: "Delete" }));
    expect(deleteOp).toHaveBeenCalledWith(3);
    expect(await panel.findByRole("alert")).toHaveTextContent(
      "cannot delete the primary admin account",
    );
  });

  it("keeps the primary admin and yourself out of a bulk disable", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("checkbox", { name: "Select all on this page" }));
    await user.click(screen.getByRole("button", { name: "Disable" }));
    const sheet = within(screen.getByRole("dialog", { name: "3 users selected" }));
    expect(sheet.getByText(/your own account are skipped/)).toBeInTheDocument();
    await user.click(sheet.getByRole("button", { name: "Disable" }));
    expect(updateOp).toHaveBeenCalledTimes(2);
    expect(updateOp).toHaveBeenCalledWith(expect.objectContaining({ id: 2, disabled: 1 }));
    expect(updateOp).toHaveBeenCalledWith(expect.objectContaining({ id: 3, disabled: 1 }));
    expect(await screen.findByRole("status")).toHaveTextContent("Disabled 2 users.");
  });

  it("lists sign-in lockouts and clears one", async () => {
    const user = userEvent.setup();
    lockouts = {
      lockouts: [
        { ip: "203.0.113.50", failures: 3, lockedUntil: now + 500, lastFailure: now - 10 },
      ],
    };
    renderPanel();
    const card = within(screen.getByRole("region", { name: "Sign-in lockouts" }));
    expect(card.getByText("203.0.113.50")).toBeInTheDocument();
    expect(card.getByText(/locked, lifts in/)).toBeInTheDocument();
    await user.click(card.getByRole("button", { name: "Clear" }));
    expect(clearLockoutOp).toHaveBeenCalledWith("203.0.113.50");
  });
});
