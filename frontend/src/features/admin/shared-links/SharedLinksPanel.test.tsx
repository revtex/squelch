import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import SharedLinksPanel from "./SharedLinksPanel";
import { ToastProvider } from "@/features/admin/_shell";
import type { SharedLinkAdmin } from "@/types";

const now = Math.floor(Date.now() / 1000);

const links: SharedLinkAdmin[] = [
  {
    id: 1,
    callId: 100,
    userId: 7,
    token: "tok-active",
    createdAt: now - 3600,
    sharedBy: "alice",
    dateTime: now - 7200,
    duration: 65,
    systemLabel: "County PD",
    talkgroupLabel: "PD Disp",
    talkgroupName: "Police Dispatch",
    expiresAt: now + 86_400,
    effectiveExpiresAt: now + 86_400,
    expired: false,
    opens: 3,
    lastOpenedAt: now - 60,
  },
  {
    id: 2,
    callId: 101,
    userId: 7,
    token: "tok-old",
    createdAt: now - 10 * 86_400,
    sharedBy: "bob",
    dateTime: now - 11 * 86_400,
    duration: 12,
    systemLabel: "Fire",
    talkgroupLabel: "FD Tac 1",
    talkgroupName: "",
    expiresAt: null,
    effectiveExpiresAt: now - 3 * 86_400,
    expired: true,
    opens: 0,
    lastOpenedAt: null,
  },
];

type Op = (arg: unknown) => Promise<unknown>;
const deleteOp = vi.fn<Op>();
const restoreOp = vi.fn<Op>();
const revokeExpiredOp = vi.fn<Op>();
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/features/admin/_shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/admin/_shell")>()),
  useGetSharedLinksQuery: () => ({ data: links, isLoading: false, isError: false }),
  useDeleteSharedLinkMutation: () => mutation(deleteOp),
  useRestoreSharedLinkMutation: () => mutation(restoreOp),
  useRevokeExpiredSharedLinksMutation: () => mutation(revokeExpiredOp),
}));

function renderPanel() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SharedLinksPanel />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SharedLinksPanel", () => {
  beforeEach(() => {
    deleteOp.mockReset().mockResolvedValue({ deleted: true });
    restoreOp.mockReset().mockResolvedValue({ restored: true });
    revokeExpiredOp.mockReset().mockResolvedValue({ revoked: 1 });
  });

  it("lists links with who shared them, opens and expiry", () => {
    renderPanel();
    const table = screen.getByRole("table", { name: "Shared links" });
    const active = within(table).getByText("PD Disp").closest("tr")!;
    expect(within(active).getByText("by alice")).toBeInTheDocument();
    expect(within(active).getByText("3")).toBeInTheDocument();
    expect(within(active).getByText(/in 1d|in 23h/)).toBeInTheDocument();
    const old = within(table).getByText("FD Tac 1").closest("tr")!;
    expect(within(old).getByText("expired")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke 1 expired link" })).toBeInTheDocument();
  });

  it("filters to expired links and searches by user", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("radio", { name: /Expired/ }));
    expect(screen.queryByText("PD Disp")).toBeNull();
    expect(screen.getByText("FD Tac 1")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /All/ }));
    await user.type(screen.getByRole("searchbox"), "alice");
    expect(screen.getByText("PD Disp")).toBeInTheDocument();
    expect(screen.queryByText("FD Tac 1")).toBeNull();
  });

  it("copies the public link from the details panel", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for PD Disp" }));
    const details = within(screen.getByRole("dialog", { name: "PD Disp" }));
    expect(details.getByText("3 times, last 1m ago")).toBeInTheDocument();
    await user.click(details.getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/call/tok-active`);
    expect(details.getByRole("link", { name: /Open shared page/ })).toHaveAttribute(
      "href",
      "/call/tok-active",
    );
  });

  it("revokes with confirmation and offers an undo that restores the same token", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Details for PD Disp" }));
    const details = within(screen.getByRole("dialog", { name: "PD Disp" }));
    await user.click(details.getByRole("button", { name: "Revoke" }));
    expect(deleteOp).not.toHaveBeenCalled();
    await user.click(details.getByRole("button", { name: "Revoke" }));
    expect(deleteOp).toHaveBeenCalledWith(1);
    const toast = await screen.findByRole("status");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(restoreOp).toHaveBeenCalledWith({
      callId: 100,
      userId: 7,
      token: "tok-active",
      createdAt: links[0].createdAt,
      expiresAt: links[0].expiresAt,
    });
  });

  it("revokes every expired link from the header button", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "Revoke 1 expired link" }));
    const sheet = within(screen.getByRole("dialog", { name: "Revoke expired links" }));
    await user.click(sheet.getByRole("button", { name: "Revoke expired" }));
    expect(revokeExpiredOp).toHaveBeenCalled();
    expect(await screen.findByRole("status")).toHaveTextContent("Revoked 1 expired link.");
  });

  it("revokes the selected links in bulk and shows a server error", async () => {
    const user = userEvent.setup();
    deleteOp.mockRejectedValue(new Error("shared link not found; it may already be revoked"));
    renderPanel();
    await user.click(screen.getByRole("checkbox", { name: "Select FD Tac 1" }));
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    const sheet = within(screen.getByRole("dialog", { name: "1 link selected" }));
    await user.click(sheet.getByRole("button", { name: "Revoke" }));
    expect(deleteOp).toHaveBeenCalledWith(2);
    expect(await sheet.findByRole("alert")).toHaveTextContent("already be revoked");
  });
});
