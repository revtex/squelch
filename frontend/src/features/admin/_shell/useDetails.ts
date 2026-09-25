import { useCallback, useRef, useState } from "react";

export interface DetailsState<T> {
  /** What the panel is showing, or null when it is closed. */
  selected: T | null;
  /** Show `selection`; `trigger` gets focus back when the panel closes. */
  open: (selection: T, trigger?: HTMLElement | null) => void;
  /** Swap what is shown without touching the remembered trigger. */
  replace: (selection: T) => void;
  /** Close and return focus to the trigger, if it is still on the page. */
  close: () => void;
  /** Close without moving focus, e.g. when the page changes tab. */
  reset: () => void;
}

/**
 * The state behind a details panel: what is open and where focus goes when
 * it closes. One per page; the page renders the panel when `selected` is set.
 */
export function useDetails<T>(): DetailsState<T> {
  const [selected, setSelected] = useState<T | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  const open = useCallback((selection: T, el?: HTMLElement | null) => {
    trigger.current = el ?? null;
    setSelected(selection);
  }, []);

  const replace = useCallback((selection: T) => {
    setSelected(selection);
  }, []);

  const close = useCallback(() => {
    setSelected(null);
    if (trigger.current?.isConnected) trigger.current.focus();
    trigger.current = null;
  }, []);

  const reset = useCallback(() => {
    setSelected(null);
    trigger.current = null;
  }, []);

  return { selected, open, replace, close, reset };
}
