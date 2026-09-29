import type { AddressPlace } from "@/types";

let regionNames: Intl.DisplayNames | null = null;

/** "Germany" for "DE"; the code itself if the browser does not know it. */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The flag emoji for a two-letter code, built from regional indicators. */
export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const base = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => base + c.charCodeAt(0)),
  );
}

/** Text a search box can match a row's place against. */
export function placeText(p: AddressPlace): string {
  if (p.local) return "local network";
  if (!p.country) return "";
  return `${p.country} ${countryName(p.country)}`.toLowerCase();
}
