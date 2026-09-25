# STRATA build plan

This is the working plan for turning STRATA into a modular, multi-agent trading
platform. It records what exists, the target architecture, the decisions taken
and why, the phases, and the questions that need the operator's answer before
the phases that depend on them.

Ground rules that apply to every phase:

- STRATA is a software project, not a promise of profit. No strategy is called
  profitable without statistically valid, out-of-sample evidence.
- Live trading is never enabled by default and never enabled by us.
- AI agents produce **data** (validated, structured proposals). They never place
  orders. Deterministic code (risk engine, portfolio engine, execution engine)
  decides what may be sent to a broker, and it can't be overridden by an agent.
- When anything is uncertain (stale data, broker down, unknown order state), the
  system does not trade.

---

## 1. Inspection (25 September 2026)

### What already exists (Stage 1 of the original brief)

| Piece | What it does | Keep? |
|---|---|---|
| `config.yaml` + `strata/config.py` | Strict, read-only trading config: instruments (SPY, BTC/USD), strategy parameters, the six original risk limits, costs, backtest dates. Rejects typos, repeated keys, `.inf`, impossible values. | Keep, extend |
| `strata/credentials.py` | Reads secrets from the `.env` file only; paper and live keys kept apart; keys hidden when printed. | Keep |
| `strata/modes.py` | Backtest / paper / live selection. Live needs `--live`, `LIVE_TRADING=true`, live keys and a phrase typed at a terminal. | Keep |
| `strata/logging_setup.py` | `strata.log` + `decisions.log` (every decision needs a reason), key redaction. | Keep, add structured JSON events |
| `strata/alpaca_clients.py` | Alpaca clients with network time limits; paper keys always reach the paper server. | Keep; becomes part of the Alpaca adapters |
| `check_setup.py`, `main.py` | Read-only self-check; start-up checks per mode (no trading yet). | Keep; `main.py` folds into the `strata` CLI in Phase 8 |
| `tests/` | 183 tests, network disabled; every safety check proven by a failing mutant. | Keep, reorganise into `unit/` and `integration/` |

### Development environment (this cloud sandbox)

- Ubuntu 24.04, x86_64, 4 CPUs, 15 GB RAM.
- Python 3.10, 3.11, 3.12 and 3.13 installed; `uv` 0.8 available.
- Docker 29 with Compose v5: the daemon can be started here. Docker Hub rate-limits
  this shared address, so the sandbox daemon uses the `mirror.gcr.io` mirror, and
  containers here can only reach PyPI with the sandbox's TLS-inspection
  certificate. Both workarounds are sandbox-only; the project files use standard
  image names and need nothing special on a normal machine.
- PostgreSQL 16 and Redis 7 installed and started locally for integration tests.
- Node 22 available (dashboard, Phase 9).
- **Blocked here:** Alpaca's servers, `docs.github.com`, SSH to GitHub. Anything
  that talks to Alpaca is built behind an adapter, tested with deterministic
  mocks, and clearly marked as unverified against the real API until the operator
  runs it.

### Operator environment

A fresh Debian machine (setup steps in README). Debian 13 ships Python 3.13;
Debian 12 ships 3.11, which is below the new 3.12 minimum, so on Debian 12 use
Docker (recommended anyway) or install Python 3.12 with `uv`.

---

## 2. Target architecture

```
                 ┌──────────────────────── deterministic ────────────────────────┐
 Market data ──► │ MarketDataAgent (fetch, validate, normalise; flags stale data) │
                 └───────────────┬────────────────────────────────────────────────┘
                                 ▼
          Analysis agents (typed outputs, confidence, reasoning, sources)
   Technical · Quantitative · Regime  (deterministic)
   Sentiment · Fundamental            (optional LLM, deterministic fallback)
                                 ▼
          StrategyAgent  → TradeProposal (versioned strategy rules)
                                 ▼
          CriticAgent    → tries to invalidate; can veto on its own
                                 ▼
          SupervisorAgent → APPROVE / REJECT / WAIT (not an average)
                                 ▼
 ┌──────────────── hard gate: deterministic, no AI, no override ────────────────┐
 │ RiskEngine → PortfolioEngine → ExecutionEngine → BrokerAdapter (paper/Alpaca) │
 │ Kill switch sits here, outside the agent layer.                              │
 └───────────────────────────────────────────────────────────────────────────────┘
           Every step writes an audit record to PostgreSQL.
```

