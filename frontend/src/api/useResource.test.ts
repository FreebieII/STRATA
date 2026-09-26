import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { addGap, addReadings, addRoundTrip, HISTORY_LENGTH } from "./SystemStatusContext";
import { useResource } from "./useResource";

describe("useResource", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads, then polls at the interval", async () => {
    let n = 0;
    const load = vi.fn(async () => ++n);
    const { result } = renderHook(() => useResource("k", load, 1000));
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(result.current.loading).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the last answer on screen when a refresh fails", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new ApiError(503, "The database is unavailable.");
      return "fine";
    });
    const { result } = renderHook(() => useResource("k", load));
    await waitFor(() => expect(result.current.data).toBe("fine"));
    fail = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.error?.status).toBe(503));
    expect(result.current.data).toBe("fine");
  });

  it("loads again when the key changes, keeping the old answer meanwhile", async () => {
    let release: (value: string) => void = () => undefined;
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((resolve) => {
          release = resolve;
          signal.addEventListener("abort", () => resolve("aborted"));
        }),
    );
    const { result, rerender } = renderHook(({ k }) => useResource(k, load), {
      initialProps: { k: "a" },
    });
    act(() => release("first"));
    await waitFor(() => expect(result.current.data).toBe("first"));
    rerender({ k: "b" });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.data).toBe("first");
    act(() => release("second"));
    await waitFor(() => expect(result.current.data).toBe("second"));
  });

  it("aborts the request in flight when the page goes away", async () => {
    let seen: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => {
      seen = signal;
      return new Promise<string>(() => undefined);
    });
    const { unmount } = renderHook(() => useResource("k", load, 1000));
    await waitFor(() => expect(seen).toBeDefined());
    unmount();
    expect(seen?.aborted).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("waits while the tab is hidden and catches up when it is shown", async () => {
    let n = 0;
    const load = vi.fn(async () => ++n);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const { result } = renderHook(() => useResource("k", load, 1000));
    await waitFor(() => expect(result.current.data).toBe(1));
    hidden.mockReturnValue(true);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(load).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.data).toBe(2));
  });
});

describe("reading history", () => {
  const checks = [
    { name: "database", ok: true, detail: "reachable", latency_ms: 2 },
    { name: "redis", ok: false, detail: "ConnectionError: refused", latency_ms: null },
  ];

  it("records each check, and a failed check as no value", () => {
    const history = addReadings({}, 1, checks);
    expect(history.database).toEqual([{ at: 1, latencyMs: 2, ok: true }]);
    expect(history.redis).toEqual([{ at: 1, latencyMs: null, ok: false }]);
  });

  it("records 'no reading' for every check when the API couldn't be asked", () => {
    const history = addGap(addReadings({}, 1, checks), 2);
    expect(history.database?.[1]).toEqual({ at: 2, latencyMs: null, ok: null });
    expect(history.redis?.[1]).toEqual({ at: 2, latencyMs: null, ok: null });
  });

  it("keeps only the newest readings", () => {
    let history = {};
    let trips: { at: number; latencyMs: number | null; ok: boolean | null }[] = [];
    for (let at = 0; at < HISTORY_LENGTH + 5; at++) {
      history = addReadings(history, at, checks);
      trips = addRoundTrip(trips, { at, latencyMs: 1, ok: true });
    }
    const database = (history as Record<string, { at: number }[]>).database!;
    expect(database).toHaveLength(HISTORY_LENGTH);
    expect(database[0]?.at).toBe(5);
    expect(trips).toHaveLength(HISTORY_LENGTH);
  });
});
