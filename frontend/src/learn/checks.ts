// Each chapter's "In short" and its "Check yourself" questions. Every answer's
// explanation says why, in the chapter's own terms; the facts behind them are
// cited in the chapter. Numbers that are STRATA's settings come from them.

import type { TradingSummary } from "../api/types";
import { roundTrip } from "../lib/costs";

export type Question = {
  id: string;
  prompt: string;
  options: string[];
  // The index of the right option.
  answer: number;
  // Shown once the question is answered, right or wrong.
  why: string;
};

export type Checks = {
  keyIdeas: (setup: TradingSummary) => string[];
  quiz: (setup: TradingSummary) => Question[];
};

const usd = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export const CHECKS: Record<string, Checks> = {
  markets: {
    keyIdeas: () => [
      "A share is a small piece of one company. An ETF holds many: SPY holds the roughly 500 companies of the S&P 500.",
      "US stocks trade on weekdays, in set hours. Bitcoin trades all day, every day.",
      "You buy at the ask and sell at the bid. The gap between them, the spread, is a cost of every trade.",
      "Protections such as SIPC and circuit breakers are about a broker failing or a market in chaos. None of them protects you from a losing trade.",
    ],
    quiz: () => [
      {
        id: "spy",
        prompt: "What do you own with one share of SPY?",
        options: [
          "A share of State Street, the company that runs the fund",
          "A small slice of about 500 large US companies",
          "A promise that you will earn what the S&P 500 earns",
          "A loan to the US government",
        ],
        answer: 1,
        why: "SPY is an ETF: a fund that holds the companies in the S&P 500 and aims to match the index before expenses. Nothing promises a return.",
      },
      {
        id: "ask",
        prompt: "The best bid is $100.00 and the best ask is $100.01. You buy 10 shares at market. What do you pay per share?",
        options: ["$100.00", "$100.005", "$100.01", "Whatever you choose"],
        answer: 2,
        why: "A market buy takes the cheapest offer to sell: the ask. Selling at market gets the bid. The cent between them is the spread.",
      },
      {
        id: "bigger",
        prompt: "You buy far more shares at market than are offered at the best ask. What happens?",
        options: [
          "All of them fill at the best ask",
          "The order walks up the book and pays more for the later shares",
          "The broker refuses the order",
          "The price on the screen changes for everyone else but not for you",
        ],
        answer: 1,
        why: "A market order takes the best offers first, then the next best, and so on. The extra it pays is slippage caused by its own size. Try it in the order book lab.",
      },
      {
        id: "sipc",
        prompt: "What does SIPC protect?",
        options: [
          "Your losses when prices fall",
          "Any crypto held at a broker",
          "Cash and securities at a failed brokerage firm, up to limits",
          "Nothing, for accounts under $25,000",
        ],
        answer: 2,
        why: "SIPC restores customers' cash and securities, up to $500,000 including $250,000 in cash, if a member firm fails. It doesn't cover market losses, or crypto that isn't a security.",
      },
    ],
  },

  orders: {
    keyIdeas: (s) => {
      const stock = roundTrip(s.costs.stock, s.risk_limits.max_position_value);
      const crypto = roundTrip(s.costs.crypto, s.risk_limits.max_position_value);
      return [
        "A market order trades now at whatever the price is. A limit order waits for your price or better. A stop becomes a market order once a price is reached.",
        "A stop can't promise its price: after a gap, it sells at the next price there is. A stop-limit won't sell below its limit, and may not sell at all.",
        `Every trade costs something. With STRATA's estimates, buying and selling ${usd(s.risk_limits.max_position_value)} costs about ${usd(stock.total)} in a stock and ${usd(crypto.total)} in crypto.`,
        "In June 2026 the pattern day trader rule gave way to FINRA's intraday margin rules. STRATA still never buys and sells a stock on the same day.",
      ];
    },
    quiz: () => [
      {
        id: "limit",
        prompt: "You want to sell only if you get at least $105. Which order?",
        options: ["A market order", "A stop order at $105", "A limit order at $105", "A trailing stop"],
        answer: 2,
        why: "A limit order sells at the limit or higher. It may never fill if the price doesn't get there.",
      },
      {
        id: "gap",
        prompt: "Your stop is at $95. Bad news overnight, and the price opens at $91. What happens?",
        options: [
          "It sells at $95, as planned",
          "It sells at about $91, the first price there is",
          "It doesn't sell, because $95 was never traded",
          "The broker makes up the difference",
        ],
        answer: 1,
        why: "Once the stop price is passed, a stop becomes a market order. After a gap, the next price there is is the open: $91, $4 worse than the stop.",
      },
      {
        id: "stop-limit",
        prompt: "The same gap, but with a stop-limit: stop $95, limit $94. What happens at the $91 open?",
        options: [
          "It sells at $91",
          "It sells at $94 anyway",
          "Nothing sells until the price is back at $94 or higher",
          "It sells at $95",
        ],
        answer: 2,
        why: "The stop turns it into a limit order at $94, and nobody pays $94 while the price is at $91. It controls the price but may never sell, even if the price keeps falling. Try both in the order lab.",
      },
      {
        id: "pdt",
        prompt: "What changed about day trading in 2026?",
        options: [
          "Day trading was banned for small accounts",
          "The pattern day trader rule was replaced by FINRA's intraday margin rules",
          "The $25,000 minimum was doubled",
          "Nothing changed",
        ],
        answer: 1,
        why: "The SEC approved FINRA's intraday margin rules on 14 April 2026; they took effect on 4 June 2026, and Alpaca switched that day.",
      },
    ],
  },

  strategies: {
    keyIdeas: (s) => [
      "A strategy is a fixed rule precise enough to test. It is not a prediction, and nothing guarantees it works.",
      `The ${s.strategies.ma_crossover.fast_period}/${s.strategies.ma_crossover.slow_period} crossover follows trends: in when the short average rises above the long one, out when it falls back.`,
      `RSI mean reversion bets on bounces: buy when RSI falls below ${s.strategies.rsi_reversion.buy_below}, sell when it rises above ${s.strategies.rsi_reversion.sell_above}.`,
      "Each does well where the other does badly, and both are judged against simply buying and holding, after costs.",
    ],
    quiz: (s) => {
      const r = s.strategies.rsi_reversion;
      return [
        {
          id: "sma",
          prompt: `What is a ${s.strategies.ma_crossover.fast_period}-day simple moving average?`,
          options: [
            `The price ${s.strategies.ma_crossover.fast_period} days ago`,
            `The highest price of the last ${s.strategies.ma_crossover.fast_period} days`,
            `The average of the last ${s.strategies.ma_crossover.fast_period} closing prices`,
            `A forecast of the price ${s.strategies.ma_crossover.fast_period} days ahead`,
          ],
          answer: 2,
          why: "It averages the last N closes, worked out again each day, which smooths out day-to-day noise.",
        },
        {
          id: "whipsaw",
          prompt: "Prices go sideways and the two averages cross back and forth. What does each crossing cost?",
          options: ["Nothing: it is only a signal", "A small loss, plus trading costs", "Exactly the spread", "It always makes money"],
          answer: 1,
          why: "Each whipsaw buys after a small rise and sells after a small fall, and pays costs both ways. Try a sideways market in the crossover lab.",
        },
        {
          id: "rsi",
          prompt: `RSI falls to ${r.buy_below - 5} and the RSI strategy holds nothing. What does it do?`,
          options: ["Buys", "Sells", "Nothing", "Buys twice as much"],
          answer: 0,
          why: `Below ${r.buy_below} while holding nothing is its buy signal: it bets that a sharp fall will bounce back.`,
        },
        {
          id: "benchmark",
          prompt: "A strategy for SPY made 5% last year. What should it be compared with?",
          options: [
            "Nothing: 5% is a good result",
            "Buying SPY and holding it over the same year, after the same costs",
            "The best month of the year",
            "A savings account only",
          ],
          answer: 1,
          why: "The simplest alternative is to buy and hold. If holding SPY made 20%, the strategy's 5% was a failure, however clever it looks.",
        },
      ];
    },
  },

  risk: {
    keyIdeas: (s) => {
      const r = s.risk_limits;
      const loss = (r.max_position_value * r.STOP_LOSS_PCT) / 100;
      return [
        "Losses need bigger gains to make up: lose 50% and you need 100% to get back.",
        `Position size decides what one bad trade costs. With STRATA's settings, one stop-out loses about ${usd(loss)}: ${+((loss / r.MAX_CAPITAL) * 100).toFixed(2)}% of its capital.`,
        `The daily limit (${usd(r.DAILY_LOSS_LIMIT)}) stops new buys for the day; the total limit (${usd(r.TOTAL_LOSS_LIMIT)}) trips the kill switch. Sells that only reduce risk always go through.`,
        "No borrowing, no short selling, no options. When unsure, STRATA doesn't trade.",
      ];
    },
    quiz: (s) => {
      const r = s.risk_limits;
      const loss = (r.max_position_value * r.STOP_LOSS_PCT) / 100;
      return [
        {
          id: "recover",
          prompt: "An account loses 50%. What gain takes it back to where it started?",
          options: ["50%", "75%", "100%", "25%"],
          answer: 2,
          why: "Half of the money is left, so it has to double: +100%. Losses compound against you.",
        },
        {
          id: "stop-cost",
          prompt: `STRATA puts at most ${usd(r.max_position_value)} in one position, with a ${r.STOP_LOSS_PCT}% stop. About how much does one stop-out lose?`,
          options: [usd((r.MAX_CAPITAL * r.STOP_LOSS_PCT) / 100), usd(loss), usd(loss / 5), usd(r.max_position_value)],
          answer: 1,
          why: `${r.STOP_LOSS_PCT}% of ${usd(r.max_position_value)} is ${usd(loss)}. The stop applies to the position, not to all the capital. Try other sizes in the lab.`,
        },
        {
          id: "q2",
          prompt: "The daily loss limit has been reached, and a position hits its stop. What happens to the sale?",
          options: [
            "It is blocked, like everything else that day",
            "It goes through: sells that only reduce risk always do",
            "It waits for the next day",
            "The kill switch trips",
          ],
          answer: 1,
          why: "The limit blocks new buys. A sale that only reduces risk always goes through, and is logged: that was the operator's decision Q2.",
        },
        {
          id: "together",
          prompt: "Why isn't holding both SPY and bitcoin as safe as it sounds?",
          options: [
            "Because they sometimes fall together",
            "Because bitcoin trades on weekends",
            "Because SPY holds bitcoin",
            "It is completely safe",
          ],
          answer: 0,
          why: "Diversification helps only when one loss is offset by another. When everything falls together, it can't prevent losses.",
        },
      ];
    },
  },

  testing: {
    keyIdeas: () => [
      "A backtest replays a strategy's rules over past prices. It is quick and free, which is why it is so easy to fool yourself with.",
      "Keep part of the past unseen, and test on it once, with settings chosen beforehand.",
      "Try enough settings and one will look great by luck alone: that is overfitting.",
      "Paper trading is kinder than real trading, so STRATA will report its results with the same cost estimates as its backtests.",
    ],
    quiz: () => [
      {
        id: "oos",
        prompt: "Why keep an out-of-sample period?",
        options: [
          "To have more data to tune the settings on",
          "To test settings on prices they were never chosen on",
          "Because old prices are wrong",
          "To make the backtest faster",
        ],
        answer: 1,
        why: "Results on unseen prices are the honest ones. Results that only hold on the prices the settings were chosen on were probably luck.",
      },
      {
        id: "many",
        prompt: "You try 1,000 settings and keep the one with the best backtest. What's the danger?",
        options: [
          "None: the best is the best",
          "It may simply be the luckiest, and do no better from now on",
          "It will certainly lose money",
          "Backtests can't test that many",
        ],
        answer: 1,
        why: "With enough tries, some settings fit the past's noise. The overfitting machine shows the best backtest doing no better than typical afterwards.",
      },
      {
        id: "look-ahead",
        prompt: "A backtest decides at a day's close, and trades at that same close. What is the problem?",
        options: ["None", "Look-ahead bias: it uses a price it couldn't have acted on in time", "Survivorship bias", "It ignores dividends"],
        answer: 1,
        why: "By the time the close is known, trading at it is no longer possible. Using information before it was available flatters any backtest.",
      },
      {
        id: "paper",
        prompt: "Why do paper results at Alpaca look better than real trading would?",
        options: [
          "Paper accounts get better prices on purpose",
          "They don't simulate slippage, market impact, the queue for limit orders, or regulatory fees",
          "They trade faster",
          "They don't: paper and real are the same",
        ],
        answer: 1,
        why: "Alpaca's paper account fills orders at quoted prices without those costs, so STRATA will add its cost estimates to paper results.",
      },
    ],
  },

  strata: {
    keyIdeas: () => [
      "Agents and strategies only produce information. Fixed rules, with no AI, decide what is traded.",
      "The risk engine can refuse anything, and nothing overrides it. Only orders it approved are sent.",
      "When something is uncertain (stale data, a broker that doesn't answer, an order in an unknown state), STRATA stops.",
      "Live trading needs four locks at once. Today nothing in STRATA can place an order.",
    ],
    quiz: () => [
      {
        id: "ai",
        prompt: "An analysis agent is very confident a trade will work. Can it place the order?",
        options: [
          "Yes, if its confidence is high enough",
          "No: agents only produce information, and only orders the risk engine approved are sent",
          "Yes, but only on paper",
          "Only if the critic agrees",
        ],
        answer: 1,
        why: "Agents propose; fixed rules decide. The execution engine sends only orders carrying the risk engine's approval.",
      },
      {
        id: "stale",
        prompt: "The market data is stale. What does STRATA do?",
        options: ["Trades on the last prices it has", "Sends no new orders until it knows what is going on", "Asks an AI to guess", "Trips the kill switch"],
        answer: 1,
        why: "When unsure, STRATA doesn't trade. Missing a good trade costs nothing; a trade based on a mistake can cost a lot. Try it in the pipeline lab.",
      },
      {
        id: "locks",
        prompt: "What does live trading need?",
        options: [
          "A button on the dashboard",
          "LIVE_TRADING=true in the secrets file",
          "All four: the --live flag, LIVE_TRADING=true, live keys, and the operator typing a confirmation phrase",
          "Nothing: it is on by default",
        ],
        answer: 2,
        why: "All four locks at once, and the phrase is typed at the machine itself. No dashboard button, setting or agent can do it.",
      },
      {
        id: "today",
        prompt: "What can STRATA do today?",
        options: [
          "Trade SPY and bitcoin on paper",
          "Run its foundation and this dashboard, and download and check prices; nothing can place an order yet",
          "Trade live with small amounts",
          "Run backtests",
        ],
        answer: 1,
        why: "Phases 1, 1b, 1c and 2 are done: the foundation, the dashboard, this section, and market data (price history, checked and kept). Backtests come in Phase 4, and trading after that, on paper first.",
      },
    ],
  },
};
