import { writeStored } from "@/shared/utils/storage";
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AvoidEntry, ConnectionStatus, ScannerConfig } from "@/types";
import type { StreamState } from "@/shared/services/audio/streamPlayer";
import type { Call, TranscriptionSegment } from "./types";

const MAX_HISTORY = 5;

interface PendingTranscript {
  text: string;
  segments?: TranscriptionSegment[];
}

interface ScannerState {
  isLive: boolean;
  isPaused: boolean;
  isAudioActive: boolean;
  heldSystem: number | null;
  heldTG: number | null;
  avoidList: AvoidEntry[];
  currentCall: Call | null;
  history: Call[];
  listenerCount: number;
  connectionStatus: ConnectionStatus;
  config: ScannerConfig | null;
  // True only once a real scanner.config/CFG frame has been applied.
  // `config` alone is not a safe signal: connection.welcome arrives first and
  // setBranding fabricates a config with an empty `systems` array, which made
  // the selection logic treat "no talkgroups yet" as "nothing is disabled".
  configReceived: boolean;
  tgSelection: Record<number, boolean>;
  tgSelectionReady: boolean;
  // When true the server sends one continuous audio stream instead of the
  // client playing each call itself. Opt-in, because it trades the local
  // queue controls (skip/replay/hold) for playback that survives an iOS
  // screen lock. See shared/services/audio/streamPlayer.
  backgroundAudio: boolean;
  /**
   * What the server stream is actually doing. Distinct from
   * backgroundAudio, which is only what the user asked for: the browser can
   * refuse a stream (autoplay policy, a failed connect), leaving the
   * request on while nothing plays ("blocked"). "starting" is an ordinary
   * connect and must not be shown as paused.
   */
  streamState: StreamState;
  pendingTranscripts: Record<number, PendingTranscript>;
}

const initialState: ScannerState = {
  isLive: false,
  // Deliberately not restored. A stream can only be opened from a user
  // gesture, so a remembered "on" is a preference the page cannot act on:
  // it suspends the normal per-call player and shows an enabled-looking
  // control while nothing plays, until some unrelated click happens to
  // satisfy the gesture. Starting off means the button always describes
  // what is actually happening.
  backgroundAudio: false,
  // Never restored: a stream can only be opened from a user gesture, so a
  // freshly loaded page is never streaming yet however the preference reads.
  streamState: "idle",
  // Never restored, for the same reason as the two above: pause is about
  // the call playing right now, and a freshly loaded page has none. A
  // restored pause reads as broken audio — nothing plays and the reason
  // is a button the listener last touched in another session.
  isPaused: false,
  isAudioActive: false,
  heldSystem: null,
  heldTG: null,
  avoidList: [],
  currentCall: null,
  history: [],
  listenerCount: 0,
  connectionStatus: "disconnected",
  config: null,
  configReceived: false,
  tgSelection: {},
  tgSelectionReady: false,
  pendingTranscripts: {},
};

