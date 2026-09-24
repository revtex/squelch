import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConnectionsPanel from "./ConnectionsPanel";
import type {
  AdminConnection,
  AdminConnectionHistoryPage,
  AdminIPBlocksList,
  AdminSession,
  ConnectionHistoryFilter,
  CreateIPBlockResult,
  GeoIPInfo,
} from "@/types";
import { formatDuration } from "./format";

const now = Math.floor(Date.now() / 1000);

const connections: AdminConnection[] = [
  {
    id: "c1",
    kind: "listener",
    userId: 2,
    username: "alice",
    role: "listener",
    familyId: "fam-a",
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    native: false,
    protocol: "v1",
    connectedAt: now - 125,
    self: false,
    trusted: false,
    country: "DE",
    local: false,
  },
  {
    id: "c2",
    kind: "stream",
    userId: null,
    username: "",
    role: "",
    familyId: null,
    ip: "198.51.100.4",
    userAgent: "",
    native: false,
    protocol: "",
    connectedAt: now - 30,
    self: false,
    trusted: true,
    country: null,
    local: true,
  },
];

const sessions: AdminSession[] = [
  {
    familyId: "fam-a",
    userId: 2,
    username: "alice",
    role: "listener",
    ip: "203.0.113.9",
    userAgent: "okhttp/4.12",
    native: true,
    signedInAt: now - 86_400,
    lastUsedAt: now - 60,
    expiresAt: now + 86_400,
    liveConnections: 1,
    current: false,
    trusted: false,
    country: "DE",
    local: false,
  },
];

let historyPage: AdminConnectionHistoryPage;
let geoip: GeoIPInfo;
const historyCalls: ConnectionHistoryFilter[] = [];

type Op = (arg: unknown) => Promise<void>;
const disconnectOp = vi.fn<Op>();
const revokeOp = vi.fn<Op>();
const signOutOp = vi.fn<Op>();
const deleteBlockOp = vi.fn<Op>();
const createBlockOp = vi.fn<(arg: unknown) => Promise<CreateIPBlockResult>>();
let blocksList: AdminIPBlocksList;
// Called lazily from the mocked hooks: vi.mock is hoisted above these.
const mutation = (fn: Op) => [
  (arg: unknown) => ({ unwrap: () => fn(arg) }),
  { isLoading: false, isError: false },
];

vi.mock("@/app/store", () => ({
  useAppSelector: (select: (s: { auth: { username: string } }) => unknown) =>
    select({ auth: { username: "root" } }),
}));

