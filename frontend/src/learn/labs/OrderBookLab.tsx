// Markets: buying at market eats through the order book, one price at a time.

import { useState } from "react";

import { Term } from "../Prose";
import { ORDER_BOOK_ASKS } from "../synthetic";
import { Lab, money, Readout, Slider } from "./Lab";
import { walkBook } from "./sim";

const TOTAL = ORDER_BOOK_ASKS.reduce((sum, level) => sum + level.size, 0);

export function OrderBookLab() {
  const [quantity, setQuantity] = useState(400);
  const walk = walkBook(ORDER_BOOK_ASKS, quantity);
  const best = ORDER_BOOK_ASKS[0]!;
  const biggest = Math.max(...ORDER_BOOK_ASKS.map((l) => l.size));
  const takenAt = new Map(walk.fills.map((f) => [f.price, f.size]));
  const atBest = Math.min(quantity, best.size);

  return (
    <Lab
      title="Buy at market: how an order walks the book"
      kind="made-up"
      intro="Drag the slider to buy more shares at once. A market order takes the cheapest offers first, then the next cheapest, and so on."
      note={
        <>
          Real order books change every moment, and for SPY they are far deeper. The lesson holds:
          a big market order pays more than the price on the screen. That extra is{" "}
          <Term id="slippage">slippage</Term> caused by your own order.
        </>
      }
    >
      <Slider
        label="Shares to buy"
        value={quantity}
        min={50}
        max={2600}
        step={50}
        onChange={setQuantity}
        format={(n) => n.toLocaleString("en-US")}
      />
      <table className="table book-lab">
        <caption className="table__caption">Offers to sell, cheapest first, and what your order takes</caption>
        <thead>
          <tr>
            <th scope="col">Price</th>
            <th scope="col">Offered</th>
            <th scope="col">You take</th>
          </tr>
        </thead>
        <tbody>
          {ORDER_BOOK_ASKS.map((level) => {
            const taken = takenAt.get(level.price) ?? 0;
            return (
              <tr key={level.price} className={taken ? "is-taken" : undefined}>
                <td className="mono">{money(level.price)}</td>
                <td>
                  <span className="book-lab__bar" aria-hidden="true">
                    <span className="book-lab__offered" style={{ width: `${(level.size / biggest) * 100}%` }}>
                      <span className="book-lab__taken" style={{ width: `${(taken / level.size) * 100}%` }} />
                    </span>
                  </span>
                  <span className="mono">{level.size.toLocaleString("en-US")}</span>
                </td>
                <td className="mono">{taken ? taken.toLocaleString("en-US") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="lab-readouts" aria-live="polite">
        <Readout
          label="Average price paid"
          value={walk.average === null ? "—" : `$${walk.average.toFixed(4)}`}
          detail={`best offer ${money(best.price)}`}
        />
        <Readout
          label="Extra paid, in all"
          value={walk.slippage === null ? "—" : money(walk.slippage * walk.filled)}
          detail={walk.slippage === null ? "" : `${walk.slippage >= 0.00005 ? `$${walk.slippage.toFixed(4)}` : "nothing"} a share over the best offer`}
        />
        <Readout
          label="Bought"
          value={`${walk.filled.toLocaleString("en-US")} of ${quantity.toLocaleString("en-US")}`}
          detail={walk.unfilled ? `the book ran out after ${TOTAL.toLocaleString("en-US")}` : "all of it"}
        />
      </div>
      <p className="lab__explain">
        {walk.unfilled
          ? `This book offers only ${TOTAL.toLocaleString("en-US")} shares. A market order this big would keep buying from offers further up, at worse prices still.`
          : walk.fills.length === 1
            ? `The first ${best.size} shares on offer cost ${money(best.price)}, so ${quantity.toLocaleString("en-US")} shares all fill at the best price.`
            : `Only ${best.size} shares were offered at ${money(best.price)}; the rest came from ${walk.fills.length - 1} dearer ${walk.fills.length - 1 === 1 ? "price" : "prices"}, up to ${money(walk.fills[walk.fills.length - 1]!.price)}.`}{" "}
        {atBest === quantity ? (
          <>
            A <Term id="limit-order">limit order</Term> at {money(best.price)} would buy them all at that price too.
          </>
        ) : (
          <>
            A <Term id="limit-order">limit order</Term> at {money(best.price)} would buy just {atBest.toLocaleString("en-US")} now
            and wait for the other {(quantity - atBest).toLocaleString("en-US")}: it never pays more, but it may never fill.
          </>
        )}
      </p>
    </Lab>
  );
}
