// The Learn section: how trading works, and how STRATA does it.

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Link, useLocation, useParams } from "react-router";

import { IconGood } from "../components/Icons";
import { PageHeader } from "../components/Parts";
import { NotFoundPage } from "../pages/UpcomingPage";
import { MARKETS_SOURCES, MarketsChapter } from "./chapters/Markets";
import { ORDERS_SOURCES, OrdersChapter } from "./chapters/Orders";
import { RISK_SOURCES, RiskChapter } from "./chapters/Risk";
import { STRATA_SOURCES, StrataChapter } from "./chapters/Strata";
import { STRATEGIES_SOURCES, StrategiesChapter } from "./chapters/Strategies";
import { TESTING_SOURCES, TestingChapter } from "./chapters/Testing";
import { CHECKS } from "./checks";
import { GLOSSARY, sortKey, strataNote } from "./glossary";
import { useLearnProgress } from "./progress";
import { Cite, KeyIdeas, SourceList } from "./Prose";
import { Quiz } from "./Quiz";
import type { SourceId } from "./sources";
import { useSetup } from "./useSetup";

export type Chapter = {
  id: string;
  title: string;
  summary: string;
  body: ComponentType;
  sections: { id: string; title: string }[];
  sources: readonly SourceId[];
};

export const CHAPTERS: Chapter[] = [
  {
    id: "markets",
    title: "Markets and what STRATA trades",
    summary: "Stocks, ETFs, the S&P 500 and SPY, bitcoin; where and when they trade; reading a price.",
    body: MarketsChapter,
    sections: [
      { id: "what", title: "What is traded" },
      { id: "where", title: "Where it trades" },
      { id: "when", title: "When it trades" },
      { id: "prices", title: "Reading a price" },
      { id: "protection", title: "What protects you" },
    ],
    sources: MARKETS_SOURCES,
  },
  {
    id: "orders",
    title: "Orders: how buying and selling works",
    summary: "Market, limit and stop orders; how long orders last; fills and slippage; the 2026 day-trading change; fees.",
    body: OrdersChapter,
    sections: [
      { id: "types", title: "Kinds of order" },
      { id: "time-in-force", title: "How long an order lasts" },
      { id: "fills", title: "Fills and slippage" },
      { id: "fractions", title: "Part of a share" },
      { id: "settlement", title: "Settlement" },
      { id: "accounts", title: "Cash, margin, borrowing" },
      { id: "day-trading", title: "Day trading rules" },
      { id: "fees", title: "What trading costs" },
    ],
    sources: ORDERS_SOURCES,
  },
  {
    id: "strategies",
    title: "Strategies: STRATA's two ideas",
    summary: "Trend following and mean reversion; moving averages and crossovers; the RSI, step by step.",
    body: StrategiesChapter,
    sections: [
      { id: "families", title: "Two kinds of idea" },
      { id: "moving-averages", title: "Moving averages" },
      { id: "crossover", title: "Crossover strategy" },
      { id: "rsi", title: "The RSI" },
      { id: "rsi-strategy", title: "RSI strategy" },
      { id: "from-signal", title: "From signal to trade" },
      { id: "benchmark", title: "The benchmark" },
    ],
    sources: STRATEGIES_SOURCES,
  },
  {
    id: "risk",
    title: "Risk: how STRATA limits losses",
    summary: "Why small losses matter; position size; stops and targets; the limits together; drawdown.",
    body: RiskChapter,
    sections: [
      { id: "arithmetic", title: "Why small losses matter" },
      { id: "sizing", title: "Position size" },
      { id: "stops", title: "Stop-loss and take-profit" },
      { id: "limits", title: "The limits, together" },
      { id: "drawdown", title: "Drawdown" },
      { id: "never", title: "What STRATA never does" },
      { id: "diversification", title: "Two instruments" },
    ],
    sources: RISK_SOURCES,
  },
  {
    id: "testing",
    title: "Testing ideas honestly",
    summary: "Backtests, out-of-sample tests and how backtests lie; the numbers to read; paper trading's limits.",
    body: TestingChapter,
    sections: [
      { id: "backtest", title: "What a backtest is" },
      { id: "split", title: "Keeping the past unseen" },
      { id: "traps", title: "How backtests lie" },
      { id: "metrics", title: "The numbers" },
      { id: "regulators", title: "What regulators say" },
      { id: "paper", title: "Paper trading" },
    ],
    sources: TESTING_SOURCES,
  },
  {
    id: "strata",
    title: "How STRATA trades",
    summary: "From a price to an order: agents, the critic, the risk engine; what happens when things go wrong.",
    body: StrataChapter,
    sections: [
      { id: "pipeline", title: "The pipeline" },
      { id: "propose", title: "Agents propose, rules decide" },
      { id: "wrong", title: "When something goes wrong" },
      { id: "live", title: "The four locks" },
      { id: "roadmap", title: "What exists today" },
      { id: "dashboard", title: "Where to see it" },
    ],
    sources: STRATA_SOURCES,
  },
];

