import { useState, useEffect, useCallback, useRef } from "react";
import { adminWsClient } from "@/shared/services/ws/adminClient";

// ─── useWsQuery ─────────────────────────────────────────────────────────────

interface WsQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Hook that fetches data via admin WebSocket.
 * Mirrors RTK Query's useQuery return shape.
 * Re-fetches on mount, when op/params change, on WS connect, and on topic events.
 * Optional pollingInterval (ms) enables periodic auto-refresh.
 * With `skip` nothing is fetched and data stays undefined until it turns off.
 * With `debounceMs`, a burst of topic events refetches once, that long after
 * the last one (for topics that fire on every call).
 */
export function useWsQuery<T>(
  op: string,
  params?: Record<string, unknown>,
  invalidateTopic?: string,
  pollingInterval?: number,
  options?: { skip?: boolean; debounceMs?: number },
): WsQueryResult<T> {
  const debounceMs = options?.debounceMs ?? 0;
  const skip = options?.skip ?? false;
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(!skip);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const paramsKey = JSON.stringify(params ?? null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const doFetch = useCallback(() => {
    if (skip) {
      setIsLoading(false);
      return;
    }
    if (!adminWsClient.isConnected()) return;
    setIsLoading(true);
    adminWsClient
      .request<T>(op, paramsRef.current)
      .then((result) => {
        setData(result);
        setIsError(false);
        setError(null);
      })
      .catch((e: unknown) => {
        setIsError(true);
        setError(e instanceof Error ? e : new Error(String(e)));
      })
      .finally(() => {
        setIsLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op, paramsKey, skip]);

  // Initial fetch + refetch on param/op change
  useEffect(() => {
    doFetch();
  }, [doFetch]);

  // Re-fetch on WS connection
  useEffect(() => {
    return adminWsClient.on("__connected__", () => {
      doFetch();
    });
  }, [doFetch]);

  // Re-fetch on invalidation topic
  useEffect(() => {
    if (!invalidateTopic) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = adminWsClient.on(invalidateTopic, () => {
      if (debounceMs <= 0) {
        doFetch();
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => doFetch(), debounceMs);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [doFetch, invalidateTopic, debounceMs]);

  // Polling interval for periodic refresh
  useEffect(() => {
    if (!pollingInterval || pollingInterval <= 0) return;
    // Coerce the delay to a bounded integer and wrap doFetch in an inline
    // arrow so only a locally-constructed function reference flows into
    // setInterval. setInterval only `eval`s its first argument when given a
    // string; by passing a function literal and a number here we also silence
    // Snyk's taint-through-JSON.stringify false positive.
    const delayMs = Math.max(1, Math.floor(Number(pollingInterval)));
    const id = setInterval(() => {
      doFetch();
    }, delayMs);
    return () => clearInterval(id);
  }, [doFetch, pollingInterval]);

  return { data, isLoading, isError, error, refetch: doFetch };
}

// ─── useWsMutation ──────────────────────────────────────────────────────────

interface MutationResult<TResult> {
  unwrap: () => Promise<TResult>;
}

interface MutationState {
  isLoading: boolean;
  isError: boolean;
}

interface WsMutationOptions<TArg> {
  /** Transform the argument before sending as params. */
  transformArg?: (arg: TArg) => Record<string, unknown>;
  /** Custom timeout in ms (default: REQUEST_TIMEOUT from adminWsClient). */
  timeoutMs?: number;
}

/**
 * Hook that sends a mutation via admin WebSocket.
 * Mirrors RTK Query's useMutation return shape: [trigger, { isLoading }]
 */
export function useWsMutation<TResult = void, TArg = Record<string, unknown>>(
  op: string,
  options?: WsMutationOptions<TArg>,
): [(arg: TArg) => MutationResult<TResult>, MutationState] {
  const [isLoading, setIsLoading] = useState(false);
  const [isError, setIsError] = useState(false);
  const opRef = useRef(op);
  const optionsRef = useRef(options);
  useEffect(() => {
    opRef.current = op;
    optionsRef.current = options;
  });

  const trigger = useCallback((arg: TArg): MutationResult<TResult> => {
    const params = optionsRef.current?.transformArg
      ? optionsRef.current.transformArg(arg)
      : (arg as unknown as Record<string, unknown>);

    setIsLoading(true);
    setIsError(false);

    const promise = adminWsClient
      .request<TResult>(opRef.current, params, optionsRef.current?.timeoutMs)
      .then((result) => {
        setIsLoading(false);
        return result;
      })
      .catch((e: unknown) => {
        setIsLoading(false);
        setIsError(true);
        throw e;
      });

    return {
      unwrap: () => promise,
    };
  }, []);

  return [trigger, { isLoading, isError }];
}

// ─── useLazyWsQuery ─────────────────────────────────────────────────────────

interface LazyQueryState<T> {
  data: T | undefined;
  isFetching: boolean;
  isLoading: boolean;
}

interface LazyQueryResult<T> {
  data: T;
  unwrap: () => Promise<T>;
}

/**
 * Lazy query hook — doesn't fetch until trigger() is called.
 * Mirrors RTK Query's useLazyQuery return shape: [trigger, { data, isFetching }]
 */
export function useLazyWsQuery<TResult, TArg = void>(
  op: string,
  options?: { transformArg?: (arg: TArg) => Record<string, unknown> },
): [(arg: TArg) => LazyQueryResult<TResult>, LazyQueryState<TResult>] {
  const [data, setData] = useState<TResult | undefined>(undefined);
  const [isFetching, setIsFetching] = useState(false);
  const opRef = useRef(op);
  const optionsRef = useRef(options);
  useEffect(() => {
    opRef.current = op;
    optionsRef.current = options;
  });

  const trigger = useCallback((arg: TArg): LazyQueryResult<TResult> => {
    const params = optionsRef.current?.transformArg
      ? optionsRef.current.transformArg(arg)
      : (arg as unknown as Record<string, unknown> | undefined);

    setIsFetching(true);

    const promise = adminWsClient
      .request<TResult>(opRef.current, params ?? undefined)
      .then((result) => {
        setData(result);
        setIsFetching(false);
        return result;
      })
      .catch((e: unknown) => {
        setIsFetching(false);
        throw e;
      });

    return {
      data: undefined as unknown as TResult,
      unwrap: () => promise,
    };
  }, []);

  return [trigger, { data, isFetching, isLoading: isFetching }];
}
