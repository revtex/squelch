import { useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  DataTable,
  FilterChips,
  formatAgo,
  plural,
  useRetryTranscriptionMutation,
  useToast,
  useTranscriptionJobsQuery,
  type Column,
} from "@/features/admin/_shell";
import type { TranscriptionJob, TranscriptionJobStatus } from "@/types";
import { JOB_STATUS_LABEL, formatSecs, jobTitle } from "./transcription";

export interface JobsTabProps {
  initialFilter: TranscriptionJobStatus | "all";
  failed24h: number;
  queued: number;
  transcribing: boolean;
  onChanged: () => void;
}

type Filter = TranscriptionJobStatus | "all";

function statusBadge(j: TranscriptionJob) {
  const tone: Record<TranscriptionJobStatus, string> = {
    queued: "badge-info",
    done: "badge-success",
    failed: "badge-error",
    skipped: "badge-ghost",
  };
  return <span className={`badge badge-sm ${tone[j.status]}`}>{JOB_STATUS_LABEL[j.status]}</span>;
}

/** What happened to recent calls, with a retry for the ones that failed. */
export default function JobsTab({ initialFilter, failed24h, queued, transcribing, onChanged }: JobsTabProps) {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const { data, isLoading, refetch } = useTranscriptionJobsQuery(filter === "all" ? undefined : filter);
  const [retry] = useRetryTranscriptionMutation();
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const rows = data ?? [];

  const doRetry = async (ids: number[], key: number | "all") => {
    setBusy(key);
    try {
      const r = await retry(ids.length === 1 ? { callId: ids[0] } : { callIds: ids }).unwrap();
      toast.success(`Queued ${plural(r.retried, "call")} again.`);
      refetch();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "The retry failed.");
    } finally {
      setBusy(null);
    }
  };

  const retryable = rows.filter((j) => j.status === "failed" || j.status === "skipped");
  const columns: Column<TranscriptionJob>[] = [
    { id: "call", header: "Call", phone: "title", sortValue: jobTitle, cell: (j) => <span className="font-medium">{jobTitle(j)}</span> },
    { id: "when", header: "When", phone: "show", sortValue: (j) => j.callTime, cell: (j) => formatAgo(j.callTime) },
    {
      id: "result",
      header: "Result",
      phone: "show",
      sortValue: (j) => j.status,
      cell: (j) => (
        <span className="flex flex-wrap items-center gap-2">
          {statusBadge(j)}
          {j.error && <span className="text-xs text-base-content/70">{j.error}</span>}
          {j.status === "done" && j.durationMs > 0 && <span className="text-xs text-base-content/60">{formatSecs(j.durationMs)}</span>}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      phone: "show",
      cell: (j) =>
        j.status === "failed" || j.status === "skipped" ? (
          <button
            type="button"
            className="btn btn-xs"
            disabled={busy != null || !transcribing}
            title={transcribing ? undefined : "Turn transcription on first"}
            onClick={() => void doRetry([j.callId], j.callId)}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All" },
            { id: "failed", label: "Failed", count: failed24h },
            { id: "queued", label: "Queued", count: queued },
            { id: "skipped", label: "Skipped" },
            { id: "done", label: "Done" },
          ]}
        />
        {retryable.length > 1 && (
          <button
            type="button"
            className="btn btn-sm ms-auto"
            disabled={busy != null || !transcribing}
            onClick={() => void doRetry(retryable.map((j) => j.callId), "all")}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retry {plural(retryable.length, "call")}
          </button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(j) => j.callId}
        caption="Recent transcription jobs"
        loading={isLoading && !data}
        defaultSort={{ id: "when", dir: "desc" }}
        rowLabel={jobTitle}
        empty={filter === "all" ? "No calls have been through the transcriber yet." : `No ${JOB_STATUS_LABEL[filter]} jobs.`}
      />
      <p className="text-xs text-base-content/60">Failed counts cover the last 24 hours; the list keeps 30 days.</p>
    </div>
  );
}
