import { useEffect, useRef, useState } from "react";

/** Sections are read from this far below the top of the screen, under the sticky top bar. */
const LINE = 96;
/** After a click, scroll updates wait this long so the page can scroll to the clicked group. */
const CLICK_HOLD_MS = 1000;

/**
 * Picks the section being read: the last one whose top has passed the line
 * under the top bar. At the very bottom of the page the last section wins,
 * since a short last group can never reach the line.
 */
export function pickSection(tops: readonly number[], atBottom: boolean, line = LINE): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let pick = 0;
  tops.forEach((top, i) => {
    if (top <= line) pick = i;
  });
  return pick;
}

/**
 * Which of the page's sections is in view, for the settings rail. It follows
 * the window's scroll; clicking a link marks that section at once. Before
 * any scroll the first section is marked.
 */
export function useActiveSection(ids: readonly string[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  const clickedAt = useRef(0);
  const key = ids.join(",");

  useEffect(() => {
    const list = key ? key.split(",") : [];
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() - clickedAt.current < CLICK_HOLD_MS) return;
      const els = list.map((id) => document.getElementById(id));
      const present = els.flatMap((el) => (el ? [el] : []));
      const doc = document.documentElement;
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2;
      const i = pickSection(
        present.map((el) => el.getBoundingClientRect().top),
        atBottom,
      );
      if (i >= 0) setActive(present[i].id);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [key]);

  const choose = (id: string) => {
    clickedAt.current = Date.now();
    setActive(id);
  };

  const current = active !== null && ids.includes(active) ? active : (ids[0] ?? null);
  return [current, choose];
}
