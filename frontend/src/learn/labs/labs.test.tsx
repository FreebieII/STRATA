// The labs, used the way a reader would: step through days, drag sliders,
// pick situations, and read what they say.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { CrossoverLab } from "./CrossoverLab";
import { OrderBookLab } from "./OrderBookLab";
import { OrderLab } from "./OrderLab";
import { ordinal, OverfitLab } from "./OverfitLab";
import { PipelineLab } from "./PipelineLab";
import { RsiStepper } from "./RsiStepper";
import { SizingLab } from "./SizingLab";

const LIMITS = {
  MAX_CAPITAL: 300,
  MAX_POSITION_PCT: 20,
  STOP_LOSS_PCT: 5,
  DAILY_LOSS_LIMIT: 15,
  TOTAL_LOSS_LIMIT: 60,
  MAX_TRADES_PER_DAY: 3,
  max_position_value: 60,
};

// Labs link words to the glossary, so they need a router.
const show = (lab: ReactNode) => render(<MemoryRouter>{lab}</MemoryRouter>);
const slide = (name: string, value: number) => fireEvent.change(screen.getByRole("slider", { name }), { target: { value: String(value) } });

describe("buying at market", () => {
  it("pays more per share as the order grows, and says when the book runs out", () => {
    show(<OrderBookLab />);
    slide("Shares to buy", 300);
    expect(screen.getByText("$100.0100")).toBeInTheDocument();
    slide("Shares to buy", 400);
    // 300 at 100.01 and 100 at 100.02.
    expect(screen.getByText("$100.0125")).toBeInTheDocument();
    expect(screen.getByText(/would buy just 300 now and wait for the other 100/)).toBeInTheDocument();
    slide("Shares to buy", 2600);
    expect(screen.getByText("2,350 of 2,600")).toBeInTheDocument();
    expect(screen.getByText(/the book ran out/)).toBeInTheDocument();
  });
});

