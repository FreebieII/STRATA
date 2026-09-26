// One shared poll of GET /system/status for every page that needs it (the
// PAPER/LIVE banner, overview, system and risk pages), plus a short history
// for the overview's sparklines: each health check's response time, and how
// long the API took to answer this browser.
//
// The history is kept only in this browser tab, from the moment it opened:
// the API does not store these readings.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import { api, ApiError, isAbort } from "./client";
import type { CheckDetail, SystemStatus } from "./types";
import { useResource, type Resource } from "./useResource";

export const STATUS_INTERVAL_MS = 15_000;
export const HISTORY_LENGTH = 40; // 10 minutes at one reading every 15 seconds

export type Sample = {
  at: number;
  // null when the check failed or no reading could be taken.
  latencyMs: number | null;
  // true/false: the check's result; null: the API itself couldn't be asked.
  ok: boolean | null;
};

export type History = Record<string, Sample[]>;

type Value = {
  status: Resource<SystemStatus>;
  // Per health check, by name.
  history: History;
  // Round trips from this browser to the API and back.
  roundTrips: Sample[];
};

const StatusContext = createContext<Value | null>(null);

export function addReadings(history: History, at: number, checks: CheckDetail[]): History {
  const next: History = { ...history };
  for (const check of checks) {
    const sample = { at, latencyMs: check.ok ? check.latency_ms : null, ok: check.ok };
    next[check.name] = [...(history[check.name] ?? []), sample].slice(-HISTORY_LENGTH);
  }
  return next;
}

export function addGap(history: History, at: number): History {
  const next: History = {};
  for (const [name, samples] of Object.entries(history)) {
    next[name] = [...samples, { at, latencyMs: null, ok: null }].slice(-HISTORY_LENGTH);
  }
  return next;
}

export function addRoundTrip(samples: Sample[], sample: Sample): Sample[] {
  return [...samples, sample].slice(-HISTORY_LENGTH);
}

export function SystemStatusProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<History>({});
  const [roundTrips, setRoundTrips] = useState<Sample[]>([]);

  const load = useCallback(async (signal: AbortSignal) => {
    const started = performance.now();
    const took = () => Math.round((performance.now() - started) * 10) / 10;
    try {
      const status = await api.status(signal);
      const ms = took();
      const at = Date.now();
      setHistory((h) => addReadings(h, at, status.checks));
      setRoundTrips((r) => addRoundTrip(r, { at, latencyMs: ms, ok: true }));
      return status;
    } catch (error) {
      if (!isAbort(error)) {
        const ms = took();
        const at = Date.now();
        // An HTTP error still answered (in some time); no answer at all is a gap.
        const answered = error instanceof ApiError && error.status > 0;
        setHistory((h) => addGap(h, at));
        setRoundTrips((r) =>
          addRoundTrip(r, { at, latencyMs: answered ? ms : null, ok: answered ? false : null }),
        );
      }
      throw error;
    }
  }, []);

  const status = useResource("system-status", load, STATUS_INTERVAL_MS);
  return <StatusContext value={{ status, history, roundTrips }}>{children}</StatusContext>;
}

export function useSystemStatus(): Value {
  const value = useContext(StatusContext);
  if (value === null) throw new Error("useSystemStatus() needs a <SystemStatusProvider>");
  return value;
}
