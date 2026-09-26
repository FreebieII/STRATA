// The filter row above a list, and paging through it (newest first).

import { useCallback, useEffect, useId, useState } from "react";

import { NAME_PATTERN } from "../api/client";
import { IconChevronLeft, IconChevronRight } from "./Icons";

/** A text filter for names like `login_failed`: applied when valid, after a pause. */
export function NameFilter({
  label,
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  suggestions: string[];
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const listId = useId();
  const hintId = useId();
  const trimmed = draft.trim();
  const valid = trimmed === "" || NAME_PATTERN.test(trimmed);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (!valid || trimmed === (value ?? "")) return undefined;
    const timer = window.setTimeout(() => onChange(trimmed || null), 400);
    return () => window.clearTimeout(timer);
  }, [trimmed, valid, value, onChange]);

  return (
    <label className="field field--inline">
      <span className="field__label">{label}</span>
      <input
        className="input input--mono"
        value={draft}
        list={listId}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="none"
        maxLength={64}
        aria-invalid={!valid || undefined}
        aria-describedby={!valid ? hintId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) onChange(trimmed || null);
          if (e.key === "Escape") onChange(null);
        }}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {!valid ? (
        <span className="field__hint field__hint--problem" id={hintId}>
          Lowercase letters, digits and . _ - only
        </span>
      ) : null}
    </label>
  );
}

/** A row of mutually exclusive choices; `null` is "all". */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T | null; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="field field--inline">
      <span className="field__label" id={`seg-${label}`}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={`seg-${label}`}>
        {options.map((option) => (
          <button
            key={option.value ?? "all"}
            type="button"
            className={`segmented__option${option.value === value ? " is-selected" : ""}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Paging for newest-first lists. The API pages with `before_id`; the stack of
 * cursors already visited makes "Newer" possible.
 */
export function usePager(beforeId: number | null, setBeforeId: (id: number | null) => void) {
  const [visited, setVisited] = useState<(number | null)[]>([]);
  const reset = useCallback(() => setVisited([]), []);
  return {
    canGoNewer: beforeId !== null,
    older: (nextBeforeId: number) => {
      setVisited((v) => [...v, beforeId]);
      setBeforeId(nextBeforeId);
    },
    newer: () => {
      const previous = visited.length ? visited[visited.length - 1] ?? null : null;
      setVisited((v) => v.slice(0, -1));
      setBeforeId(previous);
    },
    newest: () => {
      setVisited([]);
      setBeforeId(null);
    },
    reset,
    pageNumber: visited.length + 1,
    knowsPosition: beforeId === null || visited.length > 0,
  };
}

export function Pager({
  pager,
  nextBeforeId,
  count,
  noun,
}: {
  pager: ReturnType<typeof usePager>;
  nextBeforeId: number | null | undefined;
  count: number;
  noun: string;
}) {
  return (
    <nav className="pager" aria-label={`Pages of ${noun}`}>
      <span className="pager__where">
        {pager.knowsPosition ? `Page ${pager.pageNumber}` : "Older page"} · {count} {noun}
      </span>
      <div className="pager__buttons">
        <button type="button" className="button button--small" onClick={pager.newest} disabled={!pager.canGoNewer}>
          Newest
        </button>
        <button type="button" className="button button--small" onClick={pager.newer} disabled={!pager.canGoNewer}>
          <IconChevronLeft size={14} />
          <span>Newer</span>
        </button>
        <button
          type="button"
          className="button button--small"
          onClick={() => nextBeforeId && pager.older(nextBeforeId)}
          disabled={!nextBeforeId}
        >
          <span>Older</span>
          <IconChevronRight size={14} />
        </button>
      </div>
    </nav>
  );
}
