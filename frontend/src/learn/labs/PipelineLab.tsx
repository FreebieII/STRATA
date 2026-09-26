// How STRATA trades: send a pretend trade idea through the pipeline, and see
// which rule stops it, or that it gets through.

import { useState } from "react";

import type { RiskLimitsSummary } from "../../api/types";
import { Segmented } from "../../components/Filters";
import { IconCritical, IconGood, IconUnknown } from "../../components/Icons";
import { Lab, Toggle } from "./Lab";
import { walkPipeline, type Situation } from "./sim";

export function PipelineLab({ limits }: { limits: RiskLimitsSummary }) {
  const good: Situation = {
    side: "buy",
    dataFresh: true,
    strategySignals: true,
    criticObjects: false,
    killSwitch: false,
    dailyLossReached: false,
    tradesToday: 0,
    positionPct: limits.MAX_POSITION_PCT,
  };
  const presets: { label: string; situation: Situation }[] = [
    { label: "A good idea", situation: good },
    { label: "Stale data", situation: { ...good, dataFresh: false } },
    { label: "Too big", situation: { ...good, positionPct: limits.MAX_POSITION_PCT * 2 } },
    { label: "A bad day: a new buy", situation: { ...good, dailyLossReached: true, tradesToday: limits.MAX_TRADES_PER_DAY } },
    {
      label: "A bad day: a stop-loss sale",
      situation: { ...good, side: "sell", dailyLossReached: true, tradesToday: limits.MAX_TRADES_PER_DAY },
    },
  ];
  const [s, setS] = useState<Situation>(good);
  const set = (change: Partial<Situation>) => setS((current) => ({ ...current, ...change }));
  const stages = walkPipeline(s, limits);
  const stop = stages.find((stage) => stage.outcome === "stop");
  const sizes = [...new Set([Math.round(limits.MAX_POSITION_PCT / 2), limits.MAX_POSITION_PCT, limits.MAX_POSITION_PCT * 2])];

  return (
    <Lab
      title="Send a pretend trade through STRATA"
      kind="rules"
      intro="Set up the situation, or pick one below, and follow the idea step by step. The first rule that says no stops it, and nothing after that runs."
      note="None of these parts exist yet: they arrive in Phases 2 to 8. This follows the rules already decided for them in BUILD_PLAN.md, so you can see how they fit together."
    >
      <div className="lab-presets" role="group" aria-label="Situations to try">
        {presets.map((p) => (
          <button key={p.label} type="button" className="button button--small" onClick={() => setS(p.situation)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="lab-controls">
        <Segmented<Situation["side"]>
          label="The idea"
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell, to reduce risk" },
          ]}
          value={s.side}
          onChange={(v) => set({ side: v ?? "buy" })}
        />
        <Segmented<string>
          label="Trades already today"
          options={Array.from({ length: limits.MAX_TRADES_PER_DAY + 1 }, (_, i) => ({ value: String(i), label: String(i) }))}
          value={String(Math.min(s.tradesToday, limits.MAX_TRADES_PER_DAY))}
          onChange={(v) => set({ tradesToday: Number(v ?? 0) })}
        />
        {s.side === "buy" ? (
          <Segmented<string>
            label="Size"
            options={sizes.map((n) => ({ value: String(n), label: `${n}% of capital` }))}
            value={String(s.positionPct)}
            onChange={(v) => set({ positionPct: Number(v ?? limits.MAX_POSITION_PCT) })}
          />
        ) : null}
      </div>
      <div className="lab-toggles">
        <Toggle label="The market data is fresh and passes its checks" checked={s.dataFresh} onChange={(v) => set({ dataFresh: v })} />
        <Toggle label="The strategy gives a signal" checked={s.strategySignals} onChange={(v) => set({ strategySignals: v })} />
        <Toggle label="The critic objects" checked={s.criticObjects} onChange={(v) => set({ criticObjects: v })} />
        <Toggle label={`Today's losses reached $${limits.DAILY_LOSS_LIMIT}`} checked={s.dailyLossReached} onChange={(v) => set({ dailyLossReached: v })} />
        <Toggle label="The kill switch has tripped" checked={s.killSwitch} onChange={(v) => set({ killSwitch: v })} />
      </div>

      <ol className="pipeline-walk" aria-label="Each step, in order">
        {stages.map((stage) => (
          <li key={stage.name} className={`pipeline-walk__stage is-${stage.outcome.replace(" ", "-")}`}>
            <span className="pipeline-walk__icon">
              {stage.outcome === "pass" ? (
                <IconGood size={16} label="passed" />
              ) : stage.outcome === "stop" ? (
                <IconCritical size={16} label="stopped" />
              ) : (
                <IconUnknown size={16} label="not reached" />
              )}
            </span>
            <span className="pipeline-walk__name">{stage.name}</span>
            <span className="pipeline-walk__reason">{stage.reason}</span>
          </li>
        ))}
      </ol>
      <p className={`lab__result lab__result--${stop ? "stopped" : "sent"}`} aria-live="polite">
        {stop ? (
          <>
            <strong>Stopped at “{stop.name}”.</strong> Nothing is sent to the broker, and the reason is
            logged.
          </>
        ) : (
          <>
            <strong>Sent.</strong> Every rule said yes, so the order goes to Alpaca's paper account, with
            pretend money.
          </>
        )}
      </p>
    </Lab>
  );
}