describe("following one sell order", () => {
  it("steps through the days, and a stop sells below its price after a gap", async () => {
    const user = userEvent.setup();
    show(<OrderLab stopPct={5} positionUsd={60} />);
    // The defaults: a stop at $95, and bad news overnight.
    expect(screen.getByText("Day 1 of 10")).toBeInTheDocument();
    expect(screen.getByText(/Not sold yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Day 2 of 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText(/Sold on day 5 at \$91\.20: −8\.8%, −\$5\.28 on a \$60 position/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "What happened each day" })).toHaveTextContent("$3.80 a share worse than the stop");
  });

  it("a stop-limit holds out for its limit, and may never sell", async () => {
    const user = userEvent.setup();
    show(<OrderLab stopPct={5} positionUsd={60} />);
    await user.click(screen.getByRole("button", { name: "Stop-limit" }));
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText(/Not sold after 10 days\. Still holding at \$88\.60: −11\.4%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bad news, then a bounce" }));
    // Changing the story starts again at day 1.
    expect(screen.getByText("Day 1 of 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText(/Sold on day 7 at \$94\.00/)).toBeInTheDocument();
  });

  it("a limit order waits for its price", async () => {
    const user = userEvent.setup();
    show(<OrderLab stopPct={5} positionUsd={60} />);
    await user.click(screen.getByRole("button", { name: "Limit" }));
    await user.click(screen.getByRole("button", { name: "A rally" }));
    await user.click(screen.getByRole("button", { name: "Show all" }));
    // The target is twice the stop distance: $110.
    expect(screen.getByText(/Sold on day 10 at \$110\.00: \+10\.0%, \$6\.00 on a \$60 position/)).toBeInTheDocument();
  });
});

describe("the crossover lab", () => {
  it("starts from STRATA's settings, compares with buying and holding, and lists every trade", async () => {
    const user = userEvent.setup();
    show(<CrossoverLab fast={20} slow={50} costPct={{ stock: 0.13, crypto: 0.8 }} />);
    expect(screen.getByRole("button", { name: "Use STRATA's 20/50" })).toBeDisabled();
    expect(screen.getByText("The strategy")).toBeInTheDocument();
    expect(screen.getByText("Buying and holding")).toBeInTheDocument();
    const trades = within(screen.getByRole("table")).getAllByRole("row").length - 1;
    expect(trades).toBeGreaterThanOrEqual(2);

    slide("Fast average", 5);
    expect(screen.getByRole("button", { name: "Use STRATA's 20/50" })).toBeEnabled();
    // Shorter averages trade more.
    expect(within(screen.getByRole("table")).getAllByRole("row").length - 1).toBeGreaterThan(trades);
    await user.click(screen.getByRole("button", { name: "Use STRATA's 20/50" }));
    expect(within(screen.getByRole("table")).getAllByRole("row").length - 1).toBe(trades);
  });

  it("keeps the slow average longer than the fast one", () => {
    show(<CrossoverLab fast={20} slow={50} costPct={{ stock: 0.13, crypto: 0.8 }} />);
    slide("Fast average", 60);
    expect(screen.getByRole("slider", { name: "Slow average" })).toHaveValue("65");
  });
});

describe("the RSI, day by day", () => {
  it("shows the working, and says what the strategy does", async () => {
    const user = userEvent.setup();
    show(<RsiStepper period={14} buyBelow={30} sellAbove={70} />);
    // It opens on the first buy signal: here the first RSI day, a plain average.
    expect(screen.getByText(/a buy signal\. Today's close made it, so the strategy buys the next day\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next signal" }));
    expect(screen.getByText(/a sell signal\. The strategy sells the next day\./)).toBeInTheDocument();
    // Later days use Wilder's running average: yesterday's times 13, plus today, over 14.
    expect(screen.getAllByText(/× 13 \+ .* ÷ 14 =/)).toHaveLength(2);
  });

  it("starts the averages plainly on the first RSI day", () => {
    show(<RsiStepper period={14} buyBelow={30} sellAbove={70} />);
    slide("Day", 14);
    expect(screen.getByText(/the first 14 gains, averaged/)).toBeInTheDocument();
  });
});

describe("how much one trade can cost", () => {
  it("works out the loss at the stop and what each limit allows", () => {
    show(<SizingLab limits={LIMITS} />);
    expect(screen.getByText("$3.00")).toBeInTheDocument();
    expect(screen.getByText("1% of your capital")).toBeInTheDocument();
    expect(screen.getByText("5 stop-outs")).toBeInTheDocument();
    expect(screen.getByText("20 stop-outs")).toBeInTheDocument();
    slide("Stop-loss", 10);
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.getByText("2 stop-outs")).toBeInTheDocument();
  });

  it("says when one stop-out is bigger than the daily limit", () => {
    show(<SizingLab limits={LIMITS} />);
    slide("Largest position", 100);
    slide("Stop-loss", 20);
    // $300 * 20% = $60 lost at the stop, more than the $15 daily limit.
    expect(screen.getByText(/is already more than the \$15 daily limit/)).toBeInTheDocument();
  });
});

describe("the overfitting machine", () => {
  it("tries the strategies, shows the best backtest and how it did afterwards", async () => {
    const user = userEvent.setup();
    show(<OverfitLab />);
    expect(screen.queryByText("Best backtest")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try 100 random strategies" }));
    expect(screen.getByText("Best backtest")).toBeInTheDocument();
    expect(screen.getByText("The same setting, afterwards")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /100 settings\. The best backtest/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "A new made-up market" }));
    expect(screen.getByText("market #9")).toBeInTheDocument();
    expect(screen.getByText("Best backtest")).toBeInTheDocument();
  });
});

describe("ordinals", () => {
  it("say 1st, 2nd, 3rd and 11th to 13th properly", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 98, 101, 111, 112].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "98th", "101st", "111th", "112th",
    ]);
  });
});

describe("a pretend trade through the pipeline", () => {
  it("gets through when every rule says yes", () => {
    show(<PipelineLab limits={LIMITS} />);
    expect(screen.getByText("Sent.")).toBeInTheDocument();
  });

  it("names the rule that stops it, and lets risk-reducing sales through a bad day", async () => {
    const user = userEvent.setup();
    show(<PipelineLab limits={LIMITS} />);
    await user.click(screen.getByRole("button", { name: "A bad day: a new buy" }));
    expect(screen.getByText("Stopped at “Risk engine: daily loss limit”.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "A bad day: a stop-loss sale" }));
    expect(screen.getByText("Sent.")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "The kill switch has tripped" }));
    expect(screen.getByText("Stopped at “Risk engine: kill switch”.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stale data" }));
    expect(screen.getByText("Stopped at “Market data”.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "not reached" }).length).toBeGreaterThan(5);
  });
});
