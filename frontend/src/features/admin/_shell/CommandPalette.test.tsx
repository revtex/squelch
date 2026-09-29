import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { NavigationGuardProvider } from "./useNavigationGuard";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));

vi.mock("./useAdminWsOps", () => ({
  useListUsersQuery: () => ({ data: [{ id: 7, username: "dispatch-a" }] }),
  useListSystemsQuery: () => ({ data: [{ id: 3, label: "Lake County" }] }),
  useListTalkgroupsQuery: () => ({
    data: [{ id: 41, systemId: 3, talkgroupId: 101, label: "LC FD Disp", name: "Fire Dispatch" }],
  }),
  useListApiKeysQuery: () => ({ data: [{ id: 5, ident: "TR-Lake-South" }] }),
  useListDirMonitorsQuery: () => ({ data: [{ id: 9, directory: "/srv/dispatch" }] }),
  useListDownstreamsQuery: () => ({ data: [{ id: 2, label: "Cleveland relay", url: "https://x.test" }] }),
}));

function renderPalette(onClose = vi.fn()) {
  render(
    <MemoryRouter>
      <NavigationGuardProvider>
        <CommandPalette
          onClose={onClose}
          settings={[{ label: "Dispatch sound", section: "Scanner" }]}
        />
      </NavigationGuardProvider>
    </MemoryRouter>,
  );
  return onClose;
}

describe("CommandPalette", () => {
  beforeEach(() => navigate.mockReset());

  it("lists only pages until two letters are typed", async () => {
    const user = userEvent.setup();
    renderPalette();
    expect(screen.getByRole("option", { name: /^Users/ })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "d");
    expect(screen.queryByRole("option", { name: /dispatch-a/ })).toBeNull();
  });

  it("finds users, talkgroups, monitors and settings, each with its kind", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "disp");
    expect(screen.getByRole("option", { name: /dispatch-a.*User/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /LC FD Disp.*Talkgroup/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /\/srv\/dispatch.*Monitor/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Dispatch sound.*Setting/ })).toBeInTheDocument();
  });

  it("opens the chosen item's details through its page link", async () => {
    const user = userEvent.setup();
    const onClose = renderPalette();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "LC FD");
    await user.click(screen.getByRole("option", { name: /LC FD Disp/ }).querySelector("button")!);
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/admin/systems?system=3&open=41");
  });

  it("links a setting to the settings page filtered to it", async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.type(screen.getByRole("combobox", { name: "Search" }), "sound");
    await user.keyboard("{Enter}");
    expect(navigate).toHaveBeenCalledWith("/admin/settings?q=Dispatch%20sound");
  });
});
