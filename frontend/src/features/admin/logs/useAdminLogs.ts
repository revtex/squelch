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

interface QueryState<T> {
  rows: T[] | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
}

function useWsRows<T>(op: string, params: LogQueryParams, following: boolean, paused: boolean): QueryState<T> {
  const [rows, setRows] = useState<T[] | null>(null);
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
      const result = await adminWsClient.request<T[]>(op, request);
      setRows(result);
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

  return { rows, isLoading, isFetching, refetch: fetchRows };
}

/** The server's in-memory log, newest first. */
export function useAdminLogs(params: LogQueryParams, following: boolean, paused = false) {
  const q = useWsRows<AdminLog>("logs.query", params, following, paused);
  return { logs: q.rows, isLoading: q.isLoading, isFetching: q.isFetching, refetch: q.refetch };
}

/** The audit trail from the logs table, newest first. */
export function useAuditTrail(params: LogQueryParams, following: boolean, paused = false) {
  const q = useWsRows<AdminAuditRow>("logs.audit", params, following, paused);
  return { rows: q.rows, isLoading: q.isLoading, isFetching: q.isFetching, refetch: q.refetch };
}

export function useAdminLogLevel() {
  const [level, setLevel] = useState<string>("info");

  const fetchLevel = useCallback(async () => {
    if (!adminWsClient.isConnected()) return;
    try {
      const result = await adminWsClient.request<{ level: string }>("logs.level");
      setLevel(result.level);
    } catch {
      // Keep the last known level.
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchLevel();
    });
    const unsubConnect = adminWsClient.on("__connected__", () => void fetchLevel());
    const unsubConfig = adminWsClient.on("config.updated", () => void fetchLevel());
    return () => {
      unsubConnect();
      unsubConfig();
    };
  }, [fetchLevel]);

  return { level, refetch: fetchLevel };
}
