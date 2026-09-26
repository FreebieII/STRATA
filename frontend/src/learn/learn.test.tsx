// The Learn section: it cites only official sources, every word it links to is
// in the glossary, and it quotes STRATA's settings as the running system has them.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { fakeApi, healthyRoutes, json, status } from "../test/fakeApi";
import { CHECKS } from "./checks";
import { GLOSSARY, sortKey } from "./glossary";
import { type Session, SessionClock, usSessions } from "./illustrations/Illustrations";
import { CHAPTERS } from "./LearnPages";
import { parseProgress, PROGRESS_KEY } from "./progress";
import { OFFICIAL_DOMAINS, SOURCES } from "./sources";
import { SHIPPED } from "./useSetup";

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.hash}</output>;
}

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

const glossaryIds = new Set(GLOSSARY.map((entry) => entry.id));

// jsdom can't scroll; the pages scroll to the top, or to the #section asked for.
const scrolledTo = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledTo(this.id);
  };
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  scrolledTo.mockReset();
});

describe("sources", () => {
  it("are all official sites, over HTTPS", () => {
    const unofficial = Object.entries(SOURCES).filter(([, source]) => {
      const url = new URL(source.url);
      const official = OFFICIAL_DOMAINS.some(
        (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      );
      return url.protocol !== "https:" || !official;
    });
    expect(unofficial).toEqual([]);
  });

  it("each name a title and a publisher, and no page is listed twice", () => {
    const sources = Object.values(SOURCES);
    for (const source of sources) {
      expect(source.title.trim()).not.toBe("");
      expect(source.publisher.trim()).not.toBe("");
    }
    expect(new Set(sources.map((s) => s.url)).size).toBe(sources.length);
  });

  it("are each cited somewhere: in a chapter or in the glossary", () => {
    const cited = new Set<string>([
      ...CHAPTERS.flatMap((chapter) => chapter.sources),
      ...GLOSSARY.flatMap((entry) => (entry.source ? [entry.source] : [])),
    ]);
    expect(Object.keys(SOURCES).filter((id) => !cited.has(id))).toEqual([]);
  });
});

describe("the glossary", () => {
  it("has one entry per id, each usable as a link target", () => {
    expect(glossaryIds.size).toBe(GLOSSARY.length);
    for (const entry of GLOSSARY) expect(entry.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("is in A-to-Z order, ignoring case, spaces and punctuation", () => {
    const keys = GLOSSARY.map((entry) => sortKey(entry.term));
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cites only sources that exist", () => {
    const missing = GLOSSARY.filter((entry) => entry.source && !(entry.source in SOURCES));
    expect(missing).toEqual([]);
  });
});

describe.each(CHAPTERS)("the chapter “$title”", (chapter) => {
  async function openChapter() {
    fakeApi(healthyRoutes());
    const view = open(`/learn/${chapter.id}`);
    await screen.findByRole("heading", { level: 1, name: chapter.title });
    return view.container.querySelector("article")!;
  }

  it("links only to words the glossary explains", async () => {
    const article = await openChapter();
    const terms = [...article.querySelectorAll("[data-term]")].map((el) => el.getAttribute("data-term"));
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.filter((id) => !glossaryIds.has(id!))).toEqual([]);
  });

  it("lists exactly the sources it cites", async () => {
    const article = await openChapter();
    const cited = new Set([...article.querySelectorAll("[data-source]")].map((el) => el.getAttribute("data-source")));
    expect([...cited].sort()).toEqual([...chapter.sources].sort());
    if (chapter.sources.length) {
      const list = within(screen.getByRole("region", { name: "Sources" }));
      for (const id of chapter.sources) {
        expect(list.getByRole("link", { name: SOURCES[id].title })).toHaveAttribute("href", SOURCES[id].url);
      }
    } else {
      expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    }
  });

  it("has a contents entry for every section, and every entry leads somewhere", async () => {
    const article = await openChapter();
    const headings = [...article.querySelectorAll("section > h2[id]")]
      .map((h) => h.id)
      .filter((id) => id !== "sources");
    expect(headings).toEqual([...chapter.sections.map((s) => s.id), "quiz"]);
    const contents = within(screen.getByRole("navigation", { name: "In this chapter" }));
    for (const section of chapter.sections) {
      expect(contents.getByRole("link", { name: section.title })).toHaveAttribute("href", `#${section.id}`);
    }
    expect(contents.getByRole("link", { name: "Check yourself" })).toHaveAttribute("href", "#quiz");
  });

  it("starts with its main points, and every lab says what its numbers are", async () => {
    const article = await openChapter();
    const summary = within(article).getByRole("complementary", { name: "In short" });
    expect(within(summary).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    const labs = article.querySelectorAll("section.lab");
    expect(labs.length).toBeGreaterThanOrEqual(1);
    for (const lab of labs) {
      expect(lab.querySelector(".lab__tag")?.textContent).toMatch(/^Try it · /);
      expect(lab.querySelector(".lab__intro")?.textContent?.trim()).toBeTruthy();
    }
  });

  it("ends with questions whose answers exist and are explained", async () => {
    const article = await openChapter();
    const quiz = within(article).getByRole("region", { name: "Check yourself" });
    const groups = within(quiz).getAllByRole("group");
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) expect(within(group).getAllByRole("radio").length).toBeGreaterThanOrEqual(3);
  });

  it("says what each picture is: made-up prices, settings, arithmetic, facts or a diagram", async () => {
    const article = await openChapter();
    for (const figure of article.querySelectorAll("figure")) {
      // Named by its title, for screen readers.
      const title = document.getElementById(figure.getAttribute("aria-labelledby") ?? "");
      expect(title?.textContent?.trim()).toBeTruthy();
      expect(figure.querySelector(".learn-figure__tag")?.textContent?.trim()).toBeTruthy();
      expect(figure.querySelector("figcaption")?.textContent?.trim()).toBeTruthy();
    }
  });
});

describe("pictures made from invented prices", () => {
  it("say so", async () => {
    fakeApi(healthyRoutes());
    open("/learn/strategies");
    await screen.findByRole("heading", { level: 1, name: /Strategies/ });
    const tags = screen.getAllByText("Illustration: made-up prices, not market data");
    // The crossover and RSI pictures are both drawn from made-up prices.
    expect(tags.length).toBeGreaterThanOrEqual(2);
  });
});

describe("STRATA's settings in the text", () => {
  function running(change: (trading: ReturnType<typeof status>["trading"]) => void) {
    const current = status();
    change(current.trading);
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => json(200, current) });
  }

  it("come from the running system", async () => {
    running((t) => {
      t.strategies.ma_crossover = { fast_period: 10, slow_period: 30 };
      t.strategies.rsi_reversion = { rsi_period: 7, buy_below: 25, sell_above: 75 };
    });
    open("/learn/strategies");
    expect(await screen.findByRole("heading", { name: /10\/30 moving-average crossover/ })).toBeInTheDocument();
    expect(screen.getByText(/Buy when the 10-day average of the daily close rises above the 30-day average/)).toBeInTheDocument();
  });

  it("follow the risk limits, including what one stop-loss costs", async () => {
    running((t) => {
      t.risk_limits = { ...t.risk_limits, STOP_LOSS_PCT: 8, max_position_value: 60, MAX_CAPITAL: 300 };
      t.timezone = "Europe/London";
    });
    open("/learn/risk");
    // 8% of $60 is $4.80, which is 1.6% of $300.
    expect(await screen.findByText(/risks about \$4\.80, 1\.6% of the capital/)).toBeInTheDocument();
    expect(screen.getByText("Stop-loss 8% below, take-profit 16% above")).toBeInTheDocument();
    // The made-up trade that jumps past the stop opens below it: 1.5 times the stop distance.
    expect(screen.getByText(/opened at 88, below the stop: −12%/)).toBeInTheDocument();
    expect(screen.getByText(/midnight, Europe\/London/)).toBeInTheDocument();
  });

  it("use config.yaml as shipped until the running system answers, and say so", async () => {
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => new Promise<Response>(() => {}) });
    open("/learn");
    expect(await screen.findByText(/the shipped defaults are shown until the system status loads/)).toBeInTheDocument();
    expect(SHIPPED.live_trading_switch).toBe(false);
  });
});

