import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/features/admin/_shell";

export interface CopyFieldProps {
  label: string;
  value: string;
  /** Show the value in a multi-line block rather than a one-line field. */
  multiline?: boolean;
  hint?: ReactNode;
}

/** A read-only value with a Copy button, for secrets and commands. */
export default function CopyField({ label, value, multiline = false, hint }: CopyFieldProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <div className="fieldset">
      <div className="flex items-center justify-between gap-2">
        <span className="fieldset-legend">{label}</span>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copy()}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {multiline ? (
        <pre className="max-h-64 overflow-auto rounded-box bg-base-300 p-3 font-mono text-xs whitespace-pre-wrap break-all">
          {value}
        </pre>
      ) : (
        <input
          type="text"
          className="input input-sm w-full font-mono text-xs"
          aria-label={label}
          value={value}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
      {/* block: the label style is a flex row, which would split a hint with a link into columns */}
      {hint && <p className="label block whitespace-normal">{hint}</p>}
    </div>
  );
}
