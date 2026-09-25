import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity } from "lucide-react";
import {
  PageHeader,
  plural,
  useToast,
  useTranscriptionModelsQuery,
  useTranscriptionStatsQuery,
  useTranscriptionStatusQuery,
  useTranscriptionTestMutation,
} from "@/features/admin/_shell";
import type { TranscriptionJobStatus, TranscriptionStatus } from "@/types";
import JobsTab from "./JobsTab";
import ModelsTab from "./ModelsTab";
import SettingsTab from "./SettingsTab";
import { formatSecs, queueTrend, tabFrom, type Tab } from "./transcription";

const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "models", label: "Models" },
  { id: "jobs", label: "Recent jobs" },
];

function ConnectionBanner({ status, onTest, testing }: { status: TranscriptionStatus; onTest: () => void; testing: boolean }) {
  const parts: string[] = [];
  if (status.connected) {
    parts.push(`Connected to ${status.url}`);
    if (status.version) parts.push(`go-whisper ${status.version}`);
    if (status.model) parts.push(`model ${status.model}`);
    if (status.poolEnabled) parts.push(plural(status.workers, "worker"));
    else parts.push("not transcribing");
  } else if (!status.url) {
    parts.push("No sidecar URL set");
  } else {
    parts.push(`Not connected to ${status.url}`);
    if (status.error) parts.push(status.error);
  }
  return (
    <div
      role="status"
      aria-label="Sidecar connection"
      className={`flex flex-wrap items-center gap-3 rounded-box border px-3 py-2 text-sm ${
        status.connected ? "border-success/30 bg-success/10" : "border-warning/40 bg-warning/10"
      }`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${status.connected ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">{parts.join(" · ")}</span>
      <button type="button" className="btn btn-xs" disabled={testing || !status.url} onClick={onTest}>
        {testing ? "Testing…" : "Test connection"}
      </button>
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: React.ReactNode }) {
  return (
    <div className="rounded-box border border-admin-line bg-base-100 p-3">
      <p className="text-xs text-base-content-dim">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {detail && <p className="text-xs text-base-content-dim">{detail}</p>}
    </div>
  );
}

/** The sidecar's state, the numbers, and the settings, models and jobs. */
export default function TranscriptionPanel() {
  const [search, setSearch] = useSearchParams();
  const tab = tabFrom(search.get("tab"));
  const jobFilter = search.get("status");
  const toast = useToast();

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useTranscriptionStatusQuery();
  const { data: stats, refetch: refetchStats } = useTranscriptionStatsQuery();
  const models = useTranscriptionModelsQuery();
  const [test, { isLoading: testing }] = useTranscriptionTestMutation();
  const [testResult, setTestResult] = useState<string | null>(null);

  const refresh = useCallback(() => {
    refetchStatus();
    refetchStats();
    models.refetch();
  }, [refetchStatus, refetchStats, models]);

  const runTest = async (url?: string): Promise<boolean> => {
    try {
      const r = await test(url ? { url } : {}).unwrap();
      const line = r.ok
        ? `Answered in ${r.latencyMs} ms with ${plural(r.models, "model")}${r.version ? `, go-whisper ${r.version}` : ""}.`
        : `Failed: ${r.error}.`;
      setTestResult(line);
      if (r.ok) toast.success(line);
      else toast.error(line);
      refetchStatus();
      return r.ok;
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : "The test could not run.";
      setTestResult(msg);
      toast.error(msg);
      return false;
    }
  };

  const selectTab = (next: Tab) => {
    const params = new URLSearchParams(search);
    if (next === "settings") params.delete("tab");
    else params.set("tab", next);
    params.delete("status");
    setSearch(params, { replace: true });
  };

  const queue = status?.queueDepth ?? stats?.queueDepth ?? 0;
  // The reading before this one, kept the way React suggests for derived
  // state: adjusted during render when the queue changes.
  const [seenQueue, setSeenQueue] = useState(queue);
  const [prevQueue, setPrevQueue] = useState<number | null>(null);
  if (queue !== seenQueue) {
    setPrevQueue(seenQueue);
    setSeenQueue(queue);
  }
  const trend = queueTrend(queue, prevQueue);
  const workers = Math.max(1, status?.workers ?? 1);
  const behindSec = stats?.avgDurationMs ? Math.round((queue * stats.avgDurationMs) / 1000 / workers) : 0;
  const share = stats && stats.calls24h > 0 ? Math.round((stats.recent24h / stats.calls24h) * 100) : null;

  return (
    <div className="space-y-[18px]">
      <PageHeader
        title="Transcription"
        subtitle={
          <>
            Turn recordings into text with a{" "}
            <a href="https://github.com/mutablelogic/go-whisper" className="link" target="_blank" rel="noreferrer">
              go-whisper
            </a>{" "}
            sidecar. Transcripts show in the scanner and in search.
          </>
        }
      />

      {statusLoading && !status ? (
        <p className="text-sm text-base-content-dim">Loading…</p>
      ) : status ? (
        <ConnectionBanner status={status} onTest={() => void runTest()} testing={testing} />
      ) : null}
      {testResult && (
        <p className="text-xs text-base-content-dim" aria-live="polite">
          Last test: {testResult}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Queue"
          value={status?.poolEnabled ? String(queue) : "off"}
          detail={
            status?.poolEnabled
              ? queue > 0
                ? `${trend}${behindSec ? ` · ~${behindSec} s behind` : ""}`
                : "nothing waiting"
              : "turn on under Settings"
          }
        />
        <Tile label="Transcribed 24 h" value={(stats?.recent24h ?? 0).toLocaleString()} detail={share != null ? `${share}% of calls` : "no calls yet"} />
        <Tile
          label="Avg time per call"
          value={formatSecs(stats?.avgDurationMs ?? 0)}
          detail={stats && stats.minDurationMs > 0 ? `${formatSecs(stats.minDurationMs)} to ${formatSecs(stats.maxDurationMs)}` : undefined}
        />
        <Tile
          label="Failed 24 h"
          value={(stats?.failed24h ?? 0).toLocaleString()}
          detail={
            (stats?.failed24h ?? 0) > 0 ? (
              <Link to="/admin/transcription?tab=jobs&status=failed" className="link">
                Show failures
              </Link>
            ) : stats && stats.skipped24h > 0 ? (
              `${plural(stats.skipped24h, "short call")} skipped`
            ) : (
              "none"
            )
          }
        />
      </div>

      <div role="tablist" aria-label="Transcription sections" className="tabs tabs-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={`tab ${t.id === tab ? "tab-active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {t.id === "models" && models.data && <span className="badge badge-ghost badge-sm ml-2">{models.data.models.length}</span>}
          </button>
        ))}
      </div>

      {tab === "settings" && status && <SettingsTab status={status} onTest={runTest} testing={testing} onSaved={refresh} />}
      {tab === "models" && (
        <ModelsTab
          data={models.data}
          loading={models.isLoading}
          error={models.isError ? (models.error?.message ?? "no answer") : null}
          activeModel={status?.model ?? ""}
          transcribing={status?.poolEnabled ?? false}
          onChanged={refresh}
        />
      )}
      {tab === "jobs" && (
        <JobsTab
          key={jobFilter ?? "all"}
          initialFilter={(jobFilter as TranscriptionJobStatus | null) ?? "all"}
          failed24h={stats?.failed24h ?? 0}
          queued={stats?.queued ?? 0}
          transcribing={status?.poolEnabled ?? false}
          onChanged={refetchStats}
        />
      )}
      {!status && !statusLoading && (
        <p className="flex items-center gap-2 text-sm text-base-content-dim">
          <Activity className="h-4 w-4" aria-hidden="true" />
          The transcription status could not be read.
        </p>
      )}
    </div>
  );
}
