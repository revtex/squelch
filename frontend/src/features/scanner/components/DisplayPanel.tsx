import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { Share2, Copy, X, ExternalLink } from "lucide-react";
import { BookmarkButton } from "../components/BookmarkButton";
import { useGetBookmarkIDsQuery, useToggleBookmarkMutation } from "@/app/api";
import { useShareCallMutation } from "../shareSlice";
import { TranscriptPanel } from "../components/TranscriptPanel";
import { useActiveUnit } from "../hooks/useActiveUnit";
import { useLcdBrightness } from "../hooks/useLcdBrightness";
import {
  usePlaybackPosition,
  formatElapsed,
} from "../hooks/usePlaybackPosition";
import { useAppSelector } from "@/app/store";
import type { AvoidEntry } from "@/types";
import type { Call } from "../types";

interface DisplayPanelProps {
  currentCall: Call | null;
  heldSystem: number | null;
  heldTG: number | null;
  listenerCount: number;
  queueCount: number;
  avoidList: AvoidEntry[];
  time12hFormat: boolean;
  showListenersCount: boolean;
  shareableLinks: boolean;
  isAuthenticated: boolean;
  isLive: boolean;
  isPaused?: boolean;
  /** Server stream is playing; LIVE is deliberately off in that mode. */
  backgroundAudio?: boolean;
}

function useClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatClock(d: Date, hour12: boolean) {
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12,
  });
}

function formatCallTime(ts: number, hour12: boolean) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  });
}

function formatFrequency(hz?: number) {
  if (!hz || hz <= 0) return "";
  const mhz = Math.floor(hz / 1_000_000);
  const rest = (hz % 1_000_000).toString().padStart(6, "0");
  return `${mhz}.${rest} MHz`;
}

/**
 * The talkgroup name, stepped down in size until it fits the panel, then
 * ellipsised — never squashed. Its full size comes from the theme's CSS
 * (.lcd-sign), so block and classic panels each start from their own.
 */
function AutoSizeText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      el.style.lineHeight = "";
      const full = parseFloat(getComputedStyle(el).fontSize) || 0;
      const min = full * 0.48;
      let size = full;
      while (el.scrollWidth > el.clientWidth && size - 2 >= min) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
      // Keep the row's height as the name shrinks.
      if (size !== full) el.style.lineHeight = getComputedStyle(el).height;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <div
      ref={ref}
      className={`overflow-hidden whitespace-nowrap text-ellipsis ${className ?? ""}`}
    >
      {text}
    </div>
  );
}

