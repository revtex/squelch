import { useEffect, useState } from "react";

/**
 * Which of the page's sections is in view, for the settings rail. The
 * section nearest the top of the screen wins; clicking a link sets it at
 * once. Without IntersectionObserver (tests, old browsers) the first
 * section, or the last one clicked, stays marked.
 */
export function useActiveSection(ids: readonly string[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(",");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = key
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = els.find((el) => visible.has(el.id));
        if (first) setActive(first.id);
      },
      // The band just under the sticky top bar.
      { rootMargin: "-80px 0px -60% 0px" },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, [key]);

  const current = active !== null && ids.includes(active) ? active : (ids[0] ?? null);
  return [current, setActive];
}
