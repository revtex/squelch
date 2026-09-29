import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import type { ReactNode } from "react";
import { authSlice, setCredentials } from "@/features/auth";
import { api } from "@/app/api";
import { trMqttReducer } from "@/app/store";
import { scannerSlice } from "../scannerSlice";
import { callsSlice } from "../callsSlice";
import { useKeypadBeeps } from "./useKeypadBeeps";

const mockSave = vi.fn();
let accountPrefs: { keypadBeeps?: string } | undefined;

vi.mock("@/features/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/features/auth")>("@/features/auth");
  return {
    ...actual,
    useGetPreferencesQuery: () => ({ data: accountPrefs }),
    useUpdatePreferencesMutation: () => [mockSave, { isLoading: false }],
  };
});

const KEY = "squelch-keypad-beeps";

function wrapper(signedIn: boolean) {
  const store = configureStore({
    reducer: {
      scanner: scannerSlice.reducer,
      trMqtt: trMqttReducer,
      auth: authSlice.reducer,
      calls: callsSlice.reducer,
      [api.reducerPath]: api.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(api.middleware),
  });
  if (signedIn) {
    store.dispatch(
      setCredentials({
        token: "t",
        username: "listener",
        role: "listener",
        passwordNeedChange: false,
      }),
    );
  }
  return ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
}

describe("useKeypadBeeps", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSave.mockClear();
    accountPrefs = undefined;
  });

  it("follows the instance's setting until a listener picks one", () => {
    const { result } = renderHook(() => useKeypadBeeps("whistler"), {
      wrapper: wrapper(false),
    });
    expect(result.current.style).toBe("whistler");
    expect(result.current.label).toBe("Whistler");
  });

  it("takes the account's choice over the instance's", () => {
    accountPrefs = { keypadBeeps: "disabled" };
    const { result } = renderHook(() => useKeypadBeeps("uniden"), {
      wrapper: wrapper(true),
    });
    // Off is a choice, not an absence.
    expect(result.current.style).toBe("disabled");
    expect(result.current.label).toBe("Off");
  });

  it("saves a signed-in listener's choice to the account", () => {
    const { result } = renderHook(() => useKeypadBeeps("uniden"), {
      wrapper: wrapper(true),
    });
    act(() => result.current.setStyle("whistler"));
    expect(mockSave).toHaveBeenCalledWith({ keypadBeeps: "whistler" });
    // Mirrored locally too, so the sound is right if the save never lands.
    expect(localStorage.getItem(KEY)).toBe("whistler");
  });

  it("keeps an anonymous listener's choice in this browser alone", () => {
    const { result } = renderHook(() => useKeypadBeeps("uniden"), {
      wrapper: wrapper(false),
    });
    act(() => result.current.setStyle("disabled"));
    expect(mockSave).not.toHaveBeenCalled();
    expect(result.current.style).toBe("disabled");
    expect(localStorage.getItem(KEY)).toBe("disabled");
  });
});
