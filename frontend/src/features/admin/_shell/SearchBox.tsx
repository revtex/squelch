import { Search, X } from "lucide-react";

export interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  /** Says what the search covers, e.g. "Search by name or address". */
  label: string;
  className?: string;
}

/** A list page's search field, with a clear button once something is typed. */
export function SearchBox({
  value,
  onChange,
  label,
  className = "",
}: SearchBoxProps) {
  return (
    <label
      className={`input flex items-center gap-2 rounded-md bg-base-200 ${className}`}
    >
      <Search
        className="h-[18px] w-[18px] shrink-0 text-base-content-dim"
        aria-hidden="true"
      />
      <input
        type="search"
        className="grow"
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square -mr-2"
          aria-label="Clear search"
          onClick={() => onChange("")}
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </label>
  );
}
