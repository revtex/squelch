import { readStored } from "@/shared/utils/storage";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGetSetupStatusQuery } from "@/app/api";
import { useAppDispatch, useAppSelector } from "@/app/store";
import { setSetupStatus, selectToken } from "@/features/auth";
import { expireAvoids, setPaused, setLive, resetDisplay } from "./scannerSlice";
import { useScanner } from "./hooks/useScanner";
import { useTGSelectionSync } from "./hooks/useTGSelectionSync";
import { useKeypadBeeps } from "./hooks/useKeypadBeeps";
import { LEDPanel } from "./components/LEDPanel";
import { DisplayPanel } from "./components/DisplayPanel";
import { ControlToolbar } from "./components/ControlToolbar";
import { HistoryPanel } from "./components/HistoryPanel";
import SelectTGPanel from "./components/SelectTGPanel";
import SearchPanel from "./components/SearchPanel";
import BookmarksPanel from "./components/BookmarksPanel";
import { isMobilePlatform } from "@/shared/utils/platform";

export default function Scanner() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data: setupStatus } = useGetSetupStatusQuery();
  const token = useAppSelector(selectToken);
  const isAudioActive = useAppSelector((s) => s.scanner.isAudioActive);

  const scanner = useScanner();
  useTGSelectionSync();
  // Per-browser, with the server's setting as the starting point.
  const { style: keypadBeeps } = useKeypadBeeps(scanner.config?.keypadBeeps);

  // Read cached display prefs so we don't flash defaults before WS delivers CFG.
  // Lazy useState initializer runs exactly once per component instance.
  const [cachedPrefs] = useState<{
    time12hFormat?: boolean;
    showListenersCount?: boolean;
  }>(() => {
    try {
      const raw = readStored(sessionStorage, "squelch-display-prefs");
      if (raw)
        return JSON.parse(raw) as {
          time12hFormat?: boolean;
          showListenersCount?: boolean;
        };
    } catch {
      /* ignore */
    }
    return {};
  });

  const [selectTGOpen, setSelectTGOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);

  const handleToggleSelectTG = useCallback(() => {
    setSelectTGOpen((prev) => !prev);
    setSearchOpen(false);
  }, []);

  const handleToggleSearch = useCallback(() => {
    setSearchOpen((prev) => !prev);
    setSelectTGOpen(false);
  }, []);

  useEffect(() => {
    if (setupStatus) {
      dispatch(setSetupStatus(setupStatus));
      if (setupStatus.needsSetup) {
        navigate("/setup", { replace: true });
        return;
      }
      // If not public access and not authenticated, redirect to login
      if (!setupStatus.publicAccess && !token) {
        navigate("/login", { replace: true });
      }
    }
  }, [setupStatus, navigate, dispatch, token]);

  // Expire timed avoid entries every 10 seconds
  useEffect(() => {
    const id = setInterval(() => dispatch(expireAvoids()), 10_000);
    return () => clearInterval(id);
  }, [dispatch]);

  // Reset playback state when leaving the scanner route.
  // Live off ensures no audio auto-plays on return.
  useEffect(
    () => () => {
      dispatch(setLive(false));
      dispatch(setPaused(false));
      dispatch(resetDisplay());
    },
    [dispatch],
  );

  return (
    <div className="max-w-2xl mx-auto p-6">
      <LEDPanel
        onToggleBookmarks={
          token ? () => setBookmarksOpen((prev) => !prev) : undefined
        }
      />
      <DisplayPanel
        currentCall={scanner.currentCall}
        backgroundAudio={scanner.backgroundAudio}
        heldSystem={scanner.heldSystem}
        heldTG={scanner.heldTG}
        listenerCount={scanner.listenerCount}
        queueCount={scanner.pendingCount}
        avoidList={scanner.avoidList}
        time12hFormat={
          scanner.config?.time12hFormat ?? cachedPrefs.time12hFormat ?? false
        }
        showListenersCount={
          scanner.config?.showListenersCount ??
          cachedPrefs.showListenersCount ??
          false
        }
        shareableLinks={scanner.config?.shareableLinks ?? false}
        isAuthenticated={!!token}
        isLive={scanner.isLive}
        isPaused={scanner.isPaused}
      />
      <ControlToolbar
        isPaused={scanner.isPaused}
        isLive={scanner.isLive}
        volume={scanner.volume}
        heldSystem={scanner.heldSystem}
        heldTG={scanner.heldTG}
        currentCallTgId={scanner.currentCall?.talkgroup}
        currentCallSystemId={scanner.currentCall?.system}
        onTogglePause={scanner.togglePause}
        onToggleLive={scanner.toggleLive}
        onSkip={scanner.skip}
        onReplay={scanner.replay}
        onSetVolume={scanner.setVolume}
        onHoldSystem={scanner.holdSystem}
        onHoldTG={scanner.holdTG}
        onAddAvoid={scanner.addAvoid}
        onToggleSelectTG={handleToggleSelectTG}
        onToggleSearch={handleToggleSearch}
        selectOpen={selectTGOpen}
        searchOpen={searchOpen}
        isAvoided={
          scanner.currentCall != null &&
          scanner.avoidList.some(
            (a) => a.talkgroupId === scanner.currentCall?.talkgroup,
          )
        }
        // Anything the player has already played can be replayed, whether or
        // not it is still the Call on the display.
        canReplay={scanner.currentCall != null || scanner.history.length > 0}
        backgroundAudio={scanner.backgroundAudio}
        streamState={scanner.streamState}
        onToggleBackgroundAudio={
          // Mobile only: a desktop browser keeps a background tab running
          // and plays each call normally, so the stream buys nothing there.
          token && isMobilePlatform()
            ? scanner.toggleBackgroundAudio
            : undefined
        }
        keypadBeeps={keypadBeeps}
      />
      <HistoryPanel
        history={scanner.history}
        time12hFormat={
          scanner.config?.time12hFormat ?? cachedPrefs.time12hFormat ?? false
        }
        playingCallId={isAudioActive ? (scanner.currentCall?.id ?? null) : null}
      />
      <SelectTGPanel
        isOpen={selectTGOpen}
        onClose={() => setSelectTGOpen(false)}
      />
      <SearchPanel isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <BookmarksPanel
        isOpen={bookmarksOpen}
        onClose={() => setBookmarksOpen(false)}
      />
    </div>
  );
}
