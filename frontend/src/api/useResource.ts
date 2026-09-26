// Loading data from the API, optionally again and again (polling).
//
// While a new request is in flight the previous answer stays on screen (pages
// dim it slightly) instead of flashing a spinner. Polling pauses while the
// browser tab is hidden and catches up as soon as it is visible again.

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, isAbort } from "./client";

export type Resource<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  // True until the first answer (or failure) arrives.
  loading: boolean;
  // True whenever a request is in flight.
  refreshing: boolean;
  // When `data` last arrived (milliseconds since 1970).
  updatedAt: number | undefined;
  refresh: () => void;
};

type State<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  updatedAt: number | undefined;
  settled: boolean;
  inFlight: boolean;
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const why = error instanceof Error ? error.message : String(error);
  return new ApiError(0, `Something went wrong in the dashboard: ${why}`);
}

/**
 * Load `load()` now, again whenever `key` changes, and every `intervalMs` if given.
 * `key` should describe everything the request depends on (filters, page).
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  intervalMs?: number,
): Resource<T> {
  const [state, setState] = useState<State<T>>({
    data: undefined,
    error: undefined,
    updatedAt: undefined,
    settled: false,
    inFlight: true,
  });
  const [manual, setManual] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let dueWhileHidden = false;

    const run = async () => {
      controller?.abort();
      controller = new AbortController();
      setState((s) => ({ ...s, inFlight: true }));
      try {
        const data = await loadRef.current(controller.signal);
        if (stopped) return;
        setState({ data, error: undefined, updatedAt: Date.now(), settled: true, inFlight: false });
      } catch (error) {
        if (stopped || isAbort(error)) return;
        setState((s) => ({ ...s, error: toApiError(error), settled: true, inFlight: false }));
      }
      schedule();
    };

    const schedule = () => {
      if (!intervalMs || stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.hidden) dueWhileHidden = true;
        else void run();
      }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (!document.hidden && dueWhileHidden) {
        dueWhileHidden = false;
        void run();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void run();
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [key, intervalMs, manual]);

  const refresh = useCallback(() => setManual((n) => n + 1), []);

  return {
    data: state.data,
    error: state.error,
    loading: !state.settled,
    refreshing: state.inFlight,
    updatedAt: state.updatedAt,
    refresh,
  };
}
