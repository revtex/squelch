import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import Admin from "./Admin";
import { scannerSlice } from "@/features/scanner";
import { authSlice } from "@/features/auth";
import { callsSlice } from "@/features/scanner";
import { api } from "@/app/api";
import type { RootState } from "@/app/store";
import { trMqttReducer } from "@/app/store";

// --- Mocks ---

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="navigate" data-to={to} />
    ),
  };
});


// --- Helpers ---

function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: {
      scanner: scannerSlice.reducer,
      trMqtt: trMqttReducer,
      auth: authSlice.reducer,
      calls: callsSlice.reducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (gDM) => gDM().concat(api.middleware),
    preloadedState: preloadedState as RootState,
  });
}

function renderAdmin(preloadedState?: Partial<RootState>, url = "/admin/users") {
  const store = makeStore(preloadedState);
  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[url]}>
          <Admin />
        </MemoryRouter>
      </Provider>,
    ),
  };
}

// --- Tests ---

describe("Admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when no token", () => {
    renderAdmin();
    const navs = screen.getAllByTestId("navigate");
    const loginNav = navs.find((el) => el.getAttribute("data-to") === "/login");
    expect(loginNav).toBeDefined();
  });

  it("shows access denied when role is listener", () => {
    renderAdmin({
      auth: {
        token: "test-token",
        role: "listener",
        username: "user",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("renders sidebar nav items when authenticated", () => {
    renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);

    const expectedLabels = [
      "Overview",
      "Users",
      "Connections",
      "Systems & talkgroups",
      "Groups & tags",
      "API keys",
      "Folder monitors",
      "Forwarding",
      "Settings",
      "Logs & audit",
      "Trunk Recorder",
      "Backup & import",
    ];

    for (const label of expectedLabels) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("opens the command palette with Ctrl+K and jumps to a section", async () => {
    const user = userEvent.setup();
    renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);

    await user.keyboard("{Control>}k{/Control}");
    const box = screen.getByRole("combobox", { name: "Search" });
    expect(box).toHaveFocus();
    await user.type(box, "audit");
    expect(screen.getByRole("option", { name: /^Logs & audit/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Enter}");
    expect(mockNavigate).toHaveBeenCalledWith("/admin/logs");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lists every section in the More sheet on a phone", async () => {
    const user = userEvent.setup();
    renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);

    await user.click(screen.getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "All sections" });
    expect(within(sheet).getByRole("link", { name: "Forwarding" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("link", { name: "Forwarding" }));
    expect(mockNavigate).toHaveBeenCalledWith("/admin/forwarding");
    expect(screen.queryByRole("dialog", { name: "All sections" })).toBeNull();
  });

  it("opens every section from the top bar's menu button and searches from its field", async () => {
    const user = userEvent.setup();
    renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const sheet = screen.getByRole("dialog", { name: "All sections" });
    expect(within(sheet).getByRole("link", { name: "Backup & import" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "All sections" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Search users, talkgroups, settings/ }));
    expect(screen.getByRole("combobox", { name: "Search" })).toHaveFocus();
  });

  it("sends an unknown admin address to Overview by its full path", () => {
    renderAdmin(
      {
        auth: {
          token: "test-token",
          role: "admin",
          username: "admin",
          passwordNeedChange: false,
          setupStatus: null,
        },
      } as Partial<RootState>,
      "/admin/groups-tags",
    );
    const targets = screen.getAllByTestId("navigate").map((el) => el.getAttribute("data-to"));
    expect(targets).toContain("/admin/overview");
  });

  it("shows the socket state in the top bar", () => {
    renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);
    expect(screen.getByRole("status")).toHaveTextContent(/Reconnecting|Offline|Live/);
  });

  it("sign out button clears credentials", async () => {
    // Suppress RTK Query unhandled-error log (Node's Request can't resolve relative URLs in jsdom)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { store } = renderAdmin({
      auth: {
        token: "test-token",
        role: "admin",
        username: "admin",
        passwordNeedChange: false,
        setupStatus: null,
      },
    } as Partial<RootState>);

    // Multiple sign out buttons may exist (mobile + desktop sidebars)
    const signOutButtons = screen.getAllByText("Sign out");
    fireEvent.click(signOutButtons[0]);

    await waitFor(() => {
      expect(store.getState().auth.token).toBeNull();
    });
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });

    spy.mockRestore();
  });
});
