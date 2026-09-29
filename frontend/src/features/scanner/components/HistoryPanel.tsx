import { audioPlayer } from "@/shared/services/audio/player";
import type { Call } from "../types";

const MAX_ROWS = 5;

interface HistoryPanelProps {
  history: Call[];
  time12hFormat: boolean;
  /** The Call on the air, if any — its row carries the accent rail. */
  playingCallId?: number | null;
}

/**
 * RECENT: the last few Calls as one-line rows, each a button that replays
 * it. A talkgroup with its own LED colour keeps that colour as a rail, so
 * a glance sorts fire from police before a word is read.
 */
export function HistoryPanel({
  history,
  time12hFormat,
  playingCallId,
}: HistoryPanelProps) {
  if (history.length === 0) return null;

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: time12hFormat,
    });

  return (
    <section className="mt-[18px]" aria-label="Recent calls">
      <div className="flex items-center justify-between mb-1.5 text-[10px] sm:text-[11px] font-bold tracking-label uppercase text-base-content-dim">
        <span>Recent</span>
        <span>Tap to replay</span>
      </div>
      <ul className="flex flex-col gap-1">
        {history.slice(0, MAX_ROWS).map((call) => {
          const name =
            call.talkgroupName?.trim() ||
            call.talkgroupLabel?.trim() ||
            `TGID ${call.talkgroupId}`;
          const time = formatTime(call.dateTime);
          const own = call.talkgroupLedColor;
          const playing = playingCallId === call.id;
          const rail = playing
            ? (own ?? "var(--color-accent)")
            : own
              ? `color-mix(in srgb, ${own} 60%, transparent)`
              : undefined;
          return (
            <li key={call.id}>
              <button
                type="button"
                onClick={() => audioPlayer.playNow(call)}
                aria-label={`Replay ${name}, ${time}`}
                aria-current={playing ? "true" : undefined}
                className="relative flex w-full h-12 items-center gap-2.5 overflow-hidden rounded px-2.5 text-left bg-base-200 hover:bg-base-300 transition-colors"
                style={
                  playing
                    ? {
                        backgroundImage: `linear-gradient(color-mix(in srgb, ${own ?? "var(--color-accent)"} 16%, transparent), color-mix(in srgb, ${own ?? "var(--color-accent)"} 16%, transparent))`,
                      }
                    : undefined
                }
              >
                {rail && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-0.5"
                    style={{ backgroundColor: rail }}
                  />
                )}
                <span className="shrink-0 font-mono text-[11px] sm:text-xs text-base-content-dim">
                  {time}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] sm:text-sm leading-[18px] sm:leading-5">
                  {name}
                </span>
                {call.talkgroupId > 0 && (
                  <span className="shrink-0 font-mono text-[10px] sm:text-[11px] text-base-content-dim">
                    TGID:{call.talkgroupId}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
