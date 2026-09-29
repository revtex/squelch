import { useState, useEffect, useCallback, useRef } from "react";
import { adminWsClient } from "@/shared/services/ws/adminClient";
import type { AdminAuditRow, AdminLog } from "@/types";

export interface LogQueryParams {
  /** How far back to read, in seconds; the bound is computed at fetch time. */
  sinceSeconds?: number;
  level?: string;
  q?: string;
  limit?: number;
}

const LIVE_POLL_MS = 5_000;
const DEBOUNCE_MS = 2_000;

interface QueryState<R> {
  data: R | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
}

function useWsQuery<R>(op: string, params: LogQueryParams, following: boolean, paused: boolean): QueryState<R> {
  const [data, setData] = useState<R | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchRows = useCallback(async () => {
    if (!adminWsClient.isConnected()) return;
    setIsFetching(true);
    try {
      const { sinceSeconds, ...rest } = paramsRef.current;
      const request: Record<string, unknown> = { ...rest };
      if (sinceSeconds !== undefined) request.from = Math.floor(Date.now() / 1000) - sinceSeconds;
      const result = await adminWsClient.request<R>(op, request);
      setData(result);
    } catch {
      // The socket layer reports outages; a failed poll just keeps the last rows.
    } finally {
      setIsLoading(false);
      setIsFetching(false);
    }
  }, [op]);

  const paramsKey = `${params.sinceSeconds ?? ""}|${params.level ?? ""}|${params.q ?? ""}|${params.limit ?? ""}`;
  useEffect(() => {
    void fetchRows();
  }, [fetchRows, paramsKey]);

  useEffect(() => adminWsClient.on("__connected__", () => void fetchRows()), [fetchRows]);

  useEffect(() => {
    if (!following) return;
    const tick = () => {
      if (!pausedRef.current) void fetchRows();
    };
    const interval = setInterval(tick, LIVE_POLL_MS);
    const unsub = adminWsClient.on("activity.updated", () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(tick, DEBOUNCE_MS);
    });
    return () => {
      clearInterval(interval);
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [following, fetchRows]);

  return { data, isLoading, isFetching, refetch: fetchRows };
}

/** The server's in-memory log, newest first. */
export function useAdminLogs(params: LogQueryParams, following: boolean, paused = false) {
  const q = useWsQuery<AdminLog[]>("logs.query", params, following, paused);
  return { logs: q.data, isLoading: q.isLoading, isFetching: q.isFetching, refetch: q.refetch };
}

/** The audit trail from the logs table, newest first. */
export function useAuditTrail(params: LogQueryParams, following: boolean, paused = false) {
  const q = useWsQuery<AdminAuditRow[]>("logs.audit", params, following, paused);
  return { rows: q.data, isLoading: q.isLoading, isFetching: q.isFetching, refetch: q.refetch };
}

export interface LogLevelCounts {
  all: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
}

/**
 * The server log counted by level over the range and search, whatever the
 * level filter and row limit: the chips' totals.
 */
export function useLogCounts(params: Pick<LogQueryParams, "sinceSeconds" | "q">, following: boolean, paused = false) {
  return useWsQuery<LogLevelCounts>("logs.counts", params, following, paused).data;
}
