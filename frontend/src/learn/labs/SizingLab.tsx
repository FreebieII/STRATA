// Risk: how the size of a position decides what one bad trade costs.

import { useState } from "react";

import type { RiskLimitsSummary } from "../../api/types";
import { Pips } from "../../components/Meter";
import { recoveryNeeded } from "../indicators";
import { Lab, money, Readout, Slider } from "./Lab";
import { sizeTrade } from "./sim";

const pct = (n: number) => `${+n.toFixed(2)}%`;

export function SizingLab({ limits }: { limits: RiskLimitsSummary }) {
  const [capital, setCapital] = useState(limits.MAX_CAPITAL);
  const [share, setShare] = useState(limits.MAX_POSITION_PCT);
  const [stop, setStop] = useState(limits.STOP_LOSS_PCT);
  const s = sizeTrade(capital, share, stop, limits.DAILY_LOSS_LIMIT, limits.TOTAL_LOSS_LIMIT);
  const isConfigured = capital === limits.MAX_CAPITAL && share === limits.MAX_POSITION_PCT && stop === limits.STOP_LOSS_PCT;
  const badDay = (s.dailyAllows ?? 0) * s.lossAtStop;
  const badDayPct = capital > 0 ? (badDay / capital) * 100 : 0;

  return (
    <Lab
      title="How much can one trade cost?"
      kind="arithmetic"
      intro="Change the money, the share of it in one position, and the stop. The loss limits stay at STRATA's settings."
    >
      <div className="lab-controls">
        <Slider label="Capital" value={capital} min={100} max={2000} step={50} onChange={setCapital} format={(n) => money(n, 0)} />
        <Slider label="Largest position" value={share} min={5} max={100} step={5} onChange={setShare} format={(n) => `${n}% of capital`} />
        <Slider label="Stop-loss" value={stop} min={1} max={20} step={0.5} onChange={setStop} format={(n) => `${n}% below the price paid`} />
        <button
          type="button"
          className="button button--small button--ghost"
          disabled={isConfigured}
          onClick={() => {
            setCapital(limits.MAX_CAPITAL);
            setShare(limits.MAX_POSITION_PCT);
            setStop(limits.STOP_LOSS_PCT);
          }}
        >
          Use STRATA's settings
        </button>
      </div>
      <div className="lab-readouts" aria-live="polite">
        <Readout label="One position" value={money(s.position)} detail={`${share}% of ${money(capital, 0)}`} />
        <Readout label="Lost if it hits the stop" value={money(s.lossAtStop)} detail={`${pct(s.lossPct)} of your capital`} />
        <Readout
          label={`The ${money(limits.DAILY_LOSS_LIMIT, 0)} daily limit allows`}
          value={s.dailyAllows === null ? "—" : `${s.dailyAllows} stop-outs`}
          detail={s.dailyAllows !== null ? <Pips count={s.dailyAllows} label={`${s.dailyAllows} stop-outs`} /> : null}
        />
        <Readout
          label={`The ${money(limits.TOTAL_LOSS_LIMIT, 0)} kill switch allows`}
          value={s.totalAllows === null ? "—" : `${s.totalAllows} stop-outs`}
          detail={s.totalAllows !== null ? <Pips count={s.totalAllows} label={`${s.totalAllows} stop-outs`} /> : null}
        />
      </div>
      <p className="lab__explain">
        {s.dailyAllows === 0
          ? `A single stop-out (${money(s.lossAtStop)}) is already more than the ${money(limits.DAILY_LOSS_LIMIT, 0)} daily limit: one bad trade would stop the day. That position is too big for these limits.`
          : s.dailyAllows === null
            ? "With no stop, a position never loses to its stop, but nothing limits how far it can fall either."
            : `After ${s.dailyAllows} stop-outs in a row you'd be down ${money(badDay)}, ${pct(badDayPct)} of your capital, and need a gain of ${pct(recoveryNeeded(badDayPct))} to get back. `}
        {s.dailyAllows ? "The smaller each loss, the more mistakes you can survive while you find out whether a strategy works." : ""}
      </p>
    </Lab>
  );
}
