import { useCallback, useState } from "react";

export interface Frozen<T> {
  /** The rows to show: live, or the ones captured when paused. */
  rows: T[];
  paused: boolean;
  /** How many rows arrived since the pause. */
  newCount: number;
  toggle: () => void;
}

/**
 * Pauses a live list so it can be read. While paused the captured rows stay
 * put and the count of newer rows ticks up; resuming shows everything again.
 */
export function useFreeze<T extends { at: number }>(live: T[]): Frozen<T> {
  const [frozen, setFrozen] = useState<{ rows: T[]; at: number } | null>(null);
  const toggle = useCallback(() => {
    setFrozen((cur) => (cur ? null : { rows: live, at: Date.now() }));
  }, [live]);
  if (!frozen) return { rows: live, paused: false, newCount: 0, toggle };
  let newCount = 0;
  for (const row of live) if (row.at > frozen.at) newCount++;
  return { rows: frozen.rows, paused: true, newCount, toggle };
}