vi.mock("@/features/admin/_shell", () => ({
  useListConnectionsQuery: () => ({
    data: { connections, geoip },
    isLoading: false,
    isError: false,
  }),
  useListSessionsQuery: () => ({
    data: { sessions, geoip },
    isLoading: false,
    isError: false,
  }),
  useDisconnectConnectionMutation: () => mutation(disconnectOp),
  useRevokeSessionMutation: () => mutation(revokeOp),
  useSignOutUserMutation: () => mutation(signOutOp),
  useDeleteIPBlockMutation: () => mutation(deleteBlockOp),
  useCreateIPBlockMutation: () => [
    (arg: unknown) => ({ unwrap: () => createBlockOp(arg) }),
    { isLoading: false, isError: false },
  ],
  useListIPBlocksQuery: () => ({
    data: blocksList,
    isLoading: false,
    isError: false,
  }),
  useConnectionHistoryQuery: (filter: ConnectionHistoryFilter) => {
    historyCalls.push(filter);
    return {
      data: historyPage,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));

beforeEach(() => {
  historyCalls.length = 0;
  geoip = {
    enabled: true,
    credit: { text: "IP Geolocation by DB-IP", url: "https://db-ip.com" },
  };
  disconnectOp.mockReset().mockResolvedValue(undefined);
  revokeOp.mockReset().mockResolvedValue(undefined);
  signOutOp.mockReset().mockResolvedValue(undefined);
  deleteBlockOp.mockReset().mockResolvedValue(undefined);
  createBlockOp.mockReset();
  blocksList = {
    enabled: true,
    blocks: [
      {
        id: 7,
        cidr: "203.0.113.0/24",
        reason: "scraping",
        createdBy: "root",
        createdAt: now - 600,
        expiresAt: null,
      },
    ],
    trusted: ["127.0.0.0/8", "::1/128", "198.51.100.7/32"],
    yourAddress: "192.0.2.10",
  };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  historyPage = {
    items: [
      {
        id: 1,
        kind: "admin",
        userId: 1,
        username: "root",
        ip: "192.0.2.10",
        userAgent: null,
        native: false,
        familyId: null,
        connectedAt: now - 3600,
        disconnectedAt: now - 3000,
        disconnectReason: "signout",
        trusted: false,
        country: "GB",
        local: false,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 100,
    retentionDays: 30,
    geoip,
  };
});

/** Opens a row's action menu and returns queries scoped to it. */
async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  const trigger = screen.getByRole("button", { name });
  await user.click(trigger);
  const menu = trigger.closest(".dropdown");
  if (!(menu instanceof HTMLElement)) throw new Error(`no menu for ${name}`);
  return within(menu);
}

describe("ConnectionsPanel", () => {
  it("lists live connections with domain labels and anonymous listeners", () => {
    render(<ConnectionsPanel />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("alice")).toBeInTheDocument();
    expect(within(table).getByText("LIVE")).toBeInTheDocument();
    expect(within(table).getByText("BKGND")).toBeInTheDocument();
    expect(within(table).getByText("Anonymous")).toBeInTheDocument();
    expect(within(table).getByText(formatDuration(125))).toBeInTheDocument();
  });

  it("filters live connections by user or address", async () => {
    render(<ConnectionsPanel />);
    await userEvent.type(
      screen.getByRole("searchbox", {
        name: "Filter by user, address or country",
      }),
      "198.51",
    );
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(screen.getByText("198.51.100.4")).toBeInTheDocument();
  });

  it("shows signed-in devices with the app and online state", async () => {
    render(<ConnectionsPanel />);
    await userEvent.click(
      screen.getByRole("tab", { name: "Signed-in devices" }),
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Squelch app")).toBeInTheDocument();
    expect(within(table).getByText("Online")).toBeInTheDocument();
  });

  it("jumps from an address to its history", async () => {
    render(<ConnectionsPanel />);
    await userEvent.click(screen.getByRole("button", { name: "203.0.113.9" }));

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(historyCalls[historyCalls.length - 1]?.ip).toBe("203.0.113.9");
    expect(screen.getByText("Address 203.0.113.9")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(historyCalls[historyCalls.length - 1]?.ip).toBeUndefined();
  });

  it("says so when history is turned off", async () => {
    historyPage = { ...historyPage, items: [], total: 0, retentionDays: 0 };
    render(<ConnectionsPanel />);
    await userEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(
      screen.getByText(/Connection history is turned off/),
    ).toBeInTheDocument();
  });

  it("disconnects the chosen connection after confirming", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const menu = await openMenu(user, "Actions for alice (LIVE)");
    await user.click(menu.getByRole("button", { name: "Disconnect" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(disconnectOp).toHaveBeenCalledWith("c1");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Disconnected alice.",
    );
  });

  it("does nothing when the confirmation is cancelled", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const menu = await openMenu(user, "Actions for alice (LIVE)");
    await user.click(menu.getByRole("button", { name: "Sign out everywhere" }));
    expect(signOutOp).not.toHaveBeenCalled();
  });

  it("offers no sign-out for an anonymous listener", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const menu = await openMenu(user, "Actions for anonymous (BKGND)");
    expect(
      menu.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
    expect(menu.queryByRole("button", { name: "Sign out device" })).toBeNull();
    expect(
      menu.queryByRole("button", { name: "Sign out everywhere" }),
    ).toBeNull();
  });

  it("signs a device out from the devices tab and shows server errors", async () => {
    revokeOp.mockRejectedValueOnce(
      new Error("that device is already signed out"),
    );
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: "Signed-in devices" }));
    const menu = await openMenu(user, "Actions for alice's device");
    await user.click(menu.getByRole("button", { name: "Sign out device" }));
    expect(revokeOp).toHaveBeenCalledWith("fam-a");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "that device is already signed out",
    );
  });

  it("signs an account out everywhere from history", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: "History" }));
    const menu = await openMenu(user, "Actions for root at 192.0.2.10");
    await user.click(menu.getByRole("button", { name: "Sign out everywhere" }));
    expect(window.confirm).toHaveBeenCalledWith(
      "Sign yourself out on every device, including this one?",
    );
    expect(signOutOp).toHaveBeenCalledWith(1);
  });

  it("blocks an address from a live row", async () => {
    createBlockOp.mockResolvedValue({
      ok: true,
      id: 9,
      cidr: "203.0.113.9/32",
      closed: 1,
    });
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const menu = await openMenu(user, "Actions for alice (LIVE)");
    await user.click(menu.getByRole("button", { name: "Block address" }));
    const dialog = screen.getByRole("dialog", { name: "Block an address" });
    expect(within(dialog).getByLabelText("Address or range")).toHaveValue(
      "203.0.113.9",
    );
    await user.type(within(dialog).getByLabelText("Reason (optional)"), "spam");
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    const arg = createBlockOp.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.address).toBe("203.0.113.9");
    expect(arg.reason).toBe("spam");
    expect(typeof arg.expiresAt).toBe("number");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Blocked 203.0.113.9/32. 1 connection was dropped.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks before blocking a range that holds your own address", async () => {
    createBlockOp
      .mockResolvedValueOnce({
        needsConfirm: true,
        cidr: "192.0.2.0/24",
        message: "192.0.2.0/24 includes your own address, 192.0.2.10.",
      })
      .mockResolvedValueOnce({
        ok: true,
        id: 3,
        cidr: "192.0.2.0/24",
        closed: 0,
      });
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: "Blocked addresses" }));
    await user.click(screen.getByRole("button", { name: "Block an address" }));
    const dialog = screen.getByRole("dialog", { name: "Block an address" });
    await user.type(
      within(dialog).getByLabelText("Address or range"),
      "192.0.2.0/24",
    );
    await user.selectOptions(within(dialog).getByLabelText("For"), "never");
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("includes your own address"),
    );
    expect(createBlockOp).toHaveBeenCalledTimes(2);
    const forced = createBlockOp.mock.calls[1][0] as Record<string, unknown>;
    expect(forced.force).toBe(true);
    expect(forced.expiresAt).toBeUndefined();
  });

  it("shows why a block was refused, in the dialog", async () => {
    createBlockOp.mockRejectedValue(
      new Error("10.0.0.0/8 is too wide; the widest block allowed is /16."),
    );
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: "Blocked addresses" }));
    await user.click(screen.getByRole("button", { name: "Block an address" }));
    const dialog = screen.getByRole("dialog", { name: "Block an address" });
    await user.type(
      within(dialog).getByLabelText("Address or range"),
      "10.0.0.0/8",
    );
    await user.click(within(dialog).getByRole("button", { name: "Block" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "too wide",
    );
  });

  it("offers no block on a trusted address and marks it", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    const menu = await openMenu(user, "Actions for anonymous (BKGND)");
    expect(menu.queryByRole("button", { name: "Block address" })).toBeNull();
    expect(
      within(screen.getByRole("table")).getByText("trusted"),
    ).toBeInTheDocument();
  });

  it("lists blocks and the never-blocked addresses, and removes a block", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: "Blocked addresses" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("203.0.113.0/24")).toBeInTheDocument();
    expect(within(table).getByText("scraping")).toBeInTheDocument();
    const never = screen.getByRole("region", { name: "Never blocked" });
    expect(within(never).getByText("198.51.100.7/32")).toBeInTheDocument();
    expect(screen.getByText("192.0.2.10")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Remove the block on 203.0.113.0/24",
      }),
    );
    expect(deleteBlockOp).toHaveBeenCalledWith(7);
  });

  it("shows countries and the database's credit when lookup is on", () => {
    render(<ConnectionsPanel />);
    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Country" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("Germany")).toBeInTheDocument();
    expect(within(table).getByText("Local network")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "IP Geolocation by DB-IP" }),
    ).toHaveAttribute("href", "https://db-ip.com");
  });

  it.each([
    ["Live", "Germany"],
    ["Signed-in devices", "Germany"],
    ["History", "United Kingdom"],
  ])("puts the country under its own header on %s", async (tab, country) => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.click(screen.getByRole("tab", { name: tab }));
    const table = screen.getByRole("table");
    const column = within(table)
      .getAllByRole("columnheader")
      .findIndex((th) => th.textContent === "Country");
    const cell = within(table).getByText(country).closest("td");
    expect(cell).not.toBeNull();
    expect(
      Array.from(cell?.parentElement?.children ?? []).indexOf(cell as Element),
    ).toBe(column);
  });

  it("hides the country column without a database", () => {
    geoip = { enabled: false, credit: null };
    render(<ConnectionsPanel />);
    expect(
      within(screen.getByRole("table")).queryByRole("columnheader", {
        name: "Country",
      }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /DB-IP/ })).toBeNull();
  });

  it("filters live connections by country name", async () => {
    const user = userEvent.setup();
    render(<ConnectionsPanel />);
    await user.type(
      screen.getByRole("searchbox", {
        name: "Filter by user, address or country",
      }),
      "germ",
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("alice")).toBeInTheDocument();
    expect(within(table).queryByText("Anonymous")).toBeNull();
  });
});
