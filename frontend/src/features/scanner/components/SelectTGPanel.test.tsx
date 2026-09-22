import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import SelectTGPanel from "../components/SelectTGPanel";
import { scannerSlice } from "../scannerSlice";
import { authSlice } from "@/features/auth";
import { callsSlice } from "../callsSlice";
import { api } from "@/app/api";
import type { RootState } from "@/app/store";
import type { ScannerConfig } from "@/types";
import { trMqttReducer } from "@/app/store";

const testConfig: ScannerConfig = {
  systems: [
    {
      id: 1,
      systemId: 100,
      label: "System Alpha",
      ledColor: "",
      talkgroups: [
        {
          id: 10,
          talkgroupId: 200,
          label: "TG-A1",
          name: "Alpha One",
          tag: "Law",
          group: "Police",
          ledColor: "#00ff00",
        },
        {
          id: 11,
          talkgroupId: 201,
          label: "TG-A2",
          name: "Alpha Two",
          tag: "Fire",
          group: "Fire",
          ledColor: "#ff0000",
        },
      ],
    },
    {
      id: 2,
      systemId: 101,
      label: "System Beta",
      ledColor: "",
      talkgroups: [
        {
          id: 20,
          talkgroupId: 300,
          label: "TG-B1",
          name: "Beta One",
          tag: "Law",
          group: "Police",
          ledColor: "#0000ff",
        },
        // Ungrouped/untagged: the server omits both fields, so these land in
        // the "(No Group)"/"(No Tag)" placeholder sections.
        {
          id: 21,
          talkgroupId: 301,
          label: "TG-B2",
          name: "Beta Two",
          ledColor: "",
        },
      ],
    },
  ],
  branding: "TEST",
  email: "",
  version: "1.0",
  time12hFormat: false,
  showListenersCount: false,
  keypadBeeps: "uniden",
  shareableLinks: false,
  transcriptionEnabled: false,
  liveTranscriptDisplay: false,
};

function scannerState(
  overrides: Partial<RootState["scanner"]> = {},
): RootState["scanner"] {
  return {
    isLive: false,
    isPaused: false,
    isAudioActive: false,
    backgroundAudio: false,
    streamState: "idle" as const,
    heldSystem: null,
    heldTG: null,
    avoidList: [],
    currentCall: null,
    history: [],
    listenerCount: 0,
    connectionStatus: "disconnected",
    config: testConfig,
    tgSelection: {},
    configReceived: true,
    tgSelectionReady: true,
    pendingTranscripts: {},
    ...overrides,
  };
}

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

function renderPanel(
  preloadedState?: Partial<RootState>,
  isOpen = true,
  onClose = vi.fn(),
) {
  const store = makeStore(preloadedState);
  const result = render(
    <Provider store={store}>
      <SelectTGPanel isOpen={isOpen} onClose={onClose} />
    </Provider>,
  );
  return { ...result, store, onClose };
}

function clickGroupToggle(
  label: string,
  actionLabel: "Turn all on" | "Turn all off",
) {
  const headerButton = screen.getByRole("button", {
    name: new RegExp(label, "i"),
  });
  const row = headerButton.closest("div");
  const toggleButton = row?.querySelector(
    `button[aria-label="${actionLabel}"]`,
  ) as HTMLButtonElement | null;
  expect(toggleButton).toBeTruthy();
  fireEvent.click(toggleButton!);
}

