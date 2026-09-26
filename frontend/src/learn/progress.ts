// How far the reader has got in the Learn section: which chapters were opened
// and each quiz's score. It lives in this browser only (localStorage). It is a
// convenience, so if the browser won't store it, everything still works; the
// progress just isn't remembered.

import { useCallback, useMemo, useSyncExternalStore } from "react";

export type ChapterProgress = {
  opened?: boolean;
  quiz?: { correct: number; total: number };
};

export type Progress = Record<string, ChapterProgress>;

export const PROGRESS_KEY = "strata.learn.progress";

const listeners = new Set<() => void>();
// Kept in memory instead when the browser refuses to store anything.
let fallback: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PROGRESS_KEY);
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROGRESS_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Only well-formed entries survive: the store may hold anything. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const progress: Progress = {};
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const entry = value as Record<string, unknown>;
    const out: ChapterProgress = {};
    if (entry.opened === true) out.opened = true;
    const quiz = entry.quiz as Record<string, unknown> | undefined;
    if (
      quiz &&
      Number.isInteger(quiz.correct) &&
      Number.isInteger(quiz.total) &&
      (quiz.total as number) > 0 &&
      (quiz.correct as number) >= 0 &&
      (quiz.correct as number) <= (quiz.total as number)
    ) {
      out.quiz = { correct: quiz.correct as number, total: quiz.total as number };
    }
    progress[id] = out;
  }
  return progress;
}

function write(next: Progress) {
  const text = JSON.stringify(next);
  try {
    window.localStorage.setItem(PROGRESS_KEY, text);
  } catch {
    // Not stored: keep it for this visit only.
    fallback = text;
  }
  listeners.forEach((listener) => listener());
}

export function useLearnProgress() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const progress = useMemo(() => parseProgress(raw), [raw]);
  const update = useCallback((id: string, change: (current: ChapterProgress) => ChapterProgress) => {
    const current = parseProgress(readRaw());
    write({ ...current, [id]: change(current[id] ?? {}) });
  }, []);
  const markOpened = useCallback(
    (id: string) => {
      if (!parseProgress(readRaw())[id]?.opened) update(id, (c) => ({ ...c, opened: true }));
    },
    [update],
  );
  const recordQuiz = useCallback(
    (id: string, correct: number, total: number) => update(id, (c) => ({ ...c, opened: true, quiz: { correct, total } })),
    [update],
  );
  const clear = useCallback(() => {
    fallback = null;
    try {
      window.localStorage.removeItem(PROGRESS_KEY);
    } catch {
      // Nothing stored anyway.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return { progress, markOpened, recordQuiz, clear };
}