describe("the glossary page", () => {
  it("finds words by name, abbreviation or meaning", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    open("/learn/glossary");
    await screen.findByRole("heading", { level: 1, name: "Glossary" });
    expect(screen.getByText("After hours")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Find" }), "slippage");
    const matches = GLOSSARY.filter((e) =>
      [e.term, e.short ?? "", e.meaning].some((text) => text.toLowerCase().includes("slippage")),
    );
    expect(screen.getByText(`${matches.length} of ${GLOSSARY.length} match “slippage”.`)).toBeInTheDocument();
    expect(screen.getByText("Slippage")).toBeInTheDocument();
    expect(screen.queryByText("After hours")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Find" }));
    await user.type(screen.getByRole("textbox", { name: "Find" }), "zzzz");
    expect(screen.getByText("No entry matches that. Try a shorter word.")).toBeInTheDocument();
  });

  it("says what each word means for STRATA, with its settings as they are", async () => {
    const current = status();
    current.trading.risk_limits = { ...current.trading.risk_limits, STOP_LOSS_PCT: 4 };
    fakeApi({ ...healthyRoutes(), "GET /system/status": () => json(200, current) });
    open("/learn/glossary");
    const entry = await screen.findByText("Kill switch");
    expect(within(entry.closest(".glossary__entry") as HTMLElement).getByText("In STRATA:")).toBeInTheDocument();
    const stop = document.getElementById("stop-loss")!;
    expect(await within(stop).findByText(/4% below the entry/)).toBeInTheDocument();
    expect(within(document.getElementById("take-profit")!).getByText(/8% above the entry/)).toBeInTheDocument();
  });

  it("opens at the word a chapter linked to", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    open("/learn/strategies");
    await screen.findByRole("heading", { level: 1, name: /Strategies/ });
    await user.click(screen.getAllByRole("link", { name: "whipsaw" })[0]!);
    expect(await screen.findByRole("heading", { level: 1, name: "Glossary" })).toBeInTheDocument();
    expect(screen.getByTestId("where").textContent).toBe("/learn/glossary#whipsaw");
    expect(scrolledTo).toHaveBeenCalledWith("whipsaw");
    expect(document.getElementById("whipsaw")).toHaveClass("is-target");
    expect(document.querySelectorAll(".is-target")).toHaveLength(1);
  });
});

