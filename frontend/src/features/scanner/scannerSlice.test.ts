import { describe, it, expect, afterEach, vi } from "vitest";
import {
  scannerSlice,
  callReceived,
  setCurrentCall,
  clearCurrentCall,
  togglePause,
  setPaused,
  toggleLive,
  setLive,
  holdSystem,
  holdTG,
  addAvoid,
  removeAvoid,
  clearAvoids,
  expireAvoids,
  toggleTG,
  setAllTGs,
  setTGsByIds,
  setConfig,
  transcriptReceived,
} from "./scannerSlice";
import type { ScannerConfig } from "@/types";
import type { Call } from "./types";

const reducer = scannerSlice.reducer;

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

describe("scannerSlice", () => {
  describe("callReceived", () => {
    it("enriches call but does not set currentCall", () => {
      const state = reducer(undefined, callReceived(makeCall({ id: 1 })));
      expect(state.currentCall).toBeNull();
    });

    it("does not add to history on receive", () => {
      const state = reducer(undefined, callReceived(makeCall({ id: 10 })));
      expect(state.history).toHaveLength(0);
    });
  });

  describe("setCurrentCall / clearCurrentCall", () => {
    it("moves previous call to history when setting new call", () => {
      let state = reducer(undefined, { type: "init" });
      state = reducer(state, setCurrentCall(makeCall({ id: 1 })));
      state = reducer(state, setCurrentCall(makeCall({ id: 2 })));
      expect(state.currentCall?.id).toBe(2);
      expect(state.history).toHaveLength(1);
      expect(state.history[0].id).toBe(1);
    });

    it("moves previous call to history when clearing", () => {
      let state = reducer(undefined, { type: "init" });
      state = reducer(state, setCurrentCall(makeCall({ id: 1 })));
      state = reducer(state, clearCurrentCall());
      expect(state.currentCall?.id).toBe(1);
      expect(state.history).toHaveLength(1);
      expect(state.history[0].id).toBe(1);
    });

    it("caps history at 5 items", () => {
      let state = reducer(undefined, { type: "init" });
      for (let i = 1; i <= 7; i++) {
        state = reducer(state, setCurrentCall(makeCall({ id: i })));
      }
      // 6 calls finished (1-6 were replaced), #7 is current
      expect(state.history).toHaveLength(5);
      // Most recent first
      expect(state.history[0].id).toBe(6);
      expect(state.history[4].id).toBe(2);
    });
  });

  describe("togglePause", () => {
    it("toggles isPaused from false to true", () => {
      const state = reducer(undefined, togglePause());
      expect(state.isPaused).toBe(true);
    });

    it("toggles isPaused from true to false", () => {
      let state = reducer(undefined, togglePause());
      state = reducer(state, togglePause());
      expect(state.isPaused).toBe(false);
    });

    it("sets isPaused explicitly", () => {
      let state = reducer(undefined, setPaused(true));
      expect(state.isPaused).toBe(true);
      state = reducer(state, setPaused(false));
      expect(state.isPaused).toBe(false);
    });
  });

  describe("resetting pause", () => {
    it("clears a pause when LIVE is toggled", () => {
      // LIVE off and on is how someone restarts listening; coming back to
      // a silently paused player reads as broken audio.
      let state = reducer(undefined, togglePause());
      expect(state.isPaused).toBe(true);
      state = reducer(state, toggleLive());
      expect(state.isPaused).toBe(false);
    });

    it("clears a pause when LIVE is turned off", () => {
      let state = reducer(undefined, togglePause());
      state = reducer(state, setLive(true));
      state = reducer(state, setLive(false));
      expect(state.isPaused).toBe(false);
    });

    it("does not restore a pause from a previous page load", async () => {
      // Pause is about the call playing right now, like backgroundAudio
      // and streamState beside it — none of them survive a reload.
      sessionStorage.setItem("squelch-paused", "true");
      vi.resetModules();
      const mod = await import("./scannerSlice");
      const fresh = mod.scannerSlice.reducer(undefined, { type: "@@INIT" });
      expect(fresh.isPaused).toBe(false);
    });
  });

  describe("toggleLive", () => {
    it("toggles isLive from false to true", () => {
      const state = reducer(undefined, toggleLive());
      expect(state.isLive).toBe(true);
    });

    it("toggles isLive from true to false", () => {
      let state = reducer(undefined, toggleLive());
      state = reducer(state, toggleLive());
      expect(state.isLive).toBe(false);
    });
  });

  describe("holdSystem / holdTG", () => {
    it("sets heldSystem", () => {
      const state = reducer(undefined, holdSystem(42));
      expect(state.heldSystem).toBe(42);
    });

    it("clears heldSystem with null", () => {
      let state = reducer(undefined, holdSystem(42));
      state = reducer(state, holdSystem(null));
      expect(state.heldSystem).toBeNull();
    });

    it("sets heldTG", () => {
      const state = reducer(undefined, holdTG(99));
      expect(state.heldTG).toBe(99);
    });

    it("clears heldTG with null", () => {
      let state = reducer(undefined, holdTG(99));
      state = reducer(state, holdTG(null));
      expect(state.heldTG).toBeNull();
    });
  });

  describe("addAvoid / removeAvoid / clearAvoids", () => {
    it("does not write the avoid into tgSelection", () => {
      // Avoids are tracked separately (and persisted separately); folding
      // them into tgSelection turned a timed avoid into a permanent disable.
      const state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: Date.now() + 60_000 }),
      );
      expect(state.tgSelection[10]).toBeUndefined();
    });

    it("adds an avoid entry", () => {
      const state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: 0 }),
      );
      expect(state.avoidList).toHaveLength(1);
      expect(state.avoidList[0].talkgroupId).toBe(10);
    });

    it("replaces existing avoid for same talkgroup", () => {
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: 1000 }),
      );
      state = reducer(state, addAvoid({ talkgroupId: 10, expiresAt: 2000 }));
      expect(state.avoidList).toHaveLength(1);
      expect(state.avoidList[0].expiresAt).toBe(2000);
    });

    it("removes an avoid entry by talkgroupId", () => {
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: 0 }),
      );
      state = reducer(state, removeAvoid(10));
      expect(state.avoidList).toHaveLength(0);
    });

    it("clears all avoids", () => {
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: 0 }),
      );
      state = reducer(state, addAvoid({ talkgroupId: 20, expiresAt: 0 }));
      state = reducer(state, clearAvoids());
      expect(state.avoidList).toHaveLength(0);
    });

    it("clearAvoids leaves tgSelection untouched", () => {
      let state = reducer(undefined, setTGsByIds({ ids: [10], enabled: false }));
      state = reducer(state, addAvoid({ talkgroupId: 10, expiresAt: 0 }));
      state = reducer(state, clearAvoids());
      expect(state.tgSelection[10]).toBe(false);
    });
  });

  describe("toggleTG", () => {
    it("disables an unkeyed talkgroup (missing key means enabled)", () => {
      const state = reducer(undefined, toggleTG(5));
      expect(state.tgSelection[5]).toBe(false);
    });

    it("flips talkgroup selection from false to true", () => {
      let state = reducer(undefined, toggleTG(5));
      state = reducer(state, toggleTG(5));
      expect(state.tgSelection[5]).toBe(true);
    });
  });

  describe("setTGsByIds", () => {
    it("disables exactly the given ids", () => {
      const state = reducer(
        undefined,
        setTGsByIds({ ids: [10, 11], enabled: false }),
      );
      expect(state.tgSelection).toEqual({ 10: false, 11: false });
    });

    it("enables the given ids and clears their avoids", () => {
      let state = reducer(undefined, addAvoid({ talkgroupId: 10, expiresAt: 0 }));
      state = reducer(state, addAvoid({ talkgroupId: 99, expiresAt: 0 }));
      state = reducer(state, setTGsByIds({ ids: [10], enabled: true }));
      expect(state.tgSelection[10]).toBe(true);
      expect(state.avoidList.map((a) => a.talkgroupId)).toEqual([99]);
    });

    it("ignores an empty id list", () => {
      const state = reducer(undefined, setTGsByIds({ ids: [], enabled: false }));
      expect(state.tgSelection).toEqual({});
    });
  });

  describe("setAllTGs", () => {
    const config: ScannerConfig = {
      systems: [
        {
          id: 1,
          systemId: 100,
          label: "System 1",
          ledColor: "",
          talkgroups: [
            {
              id: 10,
              talkgroupId: 200,
              label: "TG1",
              name: "Talkgroup 1",
              tag: "Law",
              group: "Police",
              ledColor: "#00e676",
            },
            {
              id: 11,
              talkgroupId: 201,
              label: "TG2",
              name: "Talkgroup 2",
              tag: "Fire",
              group: "Fire",
              ledColor: "#ff0000",
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

    it("enables all talkgroups", () => {
      let state = reducer(undefined, setConfig(config));
      state = reducer(state, setAllTGs(true));
      expect(state.tgSelection[10]).toBe(true);
      expect(state.tgSelection[11]).toBe(true);
    });

    it("disables all talkgroups", () => {
      let state = reducer(undefined, setConfig(config));
      state = reducer(state, setAllTGs(true));
      state = reducer(state, setAllTGs(false));
      expect(state.tgSelection[10]).toBe(false);
      expect(state.tgSelection[11]).toBe(false);
    });

    it("does nothing without config", () => {
      const state = reducer(undefined, setAllTGs(true));
      expect(Object.keys(state.tgSelection)).toHaveLength(0);
    });
  });

  describe("transcriptReceived", () => {
    it("updates transcript on currentCall", () => {
      let state = reducer(undefined, setCurrentCall(makeCall({ id: 1 })));
      state = reducer(
        state,
        transcriptReceived({ callId: 1, text: "hello world" }),
      );
      expect(state.currentCall?.transcript).toBe("hello world");
    });

    it("updates transcript in history", () => {
      let state = reducer(undefined, setCurrentCall(makeCall({ id: 1 })));
      state = reducer(state, clearCurrentCall());
      state = reducer(
        state,
        transcriptReceived({ callId: 1, text: "transcript text" }),
      );
      expect(state.history[0].transcript).toBe("transcript text");
    });

    it("does not fail if callId not found", () => {
      let state = reducer(undefined, setCurrentCall(makeCall({ id: 1 })));
      state = reducer(state, transcriptReceived({ callId: 999, text: "nope" }));
      expect(state.currentCall?.transcript).toBeUndefined();
    });
  });

  describe("expireAvoids", () => {
    it("removes expired avoids (expiresAt < Date.now())", () => {
      const pastTime = Date.now() - 60_000;
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: pastTime }),
      );
      state = reducer(state, expireAvoids());
      expect(state.avoidList).toHaveLength(0);
    });

    it("keeps permanent avoids (expiresAt === 0)", () => {
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: 0 }),
      );
      state = reducer(state, expireAvoids());
      expect(state.avoidList).toHaveLength(1);
      expect(state.avoidList[0].talkgroupId).toBe(10);
    });

    it("keeps non-expired avoids (expiresAt > Date.now())", () => {
      const futureTime = Date.now() + 60_000;
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: futureTime }),
      );
      state = reducer(state, expireAvoids());
      expect(state.avoidList).toHaveLength(1);
      expect(state.avoidList[0].talkgroupId).toBe(10);
    });

    it("leaves the user's own on/off choice alone when an avoid expires", () => {
      const pastTime = Date.now() - 60_000;
      // TG 10 was deliberately switched off; avoiding it and letting the
      // avoid lapse must not silently switch it back on.
      let state = reducer(undefined, setTGsByIds({ ids: [10], enabled: false }));
      state = reducer(state, addAvoid({ talkgroupId: 10, expiresAt: pastTime }));
      state = reducer(state, expireAvoids());
      expect(state.avoidList).toHaveLength(0);
      expect(state.tgSelection[10]).toBe(false);
    });

    it("filters mixed avoids correctly", () => {
      const pastTime = Date.now() - 60_000;
      const futureTime = Date.now() + 60_000;
      let state = reducer(
        undefined,
        addAvoid({ talkgroupId: 10, expiresAt: pastTime }),
      );
      state = reducer(state, addAvoid({ talkgroupId: 20, expiresAt: 0 }));
      state = reducer(
        state,
        addAvoid({ talkgroupId: 30, expiresAt: futureTime }),
      );
      state = reducer(state, expireAvoids());
      expect(state.avoidList).toHaveLength(2);
      expect(state.avoidList.map((a) => a.talkgroupId)).toEqual([20, 30]);
    });
  });
});

