// Building blocks for the Learn section's text.

import type { ReactNode } from "react";
import { Link } from "react-router";

import { IconInfo, IconWarning } from "../components/Icons";
import { CHECKED_ON, SOURCES, type SourceId } from "./sources";

/** A citation: the publisher's name, linking to the official page. */
export function Cite({ id }: { id: SourceId }) {
  const source = SOURCES[id];
  return (
    <a
      className="cite"
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${source.title} (${source.publisher})`}
      data-source={id}
    >
      [{source.publisher}]
    </a>
  );
}

/** A word explained in the glossary. */
export function Term({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link className="learn-term" to={`/learn/glossary#${id}`} data-term={id}>
      {children}
    </Link>
  );
}

export function Callout({
  kind = "strata",
  title,
  children,
}: {
  // "strata": how STRATA does it. "careful": a risk or a trap.
  kind?: "strata" | "careful";
  title?: string;
  children: ReactNode;
}) {
  return (
    <aside className={`callout callout--${kind}`}>
      <p className="callout__title">
        {kind === "careful" ? <IconWarning size={14} /> : <IconInfo size={14} />}
        {title ?? (kind === "careful" ? "Careful" : "How STRATA does it")}
      </p>
      <div>{children}</div>
    </aside>
  );
}

/** A chapter's main points, before it starts. */
export function KeyIdeas({ items }: { items: string[] }) {
  return (
    <aside className="key-ideas" aria-label="In short">
      <p className="key-ideas__title">In short</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return <pre className="formula">{children}</pre>;
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function SourceList({ ids }: { ids: SourceId[] }) {
  return (
    <section className="sources" aria-labelledby="sources">
      <h2 id="sources" className="card__title">
        Sources
      </h2>
      <p className="muted">Official pages only, checked on {CHECKED_ON}. Rules and fees change: follow the links for the current version.</p>
      <ol>
        {ids.map((id) => (
          <li key={id}>
            <a href={SOURCES[id].url} target="_blank" rel="noopener noreferrer">
              {SOURCES[id].title}
            </a>{" "}
            <span className="muted">({SOURCES[id].publisher})</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
