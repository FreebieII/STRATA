// Small building blocks shared by the pages.

import { useState, type ReactNode } from "react";

import type { ApiError } from "../api/client";
import { formatAgo, formatDateTime, formatTime, formatUtc } from "../lib/format";
import { IconChevronDown, IconChevronRight, IconCritical, IconRefresh } from "./Icons";

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1>{title}</h1>
        {description ? <p className="page-header__description">{description}</p> : null}
      </div>
      {children ? <div className="page-header__actions">{children}</div> : null}
    </header>
  );
}

export function Card({
  title,
  action,
  children,
  className = "",
  busy = false,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  // Dims the content while newer data is on its way ("refetch keeps the frame").
  busy?: boolean;
}) {
  return (
    <section className={`card ${className}`} aria-busy={busy || undefined}>
      {title || action ? (
        <div className="card__head">
          {title ? <h2 className="card__title">{title}</h2> : <span />}
          {action ? <div className="card__action">{action}</div> : null}
        </div>
      ) : null}
      <div className={`card__body${busy ? " is-busy" : ""}`}>{children}</div>
    </section>
  );
}

/** "Updated 14:03:05" plus a refresh button. */
export function RefreshControl({
  updatedAt,
  refreshing,
  onRefresh,
  every,
}: {
  updatedAt: number | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  every?: string;
}) {
  return (
    <div className="refresh">
      <span className="refresh__text" aria-live="polite">
        {updatedAt ? `Updated ${formatTime(updatedAt)}` : refreshing ? "Loading…" : "Not loaded"}
        {every ? <span className="refresh__every"> · every {every}</span> : null}
      </span>
      <button
        type="button"
        className={`button button--ghost button--icon${refreshing ? " is-spinning" : ""}`}
        onClick={onRefresh}
        aria-label="Refresh now"
        title="Refresh now"
      >
        <IconRefresh size={16} />
      </button>
    </div>
  );
}

export function ErrorNotice({ error, title }: { error: ApiError; title?: string }) {
  return (
    <div className="notice notice--critical" role="alert">
      <span className="notice__icon">
        <IconCritical size={18} />
      </span>
      <div>
        <p className="notice__title">{title ?? "Couldn't load this"}</p>
        <p className="notice__text">{error.message}</p>
        {error.status === 503 ? (
          <p className="notice__hint">The dashboard keeps trying on its own.</p>
        ) : null}
      </div>
    </div>
  );
}

export function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: "neutral" | "good" | "warning" | "serious" | "critical";
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`notice notice--${tone}`}>
      <span className="notice__icon">{icon}</span>
      <div>
        <p className="notice__title">{title}</p>
        {children ? <div className="notice__text">{children}</div> : null}
      </div>
    </div>
  );
}

/** A time in the viewer's zone; hover for the exact UTC time. */
export function Time({ value, relative = false }: { value: string; relative?: boolean }) {
  return (
    <time className="time" dateTime={value} title={formatUtc(value)}>
      {relative ? formatAgo(value) : formatDateTime(value)}
    </time>
  );
}

/** Pretty-printed JSON. Rendered as text, so nothing in it can run. */
export function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return <pre className="json">{text === "{}" ? "(no details)" : text}</pre>;
}

/** A button that shows and hides a row's details. */
export function DisclosureButton({
  open,
  onToggle,
  controls,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
}) {
  return (
    <button
      type="button"
      className="button button--ghost button--icon disclosure"
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? `Hide details of ${label}` : `Show details of ${label}`}
      onClick={onToggle}
    >
      {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
    </button>
  );
}

export function useToggleSet(): [Set<number>, (id: number) => void] {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [open, toggle];
}

export function KeyValues({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([name, value], i) => (
        <div className="kv__row" key={i}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
