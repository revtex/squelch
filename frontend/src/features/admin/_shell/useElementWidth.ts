import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The rendered width of an element in CSS pixels, kept current as it
 * resizes, so an SVG can be drawn at its real size instead of scaled (which
 * would grow its text with the box). 0 until measured, and always 0 where
 * ResizeObserver is missing (tests), so callers need a fallback width.
 */
export function useElementWidth<T extends Element>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // The observer reports once on observe, then on every size change.
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
