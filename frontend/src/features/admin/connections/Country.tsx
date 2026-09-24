import { House } from "lucide-react";
import type { AddressPlace, GeoIPInfo } from "@/types";
import { countryFlag, countryName } from "./place";

export function CountryCell({ place }: { place: AddressPlace }) {
  if (place.local) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-base-content/70">
        <House className="h-3.5 w-3.5" aria-hidden="true" />
        Local network
      </span>
    );
  }
  if (!place.country) {
    return <span className="text-base-content/50">-</span>;
  }
  const name = countryName(place.country);
  return (
    <span className="whitespace-nowrap text-sm" title={place.country}>
      <span aria-hidden="true" className="mr-1">
        {countryFlag(place.country)}
      </span>
      {name}
    </span>
  );
}

/** The credit the country database's licence asks for, under the table. */
export function GeoIPCredit({ geoip }: { geoip: GeoIPInfo | undefined }) {
  if (!geoip?.enabled || !geoip.credit) return null;
  return (
    <p className="text-xs text-base-content/50">
      Countries:{" "}
      <a
        href={geoip.credit.url}
        className="link link-hover"
        target="_blank"
        rel="noopener noreferrer"
      >
        {geoip.credit.text}
      </a>
    </p>
  );
}