**Processes (docker compose):**

| Service | Role | Arrives |
|---|---|---|
| `postgres` | Source of truth: decisions, orders, fills, positions, audit trail | Phase 1 |
| `redis` | Cache, short-lived market state, queues, locks. No persistence: never the source of truth | Phase 1 |
| `migrate` | One-shot: applies database migrations before anything else starts | Phase 1 |
| `api` | FastAPI: health, status, read models, authenticated admin actions | Phase 1 |
| `worker` | Runs agent analyses and backtests from the queue | Phase 5 |
| `scheduler` | Triggers data refresh, analysis cycles, reconciliation, heartbeats | Phase 8 |
| `frontend` | Dashboard | Phase 9 |

Services are added when they have real work to do; there are no placeholder
containers.

**How an order is protected from agents.** Only the ExecutionEngine can call a
broker, and it only accepts an order carrying an approval that the RiskEngine
recorded in PostgreSQL. It re-runs the risk checks immediately before sending.
LLM output is parsed into Pydantic models and rejected if invalid; LLMs have no
tools that touch orders.

---

## 3. Decisions (made on engineering grounds, recorded here)

| # | Decision | Why |
|---|---|---|
| D1 | Package stays `strata`; the CLI is `strata` (the brief's `astratrade` example renamed to the project name). | One name everywhere. |
| D2 | Python 3.12+ (per the new brief); tested on 3.12 and 3.13; Docker image `python:3.12-slim`. | Brief requirement. |
| D3 | Three kinds of settings: `config.yaml` (trading, risk, strategies; committed), environment variables `STRATA_*` (non-secret infrastructure such as hosts and ports; set by compose), secrets file `.env` (keys, passwords, tokens; never committed; mounted into containers read-only as a Docker secret). | Secrets never live in the image, the compose file or git. |
| D4 | Live mode keeps the four-lock gate from Stage 1 (`--live`, `LIVE_TRADING=true` in `.env`, live keys, phrase typed at a terminal). The new brief's `ENABLE_LIVE_TRADING` is our `LIVE_TRADING`; the mode itself is chosen per command and defaults to paper. | Stricter than the brief's example and already tested. Live can't run as an unattended container: someone must type the phrase. |
| D5 | PostgreSQL with SQLAlchemy 2 and Alembic (psycopg 3). Each phase adds the tables it needs in its own migration. Audit tables are append-only, enforced by a database trigger. | Schema grows with real needs; audit history can't be edited. |
| D6 | Redis holds nothing that can't be rebuilt. Persistence is switched off. | Forces PostgreSQL to stay the source of truth. |
| D7 | Logs: human-readable `strata.log` and `decisions.log` (kept from Stage 1) plus a structured `events.jsonl` with the fields the brief lists. With `STRATA_LOG_FORMAT=json` (containers) the console is JSON too. Secrets are redacted everywhere. | Humans and machines both get a usable log. |
| D8 | API authentication: bearer token (`ADMIN_API_TOKEN` in `.env`, at least 32 characters), compared in constant time. Only `/health` and `/health/ready` are public. If no token is configured, protected endpoints refuse (fail closed). Ports bind to `127.0.0.1` only. | Simple, strong enough for a single-operator machine; per-operator accounts come in Phase 11. |
| D9 | CLI uses the standard library's `argparse`. | One fewer dependency. |
| D10 | Agents are deterministic by default. An `AIProvider` interface is added in Phase 5 with provider `none` as the default; LLM calls are cached and only used for qualitative work (sentiment, news, critique). | Cost control; determinism where numbers are involved. |
| D11 | Dependencies: direct ones declared in `pyproject.toml`; fully pinned, hash-checked lock files (`requirements.txt`, `requirements-dev.txt`) compiled with `uv`. | Reproducible installs; tampered packages are rejected. |
| D12 | Tests: `tests/unit` (no services, network off) and `tests/integration` (real PostgreSQL and Redis, skipped with a message when not available). Tests may only connect to local or private addresses, never the internet. | Tests can never reach a broker. |
| D13 | Long-only, cash-only. `MAX_LEVERAGE` is fixed at 1.0 and any short proposal is rejected by the risk engine. | The original brief forbids leverage, margin, shorting and options. |
| D14 | Detailed docs live in `docs/`; `README.md` and this plan stay at the top level. | Keeps the top level readable. |

---

## 4. How the original brief fits

The original requirements stay in force unless the operator changes them:

- SPY and BTC/USD; moving-average crossover (20/50) and RSI mean-reversion
  (14, buy < 30, sell > 70), long-only.
- Backtests on at least 3 years of daily data with fees and slippage, an
  in-sample/out-of-sample split reported separately, longest losing streak,
  buy-and-hold comparison, and a plain-English explanation of losses.
- The six risk limits (MAX_CAPITAL $300, MAX_POSITION_PCT 20%, STOP_LOSS_PCT 5%,
  DAILY_LOSS_LIMIT $15, TOTAL_LOSS_LIMIT $60 kill switch, MAX_TRADES_PER_DAY 3),
  each with unit tests.
- Retries with backoff, stop when unsure, reconcile on start-up, client order IDs,
  partial fills, no same-day round trips in stocks, `close_all.py`, a reason for
  every decision.
- At least 30 days of reviewed paper trading before live.

Original stages → new phases: Stage 2 (data, backtesting) → Phases 2–4;
Stage 3 (risk manager) → Phase 7; Stage 4 (paper loop, `close_all.py`) → Phase 8.

---

## 5. Phases

Each phase ends with: tests passing, docs updated, logical commits pushed, and a
summary of what was built and what's next.

Documentation grows with the code: Phase 1 adds `docs/ARCHITECTURE.md`,
`DEVELOPMENT.md`, `DEPLOYMENT.md`, `SECURITY.md` and `TRADING_MODES.md`;
`BACKTESTING.md` comes with Phase 4, `AGENTS.md` with Phases 5–6,
`RISK_MANAGEMENT.md` with Phase 7, `OPERATIONS.md` and `DISASTER_RECOVERY.md`
with Phase 8, and `BROKER_INTEGRATION.md` with Phase 10.

| Phase | Deliverables | Done when |
|---|---|---|
| **1. Foundation** | `pyproject.toml`, lock files, ruff and mypy config; infrastructure settings; structured logging; PostgreSQL models and first migration (`system_events`, append-only `audit_logs`); Redis client; health checks; FastAPI (`/health`, `/health/ready`, `/system/status`) with token auth; `strata` CLI (`status`, `db upgrade`, `api`); Dockerfile and compose (postgres, redis, migrate, api, test profile); docs. | `docker compose up` gives a healthy API with migrations applied; unit and integration tests pass; ruff and mypy clean. **Done 25 Sep 2026.** |
| **2. Market data** | Internal models (bars, quotes, trades, order book where available); `MarketDataProvider` interface; historical provider (Alpaca, cached to disk and recorded in `market_data_metadata`); deterministic mock provider; validation (gaps, duplicates, bad prices, stale data). | Data for SPY and BTC/USD loads through one interface; bad data is detected and refused. |
| **3. Analysis** | Indicator library (moving averages, RSI, ATR, volatility, and so on), technical and quantitative analysis, regime detection. | Indicators match reference values; no look-ahead in any calculation. |
| **4. Backtesting** | Event-driven engine (fees, spread, slippage, latency, sizing, stops, targets, partial fills, concurrent positions); metrics from the brief plus the original ones; equity, drawdown and trade-distribution outputs; train/validation/test and walk-forward; experiment records (dataset, dates, strategy version, parameters, git commit, results); versioned strategies (MA crossover 1.0.0, RSI 1.0.0). | The original SPY/BTC comparison runs end to end with out-of-sample results reported separately. |
| **5. Agents** | Agent framework (typed input/output, confidence, reasoning, timestamp, sources, validation, errors, logging); Technical, Quant, Regime, Sentiment, Fundamental, Strategy and Critic agents; optional LLM provider (off by default). | Every agent's output validates against its schema; the critic can veto. |
| **6. Supervisor** | Supervisor decision logic (agreement, conflicts, regime, data quality, correlation, risk/reward); structured `TradeProposal`. | Unit tests show it rejects "most agents say BUY" when the critic or data quality objects. |
| **7. Risk and safety** | Deterministic risk engine (all limits from both briefs), position sizing, portfolio engine, kill switch and its triggers, circuit breakers, audit of every decision. | A test for every limit and every kill-switch trigger; nothing reaches execution without an approval. |
| **8. Paper trading** | Paper broker, execution engine (idempotent client order IDs, partial fills, reconciliation, "unknown means reconcile first"), single-instance lock, scheduler, `strata paper start/stop`, `close_all.py`. | Paper loop runs for days without manual help; restart reconciles without duplicate orders. |
| **9. Dashboard** | Web dashboard with an unmistakable PAPER/LIVE indicator; monitoring views. | Shows equity, positions, P&L, drawdown, agent decisions, rejections, risk events, health. |
| **10. Real broker** | Alpaca `BrokerAdapter` for paper and live accounts. | Contract tests pass against mocks; operator verifies against the real paper account. |
| **11. Security hardening** | Per-operator API credentials, secret handling review, Redis auth, dependency audit, threat model. | Security checklist complete. |
| **12. End-to-end tests** | Full pipeline tests including failures (broker down, stale data, timeouts, partial fills, duplicates). | Failure scenarios behave safely. |
| **13. Paper validation** | At least 30 days of paper trading, reviewed with the operator. | Checklist in README ticked by the operator. |
| **14. Live preparation** | Pre-live checklist and procedures. **We do not enable live trading.** | The operator decides. |

---

## 6. Questions for the operator

These change trading behaviour, so they need your answer before the phase that
uses them. Until then, the proposed default is only a proposal.

| # | Question | Needed by | Proposed default |
|---|---|---|---|
| Q1 | The new brief adds percentage limits (per-trade risk 0.5%, daily loss 2%, drawdown 10%, and so on). With $300 these are much tighter than the original limits: 0.5% risk with a 5% stop allows a $30 position, not $60; a 2% daily loss is $6, not $15; a 10% drawdown is $30, not $60. Keep both sets, with the stricter one winning? | Phase 7 | Keep both; the stricter wins. |
| Q2 | When the 3-trades-per-day limit is used up, or the daily loss halt is active, may a stop-loss sell still go through? | Phase 7 | Yes: block new buys, always allow risk-reducing sells. |
| Q3 | When the kill switch trips, stop only, or close positions first? | Phase 7 | Close positions, then stop. |
| Q4 | A stock bought today that falls through its stop the same day: sell tomorrow (no day trade) or sell now? | Phase 7 | Sell at the next session. |
| Q5 | The new brief's `TradeProposal` needs a take-profit and a minimum risk/reward. The original strategies exit on signals, not targets. Add a target (for example 2× the stop distance) or treat signal exits as having no fixed target? | Phase 6 | Signal exits keep working, plus a target at 2× the stop distance; `MIN_RISK_REWARD` = 1.5. |
| Q6 | Use an LLM for sentiment, news and critique? If so, which provider and what monthly budget? | Phase 5 | No LLM until you decide; deterministic agents only. |

---

## 7. Definition of done

From the brief: the application starts; Docker works; migrations work; the API
works; agents work; backtesting works; paper trading works; the risk engine works;
the kill switch works; the dashboard works; the audit trail works; tests pass;
documentation is complete; failure scenarios are tested; **live trading stays
disabled by default**.

Passing tests doesn't make the system safe. It means the behaviour the tests
describe is present.
