import { useCallback, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/shared/utils/storage";

/**
 * The selectable themes, in picker order. Palettes live in index.css and
 * are generated from the mobile app's design tokens, so the web and the
 * app offer the same seven. All are dark: a scanner is read in the dark.
 */
export const THEMES = [
  {
    id: "squelch-midnight",
    label: "Midnight",
    summary: "Blue-black, navy block",
  },
  {
    id: "squelch-graphite",
    label: "Graphite",
    summary: "Cool near-black, brick block",
  },
  {
    id: "squelch-ember",
    label: "Ember",
    summary: "Warm brown-black, rust block",
  },
  { id: "squelch-moss", label: "Moss", summary: "Green-black, forest block" },
  { id: "squelch-plum", label: "Plum", summary: "Violet-black, wine block" },
  {
    id: "squelch-ash",
    label: "Ash",
    summary: "Neutral black, near-monochrome display",
  },
  {
    id: "squelch-classic",
    label: "Squelch classic",
    summary: "The original pale LCD",
  },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME: ThemeId = "squelch-midnight";
const STORAGE_KEY = "squelch-theme";

function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

/** The stored choice, or the default. The retired squelch-dark and
 *  squelch-light values fall back to the default. */
function readTheme(): ThemeId {
  const saved = readStored(localStorage, STORAGE_KEY);
  return isThemeId(saved) ? saved : DEFAULT_THEME;
}

let current: ThemeId | null = null;
const listeners = new Set<() => void>();

function apply(theme: ThemeId) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // Keep the browser chrome (mobile address bar, PWA title bar) on the
  // page colour rather than a fixed green.
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  const base = getComputedStyle(root)
    .getPropertyValue("--color-base-100")
    .trim();
  if (meta && base) meta.content = base;
}

/** Applies the stored theme to <html>. Called once at start-up so every
 *  route — admin and login included — renders in the chosen palette. */
export function applyStoredTheme() {
  current = readTheme();
  apply(current);
}

function getSnapshot(): ThemeId {
  if (current === null) current = readTheme();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The active theme and a setter; the choice is per browser. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setTheme = useCallback((next: ThemeId) => {
    current = next;
    apply(next);
    writeStored(localStorage, STORAGE_KEY, next);
    listeners.forEach((l) => l());
  }, []);

  const label = THEMES.find((t) => t.id === theme)?.label ?? "";

  return { theme, label, setTheme, themes: THEMES };
}
