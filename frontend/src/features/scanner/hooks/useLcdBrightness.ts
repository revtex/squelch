import { useCallback, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/shared/utils/storage";

// The key predates the squelch- prefix; kept so saved values survive.
const STORAGE_KEY = "lcd-brightness";
const DEFAULT_BRIGHTNESS = 100;

let current: number | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): number {
  if (current === null) {
    const saved = Number(readStored(localStorage, STORAGE_KEY));
    current = saved >= 20 && saved <= 120 ? saved : DEFAULT_BRIGHTNESS;
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The display's brightness, as a CSS brightness() percentage. Shared
 * between the menu that sets it and the display that draws with it.
 */
export function useLcdBrightness() {
  const brightness = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setBrightness = useCallback((value: number) => {
    current = value;
    writeStored(localStorage, STORAGE_KEY, String(value));
    listeners.forEach((l) => l());
  }, []);
  return { brightness, setBrightness };
}