function useScrollToHash() {
  const { hash, pathname } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo?.(0, 0);
      return;
    }
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    target?.scrollIntoView?.({ block: "start" });
  }, [hash, pathname]);
}

function Disclaimer() {
  return (
    <p className="card__note">
      For learning, not advice. Nothing here recommends buying or selling anything, and past results,
      backtested or real, don't predict future ones.
    </p>
  );
}

export function LearnIndex() {
  const { live } = useSetup();
  const { progress, clear } = useLearnProgress();
  const checked = CHAPTERS.filter((c) => progress[c.id]?.quiz).length;
  const next = CHAPTERS.find((c) => !progress[c.id]?.quiz);
  const started = CHAPTERS.some((c) => progress[c.id]?.opened);
  return (
    <div className="learn">
      <PageHeader
        title="Learn"
        description="How trading works, from the first order to the last abbreviation, and how STRATA does each part."
      />
      <div className="learn-progress" role="status">
        <p>
          {started ? (
            <>
              <strong>
                {checked} of {CHAPTERS.length} chapters checked.
              </strong>{" "}
              {next ? (
                <>
                  Next: <Link to={`/learn/${next.id}`}>{next.title}</Link>.
                </>
              ) : (
                "You've been through them all."
              )}
            </>
          ) : (
            <>
              <strong>Start with chapter 1</strong>, or anywhere you like. Each chapter begins with
              its main points, has things to try, and ends with a few questions to check yourself.
            </>
          )}
        </p>
        {started ? (
          <button type="button" className="button button--small button--ghost" onClick={clear}>
            Forget my progress
          </button>
        ) : null}
      </div>
      <ol className="chapters" aria-label="Chapters">
        {CHAPTERS.map((chapter, i) => {
          const done = progress[chapter.id]?.quiz;
          const opened = progress[chapter.id]?.opened;
          return (
            <li key={chapter.id}>
              <Link className={`chapter-card${done ? " is-done" : ""}`} to={`/learn/${chapter.id}`}>
                <span className="chapter-card__number">Chapter {i + 1}</span>
                <span className="chapter-card__title">{chapter.title}</span>
                <span className="chapter-card__summary">{chapter.summary}</span>
                <span className="chapter-card__status">
                  {done ? (
                    <>
                      <IconGood size={14} /> Checked: {done.correct} of {done.total} right
                    </>
                  ) : opened ? (
                    "Opened, not checked yet"
                  ) : (
                    "Not started"
                  )}
                </span>
              </Link>
            </li>
          );
        })}
        <li>
          <Link className="chapter-card" to="/learn/glossary">
            <span className="chapter-card__number">A to Z</span>
            <span className="chapter-card__title">Glossary</span>
            <span className="chapter-card__summary">
              {GLOSSARY.length} terms and abbreviations, from after hours to win rate.
            </span>
          </Link>
        </li>
      </ol>
      <div className="learn-article learn-intro">
        <p>
          Every fact about rules, fees and markets links to the official source: US regulators (the
          SEC, FINRA, the CFTC, the IRS), the exchanges, SIPC, S&amp;P Dow Jones Indices, State Street
          and Alpaca. Pictures made from invented prices say so. STRATA's own numbers come from your
          config.yaml
          {live ? ", read just now from the running system." : " (the shipped defaults are shown until the system status loads)."}
        </p>
        <Disclaimer />
      </div>
    </div>
  );
}

