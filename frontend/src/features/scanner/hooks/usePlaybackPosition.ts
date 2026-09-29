import { useEffect, useState } from "react";
import { audioPlayer } from "@/shared/services/audio/player";

/**
 * Seconds into the Call now playing, sampled at ~10 Hz while `active`.
 * Reads 0 while nothing plays, so a finished Call does not leave the
 * display claiming a position in it.
 */
export function usePlaybackPosition(active: boolean): number {
  const [position, setPosition] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (audioPlayer.isPlaying()) {
        setPosition(audioPlayer.getPlaybackTime());
      }
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  return active ? position : 0;
}

/** `m:ss` into a transmission — elapsed time, not a wall clock. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}