describe("finding the Learn pages", () => {
  it("the menu marks the chapter's section, not the glossary, and the other way round", async () => {
    fakeApi(healthyRoutes());
    const first = open("/learn/risk");
    const menu = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(menu.getByRole("link", { name: "How trading works" })).toHaveAttribute("aria-current", "page");
    expect(menu.getByRole("link", { name: "Glossary" })).not.toHaveAttribute("aria-current");
    first.unmount();

    open("/learn/glossary");
    const again = within(await screen.findByRole("navigation", { name: "Main" }));
    expect(again.getByRole("link", { name: "Glossary" })).toHaveAttribute("aria-current", "page");
    expect(again.getByRole("link", { name: "How trading works" })).not.toHaveAttribute("aria-current");
  });

  it("the index leads to every chapter and the glossary, in order", async () => {
    fakeApi(healthyRoutes());
    open("/learn");
    await screen.findByRole("heading", { level: 1, name: "Learn" });
    const cards = within(screen.getByRole("list", { name: "Chapters" })).getAllByRole("link");
    expect(cards.map((a) => a.getAttribute("href"))).toEqual([
      ...CHAPTERS.map((c) => `/learn/${c.id}`),
      "/learn/glossary",
    ]);
  });

  it("each chapter leads to the next, and the last to the glossary", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    open(`/learn/${CHAPTERS[0]!.id}`);
    await screen.findByRole("heading", { level: 1, name: CHAPTERS[0]!.title });
    for (const next of CHAPTERS.slice(1)) {
      await user.click(within(screen.getByRole("navigation", { name: "Chapters" })).getByRole("link", { name: /Next/ }));
      expect(await screen.findByRole("heading", { level: 1, name: next.title })).toBeInTheDocument();
    }
    await user.click(within(screen.getByRole("navigation", { name: "Chapters" })).getByRole("link", { name: /Next/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Glossary" })).toBeInTheDocument();
  });

  it("an unknown chapter is a missing page", async () => {
    fakeApi(healthyRoutes());
    open("/learn/astrology");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("market hours", () => {
  const saturday = Date.parse("2026-09-26T14:40:00Z");
  const regular = (sessions: Session[]) =>
    sessions
      .filter((s) => s.key === "regular")
      .map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()]);
  // The same formats the picture uses, so the tests pass in any locale.
  const clock = (timeZone: string, at: string) =>
    new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(Date.parse(at));
  const day = (timeZone: string, at: number | string) =>
    new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone }).format(new Date(at));

  it("skip weekends in New York", () => {
    // Around a Saturday there is only Friday's session, and the next is Monday's.
    expect(regular(usSessions(saturday, 1, 1))).toEqual([["2026-09-25T13:30:00.000Z", "2026-09-25T20:00:00.000Z"]]);
    expect(regular(usSessions(saturday, 0, 2))).toEqual([["2026-09-28T13:30:00.000Z", "2026-09-28T20:00:00.000Z"]]);
  });

  it("follow New York's clock changes", () => {
    // In December New York is on standard time: 9:30 is 14:30 UTC, not 13:30.
    expect(regular(usSessions(Date.parse("2026-12-01T12:00:00Z"), 0, 0))).toEqual([
      ["2026-12-01T14:30:00.000Z", "2026-12-01T21:00:00.000Z"],
    ]);
  });

  it("on a weekend, say no session falls today, and when the next one is", () => {
    render(<SessionClock now={saturday} resetZone="America/New_York" timeZone="UTC" />);
    const next = `${clock("UTC", "2026-09-28T13:30:00Z")}–${clock("UTC", "2026-09-28T20:00:00Z")}`;
    expect(
      screen.getByText(new RegExp(`none falls on your ${day("UTC", saturday)}; the next is on ${day("UTC", "2026-09-28T13:30:00Z")}, ${next} where you are`)),
    ).toBeInTheDocument();
    expect(screen.getByText("closed all day")).toBeInTheDocument();
  });

  it("show a session that crosses the viewer's midnight", () => {
    // 01:00 on Saturday in Tokyo: Friday's New York session ran from 22:30 to 05:00 there.
    render(<SessionClock now={Date.parse("2026-09-25T16:00:00Z")} resetZone="America/New_York" timeZone="Asia/Tokyo" />);
    const span = `${clock("Asia/Tokyo", "2026-09-25T13:30:00Z")}–${clock("Asia/Tokyo", "2026-09-25T20:00:00Z")}`;
    expect(screen.getByText(new RegExp(`today that is ${span} where you are`))).toBeInTheDocument();
    expect(screen.queryByText("closed all day")).not.toBeInTheDocument();
  });
});

describe("checking yourself", () => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const question = (prompt: string) => {
    const group = screen.getByRole("group", { name: new RegExp(escape(prompt)) });
    return { group, item: within(group.closest("li")!) };
  };

  async function answerRisk(user: ReturnType<typeof userEvent.setup>, rightOnes: number) {
    const questions = CHECKS.risk!.quiz(SHIPPED);
    for (const [i, q] of questions.entries()) {
      const { group, item } = question(q.prompt);
      const choice = i < rightOnes ? q.answer : (q.answer + 1) % q.options.length;
      await user.click(within(group).getByRole("radio", { name: q.options[choice] }));
      // Explained at once, right or wrong, and the answer can't be changed.
      expect(item.getByText(i < rightOnes ? "Right." : /^Not quite: the answer is/)).toBeInTheDocument();
      expect(item.getByText(q.why)).toBeInTheDocument();
      expect(group).toBeDisabled();
    }
    return questions.length;
  }

  it("explains each answer, scores the quiz, and shows the score on the Learn page", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    const view = open("/learn/risk");
    await screen.findByRole("heading", { level: 1, name: /Risk/ });
    const total = await answerRisk(user, 1);
    expect(within(screen.getByRole("region", { name: "Check yourself" })).getByRole("status")).toHaveTextContent(`1 of ${total} right.`);
    view.unmount();

    open("/learn");
    expect(await screen.findByText(`Checked: 1 of ${total} right`)).toBeInTheDocument();
    expect(screen.getByText(`1 of ${CHAPTERS.length} chapters checked.`)).toBeInTheDocument();
    // The next chapter to check is the first one not checked.
    expect(screen.getByRole("link", { name: CHAPTERS[0]!.title })).toHaveAttribute("href", `/learn/${CHAPTERS[0]!.id}`);
  });

  it("can be tried again, and remembers the last score meanwhile", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    open("/learn/risk");
    await screen.findByRole("heading", { level: 1, name: /Risk/ });
    const total = await answerRisk(user, CHECKS.risk!.quiz(SHIPPED).length);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByText("Right.")).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Last time: ${total} of ${total} right\\.`))).toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeEnabled();
  });

  it("shows what was opened, and forgets it all when asked", async () => {
    const user = userEvent.setup();
    fakeApi(healthyRoutes());
    const first = open("/learn/markets");
    await screen.findByRole("heading", { level: 1, name: /Markets/ });
    first.unmount();
    open("/learn");
    expect(await screen.findByText("Opened, not checked yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Forget my progress" }));
    expect(screen.queryByText("Opened, not checked yet")).not.toBeInTheDocument();
    expect(screen.getByText(/Start with chapter 1/)).toBeInTheDocument();
    expect(window.localStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it("still works when the browser won't store anything", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });
    fakeApi(healthyRoutes());
    open("/learn/risk");
    await screen.findByRole("heading", { level: 1, name: /Risk/ });
    const total = await answerRisk(user, 2);
    expect(within(screen.getByRole("region", { name: "Check yourself" })).getByRole("status")).toHaveTextContent(`2 of ${total} right.`);
  });

  it("ignores anything malformed in storage", () => {
    expect(parseProgress(null)).toEqual({});
    expect(parseProgress("not json")).toEqual({});
    expect(parseProgress("[1,2]")).toEqual({});
    expect(
      parseProgress(
        JSON.stringify({
          risk: { opened: true, quiz: { correct: 3, total: 4 } },
          orders: { opened: "yes", quiz: { correct: 9, total: 4 } },
          markets: 7,
        }),
      ),
    ).toEqual({ risk: { opened: true, quiz: { correct: 3, total: 4 } }, orders: {} });
  });
});
