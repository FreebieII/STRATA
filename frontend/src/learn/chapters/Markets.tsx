import { CandleDiagram, SessionClock, SpreadDiagram } from "../illustrations/Illustrations";
import { OrderBookLab } from "../labs/OrderBookLab";
import { Callout, Cite, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const MARKETS_SOURCES = [
  "investor-etf",
  "investor-index-fund",
  "spdji-sp500",
  "ssga-spy",
  "investor-crypto-spotlight",
  "cftc-virtual-currency",
  "alpaca-crypto",
  "nyse-hours",
  "investor-extended-hours",
  "alpaca-24-5",
  "nyse-extended-hours",
  "nasdaq-night-session",
  "investor-spread",
  "investor-liquidity",
  "investor-mutual-funds-guide",
  "sipc-protects",
  "investor-circuit-breakers",
] as const;

export function MarketsChapter() {
  const { setup } = useSetup();
  return (
    <>
      <p className="learn-lede">
        A market is where people who want to buy meet people who want to sell. This chapter covers
        what STRATA trades, where and when it trades, and how to read a price.
      </p>

      <Section id="what" title="What is traded">
        <p>
          A <strong>share</strong> (or stock) is a small piece of ownership in a company. Its price
          moves as people change their minds about what the company is worth.
        </p>
        <p>
          An <Term id="etf">exchange-traded fund</Term> (ETF) is a fund that holds many investments
          and whose own shares trade on an exchange, at market prices, throughout the day
          <Cite id="investor-etf" />. An <Term id="index-fund">index fund</Term> tries to match an{" "}
          <Term id="index">index</Term> rather than pick investments itself
          <Cite id="investor-index-fund" />.
        </p>
        <p>
          The <Term id="sp500">S&amp;P 500</Term> is an index of about 500 leading US companies,
          covering about 80% of the US stock market's available value. Big companies count for more:
          each is weighted by the value of its freely traded shares
          <Cite id="spdji-sp500" />.
        </p>
        <p>
          <Term id="spy">SPY</Term> is the State Street SPDR S&amp;P 500 ETF Trust, which aims to
          match the S&amp;P 500's price and dividends before expenses. It launched on 22 January 1993
          as the first ETF listed in the US, and its yearly cost was 0.0945% of the money invested
          when this was written<Cite id="ssga-spy" />. One SPY share is a slice of about 500 of the
          largest US companies at once.
        </p>
        <p>
          A <Term id="crypto">crypto asset</Term> is a digital asset recorded on a blockchain.{" "}
          <Term id="btc">Bitcoin</Term> (BTC) is the largest; <strong>BTC/USD</strong> is its price in
          US dollars. Regulators warn that crypto is highly speculative and volatile, that fraud is
          common, and that a bitcoin transfer usually can't be reversed
          <Cite id="investor-crypto-spotlight" />
          <Cite id="cftc-virtual-currency" />.
        </p>
        <Callout>
          STRATA trades exactly two things: SPY and BTC/USD. They behave very differently: SPY spreads
          its risk over hundreds of companies, while bitcoin's price swings far more. That makes them
          a useful pair for comparing the same strategy in two kinds of market.
        </Callout>
      </Section>

      <Section id="where" title="Where it trades">
        <p>
          Stocks and ETFs trade on <Term id="exchange">exchanges</Term> such as the{" "}
          <Term id="nyse">NYSE</Term> and <Term id="nasdaq">Nasdaq</Term>. You don't deal with an
          exchange directly: a <Term id="broker">broker</Term> holds your account and sends your
          orders for you.
        </p>
        <p>
          STRATA's broker is <Term id="alpaca">Alpaca</Term>, which programs can use through its{" "}
          <Term id="api">API</Term>. Alpaca offers two kinds of account: a paper account with pretend
          money, and a live account with real money. Crypto at Alpaca is handled by a separate
          company, Alpaca Crypto LLC, which is not a member of SIPC or FINRA
          <Cite id="alpaca-crypto" />. Crypto trades 24 hours a day, every day.
        </p>
      </Section>

      <Section id="when" title="When it trades">
        <p>
          The US stock market's regular session runs from 9:30 a.m. to 4:00 p.m. New York time
          (Eastern Time), Monday to Friday, except on market holidays. The NYSE publishes the
          holidays and early closes<Cite id="nyse-hours" />. Some trading also happens before the
          open (pre-market, from 4:00 a.m.) and after the close (after hours, until 8:00 p.m.). Fewer
          people trade then, so spreads are wider and prices can swing more
          <Cite id="investor-extended-hours" />.
        </p>
        <SessionClock resetZone={setup.timezone} />
        <p>
          Trading hours are getting longer. Alpaca already runs an overnight session from 8:00 p.m.
          to 4:00 a.m. Eastern Time, Sunday to Friday, for limit orders only
          <Cite id="alpaca-24-5" />. US exchanges have approval for trading 23 hours a day, five
          days a week, planned to start on 6 December 2026
          <Cite id="nyse-extended-hours" />
          <Cite id="nasdaq-night-session" />.
        </p>
      </Section>

      <Section id="prices" title="Reading a price">
        <p>
          A price you see is usually the last trade. What you can actually trade at is the{" "}
          <strong>quote</strong>: the <Term id="bid">bid</Term> (the most a buyer will pay) and the{" "}
          <Term id="ask">ask</Term> (the least a seller will accept). The gap between them is the{" "}
          <Term id="bid-ask-spread">spread</Term>, a hidden cost of every trade at market prices
          <Cite id="investor-spread" />.
        </p>
        <SpreadDiagram />
        <OrderBookLab />
        <p>
          Over a day, prices are summed up as a bar or <Term id="candle">candle</Term>: open, high,
          low and close (<Term id="ohlcv">OHLC</Term>), usually with the{" "}
          <Term id="volume">volume</Term> traded.
        </p>
        <CandleDiagram />
        <p>
          Two more words come up everywhere. <Term id="liquidity">Liquidity</Term> is how easily you
          can buy or sell without moving the price<Cite id="investor-liquidity" />.{" "}
          <Term id="volatility">Volatility</Term> is how much the price swings
          <Cite id="investor-mutual-funds-guide" />.
        </p>
      </Section>

      <Section id="protection" title="What protects you, and what doesn't">
        <p>
          If a US brokerage firm fails, <Term id="sipc">SIPC</Term> restores customers' cash and
          securities up to $500,000, including up to $250,000 in cash. It does not protect against
          prices falling, and it doesn't cover crypto that isn't a security
          <Cite id="sipc-protects" />.
        </p>
        <p>
          In a crash, the whole US market pauses: <Term id="circuit-breaker">circuit breakers</Term>{" "}
          halt trading for 15 minutes when the S&amp;P 500 falls 7% or 13% from the previous close
          (before 3:25 p.m.), and for the rest of the day at 20%
          <Cite id="investor-circuit-breakers" />.
        </p>
        <Callout kind="careful" title="Nothing protects you from losses">
          No rule or fund makes trading safe. Every protection above is about a broker failing or a
          market in chaos, never about a strategy losing money. That is what STRATA's own limits are
          for.
        </Callout>
      </Section>
    </>
  );
}
