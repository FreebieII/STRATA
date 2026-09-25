# Trading modes

STRATA has three modes:

| Mode | Money | Uses |
|---|---|---|
| `backtest` | none: simulated on past prices | paper keys, for market data |
| `paper` | Alpaca's fake money | paper keys, Alpaca's paper server |
| `live` | **real money** | live keys, Alpaca's live server |

**Paper is the default.** Nothing ever switches to live on its own.

## Current status (Phase 1)

No mode trades yet. `python main.py --mode <mode>` runs each mode's start-up
checks and stops, recording the decision in `logs/decisions.log`. The backtester
arrives in Phase 4 and the paper-trading loop in Phase 8 (see
[BUILD_PLAN.md](../BUILD_PLAN.md)).

## The live-mode lock

Live mode starts only when **all four** of these hold, checked in this order.
If any is missing, STRATA refuses to start and says which.

1. **The `--live` flag**, together with `--mode live`. (`--live` with any other
   mode is refused as a likely mistake.)
2. **`LIVE_TRADING=true` in `.env`**, exactly. Only the `.env` file counts: a
   variable set in the shell is ignored, and so are `1`, `yes` or `True!`.
3. **Live keys in `.env`** (`ALPACA_LIVE_API_KEY`, `ALPACA_LIVE_SECRET_KEY`).
   They have different names from the paper keys, so paper mode can never pick
   them up, and paper keys always go to the paper server.
4. **The confirmation phrase, typed by a person** after STRATA shows the risk
   limits. Input that is piped in or redirected from a file is refused.

Because of rule 4, live trading can never start unattended: not from a script,
not from a container restart, not after a crash. Someone has to be at the
keyboard. That is deliberate.

## Relation to the platform brief

The platform brief suggests `TRADING_MODE=paper` and `ENABLE_LIVE_TRADING=false`.
In STRATA the mode is chosen per command (default paper), and
`ENABLE_LIVE_TRADING` is the `LIVE_TRADING` switch above. The four-lock design
is stricter than the brief's example and was already tested, so it stays.

## What the API reports

`GET /system/status` includes `live_trading_switch`: whether `.env` says
`LIVE_TRADING=true`. It does **not** mean live trading is running; that also
needs the flag and the typed phrase. From Phase 8 the running engine will report
its actual mode, and from Phase 9 the dashboard will show an unmistakable
PAPER / LIVE indicator.