export const scannerSlice = createSlice({
  name: "scanner",
  initialState,
  reducers: {
    callReceived(state, action: PayloadAction<Call>) {
      const call = action.payload;

      // Enrich call with labels from config
      if (state.config) {
        for (const sys of state.config.systems) {
          if (sys.id === call.system) {
            call.systemLabel = sys.label;
            for (const tg of sys.talkgroups) {
              if (tg.id === call.talkgroup) {
                call.talkgroupLabel = tg.label;
                call.talkgroupName = tg.name;
                call.talkgroupTag = tg.tag;
                call.talkgroupGroup = tg.group;
                call.talkgroupLedColor = tg.ledColor || sys.ledColor;
                break;
              }
            }
            break;
          }
        }
      }
    },
    setCurrentCall(state, action: PayloadAction<Call | null>) {
      // Move the previous call into history (skip if already there)
      if (
        state.currentCall &&
        !state.history.some((h) => h.id === state.currentCall!.id)
      ) {
        state.history = [state.currentCall, ...state.history].slice(
          0,
          MAX_HISTORY,
        );
      }
      state.currentCall = action.payload;

      // Merge any transcript that arrived while the call was queued.
      if (state.currentCall) {
        const pending = state.pendingTranscripts[state.currentCall.id];
        if (pending) {
          state.currentCall.transcript = pending.text;
          state.currentCall.transcriptSegments = pending.segments;
          delete state.pendingTranscripts[state.currentCall.id];
        }

        // Purge stale entries — any pending transcript for a call ID older
        // than the current call was skipped/filtered and will never play.
        const currentId = state.currentCall.id;
        for (const key of Object.keys(state.pendingTranscripts)) {
          if (Number(key) < currentId) {
            delete state.pendingTranscripts[Number(key)];
          }
        }
      }
    },
    clearCurrentCall(state) {
      // Move the finished call into history (skip if already there)
      if (
        state.currentCall &&
        !state.history.some((h) => h.id === state.currentCall!.id)
      ) {
        state.history = [state.currentCall, ...state.history].slice(
          0,
          MAX_HISTORY,
        );
      }
      // Keep the last call visible on the display until a new call starts.
    },
    resetDisplay(state) {
      state.currentCall = null;
      state.history = [];
    },
    resetTGSelection(state) {
      state.tgSelection = {};
      state.tgSelectionReady = false;
    },
    togglePause(state) {
      state.isPaused = !state.isPaused;
    },
    setAudioActive(state, action: PayloadAction<boolean>) {
      state.isAudioActive = action.payload;
    },
    setPaused(state, action: PayloadAction<boolean>) {
      state.isPaused = action.payload;
    },
    // Both clear a pause: LIVE off and on is how a listener restarts
    // listening, so it has to come back playing. The player is resumed
    // alongside this in useScanner — leaving it paused here would queue
    // calls instead of playing them.
    toggleLive(state) {
      state.isLive = !state.isLive;
      state.isPaused = false;
    },
    setLive(state, action: PayloadAction<boolean>) {
      state.isLive = action.payload;
      state.isPaused = false;
    },
    holdSystem(state, action: PayloadAction<number | null>) {
      state.heldSystem = action.payload;
    },
    holdTG(state, action: PayloadAction<number | null>) {
      state.heldTG = action.payload;
    },
    addAvoid(state, action: PayloadAction<AvoidEntry>) {
      // Replace if already present
      state.avoidList = state.avoidList.filter(
        (a) => a.talkgroupId !== action.payload.talkgroupId,
      );
      state.avoidList.push(action.payload);
      // Deliberately does NOT touch tgSelection. An avoid is a separate,
      // often time-boxed mute (see audioListenerMiddleware, which checks
      // both lists); folding it into tgSelection persisted it as a
      // permanent disable the moment anything else was saved.
    },
    removeAvoid(state, action: PayloadAction<number>) {
      state.avoidList = state.avoidList.filter(
        (a) => a.talkgroupId !== action.payload,
      );
    },
    clearAvoids(state) {
      // Only the avoids are cleared — a talkgroup the user switched off
      // stays off (see addAvoid on why the two are kept separate).
      state.avoidList = [];
    },
    setListenerCount(state, action: PayloadAction<number>) {
      state.listenerCount = action.payload;
    },
    setConnectionStatus(state, action: PayloadAction<ConnectionStatus>) {
      state.connectionStatus = action.payload;
    },
    setConfig(state, action: PayloadAction<ScannerConfig>) {
      const incoming = action.payload;
      state.configReceived = true;
      state.config = {
        ...incoming,
        branding: incoming.branding ?? state.config?.branding ?? "",
        email: incoming.email ?? state.config?.email ?? "",
        version: incoming.version ?? state.config?.version ?? "",
      };
      // Cache display prefs so the next page load avoids a flash of defaults.
      try {
        writeStored(
          sessionStorage,
          "squelch-display-prefs",
          JSON.stringify({
            time12hFormat: state.config.time12hFormat,
            showListenersCount: state.config.showListenersCount,
          }),
        );
      } catch {
        // sessionStorage unavailable — ignore
      }
    },
    setBranding(
      state,
      action: PayloadAction<{
        branding: string;
        email: string;
        version: string;
      }>,
    ) {
      if (state.config) {
        state.config.branding = action.payload.branding;
        state.config.email = action.payload.email;
        state.config.version = action.payload.version;
      } else {
        // NOTE: this placeholder carries no systems. Anything that reads
        // talkgroups must gate on `configReceived`, not on `config != null`.
        state.config = {
          systems: [],
          time12hFormat: false,
          showListenersCount: false,
          shareableLinks: false,
          transcriptionEnabled: false,
          liveTranscriptDisplay: false,
          keypadBeeps: "",
          ...action.payload,
        };
      }
    },
    setStreamState(state, action: PayloadAction<StreamState>) {
      state.streamState = action.payload;
    },
    setBackgroundAudio(state, action: PayloadAction<boolean>) {
      state.backgroundAudio = action.payload;
    },
    toggleTG(state, action: PayloadAction<number>) {
      const id = action.payload;
      // A missing key means "enabled" everywhere else in the app (see
      // `tgSelection[id] !== false`), so an unkeyed talkgroup must flip to
      // false — `!undefined` would have made the first click a visible no-op.
      state.tgSelection[id] = state.tgSelection[id] === false;
    },
    restoreTGSelection(state, action: PayloadAction<Record<number, boolean>>) {
      // Restoring before the real config would mark an empty selection
      // "ready" and let the persist effect save it back as "nothing
      // disabled". Callers gate on this too; this is the backstop.
      if (!state.configReceived) return;
      state.tgSelection = action.payload;
      state.tgSelectionReady = true;
    },
    restoreFromDisabledTGs(state, action: PayloadAction<number[]>) {
      if (!state.configReceived) return;
      const disabled = new Set(action.payload);
      const selection: Record<number, boolean> = {};
      if (state.config) {
        for (const sys of state.config.systems) {
          for (const tg of sys.talkgroups) {
            selection[tg.id] = !disabled.has(tg.id);
          }
        }
      }
      state.tgSelection = selection;
      state.tgSelectionReady = true;
    },
    restoreAvoidList(state, action: PayloadAction<AvoidEntry[]>) {
      const now = Date.now();
      state.avoidList = action.payload.filter(
        (a) => a.expiresAt === 0 || a.expiresAt > now,
      );
    },
    setAllTGs(state, action: PayloadAction<boolean>) {
      const enabled = action.payload;
      if (state.config) {
        for (const sys of state.config.systems) {
          for (const tg of sys.talkgroups) {
            state.tgSelection[tg.id] = enabled;
          }
        }
      }
    },
    // Bulk toggle by explicit talkgroup id. Callers (the Select Talkgroups
    // panel) pass the exact list they rendered, so the section bucketing rule
    // lives in exactly one place and the toggle always matches the badge the
    // user is looking at — including sections keyed by a placeholder label
    // such as "(No Group)"/"(No Tag)", which match no talkgroup field.
    setTGsByIds(
      state,
      action: PayloadAction<{ ids: number[]; enabled: boolean }>,
    ) {
      const { ids, enabled } = action.payload;
      for (const id of ids) {
        state.tgSelection[id] = enabled;
      }
      if (enabled && state.avoidList.length > 0) {
        // Avoids also read as "off", so a bulk enable must clear them or the
        // section LED could never reach green (and the next click would try
        // to enable again, forever).
        const wanted = new Set(ids);
        state.avoidList = state.avoidList.filter(
          (a) => !wanted.has(a.talkgroupId),
        );
      }
    },
    expireAvoids(state) {
      const now = Date.now();
      const kept: AvoidEntry[] = [];
      for (const entry of state.avoidList) {
        if (entry.expiresAt === 0 || entry.expiresAt > now) {
          kept.push(entry);
        }
        // An expired avoid just drops out of the list — tgSelection is the
        // user's own on/off choice and is left exactly as they set it.
      }
      state.avoidList = kept;
    },
    transcriptReceived(
      state,
      action: PayloadAction<{
        callId: number;
        text: string;
        segments?: TranscriptionSegment[];
      }>,
    ) {
      const { callId, text, segments } = action.payload;
      let matched = false;

      if (state.currentCall?.id === callId) {
        state.currentCall.transcript = text;
        state.currentCall.transcriptSegments = segments;
        matched = true;
      }
      const histItem = state.history.find((c) => c.id === callId);
      if (histItem) {
        histItem.transcript = text;
        histItem.transcriptSegments = segments;
        matched = true;
      }

      // Call is likely still in the audioPlayer queue — stash for later.
      // Consumed by setCurrentCall when the call starts playing.
      if (!matched) {
        state.pendingTranscripts[callId] = { text, segments };
      }
    },
  },
});

export const {
  callReceived,
  setBackgroundAudio,
  setStreamState,
  setCurrentCall,
  clearCurrentCall,
  resetDisplay,
  resetTGSelection,
  togglePause,
  setAudioActive,
  setPaused,
  toggleLive,
  setLive,
  holdSystem,
  holdTG,
  addAvoid,
  removeAvoid,
  clearAvoids,
  expireAvoids,
  setListenerCount,
  setConnectionStatus,
  setConfig,
  setBranding,
  toggleTG,
  restoreTGSelection,
  restoreFromDisabledTGs,
  restoreAvoidList,
  setAllTGs,
  setTGsByIds,
  transcriptReceived,
} = scannerSlice.actions;
