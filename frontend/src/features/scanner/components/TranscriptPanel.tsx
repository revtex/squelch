import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatElapsed } from "../hooks/usePlaybackPosition";
import type { Call, TranscriptionSegment } from "../types";

/** Shortest span a timeline segment is drawn at, so a one-word reply stays visible. */
const MIN_SPAN_SECONDS = 0.4;

function speakerLabel(speaker: string | undefined): string {
  const match = speaker?.match(/SPEAKER_(\d+)/);
  if (match) return `Speaker ${parseInt(match[1], 10) + 1}`;
  return speaker?.trim() || "Unknown";
}

/** The segment being spoken `position` seconds in: the last one to have
 *  started, so a pause between lines keeps the line just said. */
function currentSegment(
  segments: TranscriptionSegment[],
  position: number,
): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].start <= position) return i;
  }
  return -1;
}

function transcriptNote(
  segments: TranscriptionSegment[],
  diarized: boolean,
): string | null {
  if (diarized) {
    const n = new Set(segments.map((s) => s.speaker).filter(Boolean)).size;
    return n === 1 ? "1 SPEAKER" : `${n} SPEAKERS`;
  }
  if (segments.length === 0) return null;
  return segments.length === 1 ? "1 LINE" : `${segments.length} LINES`;
}

interface TranscriptPanelProps {
  call: Call | null;
  /** Seconds into the Call, while it plays. */
  position: number;
  /** A Call is on the air; off the air nothing is "current". */
  playing: boolean;
}

/**
 * A three-line window onto the transcript that follows the audio, under a
 * strip with one segment per line, sized by how long it runs: heard in the
 * accent, being spoken in the panel's ink, still to come dithered.
 */
export function TranscriptPanel({
  call,
  position,
  playing,
}: TranscriptPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const windowRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const segments = (call?.transcriptSegments ?? []).filter((s) =>
    s.text.trim(),
  );
  const diarized = segments.some((s) => s.speaker);
  const current = playing ? currentSegment(segments, position) : -1;
  const note = call?.transcript ? transcriptNote(segments, diarized) : null;

  // Bring the line being spoken into the window, moving as little as
  // possible, so the transcript creeps up rather than jumping.
  useLayoutEffect(() => {
    const win = windowRef.current;
    const line = current >= 0 ? lineRefs.current[current] : null;
    if (!win || !line) return;
    const top = line.offsetTop;
    const bottom = top + line.offsetHeight;
    if (line.offsetHeight >= win.clientHeight || top < win.scrollTop) {
      win.scrollTop = top;
    } else if (bottom > win.scrollTop + win.clientHeight) {
      win.scrollTop = bottom - win.clientHeight;
    }
  }, [current]);

  // A new Call starts at the top of its transcript.
  useLayoutEffect(() => {
    if (windowRef.current) windowRef.current.scrollTop = 0;
  }, [call?.id]);

  return (
    <div className="border-t border-lcd-border px-3">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 h-12 text-lcd-dim"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide transcript" : "Show transcript"}
      >
        <span className="lcd-label flex-1 text-left">Transcript</span>
        {note && <span className="lcd-label font-normal">{note}</span>}
        {expanded ? (
          <ChevronUp className="w-3 h-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="pb-3">
          {/* The strip keeps its 32px whether or not there are segments to
              draw in it: a transcript arriving must not move the panel. */}
          <div className="flex h-8 items-center gap-0.5" aria-hidden="true">
            {segments.map((seg, i) => {
              const span = Math.max(seg.end - seg.start, MIN_SPAN_SECONDS);
              const fill =
                current === -1
                  ? "lcd-dither-dim"
                  : i === current
                    ? "bg-lcd-fg"
                    : seg.end <= position
                      ? "bg-lcd-accent"
                      : "lcd-dither-dim";
              return (
                <div
                  key={i}
                  className={`h-2 rounded-[1px] ${fill}`}
                  style={{ flexGrow: span, flexBasis: 0 }}
                  title={`${formatElapsed(seg.start)} – ${formatElapsed(seg.end)}`}
                />
              );
            })}
          </div>

          <div
            ref={windowRef}
            className="scrollbar-none relative h-[51px] sm:h-[60px] overflow-y-auto text-xs leading-[17px] sm:text-[13px] sm:leading-5"
          >
            {!call ? null : !call.transcript ? (
              <div className="text-lcd-dim">No transcript</div>
            ) : segments.length > 0 ? (
              segments.map((seg, i) => {
                const lit = current === -1 || i === current;
                return (
                  <div
                    key={i}
                    ref={(el) => {
                      lineRefs.current[i] = el;
                    }}
                    className="flex"
                    aria-current={i === current ? "true" : undefined}
                  >
                    {diarized && (
                      <span className="w-[68px] sm:w-20 shrink-0 truncate text-lcd-dim">
                        {speakerLabel(seg.speaker)}
                      </span>
                    )}
                    <span
                      className={`min-w-0 flex-1 ${lit ? "" : "text-lcd-dim"}`}
                    >
                      {seg.text.trim()}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="whitespace-pre-wrap">
                {call.transcript.trim()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
