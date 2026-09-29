import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { LEDPanel } from "../components/LEDPanel";
import { scannerSlice } from "../scannerSlice";
import { authSlice } from "@/features/auth";
import { callsSlice } from "../callsSlice";
import { api } from "@/app/api";
import type { RootState } from "@/app/store";
import type { ScannerConfig } from "@/types";
import type { Call } from "../types";
import { trMqttReducer } from "@/app/store";

// Mock useTheme since it reads localStorage / sets DOM attributes
const mockSetTheme = vi.fn();

vi.mock("@/shared/hooks/useTheme", () => ({
  THEMES: [
    { id: "squelch-midnight", label: "Midnight", summary: "Blue-black" },
    { id: "squelch-classic", label: "Squelch classic", summary: "Pale LCD" },
  ],
  useTheme: () => ({
    theme: "squelch-midnight",
    label: "Midnight",
    setTheme: mockSetTheme,
    themes: [
      { id: "squelch-midnight", label: "Midnight", summary: "Blue-black" },
      { id: "squelch-classic", label: "Squelch classic", summary: "Pale LCD" },
    ],
  }),
}));

function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: {
      scanner: scannerSlice.reducer,
      trMqtt: trMqttReducer,
      auth: authSlice.reducer,
      calls: callsSlice.reducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
    preloadedState: preloadedState as RootState,
  });
}

function renderLED(preloadedState?: Partial<RootState>) {
  const store = makeStore(preloadedState);
  return {
    ...render(
      <MemoryRouter>
        <Provider store={store}>
          <LEDPanel />
        </Provider>
      </MemoryRouter>,
    ),
    store,
  };
}

function makeCall(overrides: Partial<Call> = {}): Call {
  return {
    id: 1,
    audioName: "test.wav",
    audioType: "audio/wav",
    dateTime: Date.now(),
    systemId: 100,
    system: 1,
    talkgroupId: 200,
    talkgroup: 2,
    ...overrides,
  };
}

describe("LEDPanel", () => {
  beforeEach(() => {
    mockSetTheme.mockClear();
  });

  it('renders default branding text "SQUELCH"', () => {
    renderLED();
    expect(screen.getByText("SQUELCH")).toBeInTheDocument();
  });

  it("renders custom branding from config", () => {
    const config: ScannerConfig = {
      systems: [],
      branding: "MY SCANNER",
      email: "",
      version: "1.0",
      time12hFormat: false,
      showListenersCount: false,
      keypadBeeps: "uniden",
      shareableLinks: false,
      transcriptionEnabled: false,
      liveTranscriptDisplay: false,
    };
    renderLED({
      scanner: {
        isLive: true,
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
        config,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    expect(screen.getByText("MY SCANNER")).toBeInTheDocument();
  });

  it('falls back to "SQUELCH" when branding is blank', () => {
    const config: ScannerConfig = {
      systems: [],
      branding: "   ",
      email: "",
      version: "1.0",
      time12hFormat: false,
      showListenersCount: false,
      keypadBeeps: "uniden",
      shareableLinks: false,
      transcriptionEnabled: false,
      liveTranscriptDisplay: false,
    };
    renderLED({
      scanner: {
        isLive: true,
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
        config,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    expect(screen.getByText("SQUELCH")).toBeInTheDocument();
  });

  it("names the current theme in the menu", () => {
    renderLED();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const item = screen.getByRole("button", { name: /theme/i });
    expect(item).toHaveTextContent("Midnight");
  });

  it("sets the theme picked in the theme picker", () => {
    renderLED();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    fireEvent.click(screen.getByRole("radio", { name: /squelch classic/i }));
    expect(mockSetTheme).toHaveBeenCalledWith("squelch-classic");
  });

  it("offers bookmarks in the menu only when the page provides them", () => {
    const onToggleBookmarks = vi.fn();
    const { unmount } = renderLED();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.queryByRole("button", { name: "Bookmarks" }),
    ).not.toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter>
        <Provider store={makeStore()}>
          <LEDPanel onToggleBookmarks={onToggleBookmarks} />
        </Provider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    expect(onToggleBookmarks).toHaveBeenCalledOnce();
  });

  it("shows the live colour, dimmed, when live and idle", () => {
    renderLED({
      scanner: {
        isLive: true,
        isPaused: false,
        isAudioActive: false,
        backgroundAudio: false,
        streamState: "idle" as const,
        heldSystem: null,
        heldTG: null,
        avoidList: [],
        currentCall: makeCall(),
        history: [],
        listenerCount: 0,
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = screen.getByTestId("led");
    expect(led).toBeTruthy();
    expect(led.dataset.state).toBe("idle");
    expect(led.getAttribute("style")).toContain("var(--led-live)");
  });

  it("shows the paused colour when paused", () => {
    renderLED({
      scanner: {
        isLive: true,
        isPaused: true,
        isAudioActive: false,
        backgroundAudio: false,
        streamState: "idle" as const,
        heldSystem: null,
        heldTG: null,
        avoidList: [],
        currentCall: null,
        history: [],
        listenerCount: 0,
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = screen.getByTestId("led");
    expect(led).toBeTruthy();
    expect(led.dataset.state).toBe("paused");
    expect(led.getAttribute("style")).toContain("var(--led-paused)");
  });

  it("shows blink animation when paused", () => {
    renderLED({
      scanner: {
        isLive: true,
        isPaused: true,
        isAudioActive: false,
        backgroundAudio: false,
        streamState: "idle" as const,
        heldSystem: null,
        heldTG: null,
        avoidList: [],
        currentCall: null,
        history: [],
        listenerCount: 0,
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = document.querySelector(".animate-pulse") as HTMLElement;
    expect(led).toBeTruthy();
  });

  it("does not blink when not paused", () => {
    renderLED({
      scanner: {
        isLive: true,
        isPaused: false,
        isAudioActive: false,
        backgroundAudio: false,
        streamState: "idle" as const,
        heldSystem: null,
        heldTG: null,
        avoidList: [],
        currentCall: makeCall(),
        history: [],
        listenerCount: 0,
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = document.querySelector(".animate-pulse");
    expect(led).toBeNull();
  });

  it("uses talkgroupLedColor from current call when available", () => {
    renderLED({
      scanner: {
        isLive: true,
        isPaused: false,
        isAudioActive: true,
        backgroundAudio: false,
        streamState: "idle" as const,
        heldSystem: null,
        heldTG: null,
        avoidList: [],
        currentCall: makeCall({ talkgroupLedColor: "#ff00ff" }),
        history: [],
        listenerCount: 0,
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = screen.getByTestId("led");
    expect(led).toBeTruthy();
    expect(led.style.backgroundColor).toBe("rgb(255, 0, 255)"); // #ff00ff
  });

  it("offers keypad beeps in the menu, showing what is set", () => {
    renderLED();
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const item = screen.getByRole("button", { name: /Keypad beeps/ });
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    // The choice is this browser's, so the list is here rather than in
    // the admin panel.
    expect(screen.getByRole("radio", { name: "Off" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Uniden" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Whistler" })).toBeInTheDocument();
  });

  it("shows the off colour when not live", () => {
    renderLED({
      scanner: {
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
        connectionStatus: "connected",
        config: null,
        tgSelection: {},
        configReceived: true,
        tgSelectionReady: true,
        pendingTranscripts: {},
      },
    });
    const led = screen.getByTestId("led");
    expect(led).toBeTruthy();
    expect(led.dataset.state).toBe("off");
    expect(led.getAttribute("style")).toContain("var(--led-off)");
  });
});