describe("SelectTGPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is not rendered when isOpen is false", () => {
    const { container } = renderPanel({ scanner: scannerState() }, false);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders header when open", () => {
    renderPanel({ scanner: scannerState() }, true);
    expect(screen.getByText("Select Talkgroups")).toBeInTheDocument();
  });

  it("clicking close button calls onClose", () => {
    const onClose = vi.fn();
    renderPanel({ scanner: scannerState() }, true, onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("group toggle turns all talkgroups in group off", () => {
    const { store } = renderPanel({ scanner: scannerState() });
    clickGroupToggle("Police", "Turn all off");
    const state = store.getState().scanner;
    expect(state.tgSelection[10]).toBe(false);
    expect(state.tgSelection[20]).toBe(false);
  });

  it("group toggle turns all talkgroups in group on", () => {
    const { store } = renderPanel({
      scanner: scannerState({ tgSelection: { 10: false, 20: false } }),
    });

    clickGroupToggle("Police", "Turn all on");
    const state = store.getState().scanner;
    expect(state.tgSelection[10]).toBe(true);
    expect(state.tgSelection[20]).toBe(true);
  });

  it("system section expands and shows talkgroup names", () => {
    renderPanel({ scanner: scannerState() });

    fireEvent.click(screen.getByRole("button", { name: /systems/i }));
    fireEvent.click(screen.getByRole("button", { name: /System Alpha/i }));

    expect(screen.getByText("TG-A1 - Alpha One")).toBeInTheDocument();
    expect(screen.getByText("TG-A2 - Alpha Two")).toBeInTheDocument();
  });

  it("clicking talkgroup checkbox toggles selection", () => {
    const { store } = renderPanel({ scanner: scannerState() });

    fireEvent.click(screen.getByRole("button", { name: /systems/i }));
    fireEvent.click(screen.getByRole("button", { name: /System Alpha/i }));

    const tgLabel = screen.getByText("TG-A1 - Alpha One").closest("label");
    expect(tgLabel).toBeTruthy();
    const checkbox = within(tgLabel!).getByRole("checkbox");
    fireEvent.click(checkbox);
    // Unkeyed means enabled, so the first click must turn it off.
    expect(store.getState().scanner.tgSelection[10]).toBe(false);
  });

  it("avoids tab lists timed avoids with the time left", () => {
    const expiresAt = Date.now() + 90_000;
    renderPanel({
      scanner: scannerState({ avoidList: [{ talkgroupId: 10, expiresAt }] }),
    });

    fireEvent.click(screen.getByRole("button", { name: /avoids/i }));
    expect(screen.getByText("TG-A1 - Alpha One")).toBeInTheDocument();
    expect(screen.getByText(/^1:(29|30)$/)).toBeInTheDocument();
  });

  it("avoids tab leaves permanent avoids out", () => {
    renderPanel({
      scanner: scannerState({ avoidList: [{ talkgroupId: 10, expiresAt: 0 }] }),
    });

    fireEvent.click(screen.getByRole("button", { name: /avoids/i }));
    expect(screen.queryByText("TG-A1 - Alpha One")).not.toBeInTheDocument();
    expect(screen.getByText(/No timed avoids/i)).toBeInTheDocument();
  });

  it("Resume clears a timed avoid", () => {
    const expiresAt = Date.now() + 90_000;
    const { store } = renderPanel({
      scanner: scannerState({ avoidList: [{ talkgroupId: 10, expiresAt }] }),
    });

    fireEvent.click(screen.getByRole("button", { name: /avoids/i }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(store.getState().scanner.avoidList).toHaveLength(0);
  });

  it("avoided talkgroup shows avoid badge", () => {
    renderPanel({
      scanner: scannerState({ avoidList: [{ talkgroupId: 10, expiresAt: 0 }] }),
    });

    fireEvent.click(screen.getByRole("button", { name: /systems/i }));
    fireEvent.click(screen.getByRole("button", { name: /System Alpha/i }));

    expect(screen.getByText("AVOID")).toBeInTheDocument();
  });

  it("(No Group) toggle turns its talkgroups off", () => {
    const { store } = renderPanel({ scanner: scannerState() });
    clickGroupToggle("\\(No Group\\)", "Turn all off");
    expect(store.getState().scanner.tgSelection[21]).toBe(false);
  });

  it("(No Tag) toggle turns its talkgroups off", () => {
    const { store } = renderPanel({ scanner: scannerState() });
    fireEvent.click(screen.getByRole("button", { name: /^tags$/i }));
    clickGroupToggle("\\(No Tag\\)", "Turn all off");
    expect(store.getState().scanner.tgSelection[21]).toBe(false);
  });

  it("section toggle only touches the talkgroups it rendered", () => {
    const { store } = renderPanel({ scanner: scannerState() });
    // The search box auto-expands matching sections in a microtask.
    act(() => {
      fireEvent.change(screen.getByPlaceholderText("Search talkgroups..."), {
        target: { value: "Beta One" },
      });
    });
    clickGroupToggle("Police", "Turn all off");
    const state = store.getState().scanner;
    expect(state.tgSelection[20]).toBe(false);
    // TG 10 is in the Police group but was filtered out of the section.
    expect(state.tgSelection[10]).toBeUndefined();
  });

  it("global toggle asks before re-enabling everything", () => {
    const { store } = renderPanel({
      scanner: scannerState({ tgSelection: { 10: false, 11: false } }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    const allRow = screen.getByText("All Talkgroups").closest("div");
    const globalToggle = allRow?.querySelector(
      'button[aria-label="Turn all on"]',
    ) as HTMLButtonElement | null;
    expect(globalToggle).toBeTruthy();
    fireEvent.click(globalToggle!);

    expect(confirmSpy).toHaveBeenCalled();
    expect(store.getState().scanner.tgSelection[10]).toBe(false);

    confirmSpy.mockReturnValue(true);
    fireEvent.click(globalToggle!);
    expect(store.getState().scanner.tgSelection[10]).toBe(true);
    confirmSpy.mockRestore();
  });

  it("global toggle sets all talkgroups off", () => {
    const { store } = renderPanel({ scanner: scannerState() });

    const allRow = screen.getByText("All Talkgroups").closest("div");
    const globalToggle = allRow?.querySelector(
      'button[aria-label="Turn all off"]',
    ) as HTMLButtonElement | null;
    expect(globalToggle).toBeTruthy();
    fireEvent.click(globalToggle!);

    const state = store.getState().scanner;
    expect(state.tgSelection[10]).toBe(false);
    expect(state.tgSelection[11]).toBe(false);
    expect(state.tgSelection[20]).toBe(false);
    expect(state.tgSelection[21]).toBe(false);
  });
});