export function LearnChapterPage() {
  const { chapter: id } = useParams();
  const { setup } = useSetup();
  const { markOpened } = useLearnProgress();
  useScrollToHash();
  const index = CHAPTERS.findIndex((c) => c.id === id);
  const chapter = CHAPTERS[index];
  useEffect(() => {
    if (chapter) markOpened(chapter.id);
  }, [chapter, markOpened]);
  if (!chapter) return <NotFoundPage />;
  const checks = CHECKS[chapter.id];
  const Body = chapter.body;
  const previous = CHAPTERS[index - 1];
  const next = CHAPTERS[index + 1];
  return (
    <div className="learn-chapter">
      <header className="learn-chapter__head">
        <p className="chapter-card__number">
          <Link className="link-arrow" to="/learn">
            Learn
          </Link>{" "}
          · Chapter {index + 1} of {CHAPTERS.length}
        </p>
        <h1 id="chapter-title" className="learn-title">
          {chapter.title}
        </h1>
      </header>
      <div className="learn-layout">
        <article className="learn-article" aria-labelledby="chapter-title">
          {checks ? <KeyIdeas items={checks.keyIdeas(setup)} /> : null}
          <Body />
          {checks ? <Quiz chapterId={chapter.id} questions={checks.quiz(setup)} /> : null}
          {chapter.sources.length ? <SourceList ids={[...chapter.sources]} /> : null}
          <Disclaimer />
          <nav className="chapter-nav" aria-label="Chapters">
            {previous ? (
              <Link to={`/learn/${previous.id}`}>
                <span className="chapter-nav__dir">Previous</span>
                <span className="chapter-nav__title">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            <Link className="chapter-nav__next" to={next ? `/learn/${next.id}` : "/learn/glossary"}>
              <span className="chapter-nav__dir">Next</span>
              <span className="chapter-nav__title">{next ? next.title : "Glossary"}</span>
            </Link>
          </nav>
        </article>
        <nav className="learn-toc" aria-label="In this chapter">
          <p className="learn-toc__title">In this chapter</p>
          <ol>
            {chapter.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
            {checks ? (
              <li>
                <a href="#quiz">Check yourself</a>
              </li>
            ) : null}
          </ol>
          <div className="learn-toc__chapters">
            <p className="learn-toc__title learn-toc__title--next">Chapters</p>
            <ol>
              {CHAPTERS.map((c, i) => (
                <li key={c.id}>
                  <Link to={`/learn/${c.id}`} aria-current={c.id === chapter.id ? "page" : undefined}>
                    {i + 1}. {c.title.split(":")[0]}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/learn/glossary">Glossary</Link>
              </li>
            </ol>
          </div>
        </nav>
      </div>
    </div>
  );
}

export function GlossaryPage() {
  const { setup } = useSetup();
  const [query, setQuery] = useState("");
  const target = decodeURIComponent(useLocation().hash.slice(1));
  useScrollToHash();
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      GLOSSARY.filter(
        (e) =>
          !needle ||
          e.term.toLowerCase().includes(needle) ||
          (e.short ?? "").toLowerCase().includes(needle) ||
          e.meaning.toLowerCase().includes(needle),
      ),
    [needle],
  );
  const letters = [...new Set(shown.map((e) => sortKey(e.term).charAt(0).toUpperCase()))];

  return (
    <div className="learn">
      <PageHeader
        title="Glossary"
        description={`${GLOSSARY.length} words and abbreviations used in trading and in STRATA, with what each means for STRATA.`}
      />
      <div className="glossary-tools" role="search" aria-label="Search the glossary">
        <label className="field field--inline">
          <span className="field__label">Find</span>
          <input
            className="input glossary-find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="a word, or part of one"
            aria-describedby="glossary-count"
          />
        </label>
        <nav className="letters" aria-label="Letters">
          {letters.map((letter) => (
            <a key={letter} href={`#letter-${letter}`}>
              {letter}
            </a>
          ))}
        </nav>
      </div>
      <p className="muted" id="glossary-count" aria-live="polite">
        {needle ? `${shown.length} of ${GLOSSARY.length} match “${query.trim()}”.` : ""}
      </p>
      <dl className="glossary learn-article">
        {letters.map((letter) => (
          <div key={letter}>
            <p className="glossary__letter" id={`letter-${letter}`}>
              {letter}
            </p>
            {shown
              .filter((e) => sortKey(e.term).charAt(0).toUpperCase() === letter)
              .map((entry) => {
                const note = strataNote(entry, setup);
                return (
                  <div
                    className={`glossary__entry${entry.id === target ? " is-target" : ""}`}
                    id={entry.id}
                    key={entry.id}
                  >
                    <dt>
                      <span className="glossary__term">{entry.term}</span>
                      {entry.short ? <span className="glossary__short">{entry.short}</span> : null}
                    </dt>
                    <dd className="glossary__meaning">
                      {entry.meaning}
                      {entry.source ? <Cite id={entry.source} /> : null}
                    </dd>
                    {note ? (
                      <dd className="glossary__strata">
                        <strong>In STRATA:</strong> {note}
                      </dd>
                    ) : null}
                  </div>
                );
              })}
          </div>
        ))}
      </dl>
      {!shown.length ? <p className="empty-line">No entry matches that. Try a shorter word.</p> : null}
      <Disclaimer />
    </div>
  );
}
