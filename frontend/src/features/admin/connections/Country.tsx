import type { ReactNode } from "react";
import { House } from "lucide-react";
import type { AddressPlace, GeoIPInfo } from "@/types";
import { countryFlag, countryName } from "./place";
import type { HistoryLink } from "./types";

export function CountryCell({ place }: { place: AddressPlace }) {
  if (place.local) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-base-content-dim">
        <House className="h-3.5 w-3.5" aria-hidden="true" />
        Local network
      </span>
    );
  }
  if (!place.country) {
    return <span className="text-admin-dim2">-</span>;
  }
  const name = countryName(place.country);
  return (
    <span className="text-sm sm:whitespace-nowrap" title={place.country}>
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
    <p className="text-xs text-admin-dim2">
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

/** The address, a "trusted" tag, and where it is when GeoIP is on. */
export function AddressCell({
  ip,
  trusted,
  place,
  onShowHistory,
}: {
  ip: string | null;
  trusted: boolean;
  place: ReactNode;
  onShowHistory: HistoryLink;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {ip ? (
          <button
            type="button"
            className="link link-hover break-all text-left font-mono"
            onClick={() => onShowHistory({ ip })}
            title={`Show connection history for ${ip}`}
          >
            {ip}
          </button>
        ) : (
          <span className="text-admin-dim2">-</span>
        )}
        {trusted && (
          <span
            className="badge"
            title="On the server's trusted list: can never be blocked"
          >
            trusted
          </span>
        )}
      </div>
      {place && <div className="text-xs text-base-content-dim">{place}</div>}
    </>
  );
}
