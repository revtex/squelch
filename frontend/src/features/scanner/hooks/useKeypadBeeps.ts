import { useCallback, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/shared/utils/storage";

const STORAGE_KEY = "squelch-keypad-beeps";

/** Off first: the reason to open this list is usually to stop the noise. */
export const BEEP_STYLES = [
  { id: "disabled", label: "Off" },
  { id: "uniden", label: "Uniden" },
  { id: "whistler", label: "Whistler" },
] as const;

// undefined = not read yet, null = nothing has been chosen on this browser.
let current: string | null | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): string | null {
  if (current === undefined) {
    current = readStored(localStorage, STORAGE_KEY);
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function labelFor(style: string): string {
  return BEEP_STYLES.find((s) => s.id === style)?.label ?? "Off";
}

/**
 * Whether the keypad makes a sound, and which one — a per-browser choice,
 * as it is on the phone.
 *
 * Nothing chosen is not the same as off: until someone picks a style here,
 * the server's own `keypadBeeps` is followed, so an instance that set the
 * beeps up for its listeners does not have to set them up twice. From the
 * first pick on, this browser's choice is the only one that counts.
 */
export function useKeypadBeeps(serverDefault?: string) {
  const chosen = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setStyle = useCallback((value: string) => {
    current = value;
    writeStored(localStorage, STORAGE_KEY, value);
    listeners.forEach((l) => l());
  }, []);
  const style = chosen ?? serverDefault ?? "";
  return { style, label: labelFor(style), setStyle };
}
