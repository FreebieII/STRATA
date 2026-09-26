// Words and abbreviations used in trading and in STRATA, A to Z (sorted by
// their letters and digits only, so "S&P 500" sorts as "sp500"). Entries
// about rules, fees or institutions cite an official source.

import type { TradingSummary } from "../api/types";
import type { SourceId } from "./sources";

export function sortKey(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type Entry = {
  id: string;
  term: string;
  // The abbreviation spelled out, or another name for it.
  short?: string;
  meaning: string;
  // What it means for STRATA in particular; worked out from its settings when
  // it quotes them.
  strata?: string | ((setup: TradingSummary) => string);
  source?: SourceId;
};

export function strataNote(entry: Entry, setup: TradingSummary): string | undefined {
  return typeof entry.strata === "function" ? entry.strata(setup) : entry.strata;
}

export const GLOSSARY: Entry[] = [
  {
    id: "after-hours",
    term: "After hours",
    meaning:
      "Trading after the regular session closes, from 4:00 to 8:00 p.m. Eastern Time. Fewer people trade, so spreads are wider and prices can jump on news.",
    source: "investor-extended-hours",
  },
  {
    id: "agent",
    term: "Agent",
    short: "analysis agent",
    meaning: "A program that studies data and reports a view, with how confident it is and why.",
    strata: "Agents only produce information. They can't place orders, and the risk engine checks everything they suggest. Phase 5.",
  },
  {
    id: "alpaca",
    term: "Alpaca",
    meaning: "An online broker that lets programs trade US stocks, ETFs and crypto through its API, with free paper-trading accounts.",
    strata: "STRATA's broker. Paper trading only, unless the operator unlocks live trading.",
    source: "alpaca-paper",
  },
  {
    id: "api",
    term: "API",
    short: "application programming interface",
    meaning: "A way for programs to talk to each other.",
    strata: "STRATA talks to Alpaca's API; this dashboard talks to STRATA's own API.",
  },
  {
    id: "ask",
    term: "Ask",
    short: "offer",
    meaning: "The lowest price a seller is currently willing to accept.",
    strata: "A market order to buy pays the ask, plus any slippage.",
    source: "investor-spread",
  },
  {
    id: "atr",
    term: "ATR",
    short: "average true range",
    meaning: "The average size of a day's price range, counting overnight jumps, over recent days. A common measure of volatility.",
    strata: "Part of STRATA's indicator library (Phase 3).",
  },
  {
    id: "audit-log",
    term: "Audit log",
    meaning: "A record of who did what, and when.",
    strata: "STRATA's audit log is append-only: the database refuses to change or delete its entries.",
  },
  {
    id: "backtest",
    term: "Backtest",
    meaning:
      "Running a strategy's rules over past prices to see how it would have done. The results are hypothetical: no money was traded, and the rules were chosen knowing the past.",
    strata: "Phase 4. Results are always reported with fees and slippage, and with the out-of-sample period separately.",
    source: "sec-marketing",
  },
  {
    id: "basis-point",
    term: "Basis point",
    short: "bp",
    meaning: "One hundredth of a percent: 0.01%. A 0.25% fee is 25 basis points.",
  },
  {
    id: "bear-bull",
    term: "Bear and bull market",
    meaning: "A bull market is a long period of rising prices; a bear market, a long period of falling ones.",
  },
  {
    id: "bid",
    term: "Bid",
    meaning: "The highest price a buyer is currently willing to pay.",
    strata: "A market order to sell gets the bid, minus any slippage.",
    source: "investor-spread",
  },
  {
    id: "bid-ask-spread",
    term: "Bid-ask spread",
    short: "spread",
    meaning: "The gap between the bid and the ask. You pay it, in effect, whenever you trade at market prices.",
    source: "investor-spread",
  },
  {
    id: "broker",
    term: "Broker",
    meaning: "The firm that holds your account and sends your orders to the market.",
    strata: "Alpaca.",
  },
  {
    id: "btc",
    term: "BTC",
    short: "bitcoin",
    meaning:
      "The first and largest crypto asset. BTC/USD is its price in US dollars. Regulators call it highly speculative.",
    strata: "One of STRATA's two instruments.",
    source: "investor-crypto-spotlight",
  },
  {
    id: "buy-and-hold",
    term: "Buy and hold",
    meaning: "Buying an investment and simply keeping it.",
    strata: "Every STRATA result is compared with buying and holding the same instrument over the same period.",
  },
  {
    id: "buying-power",
    term: "Buying power",
    meaning:
      "How much an account can spend on new purchases right now: its cash in a cash account, more in a margin account, where the extra is borrowed.",
  },
  {
    id: "cagr",
    term: "CAGR",
    short: "compound annual growth rate",
    meaning: "The steady yearly growth rate that would turn the starting value into the final one.",
  },
  {
    id: "candle",
    term: "Candle",
    short: "candlestick, price bar",
    meaning: "A bar showing a period's opening, highest, lowest and closing prices.",
  },
  {
    id: "capital",
    term: "Capital",
    meaning: "The money set aside for trading.",
    strata: (s) => `MAX_CAPITAL in config.yaml: $${s.risk_limits.MAX_CAPITAL}. The bot may never have more than this invested.`,
  },
  {
    id: "capital-gain",
    term: "Capital gain",
    short: "or capital loss",
    meaning:
      "The profit, or loss, from selling something for more, or less, than it cost. The US tax rules treat crypto as property, so selling bitcoin makes a capital gain or loss, as selling a share does. Tax rules depend on where you live.",
    strata: "Paper trades aren't real sales, so they make no gain or loss for tax.",
    source: "irs-digital-assets",
  },
  {
    id: "cash-account",
    term: "Cash account",
    meaning: "A brokerage account that only buys with its own money: no borrowing.",
  },
  {
    id: "circuit-breaker",
    term: "Circuit breaker",
    meaning:
      "A market-wide trading halt when the S&P 500 falls from the previous close: 7% or 13% halts trading for 15 minutes (only before 3:25 p.m. ET), 20% halts it for the rest of the day.",
    strata: "STRATA has its own circuit breakers too: the daily loss limit and the kill switch.",
    source: "investor-circuit-breakers",
  },
  {
    id: "client-order-id",
    term: "Client order ID",
    meaning: "A unique name the trader gives an order before sending it.",
    strata:
      "Every STRATA order gets one, so if a request is retried after a network error, the broker recognises it and no second order is created. Phase 8.",
  },
  {
    id: "close",
    term: "Close",
    short: "closing price",
    meaning: "The last price of a period, usually the regular session's last trade.",
    strata: "STRATA's two strategies work on daily closing prices.",
  },
  {
    id: "compounding",
    term: "Compounding",
    meaning:
      "Earning returns on earlier returns: $100 growing 5% a year becomes $105, then $110.25. Losses compound too.",
    source: "investor-compound",
  },
  {
    id: "correlation",
    term: "Correlation",
    meaning:
      "How closely two prices move together, from −1 (always opposite) through 0 (unrelated) to +1 (always in step). Holding two correlated assets diversifies less than it seems.",
    strata: "A correlation limit is part of the risk engine (Phase 7).",
  },
  {
    id: "critic",
    term: "Critic",
    meaning: "In STRATA, the agent whose job is to find reasons a proposed trade is a bad idea.",
    strata: "It can veto a proposal. Phase 5.",
  },
  {
    id: "crossover",
    term: "Crossover",
    meaning: "When one line crosses another, such as a fast moving average rising above a slow one.",
    strata: (s) =>
      `STRATA's moving-average crossover strategy uses ${s.strategies.ma_crossover.fast_period}- and ${s.strategies.ma_crossover.slow_period}-day averages.`,
  },
  {
    id: "crypto",
    term: "Crypto asset",
    short: "cryptocurrency",
    meaning:
      "A digital asset recorded on a blockchain. Prices are very volatile, markets trade all day every day, fraud is common, and a transfer usually can't be reversed.",
    strata: "Alpaca's crypto business is not a member of SIPC or FINRA, so BTC holdings don't have SIPC protection.",
    source: "cftc-virtual-currency",
  },
  {
    id: "day-order",
    term: "Day order",
    meaning: "An order that is cancelled at the end of the trading day if it hasn't filled.",
    source: "alpaca-orders",
  },
  {
    id: "day-trade",
    term: "Day trade",
    meaning: "Buying and selling the same security on the same day. Investor.gov calls day trading extremely risky.",
    strata: "STRATA never buys and sells the same stock on the same day (the operator's decision Q4).",
    source: "investor-day-trading",
  },
  {
    id: "death-cross",
    term: "Death cross",
    meaning:
      "A short-term moving average falling below a long-term one (classically 50 and 200 days), read as a bearish sign.",
    source: "nasdaq-death-cross",
  },
  {
    id: "diversification",
    term: "Diversification",
    meaning:
      "Spreading money across different investments so a loss in one may be made up by others. It can't prevent losses when markets fall together.",
    source: "investor-diversification",
  },
  {
    id: "dollar-cost-averaging",
    term: "Dollar-cost averaging",
    meaning: "Investing the same amount at regular intervals whatever the price, so you buy more when prices are low.",
    source: "investor-dca",
  },
  {
    id: "drawdown",
    term: "Drawdown",
    short: "maximum drawdown",
    meaning:
      "How far an account's value is below its highest point so far. The maximum drawdown is the worst such fall in a period.",
    strata: "The operator chose a 20% drawdown limit for the risk engine (Phase 7).",
  },
  {
    id: "ema",
    term: "EMA",
    short: "exponential moving average",
    meaning: "A moving average that gives recent prices more weight than older ones, so it reacts faster.",
    source: "cme-moving-averages",
  },
  {
    id: "equity",
    term: "Equity",
    meaning: "Either a share of ownership in a company, or an account's total value: its cash plus what its positions are worth.",
  },
  {
    id: "et",
    term: "ET",
    short: "Eastern Time",
    meaning: "New York's time zone. US market hours are given in it.",
    strata: (s) => `STRATA's trading day, and its daily limits, follow the ${s.timezone} time zone (config.yaml).`,
  },
  {
    id: "etf",
    term: "ETF",
    short: "exchange-traded fund",
    meaning: "A fund whose shares trade on an exchange, at market prices, throughout the day.",
    strata: "SPY is an ETF.",
    source: "investor-etf",
  },
  {
    id: "exchange",
    term: "Exchange",
    meaning: "A regulated marketplace where buy and sell orders meet, such as the NYSE or Nasdaq.",
  },
  {
    id: "extended-hours",
    term: "Extended hours",
    meaning:
      "Trading outside the regular session: pre-market before it, after hours after it. Less trading means wider spreads and bigger price swings.",
    source: "investor-extended-hours",
  },
  {
    id: "fill",
    term: "Fill",
    short: "execution",
    meaning: "When an order trades. The fill price is what was actually paid or received.",
  },
  {
    id: "finra",
    term: "FINRA",
    short: "Financial Industry Regulatory Authority",
    meaning: "The US organisation that writes and enforces rules for brokerage firms, under the SEC's oversight.",
    source: "finra-4210",
  },
  {
    id: "fok",
    term: "FOK",
    short: "fill or kill",
    meaning: "Fill the whole order immediately, or cancel it entirely.",
    source: "alpaca-orders",
  },
  {
    id: "fractional-share",
    term: "Fractional share",
    meaning: "Part of one share, bought by quantity (0.1 shares) or by dollar amount ($60 worth).",
    strata:
      "STRATA needs them: one SPY share costs far more than its $60 position limit. Alpaca's minimum is $1, and fractional orders last one day only.",
    source: "alpaca-fractional",
  },
  {
    id: "gap",
    term: "Gap",
    meaning: "A jump in price from one trade to the next, often overnight or on news, skipping the prices in between.",
    strata: "A gap can carry a stop-loss sale well past its price: the risk page and the Learn section show an example.",
  },
  {
    id: "golden-cross",
    term: "Golden cross",
    meaning:
      "A short-term moving average rising above a long-term one (classically 50 and 200 days), read as a bullish sign.",
    source: "nasdaq-golden-cross",
  },
  {
    id: "gtc",
    term: "GTC",
    short: "good 'til cancelled",
    meaning: "An order that stays open until it fills or is cancelled.",
    source: "alpaca-orders",
  },
  {
    id: "health-check",
    term: "Health check",
    meaning: "A quick test that a part of a system works.",
    strata: "STRATA checks its database, schema and Redis; anything that trades treats a failing check as “do not trade”.",
  },
  {
    id: "iex",
    term: "IEX",
    short: "Investors Exchange",
    meaning: "A US stock exchange. Alpaca's free real-time stock data comes from IEX alone, about 2.5% of US trading.",
    source: "alpaca-market-data",
  },
  {
    id: "index",
    term: "Index",
    meaning: "A number that tracks a basket of securities, such as the S&P 500. You can't buy an index, only funds that follow it.",
  },
  {
    id: "index-fund",
    term: "Index fund",
    meaning: "A fund that tries to match an index's performance, before fees, without picking investments itself.",
    source: "investor-index-fund",
  },
  {
    id: "in-sample",
    term: "In-sample",
    meaning: "The part of past data that may be looked at while building and choosing a strategy.",
    strata: (s) => `From ${s.backtest.start_date} to the day before ${s.backtest.test_start_date} (config.yaml).`,
  },
  {
    id: "intraday-margin",
    term: "Intraday margin rules",
    meaning:
      "FINRA's rules, in force since 4 June 2026, requiring margin accounts to keep enough margin throughout the trading day. They replaced the pattern day trader rule; brokers may switch over until 20 October 2027.",
    source: "finra-intraday-margin",
  },
  {
    id: "ioc",
    term: "IOC",
    short: "immediate or cancel",
    meaning: "Fill as much of the order as possible at once, and cancel the rest.",
    source: "alpaca-orders",
  },
  {
    id: "kill-switch",
    term: "Kill switch",
    meaning: "An emergency stop.",
    strata:
      "When total losses reach TOTAL_LOSS_LIMIT ($60), STRATA cancels open orders, sells its positions and refuses to trade until the operator resets it by hand. Phase 7.",
  },
  {
    id: "leverage",
    term: "Leverage",
    meaning: "Trading with borrowed money. It multiplies gains and losses alike, and losses can exceed what you put in.",
    strata: "Never. STRATA's leverage is fixed at 1.0.",
  },
  {
    id: "limit-order",
    term: "Limit order",
    meaning: "An order to buy at a set price or lower, or sell at a set price or higher. It controls the price, but may never fill.",
    source: "investor-limit-order",
  },
  {
    id: "liquidity",
    term: "Liquidity",
    meaning: "How easily something can be bought or sold quickly without moving its price.",
    source: "investor-liquidity",
  },
  {
    id: "long",
    term: "Long",
    meaning: "Owning something, so you gain when its price rises.",
    strata: "STRATA only ever goes long.",
  },
  {
    id: "look-ahead-bias",
    term: "Look-ahead bias",
    meaning:
      "A backtest mistake: letting a simulated decision use information that wasn't known yet at that time, such as the day's closing price at the open.",
  },
  {
    id: "margin",
    term: "Margin account",
    short: "margin",
    meaning: "An account in which the broker lends you money against your holdings. It raises buying power, and the size of possible losses.",
    strata: "STRATA never borrows.",
    source: "investor-margin",
  },
  {
    id: "market-order",
    term: "Market order",
    meaning: "An order to buy or sell straight away at the best available price. It nearly always fills, but the price isn't guaranteed.",
    source: "investor-market-order",
  },
  {
    id: "mean-reversion",
    term: "Mean reversion",
    meaning: "The idea that after a big move away from its usual level, a price tends to come back towards it.",
    strata: "STRATA's RSI strategy bets on it.",
  },
  {
    id: "moving-average",
    term: "Moving average",
    short: "MA, SMA",
    meaning: "The average of the last N prices, worked out again every day. The simple kind (SMA) weighs each day equally.",
    strata: (s) =>
      `STRATA's crossover strategy uses ${s.strategies.ma_crossover.fast_period}- and ${s.strategies.ma_crossover.slow_period}-day simple moving averages of the daily close.`,
    source: "cme-moving-averages",
  },
  {
    id: "nasdaq",
    term: "Nasdaq",
    meaning: "A US stock exchange, and the company that runs it.",
  },
  {
    id: "notional",
    term: "Notional",
    meaning: "The dollar value of an order or position. Alpaca lets you order by notional, for example “$60 of SPY”.",
    source: "alpaca-fractional",
  },
  {
    id: "nyse",
    term: "NYSE",
    short: "New York Stock Exchange",
    meaning: "The largest US stock exchange. SPY is listed on its NYSE Arca market.",
    source: "nyse-hours",
  },
  {
    id: "ohlcv",
    term: "OHLCV",
    short: "open, high, low, close, volume",
    meaning: "The five numbers in a price bar.",
  },
  {
    id: "opg-cls",
    term: "OPG and CLS",
    short: "at the open, at the close",
    meaning: "Orders that trade only in the opening or the closing auction.",
    source: "alpaca-orders",
  },
  {
    id: "out-of-sample",
    term: "Out-of-sample",
    meaning: "Past data kept out of sight while a strategy is built, and used only to test it. The more honest result.",
    strata: (s) =>
      `From ${s.backtest.test_start_date} ${s.backtest.end_date ? `to ${s.backtest.end_date}` : "onwards"} (config.yaml), always reported separately.`,
  },
  {
    id: "overfitting",
    term: "Overfitting",
    short: "curve-fitting",
    meaning:
      "Tuning a strategy so closely to past prices that it learns their noise rather than a real pattern. It looks brilliant on old data and fails on new.",
    strata: "STRATA's strategy settings were fixed before testing and aren't changed after seeing out-of-sample results.",
  },
  {
    id: "paper-trading",
    term: "Paper trading",
    meaning:
      "Trading with pretend money against real prices. Alpaca's paper fills leave out slippage, market impact, fees and dividends, so results look better than real ones would.",
    strata: "STRATA's default mode, and the only one it will run for at least 30 days before live trading could even be considered.",
    source: "alpaca-paper",
  },
  {
    id: "partial-fill",
    term: "Partial fill",
    meaning: "When only part of an order trades, and the rest is still open or cancelled.",
    strata: "STRATA tracks the filled and unfilled parts of every order (Phase 8).",
  },
  {
    id: "pdt",
    term: "PDT",
    short: "pattern day trader",
    meaning:
      "Under FINRA's old rule, someone making 4 or more day trades in 5 business days in a margin account, who then needed $25,000 in equity. The SEC approved its replacement on 14 April 2026, and FINRA's intraday margin rules took over on 4 June 2026.",
    strata: "STRATA still never day trades stocks (decision Q4).",
    source: "finra-notice-26-10",
  },
  {
    id: "p-and-l",
    term: "P&L",
    short: "profit and loss",
    meaning: "Money made or lost. Realised P&L is from closed positions; unrealised, from open ones at today's prices.",
  },
  {
    id: "position",
    term: "Position",
    meaning: "What an account holds in one security.",
  },
  {
    id: "position-size",
    term: "Position size",
    meaning: "How much money goes into one position.",
    strata: (s) => `At most MAX_POSITION_PCT (${s.risk_limits.MAX_POSITION_PCT}%) of capital: $${s.risk_limits.max_position_value}.`,
  },
  {
    id: "pre-market",
    term: "Pre-market",
    meaning: "Trading before the regular session opens, from 4:00 a.m. Eastern Time on some venues.",
    source: "investor-extended-hours",
  },
  {
    id: "r-multiple",
    term: "R",
    short: "risk multiple",
    meaning: "A trade's result in units of what it risked. With a 5% stop, a 10% gain is +2R and hitting the stop is −1R.",
  },
  {
    id: "reconciliation",
    term: "Reconciliation",
    meaning: "Comparing your own records with the broker's and fixing any difference.",
    strata: "STRATA reconciles on every start-up, before it trades. If it is unsure what it holds, it doesn't trade (Phase 8).",
  },
  {
    id: "regime",
    term: "Regime",
    short: "market regime",
    meaning:
      "The market's broad mood: rising, falling, going sideways, calm or wild. A strategy that suits one regime often fails in another.",
    strata: "Regime detection is part of Phase 3.",
  },
  {
    id: "risk-engine",
    term: "Risk engine",
    meaning: "The part of a trading system that checks every order against the risk limits.",
    strata: "STRATA's is plain, fixed rules with no AI. It can refuse any order, and nothing can override it. Phase 7.",
  },
  {
    id: "risk-reward",
    term: "Risk/reward",
    short: "reward-to-risk",
    meaning: "A trade's possible gain divided by its possible loss.",
    strata: "STRATA only proposes trades with a reward at least 1.5 times the risk.",
  },
  {
    id: "rsi",
    term: "RSI",
    short: "relative strength index",
    meaning:
      "An indicator from 0 to 100 comparing the average size of recent up moves with recent down moves (J. Welles Wilder, 1978). Above 70 is generally read as overbought, below 30 as oversold.",
    strata: (s) => {
      const r = s.strategies.rsi_reversion;
      return `STRATA's mean-reversion strategy: ${r.rsi_period} days, buy below ${r.buy_below}, sell above ${r.sell_above}.`;
    },
    source: "cme-oscillators",
  },
  {
    id: "sec",
    term: "SEC",
    short: "U.S. Securities and Exchange Commission",
    meaning: "The US federal regulator of the securities markets. Investor.gov is its site for investors.",
  },
  {
    id: "section-31",
    term: "Section 31 fee",
    meaning:
      "A small SEC fee on sales of stocks and ETFs, which brokers pass on: $20.60 per million dollars sold since 4 April 2026.",
    strata: (s) => `Included in STRATA's $${s.costs.stock.fee_per_sell_usd.toFixed(2)} estimate per stock sale.`,
    source: "sec-section-31",
  },
  {
    id: "settlement",
    term: "Settlement",
    short: "T+1",
    meaning:
      "The final exchange of the securities and the cash. Since 28 May 2024 most US trades settle one business day after the trade.",
    source: "investor-t1",
  },
  {
    id: "sharpe",
    term: "Sharpe ratio",
    meaning:
      "The return above a risk-free rate divided by how much the returns swing. Higher means more return for the bumpiness, but it can miss rare big losses.",
  },
  {
    id: "short-selling",
    term: "Short selling",
    meaning: "Selling borrowed shares, hoping to buy them back cheaper later. Losses have no limit if the price keeps rising.",
    strata: "STRATA never shorts.",
    source: "investor-short",
  },
  {
    id: "sip",
    term: "SIP",
    short: "securities information processor",
    meaning: "The consolidated feed of quotes and trades from every US exchange.",
    strata: (s) => `config.yaml asks Alpaca for ${s.stock_data_feed.toUpperCase()} data for historical stock prices.`,
    source: "alpaca-market-data",
  },
  {
    id: "sipc",
    term: "SIPC",
    short: "Securities Investor Protection Corporation",
    meaning:
      "Protects customers' cash and securities, up to $500,000 including $250,000 in cash, if a member brokerage fails. It doesn't cover market losses, or crypto that isn't a security.",
    source: "sipc-protects",
  },
  {
    id: "slippage",
    term: "Slippage",
    meaning: "The difference between the price you expected and the price you got.",
    strata: (s) =>
      `STRATA assumes ${s.costs.stock.slippage_pct}% on every stock fill and ${s.costs.crypto.slippage_pct}% on every crypto fill (config.yaml).`,
  },
  {
    id: "sp500",
    term: "S&P 500",
    meaning:
      "An index of about 500 leading US companies, covering about 80% of the US stock market's available value, weighted by the value of their freely traded shares.",
    source: "spdji-sp500",
  },
  {
    id: "spy",
    term: "SPY",
    meaning:
      "The ticker of the State Street SPDR S&P 500 ETF Trust, a fund that aims to match the S&P 500 before expenses. It launched in January 1993, the first ETF listed in the US.",
    strata: "One of STRATA's two instruments.",
    source: "ssga-spy",
  },
  {
    id: "stop-limit",
    term: "Stop-limit order",
    meaning:
      "An order that becomes a limit order when the stop price is reached. It controls the price, but may not fill if the price moves away.",
    strata: "At Alpaca, the only kind of stop order available for crypto.",
    source: "investor-order-types",
  },
  {
    id: "stop-loss",
    term: "Stop-loss",
    short: "stop order",
    meaning:
      "An order that becomes a market order when a price is reached, to limit a loss. In a fast market it can fill well beyond that price.",
    strata: (s) => `Every STRATA position will get one, ${s.risk_limits.STOP_LOSS_PCT}% below the entry (STOP_LOSS_PCT).`,
    source: "investor-stop-order",
  },
  {
    id: "strategy",
    term: "Strategy",
    meaning: "A fixed set of rules that turns data into buy and sell signals.",
  },
  {
    id: "supervisor",
    term: "Supervisor",
    meaning: "In STRATA, the part that weighs the agents' views and the critic's objections into one structured trade proposal.",
    strata: "Phase 6.",
  },
  {
    id: "survivorship-bias",
    term: "Survivorship bias",
    meaning:
      "A backtest mistake: testing only on what still exists today, such as today's index members, which hides the companies that failed along the way.",
  },
  {
    id: "taf",
    term: "TAF",
    short: "trading activity fee",
    meaning:
      "FINRA's small per-share fee on sales: $0.000195 a share, at most $9.79 a trade, in 2026. FINRA has paused it from 1 October to 31 December 2026.",
    strata: (s) => `Included in STRATA's $${s.costs.stock.fee_per_sell_usd.toFixed(2)} estimate per stock sale.`,
    source: "finra-taf",
  },
  {
    id: "take-profit",
    term: "Take-profit",
    meaning: "An exit that sells when a gain target is reached.",
    strata: (s) => `Twice the stop distance: ${s.risk_limits.STOP_LOSS_PCT * 2}% above the entry (operator decision Q5).`,
  },
  {
    id: "ticker",
    term: "Ticker",
    short: "symbol",
    meaning: "The short code for a security, such as SPY. Crypto pairs are written like BTC/USD.",
  },
  {
    id: "time-in-force",
    term: "Time in force",
    short: "TIF",
    meaning: "How long an order stays active: day, GTC, IOC, FOK, OPG or CLS.",
    source: "alpaca-orders",
  },
  {
    id: "trailing-stop",
    term: "Trailing stop",
    meaning: "A stop whose price follows favourable moves at a set distance, and never moves back.",
    strata: "STRATA's plan uses a fixed stop, not a trailing one. At Alpaca, trailing stops are for stocks only, not crypto.",
    source: "investor-stop-bulletin",
  },
  {
    id: "trend-following",
    term: "Trend following",
    meaning: "Buying what is rising and selling what is falling, betting that trends continue.",
    strata: "STRATA's moving-average crossover is a trend-following strategy.",
  },
  {
    id: "volatility",
    term: "Volatility",
    meaning: "How much a price swings. The more volatile, the wider the gap between its highs and lows.",
    source: "investor-mutual-funds-guide",
  },
  {
    id: "volume",
    term: "Volume",
    meaning: "How many shares or coins were traded in a period.",
  },
  {
    id: "walk-forward",
    term: "Walk-forward testing",
    meaning:
      "Repeating “choose the settings on one period, test them on the next” through history, so every result comes from data the settings never saw.",
    strata: "Part of Phase 4.",
  },
  {
    id: "wash-sale",
    term: "Wash sale",
    meaning:
      "A US tax rule: a loss on selling a stock or security can't be deducted yet if you buy the same or a substantially identical one within 30 days before or after. The loss isn't lost: it is added to the cost of the new shares. Tax rules depend on where you live.",
    strata:
      "SPY is a security, so it applies to SPY: a crossover that sells at a loss and buys back within 30 days postpones that loss. Paper trades aren't real sales.",
    source: "irs-p550",
  },
  {
    id: "whipsaw",
    term: "Whipsaw",
    meaning: "A signal that quickly reverses, usually for a small loss. Crossovers suffer from it when prices go sideways.",
  },
  {
    id: "win-rate",
    term: "Win rate",
    meaning: "The share of trades that made money. A low win rate can still make money if the wins are bigger than the losses.",
  },
];
