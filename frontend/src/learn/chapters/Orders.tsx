import { COST_LEGEND, CostBars, smallPct } from "../../charts/CostBars";
import { roundTrip } from "../../lib/costs";
import { Figure } from "../illustrations/Illustrations";
import { Callout, Cite, Section, Term } from "../Prose";
import { useSetup } from "../useSetup";

export const ORDERS_SOURCES = [
  "investor-order-types",
  "investor-market-order",
  "investor-limit-order",
  "investor-stop-order",
  "investor-stop-bulletin",
  "alpaca-orders",
  "alpaca-crypto",
  "alpaca-fractional",
  "investor-t1",
  "sec-t1",
  "investor-margin",
  "investor-short",
  "investor-day-trading",
  "sec-pdt-approval",
  "finra-notice-26-10",
  "finra-intraday-margin",
  "alpaca-intraday-margin",
  "sec-section-31",
  "finra-taf",
  "alpaca-regulatory-fees",
  "alpaca-crypto-fees",
] as const;

// The SEC's Section 31 fee since 4 April 2026, per dollar sold, and FINRA's
// trading activity fee per share sold (both on sales only).
const SEC_FEE_PER_DOLLAR = 20.6 / 1_000_000;
const TAF_PER_SHARE = 0.000195;
// The most shares on which the TAF stays under a cent.
const TAF_SUB_CENT_SHARES = Math.floor(0.01 / TAF_PER_SHARE - 1e-9);