describe("backgroundAudio", () => {
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  /**
   * Re-import the slice so its initialState is recomputed against whatever
   * storage currently holds. Without the reset the static import at the top
   * of this file is reused and the assertion would pass vacuously.
   */
  async function freshInitialState(seed: string | null) {
    vi.resetModules();
    localStorage.clear();
    if (seed !== null) {
      localStorage.setItem("squelch-background-audio", seed);
    }
    const mod = await import("./scannerSlice");
    return mod.scannerSlice.reducer(undefined, { type: "@@INIT" });
  }

  it("starts off even when an old stored preference says otherwise", async () => {
    // Regression: this used to be restored from localStorage. A stream can
    // only be opened from a user gesture, so a restored "on" suspended the
    // normal player and showed an enabled control while nothing played,
    // until an unrelated click happened to satisfy the gesture.
    const state = await freshInitialState("true");

    expect(state.backgroundAudio).toBe(false);
    expect(state.streamState).toBe("idle");
  });

  it("does not write the preference back to storage", async () => {
    const mod = await import("./scannerSlice");
    const state = mod.scannerSlice.reducer(
      undefined,
      mod.setBackgroundAudio(true),
    );

    expect(state.backgroundAudio).toBe(true);
    expect(localStorage.getItem("squelch-background-audio")).toBeNull();
  });
});