export function DisplayPanel({
  currentCall,
  heldSystem,
  heldTG,
  listenerCount,
  queueCount,
  avoidList,
  time12hFormat,
  showListenersCount,
  shareableLinks,
  isAuthenticated,
  isLive,
  isPaused,
  backgroundAudio,
}: DisplayPanelProps) {
  const clock = useClock();
  const liveTranscriptDisplay = useAppSelector(
    (s) => s.scanner.config?.liveTranscriptDisplay ?? false,
  );
  const { brightness } = useLcdBrightness();
  const isAudioActive = useAppSelector((s) => s.scanner.isAudioActive);
  const position = usePlaybackPosition(isAudioActive);

  const { data: bookmarkData } = useGetBookmarkIDsQuery(undefined, {
    skip: !isAuthenticated,
  });
  const [toggleBookmark] = useToggleBookmarkMutation();
  const [shareCall] = useShareCallMutation();
  const bookmarkedCallIds = bookmarkData?.callIds ?? [];
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // Tick once per second while any timed avoid is active so `isAvoided`
  // expires on its own without waiting for an external state change.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const hasTimedAvoids = useMemo(
    () => avoidList.some((a) => a.expiresAt > 0),
    [avoidList],
  );
  useEffect(() => {
    if (!hasTimedAvoids) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasTimedAvoids]);

  const copyToClipboard = useCallback(
    async (text: string): Promise<boolean> => {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // Fall through to legacy copy for non-secure contexts or blocked permissions.
        }
      }

      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
      } catch {
        return false;
      }
    },
    [],
  );

  const handleShare = useCallback(async () => {
    if (!currentCall) return;
    try {
      const result = await shareCall(currentCall.id).unwrap();
      const url = `${window.location.origin}${result.url}`;
      setShareUrl(url);
    } catch {
      setToastMessage("Failed to share call");
      setTimeout(() => setToastMessage(null), 3000);
    }
  }, [currentCall, shareCall]);

  const handleCopyShareUrl = useCallback(async () => {
    if (!shareUrl) return;
    const copied = await copyToClipboard(shareUrl);
    if (copied) {
      setToastMessage("Link copied to clipboard");
    } else {
      setToastMessage("Copy failed - long-press URL to copy");
    }
    setTimeout(() => setToastMessage(null), 3000);
  }, [copyToClipboard, shareUrl]);

  const handleToggleBookmark = useCallback(
    (callId: number) => {
      if (!isAuthenticated) return;
      void toggleBookmark(callId);
    },
    [isAuthenticated, toggleBookmark],
  );

  const isAvoided = useMemo(() => {
    if (!currentCall) return false;
    const nowMs = nowTick;
    return avoidList.some(
      (a) =>
        a.talkgroupId === currentCall.talkgroup &&
        (a.expiresAt === 0 || a.expiresAt > nowMs),
    );
  }, [currentCall, avoidList, nowTick]);

  const isHeld = currentCall
    ? heldTG === currentCall.talkgroup || heldSystem === currentCall.system
    : false;

  const activeUnit = useActiveUnit(currentCall?.sources);

  const isHolding = heldSystem !== null || heldTG !== null;
  const idleSign = backgroundAudio
    ? "SQUELCH"
    : !isLive
      ? "OFF"
      : isPaused
        ? "PAUSED"
        : isHolding
          ? "HOLD"
          : "SQUELCH";

  const unitText = (() => {
    if (!currentCall) return "";
    const uid = activeUnit?.src || currentCall.source;
    const alias = activeUnit?.tag || currentCall.talkerAlias;
    return [uid ? `UID: ${uid}` : "", alias].filter(Boolean).join(" · ");
  })();

  // The badge row's clock: position / length while the Call plays, its
  // length once it has. Held to the length, since the position is sampled.
  const segments = currentCall?.transcriptSegments ?? [];
  const callLength = Math.max(
    currentCall?.duration ?? 0,
    segments.length > 0 ? segments[segments.length - 1].end : 0,
  );
  const callClock =
    !currentCall || callLength <= 0
      ? ""
      : isAudioActive
        ? `${formatElapsed(Math.min(position, callLength))} / ${formatElapsed(callLength)}`
        : formatElapsed(callLength);

  const errorChip = currentCall
    ? [
        currentCall.errorCount != null ? `E:${currentCall.errorCount}` : "",
        currentCall.spikeCount != null ? `S:${currentCall.spikeCount}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const badge =
    "inline-flex h-[18px] sm:h-5 items-center rounded-[2px] border border-accent px-1.5 text-[10px] sm:text-[11px] font-bold tracking-[0.08em] text-accent";

  const displayContent = (
    <div className="flex flex-col">
      {/* Head — the ink block on block themes, plain panel on classic. */}
      <div className="lcd-head px-3 pt-2.5 pb-2 flex flex-col gap-0.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold tracking-[0.06em]">
            {formatClock(clock, time12hFormat)}
          </span>
          <div className="flex items-center gap-3 whitespace-nowrap">
            {avoidList.length > 0 && (
              <span className="opacity-85">AVD {avoidList.length}</span>
            )}
            {showListenersCount && <span>L: {listenerCount}</span>}
            {/* The queue is the local player's. While background audio is
                on the server does the queueing, so this counter is
                structurally zero — a dash says "not applicable here"
                instead of implying nothing is waiting. */}
            <span
              className="font-bold"
              title={
                backgroundAudio
                  ? "The server manages the queue while background audio is on"
                  : undefined
              }
            >
              Q: {backgroundAudio ? "—" : queueCount}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 min-h-lh">
          <span className="min-w-0 flex-1 truncate">
            {currentCall?.systemLabel ?? ""}
          </span>
          {currentCall?.talkgroupTag && (
            <span className="shrink-0 rounded-[2px] bg-secondary px-1.5 py-px text-[10px] sm:text-[11px] leading-[14px] sm:leading-4 font-bold tracking-[0.1em] uppercase text-lcd-bg">
              {currentCall.talkgroupTag}
            </span>
          )}
        </div>

        <div className="flex justify-between gap-2 min-h-lh">
          <span className="min-w-0 truncate">
            {currentCall
              ? [currentCall.talkgroupGroup, currentCall.talkgroupLabel]
                  .filter(Boolean)
                  .join(" · ")
              : ""}
          </span>
          {currentCall && (
            <span className="shrink-0 whitespace-nowrap opacity-78">
              {formatCallTime(currentCall.dateTime, time12hFormat)}
            </span>
          )}
        </div>

        {currentCall ? (
          <AutoSizeText
            text={
              currentCall.talkgroupName?.trim() ||
              currentCall.talkgroupLabel?.trim() ||
              `TGID: ${currentCall.talkgroupId}`
            }
            className="lcd-sign text-center py-1"
          />
        ) : (
          <div className="lcd-sign text-center py-1 opacity-30">{idleSign}</div>
        )}
      </div>

      <div className="lcd-dither" aria-hidden="true" />

      {/* Body — the readout. Idle, it keeps its height. */}
      <div className="px-3 pt-2.5 pb-3 flex flex-col gap-[5px]">
        <div className="flex justify-between gap-2 min-h-lh">
          <span className="truncate">
            {currentCall ? formatFrequency(currentCall.frequency) : ""}
          </span>
          {currentCall && (
            <span className="shrink-0">TGID: {currentCall.talkgroupId}</span>
          )}
        </div>

        <div className="flex justify-between gap-2 min-h-lh">
          {currentCall ? (
            <>
              <span className="truncate text-lcd-dim">
                {[currentCall.site, currentCall.decoder]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <span className="truncate text-right">{unitText}</span>
            </>
          ) : (
            /* Hint to enable LIVE when offline. In background-audio mode
               LIVE is deliberately off and the server stream is playing,
               so telling the user to tap it would be wrong. */
            !isLive && (
              <span className="w-full text-center text-lcd-dim">
                {backgroundAudio
                  ? "Background audio — streaming"
                  : "Tap LIVE to start listening"}
              </span>
            )
          )}
        </div>

        <div className="flex h-[18px] sm:h-5 items-center gap-1.5">
          {isHeld && <span className={badge}>HOLD</span>}
          {isAvoided && <span className={badge}>AVOID</span>}
          {currentCall?.patches && <span className={badge}>PATCH</span>}
          {errorChip && (
            <span className="inline-flex h-[18px] sm:h-5 items-center rounded-[2px] bg-lcd-badge-bg px-1.5 text-[10px] sm:text-[11px]">
              {errorChip}
            </span>
          )}
          <span className="flex-1" />
          {currentCall && isAuthenticated && (
            <BookmarkButton
              isBookmarked={bookmarkedCallIds.includes(currentCall.id)}
              onToggle={() => handleToggleBookmark(currentCall.id)}
            />
          )}
          {currentCall && isAuthenticated && shareableLinks && (
            <button
              className="btn btn-ghost btn-xs btn-circle opacity-70 hover:opacity-100"
              onClick={handleShare}
              aria-label="Share call"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          )}
          {callClock && (
            <span className="shrink-0 text-lcd-dim">{callClock}</span>
          )}
        </div>
      </div>

      {/* Transcript (when enabled in admin) */}
      {liveTranscriptDisplay && (
        <TranscriptPanel
          call={currentCall}
          position={position}
          playing={isAudioActive}
        />
      )}
    </div>
  );

  return (
    <>
      <div
        className="lcd-display"
        style={
          brightness !== 100
            ? { filter: `brightness(${brightness / 100})` }
            : undefined
        }
      >
        {displayContent}
      </div>

      {shareUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-xl rounded-lg border border-base-300 bg-base-100 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/70">
                Share Link
              </h3>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => setShareUrl(null)}
                aria-label="Close share popup"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="input input-sm w-full"
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Share URL"
              />
              <button
                className="btn btn-primary btn-sm btn-square"
                onClick={handleCopyShareUrl}
                aria-label="Copy share URL"
                title="Copy"
              >
                <Copy size={16} />
              </button>
              <button
                className="btn btn-ghost btn-sm btn-square"
                onClick={() => {
                  if (!shareUrl) return;
                  window.open(shareUrl, "_blank", "noopener,noreferrer");
                }}
                aria-label="Open share URL"
                title="Open"
              >
                <ExternalLink size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toastMessage && (
        <div className="toast toast-end toast-bottom z-50">
          <div className="alert alert-info">
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </>
  );
}