export function OrdersChapter() {
  const { setup } = useSetup();
  const value = setup.risk_limits.max_position_value;
  const secFee = value * SEC_FEE_PER_DOLLAR;
  const budget = setup.costs.stock.fee_per_sell_usd;
  const rows = [
    { label: "Stock or ETF", cost: roundTrip(setup.costs.stock, value) },
    { label: "Crypto", cost: roundTrip(setup.costs.crypto, value) },
  ];
  return (
    <>
      <p className="learn-lede">
        An order is an instruction to your broker: buy or sell, how much, at what price, and for how
        long. Choosing the right kind is a trade-off between getting a fill and getting a price.
      </p>

      <Section id="types" title="Kinds of order">
        <div className="table-scroll">
          <table className="table">
            <caption className="table__caption">The main order types<Cite id="investor-order-types" /></caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">What it does</th>
                <th scope="col">The catch</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="strong"><Term id="market-order">Market</Term></td>
                <td>Buy or sell now, at the best price available<Cite id="investor-market-order" /></td>
                <td>The price isn't guaranteed; in a fast market it can be far from the last trade.</td>
              </tr>
              <tr>
                <td className="strong"><Term id="limit-order">Limit</Term></td>
                <td>Buy at a set price or lower, sell at a set price or higher<Cite id="investor-limit-order" /></td>
                <td>It may never fill if the price doesn't reach it.</td>
              </tr>
              <tr>
                <td className="strong"><Term id="stop-loss">Stop</Term> (stop-loss)</td>
                <td>When the stop price is reached, becomes a market order<Cite id="investor-stop-order" /></td>
                <td>The sale can happen well below the stop in a fast market, and a brief dip can set it off.</td>
              </tr>
              <tr>
                <td className="strong"><Term id="stop-limit">Stop-limit</Term></td>
                <td>When the stop price is reached, becomes a limit order</td>
                <td>It controls the price, but may not fill at all if the price keeps falling.</td>
              </tr>
              <tr>
                <td className="strong"><Term id="trailing-stop">Trailing stop</Term></td>
                <td>A stop that follows the price up at a set distance, but never moves down<Cite id="investor-stop-bulletin" /></td>
                <td>Venues differ in what triggers it, and not every broker offers it.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          At Alpaca, stocks can use all five; crypto only market, limit and stop-limit orders
          <Cite id="alpaca-orders" />
          <Cite id="alpaca-crypto" />.
        </p>
        <Callout>
          Every STRATA position will be protected by a stop. For bitcoin, where Alpaca has no plain
          stop order, that means a stop-limit, or STRATA watching the price itself and selling. Phase
          8 settles this, and its limits, before any trading starts.
        </Callout>
      </Section>

      <Section id="time-in-force" title="How long an order lasts">
        <p>
          The <Term id="time-in-force">time in force</Term> says when an unfilled order is cancelled
          <Cite id="alpaca-orders" />:
        </p>
        <ul>
          <li><Term id="day-order">Day</Term>: at the end of today's session.</li>
          <li><Term id="gtc">GTC</Term> (good 'til cancelled): only when you cancel it.</li>
          <li><Term id="ioc">IOC</Term> (immediate or cancel): fill what you can now, cancel the rest.</li>
          <li><Term id="fok">FOK</Term> (fill or kill): all of it now, or none.</li>
          <li><Term id="opg-cls">OPG and CLS</Term>: only in the opening or closing auction.</li>
        </ul>
        <p>
          At Alpaca, crypto orders can be GTC or IOC, and orders for part of a share are day orders
          only<Cite id="alpaca-fractional" />.
        </p>
      </Section>

      <Section id="fills" title="Fills, partial fills and slippage">
        <p>
          When an order trades, it is <Term id="fill">filled</Term>. Only some of it may fill at first:
          a <Term id="partial-fill">partial fill</Term>. The price you get usually differs a little
          from the one you saw; that difference is <Term id="slippage">slippage</Term>.
        </p>
        <Callout>
          STRATA gives every order a <Term id="client-order-id">client order ID</Term> before sending
          it, so a request retried after a network error can never create a second order. It tracks
          partial fills, and on every start-up it <Term id="reconciliation">reconciles</Term> its
          records with Alpaca's before doing anything else. When it isn't sure what it holds, it
          doesn't trade. (Phase 8.)
        </Callout>
      </Section>

      <Section id="fractions" title="Buying part of a share">
        <p>
          STRATA sizes each position in dollars, at most {`$${value}`}, not in shares. So it buys{" "}
          <Term id="fractional-share">fractional shares</Term>: it asks for an amount in dollars (the{" "}
          <Term id="notional">notional</Term>) and gets whatever part of a share that buys. Alpaca's
          minimum is $1<Cite id="alpaca-fractional" />.
        </p>
      </Section>

      <Section id="settlement" title="Settlement">
        <p>
          A trade isn't final the moment it fills. <Term id="settlement">Settlement</Term>, when the
          shares and the cash actually change hands, happens one business day later (T+1) for most US
          trades since 28 May 2024; before that it took two<Cite id="investor-t1" />
          <Cite id="sec-t1" />.
        </p>
      </Section>

      <Section id="accounts" title="Cash, margin, and borrowing">
        <p>
          In a <Term id="cash-account">cash account</Term> you only spend your own money. In a{" "}
          <Term id="margin">margin account</Term> the broker lends you money against your holdings:
          more buying power, and bigger possible losses<Cite id="investor-margin" />.{" "}
          <Term id="short-selling">Short selling</Term>, selling borrowed shares to buy back later,
          has no limit on how much it can lose<Cite id="investor-short" />.
        </p>
        <Callout>
          STRATA never borrows, never uses <Term id="leverage">leverage</Term> and never sells short.
          It only buys what it can pay for, and sells what it owns.
        </Callout>
      </Section>

      <Section id="day-trading" title="Day trading rules changed in 2026">
        <p>
          A <Term id="day-trade">day trade</Term> is buying and selling the same security on the same
          day; Investor.gov calls day trading extremely risky<Cite id="investor-day-trading" />. From
          2001, the <Term id="pdt">pattern day trader</Term> rule applied to margin accounts: anyone
          making 4 or more day trades in 5 business days (if they were more than 6% of their trades)
          had to keep at least $25,000 in the account.
        </p>
        <p>
          That rule is gone. The SEC approved FINRA's replacement on 14 April 2026, and new{" "}
          <Term id="intraday-margin">intraday margin rules</Term> took effect on 4 June 2026. Instead
          of counting trades, they require enough margin throughout the day. Brokers may switch over
          until 20 October 2027<Cite id="sec-pdt-approval" />
          <Cite id="finra-notice-26-10" />
          <Cite id="finra-intraday-margin" />. Alpaca switched on 4 June 2026
          <Cite id="alpaca-intraday-margin" />.
        </p>
        <Callout>
          STRATA still never buys and sells the same stock on the same day. The original brief asked
          for this, and the operator decided (decision Q4) that a stock hitting its stop on the day
          it was bought is sold at the next session. Both were decided under the old rule; they stay
          until the operator changes them.
        </Callout>
      </Section>

      <Section id="fees" title="What trading costs">
        <p>
          Alpaca charges no commission on US stocks and ETFs. Two small regulatory fees apply to
          every sale and are passed on<Cite id="alpaca-regulatory-fees" />: the SEC's{" "}
          <Term id="section-31">Section 31 fee</Term>, $20.60 per million dollars sold since 4 April
          2026<Cite id="sec-section-31" />, and FINRA's <Term id="taf">trading activity fee</Term>,
          $0.000195 a share up to $9.79 a trade, which FINRA has paused from 1 October to 31
          December 2026<Cite id="finra-taf" />.{" "}
          {secFee < 0.01 && budget >= 0.02 ? (
            <>
              On a ${value} sale the SEC fee comes to ${secFee.toFixed(4)}, and the TAF stays under a
              cent on sales of up to {TAF_SUB_CENT_SHARES} shares, far more than ${value} of SPY buys.
              STRATA budgets ${budget.toFixed(2)} a sale for the two, enough even if each were rounded
              up to a whole cent.
            </>
          ) : (
            <>
              On a ${value} sale the SEC fee comes to ${secFee.toFixed(2)}; STRATA budgets $
              {budget.toFixed(2)} a sale for both fees (<span className="mono">fee_per_sell_usd</span>{" "}
              in config.yaml).
            </>
          )}
        </p>
        <p>
          Crypto costs more. Alpaca's crypto fees depend on the last 30 days' trading volume; at the
          smallest volumes, when this was written, they were 0.15% for orders that wait in the book
          (maker) and 0.25% for orders that trade at once (taker)<Cite id="alpaca-crypto-fees" />.
        </p>
        <Figure
          title={`What one round trip costs, on a $${value} position`}
          kind="settings"
          legend={COST_LEGEND}
          caption={
            <>
              From config.yaml: stocks {setup.costs.stock.fee_pct}% fee and ${setup.costs.stock.fee_per_sell_usd.toFixed(2)} per
              sale (the regulatory fees, rounded up), crypto {setup.costs.crypto.fee_pct}% fee (the
              taker rate); plus slippage of {setup.costs.stock.slippage_pct}% and{" "}
              {setup.costs.crypto.slippage_pct}% on every fill. A crypto trade must rise about{" "}
              {smallPct(rows[1]!.cost.breakevenPct)} before it makes any money.
            </>
          }
        >
          <CostBars rows={rows} />
        </Figure>
      </Section>
    </>
  );
}
