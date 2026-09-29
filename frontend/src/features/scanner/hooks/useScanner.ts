import { useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/store";
import { useWebSocket } from "@/shared/hooks/useWebSocket";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import {
  togglePause,
  toggleLive,
  holdSystem,
  holdTG,
  addAvoid,
  removeAvoid,
  clearAvoids,
  toggleTG,
  setAllTGs,
  setBackgroundAudio,
  setLive,
  setStreamState,
  setCurrentCall,
  clearCurrentCall,
  setAudioActive,
} from "../scannerSlice";
import { streamPlayer } from "@/shared/services/audio/streamPlayer";
import { streamCues } from "@/shared/services/audio/streamCues";
import { audioPlayer } from "@/shared/services/audio/player";
import type { AvoidEntry } from "@/types";

/**
 * How long after an armed-gesture start a click still counts as part of
 * that same gesture. Generous enough for a slow tap-to-click, far short of
 * a deliberate second press.
 */
const GESTURE_GRACE_MS = 600;

export function useScanner() {
  const dispatch = useAppDispatch();
  const { connectionStatus } = useWebSocket();
  const audio = useAudioPlayer();

  const currentCall = useAppSelector((s) => s.scanner.currentCall);
  const history = useAppSelector((s) => s.scanner.history);
  const isLive = useAppSelector((s) => s.scanner.isLive);
  const isPaused = useAppSelector((s) => s.scanner.isPaused);
  const heldSystem = useAppSelector((s) => s.scanner.heldSystem);
  const heldTG = useAppSelector((s) => s.scanner.heldTG);
  const avoidList = useAppSelector((s) => s.scanner.avoidList);
  const listenerCount = useAppSelector((s) => s.scanner.listenerCount);
  const backgroundAudio = useAppSelector((s) => s.scanner.backgroundAudio);
  const streamState = useAppSelector((s) => s.scanner.streamState);
  const config = useAppSelector((s) => s.scanner.config);
  const tgSelection = useAppSelector((s) => s.scanner.tgSelection);

  const doTogglePause = useCallback(() => {
    dispatch(togglePause());
    if (isPaused) {
      audio.resume();
    } else {
      audio.pause();
    }
  }, [dispatch, isPaused, audio]);
  // LIVE and BACKGROUND are two ways of listening, so picking one drops
  // the other rather than leaving a control that looks active but is not.
  const doToggleLive = useCallback(() => {
    // Touching LIVE clears a pause (see the reducer), so the player has to
    // be let go of too. Left paused it would queue arriving calls instead
    // of playing them, and the button would say Pause over silence.
    audioPlayer.resume();
    if (backgroundAudio) {
      streamPlayer.stop();
      audioPlayer.setSuspended(false);
      dispatch(setBackgroundAudio(false));
      dispatch(setLive(true));
      return;
    }
    dispatch(toggleLive());
  }, [backgroundAudio, dispatch]);
  const doHoldSystem = useCallback(
    (id: number | null) => dispatch(holdSystem(id)),
    [dispatch],
  );
  const doHoldTG = useCallback(
    (id: number | null) => dispatch(holdTG(id)),
    [dispatch],
  );
  const doAddAvoid = useCallback(
    (entry: AvoidEntry) => dispatch(addAvoid(entry)),
    [dispatch],
  );
  const doRemoveAvoid = useCallback(
    (tgId: number) => dispatch(removeAvoid(tgId)),
    [dispatch],
  );
  const doClearAvoids = useCallback(() => dispatch(clearAvoids()), [dispatch]);
  const doToggleTG = useCallback(
    (id: number) => dispatch(toggleTG(id)),
    [dispatch],
  );
  const doSetAllTGs = useCallback(
    (enabled: boolean) => dispatch(setAllTGs(enabled)),
    [dispatch],
  );

  // Runs straight off the button press: opening the stream is subject to
  // autoplay policy, and on iOS the user activation does not survive an
  // await, so start() has to happen inside the gesture.
  const doToggleBackgroundAudio = useCallback(() => {
    // The preference can be on while nothing is playing: after a reload the
    // stream cannot open without a user gesture, so it sits armed. This
    // press *is* that gesture, so resume rather than switching the
    // preference off — otherwise the only way out is off-then-on, which is
    // what made the control feel broken after a refresh.
    // Only "blocked" means the user has to act. A stream that is merely
    // connecting is already on its way.
    //
    // The second case is this control's own press: startOnGesture listens
    // for mousedown on the document, which fires before this click, so by
    // now the stream has already started and the state no longer reads
    // "blocked". Without this the press meant to resume would be taken as
    // a press to switch off.
    const fromSameGesture =
      Date.now() - streamPlayer.startedFromGestureAt() < GESTURE_GRACE_MS;
    if (backgroundAudio && (streamState === "blocked" || fromSameGesture)) {
      audioPlayer.setSuspended(true);
      streamPlayer.start();
      return;
    }

    const next = !backgroundAudio;
    if (next) {
      // Suspend before opening the stream: on iOS only one element can hold
      // the audio session, and the local player's gesture unlock re-plays
      // its element on every tap, which would take the session straight
      // back off the stream.
      audioPlayer.setSuspended(true);
      streamPlayer.start();
      // Selecting this mode leaves the other one.
      dispatch(setLive(false));
    } else {
      streamPlayer.stop();
      audioPlayer.setSuspended(false);
    }
    dispatch(setBackgroundAudio(next));
  }, [backgroundAudio, streamState, dispatch]);

  // In stream mode the server owns playback, so none of the local player's
  // callbacks fire and the display panel would stay empty for the whole
  // session — as if nothing were happening. Drive it from the same cue that
  // drives the lock screen, so what is on screen matches what is audible.
  useEffect(() => {
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    streamCues.configure(
      () => streamPlayer.currentTime(),
      (call) => {
        audioPlayer.setNowPlaying(call);
        dispatch(setCurrentCall(call));
        dispatch(setAudioActive(true));

        // Nothing tells us when the audio stops, so fall back to the call's
        // own duration. A later call simply replaces this one.
        if (clearTimer) clearTimeout(clearTimer);
        const ms = typeof call.duration === "number" ? call.duration : 0;
        clearTimer = setTimeout(
          () => {
            dispatch(setAudioActive(false));
          },
          ms > 0 ? ms : 5000,
        );
      },
    );
    streamPlayer.setOnReset(() => {
      streamCues.reset();
      if (clearTimer) clearTimeout(clearTimer);
      dispatch(clearCurrentCall());
      dispatch(setAudioActive(false));
    });

    return () => {
      if (clearTimer) clearTimeout(clearTimer);
      streamPlayer.setOnReset(null);
    };
  }, [dispatch]);

  // Mirror the player's real state into the store so the control can show
  // "armed but not playing" instead of claiming to be streaming.
  useEffect(() => {
    streamPlayer.setOnStateChange((state) => {
      dispatch(setStreamState(state));
    });
    return () => {
      streamPlayer.setOnStateChange(null);
    };
  }, [dispatch]);

  // Keep the players consistent: exactly one of them owns playback. The
  // flag only ever changes from a tap on BKGND, so the gesture that
  // autoplay policy requires is already in hand.
  useEffect(() => {
    audioPlayer.setSuspended(backgroundAudio);
    if (backgroundAudio) {
      if (!streamPlayer.isActive()) streamPlayer.startOnGesture();
    } else {
      streamPlayer.stop();
    }
  }, [backgroundAudio]);

  return {
    // Connection
    connectionStatus,

    // Scanner state
    currentCall,
    history,
    isLive,
    isPaused,
    heldSystem,
    heldTG,
    avoidList,
    listenerCount,
    backgroundAudio,
    streamState,
    config,
    tgSelection,

    // Scanner actions
    togglePause: doTogglePause,
    toggleLive: doToggleLive,
    holdSystem: doHoldSystem,
    holdTG: doHoldTG,
    addAvoid: doAddAvoid,
    removeAvoid: doRemoveAvoid,
    clearAvoids: doClearAvoids,
    toggleTG: doToggleTG,
    setAllTGs: doSetAllTGs,
    toggleBackgroundAudio: doToggleBackgroundAudio,

    // Audio controls
    ...audio,
  };
}
