import { useCallback, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/shared/utils/storage";
import { useAppSelector } from "@/app/store";
import {
  selectToken,
  useGetPreferencesQuery,
  useUpdatePreferencesMutation,
} from "@/features/auth";

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

function setLocal(value: string) {
  current = value;
  writeStored(localStorage, STORAGE_KEY, value);
  listeners.forEach((l) => l());
}

export function labelFor(style: string): string {
  return BEEP_STYLES.find((s) => s.id === style)?.label ?? "Off";
}

/**
 * Whether the keypad makes a sound, and which one.
 *
 * The choice belongs to the listener, not to the admin and not to the
 * browser: signed in, it is stored against the account and follows the
 * person to every browser they sign in on. A listener without an account —
 * this instance allows anonymous listening — has nowhere to keep it but
 * this browser, so that is the fallback, and it is also what holds the
 * choice made before signing in.
 *
 * Nothing chosen is not the same as off: until someone picks a style, the
 * instance's own `keypadBeeps` is followed, so an operator who set the
 * beeps up does not have to set them up twice. From the first pick on, the
 * listener's choice is the only one that counts — including "Off".
 */
export function useKeypadBeeps(serverDefault?: string) {
  const token = useAppSelector(selectToken);
  const { data } = useGetPreferencesQuery(undefined, { skip: !token });
  const [savePreferences] = useUpdatePreferencesMutation();
  const local = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setStyle = useCallback(
    (value: string) => {
      // Written locally either way: it is the anonymous listener's only
      // store, and for a signed-in one it keeps the sound right if the
      // save fails or the network is gone.
      setLocal(value);
      if (token) savePreferences({ keypadBeeps: value });
    },
    [token, savePreferences],
  );

  const style = data?.keypadBeeps ?? local ?? serverDefault ?? "";
  return { style, label: labelFor(style), setStyle };
}
