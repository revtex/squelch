import {
  Play,
  Pause,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  Radio,
  Lock,
  Ban,
  List,
  Search,
  Smartphone,
} from "lucide-react";
import { useCallback } from "react";
import { playBeep } from "@/shared/services/audio/beep";
import type { AvoidEntry } from "@/types";
import type { StreamState } from "@/shared/services/audio/streamPlayer";

interface ControlToolbarProps {
  isPaused: boolean;
  isLive: boolean;
  volume: number;
  heldSystem: number | null;
  heldTG: number | null;
  currentCallTgId?: number;
  currentCallSystemId?: number;
  onTogglePause: () => void;
  onToggleLive: () => void;
  onSkip: () => void;
  onReplay: () => void;
  onSetVolume: (v: number) => void;
  onHoldSystem: (id: number | null) => void;
  onHoldTG: (id: number | null) => void;
  onAddAvoid: (entry: AvoidEntry) => void;
  onToggleSelectTG: () => void;
  onToggleSearch: () => void;
  /** The select / search panels are open — their buttons read as on. */
  selectOpen?: boolean;
  searchOpen?: boolean;
  /** The current Call's talkgroup is on the avoid list. */
  isAvoided?: boolean;
  /** There is a Call to replay; false greys out Replay. */
  canReplay?: boolean;
  backgroundAudio?: boolean;
  /** What the stream is really doing, not merely what is enabled. */
  streamState?: StreamState;
  onToggleBackgroundAudio?: () => void;
  keypadBeeps?: string;
}

