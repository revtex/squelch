import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Search } from "lucide-react";
import {
  ActionButton,
  DetailsPanel,
  FactList,
  PanelSection,
  formatDateTime,
  type Fact,
} from "@/features/admin/_shell";
import type { AdminLog } from "@/types";
import { levelBadge, lineJson, parseLog, relatedLink } from "./logLines";

export interface LogDetailsProps {
  log: AdminLog;
  /** Position in the list, for the newer/older buttons. */
  index: number;
  count: number;
  onMove: (index: number) => void;
  onShowSimilar: (message: string) => void;
  onClose: () => void;
}

/** One server log line in full: attributes, the raw JSON, and where to go next. */
export default function LogDetails({ log, index, count, onMove, onShowSimilar, onClose }: LogDetailsProps) {
  const [copied, setCopied] = useState(false);
  const parsed = parseLog(log);
  const link = relatedLink(log);
  const attrs = Object.entries(log.attrs ?? {});

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lineJson(log));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const facts: Fact[] = [
    { label: "Time", value: formatDateTime(log.dateTime) },
    { label: "Level", value: <span className={`badge badge-sm ${levelBadge(log.level)}`}>{log.level}</span> },
    { label: "Message", value: <span className="break-words">{parsed.summary}</span> },
  ];

  return (
    <DetailsPanel
      title={parsed.isRequest ? `${parsed.method} ${parsed.path}` : log.message}
      titleClassName="break-words text-base"
      subtitle="Server log line"
      onClose={onClose}
    >
      <div className="flex items-center justify-between text-xs text-base-content/60">
        <span>
          Line {index + 1} of {count}
        </span>
        <span className="join">
          <button
            type="button"
            className="btn btn-ghost btn-xs join-item"
            disabled={index <= 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
            Newer
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs join-item"
            disabled={index >= count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
            Older
          </button>
        </span>
      </div>

      <FactList facts={facts} />

      <PanelSection title="Attributes">
        {attrs.length === 0 ? (
          <p className="text-sm text-base-content/60">This line has no attributes.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-box bg-base-200 p-3 font-mono text-xs">
            {attrs.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-base-content/60">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </PanelSection>

      <PanelSection title="Raw">
        <pre className="max-h-60 overflow-auto rounded-box bg-base-200 p-3 font-mono text-xs">{lineJson(log)}</pre>
        <ActionButton
          icon={<Copy className="h-4 w-4" />}
          label={copied ? "Copied" : "Copy as JSON"}
          hint="The line with its attributes, for a bug report."
          onClick={() => void copy()}
        />
      </PanelSection>

      <PanelSection title="Next">
        <ActionButton
          icon={<Search className="h-4 w-4" />}
          label="Show similar lines"
          hint="Searches the log for this message."
          onClick={() => onShowSimilar(log.message)}
        />
        {link && (
          <Link to={link.to} className="btn btn-ghost btn-sm justify-start gap-2">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {link.label}
          </Link>
        )}
      </PanelSection>
    </DetailsPanel>
  );
}