export function ControlToolbar({
  isPaused,
  isLive,
  volume,
  heldSystem,
  heldTG,
  currentCallTgId,
  currentCallSystemId,
  onTogglePause,
  onToggleLive,
  onSkip,
  onReplay,
  onSetVolume,
  onHoldSystem,
  onHoldTG,
  onAddAvoid,
  onToggleSelectTG,
  onToggleSearch,
  selectOpen,
  searchOpen,
  isAvoided,
  canReplay = true,
  backgroundAudio,
  streamState,
  onToggleBackgroundAudio,
  keypadBeeps,
}: ControlToolbarProps) {
  const beep = useCallback(() => {
    if (keypadBeeps) playBeep(keypadBeeps);
  }, [keypadBeeps]);

  const isMuted = volume === 0;
  const isHolding = heldSystem !== null || heldTG !== null;

  const handleAvoid = (minutes: number) => {
    if (!currentCallTgId) return;
    const expiresAt = minutes === 0 ? 0 : Date.now() + minutes * 60 * 1000;
    onAddAvoid({ talkgroupId: currentCallTgId, expiresAt });
  };

  const inertTip = "Not available while background audio is on";

  // Mode buttons: equal widths in one row, wrapping to 3 + 2 when the row
  // is narrower than the labels need. LIVE + BKGND share a double cell.
  const cell = "flex-1 basis-[calc((100%-16px)/3)] @[340px]:basis-0 min-w-0";
  const pair =
    "grow-[2] basis-[calc((100%-16px)/3*2+8px)] @[340px]:basis-0 min-w-0";
  const mode =
    "btn w-full h-11 min-h-11 min-w-0 px-1 gap-1.5 rounded-[4px] border-0 shadow-none text-[11px] sm:text-xs font-bold tracking-[0.1em]";
  const off = "bg-base-300 text-base-content hover:bg-base-300/70";

  return (
    <div className="mt-4">
      {/* Transport — replay, play/pause, skip, centred; volume to the
          left. The three transport buttons act on the local player, which
          is released while the server stream owns playback, so they go
          inert in that mode rather than look available while doing
          nothing. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center">
        <div className="flex items-center gap-1 justify-self-start">
          <button
            className="btn btn-circle btn-ghost w-9 h-9"
            onClick={() => onSetVolume(isMuted ? 0.8 : 0)}
            aria-label={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => onSetVolume(Number(e.target.value))}
            className="range range-xs range-primary w-24 hidden sm:block"
            aria-label="Volume"
          />
        </div>

        <div className="flex items-center gap-[26px]">
          <div
            className="tooltip tooltip-bottom"
            data-tip={backgroundAudio ? inertTip : "Replay"}
          >
            <button
              className="btn btn-circle btn-ghost w-12 h-12"
              disabled={backgroundAudio === true || !canReplay}
              onClick={() => {
                beep();
                onReplay();
              }}
              aria-label="Replay"
            >
              <RotateCcw className="w-[21px] h-[21px]" />
            </button>
          </div>

          <div
            className="tooltip tooltip-bottom"
            data-tip={
              backgroundAudio ? inertTip : isPaused ? "Resume" : "Pause"
            }
          >
            <button
              className="btn btn-circle btn-primary w-16 h-16 border-0"
              disabled={backgroundAudio === true}
              onClick={() => {
                beep();
                onTogglePause();
              }}
              aria-label={isPaused ? "Resume" : "Pause"}
            >
              {isPaused ? (
                <Play className="w-7 h-7" fill="currentColor" />
              ) : (
                <Pause className="w-7 h-7" fill="currentColor" />
              )}
            </button>
          </div>

          <div
            className="tooltip tooltip-bottom"
            data-tip={backgroundAudio ? inertTip : "Skip"}
          >
            <button
              className="btn btn-circle btn-ghost w-12 h-12"
              disabled={backgroundAudio === true}
              onClick={() => {
                beep();
                onSkip();
              }}
              aria-label="Skip"
            >
              <SkipForward className="w-[21px] h-[21px]" />
            </button>
          </div>
        </div>

        <div />
      </div>

      {/* Modes. LIVE and BKGND are two ways of listening, not a control
          plus a mystery switch — joining them makes the choice visible.
          BKGND is mobile-only; on desktop this is just the LIVE button. */}
      <div className="@container mt-4">
        <div className="flex flex-wrap gap-2">
          <div className={onToggleBackgroundAudio ? `join ${pair}` : cell}>
            <div
              className={`tooltip tooltip-bottom ${
                onToggleBackgroundAudio ? "w-1/2" : "w-full"
              }`}
              data-tip="Play in this tab"
            >
              <button
                className={`${mode} ${onToggleBackgroundAudio ? "join-item" : ""} ${
                  isLive && !backgroundAudio ? "btn-success" : off
                }`}
                onClick={() => {
                  beep();
                  onToggleLive();
                }}
                aria-pressed={isLive && !backgroundAudio}
              >
                <Radio className="hidden sm:inline w-3.5 h-3.5" />
                LIVE
              </button>
            </div>

            {onToggleBackgroundAudio && (
              <div
                className="tooltip tooltip-bottom w-1/2"
                data-tip={
                  streamState === "blocked" && backgroundAudio
                    ? "Paused — tap to resume"
                    : "Keeps playing when your screen locks"
                }
              >
                <button
                  className={`${mode} join-item ${
                    backgroundAudio
                      ? streamState === "blocked"
                        ? "btn-warning"
                        : "btn-primary"
                      : off
                  }`}
                  onClick={() => {
                    beep();
                    onToggleBackgroundAudio();
                  }}
                  aria-label="Background audio"
                  aria-pressed={backgroundAudio === true}
                >
                  <Smartphone className="hidden sm:inline w-3.5 h-3.5" />
                  BKGND
                </button>
              </div>
            )}
          </div>

          {/* HOLD is transient UI state the server never sees, so it cannot
            filter the stream — it would look like it worked and silently
            do nothing. */}
          <div className={`dropdown dropdown-top ${cell}`}>
            <div
              tabIndex={backgroundAudio ? -1 : 0}
              role="button"
              aria-label="Hold"
              aria-disabled={backgroundAudio === true}
              title={backgroundAudio ? inertTip : undefined}
              className={`${mode} ${
                backgroundAudio
                  ? "btn-disabled"
                  : isHolding
                    ? "btn-primary"
                    : off
              }`}
            >
              <Lock className="hidden sm:inline w-3.5 h-3.5" />
              HOLD
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content menu p-2 shadow bg-base-200 rounded-box w-48 z-50"
            >
              <li>
                <button
                  onClick={() =>
                    onHoldSystem(
                      heldSystem !== null
                        ? null
                        : (currentCallSystemId ?? null),
                    )
                  }
                >
                  {heldSystem !== null ? "Release System" : "Hold System"}
                </button>
              </li>
              <li>
                <button
                  onClick={() =>
                    onHoldTG(heldTG !== null ? null : (currentCallTgId ?? null))
                  }
                >
                  {heldTG !== null ? "Release Talkgroup" : "Hold Talkgroup"}
                </button>
              </li>
            </ul>
          </div>

          <div className={`dropdown dropdown-top ${cell}`}>
            <div
              tabIndex={0}
              role="button"
              aria-label="Avoid"
              className={`${mode} ${isAvoided ? "btn-primary" : off}`}
            >
              <Ban className="hidden sm:inline w-3.5 h-3.5" />
              AVOID
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content menu p-2 shadow bg-base-200 rounded-box w-44 z-50"
            >
              <li>
                <button onClick={() => handleAvoid(30)}>30 minutes</button>
              </li>
              <li>
                <button onClick={() => handleAvoid(60)}>60 minutes</button>
              </li>
              <li>
                <button onClick={() => handleAvoid(120)}>120 minutes</button>
              </li>
              <li>
                <button onClick={() => handleAvoid(0)}>Permanent</button>
              </li>
            </ul>
          </div>

          <div
            className={`tooltip tooltip-bottom ${cell}`}
            data-tip="Select Talkgroups"
          >
            <button
              className={`${mode} ${selectOpen ? "btn-primary" : off}`}
              onClick={() => {
                beep();
                onToggleSelectTG();
              }}
              aria-expanded={selectOpen === true}
            >
              <List className="hidden sm:inline w-3.5 h-3.5" />
              SELECT
            </button>
          </div>

          <div
            className={`tooltip tooltip-bottom ${cell}`}
            data-tip="Search Calls"
          >
            <button
              className={`${mode} ${searchOpen ? "btn-primary" : off}`}
              onClick={() => {
                beep();
                onToggleSearch();
              }}
              aria-expanded={searchOpen === true}
            >
              <Search className="hidden sm:inline w-3.5 h-3.5" />
              SEARCH
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
