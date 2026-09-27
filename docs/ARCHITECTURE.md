# Architecture

The target design, the reasons behind it and the phase plan are in
[BUILD_PLAN.md](../BUILD_PLAN.md). This page describes what exists now and how
the pieces fit.

## The shape of the system

```
 Market data ──► analysis agents ──► strategy ──► critic ──► supervisor
                  (typed outputs; LLMs optional and never trusted with money)
                                                               │ structured proposal
                                                               ▼
     ┌──────────── deterministic gate: no AI, no override ────────────┐
     │  risk engine → portfolio engine → execution engine → broker     │
     │  kill switch lives here                                         │
     └─────────────────────────────────────────────────────────────────┘
     every step is stored in PostgreSQL and logged with its reason
```

Agents propose, deterministic code decides. The execution engine will only
accept orders carrying an approval recorded by the risk engine, and will re-check
the limits immediately before sending.

## What exists after Phase 2

| Piece | Module | Does |
|---|---|---|
| Trading config | `strata/config.py` | Reads and strictly checks `config.yaml` (instruments, strategies, risk limits, costs, backtest dates) |
| Infrastructure settings | `strata/settings.py` | `STRATA_` variables: database, Redis, API, logging. Typos are errors |
| Secrets | `strata/credentials.py` | Reads `.env` only; paper/live keys apart; database password; API token |
| Modes | `strata/modes.py` | Backtest / paper / live; the four-lock live gate |
| Logging | `strata/logging_setup.py` | `strata.log`, `decisions.log`, `events.jsonl`; request context; redaction |
| Database | `strata/db/` | Models, pooled connections with time limits, event and audit writers, migrations |
| Redis | `strata/redis_client.py` | Client with time limits; short-lived data only |
| Health | `strata/health.py` | Database, schema version and Redis checks that never raise |
| Operator accounts | `strata/auth/` | scrypt password hashing, sessions in Redis (hashed IDs), login-failure lock-out |
| API | `strata/api/` | FastAPI: health, readiness, status, events, audit log, chart statistics, login/logout; session or bearer-token auth; request IDs |
| Health history | `strata/api/health_history.py` | A background thread that checks health every 15 s and keeps 24 hours of readings in memory; writes `health_failed` / `health_recovered` events |
| Chart statistics | `strata/api/stats.py`, `strata/api/store.py` | Events and audit entries counted per day in the viewer's time zone, by PostgreSQL |
| Market data | `strata/market_data/` | Bars, quotes, trades and order books as STRATA's own types; the Alpaca and mock providers behind one interface; the market calendar; the checks that refuse bad data; the file cache; the record of every download |
| CLI | `strata/cli.py` | `strata status`, `strata db upgrade/current`, `strata operator ...`, `strata data fetch/check`, `strata api` |
| Dashboard | `frontend/src/` | React and TypeScript, built by Vite into static files; reads the API only. Charts in `charts/` |
| Learn section | `frontend/src/learn/` | Chapters, glossary, official-source registry and illustrations; loaded only when opened |
| HTTPS front door | `frontend/nginx/` | nginx: TLS, security headers, the static dashboard, `/api/` passed to the API |
| Certificates | `scripts/make-dashboard-cert.sh` | A local CA limited to home-network names, and the dashboard's certificate |
| Alpaca clients | `strata/alpaca_clients.py` | Connections with time limits, used by the market data provider now and the broker adapter later |
| Containers | `Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` | postgres, redis, migrate, api, frontend; tests and frontend-tests |

## The dashboard and the API

```
 browser, on this machine or the home network
    │  HTTPS, port 8443 (certificate from the local CA)
    ▼
 nginx (frontend container, read-only, runs as you)
    ├─ /            the dashboard's static files
    └─ /api/...  →  http://api:8000/...   nginx sets X-Real-IP itself
                       │
                       ▼
                    API (compose network; 127.0.0.1:8000 on the machine)
                       ├─ PostgreSQL: operators, system events, audit log
                       ├─ Redis: sessions (hashed IDs), login-failure counters
                       └─ memory: the last 24 hours of health readings
```

The browser only ever talks to nginx, so the dashboard and the API share one
origin: no cross-origin access exists to configure or get wrong. The session
cookie travels only over HTTPS and only with requests from the dashboard's own
pages.

Inside the dashboard, one poll of `GET /system/status` every 15 seconds feeds
every page (the PAPER/LIVE banner, overview, system and risk views). The newest
page of events and of the audit log refreshes every 30 seconds. Polling pauses
while the browser tab is hidden. While new data loads, the old stays on screen,
slightly dimmed. Latency sparklines are drawn from the readings this page has
taken since it opened.

### Where each chart's numbers come from

Every chart shows real records or exact arithmetic, never sample data, and each
has a "Show table" view with the same numbers.

| Chart | Page | Source |
|---|---|---|
| Availability (Overview, System) and response times (System) | Overview, System | `GET /system/health/history`: the API checks the database, schema and Redis every 15 seconds and keeps 24 hours of readings **in memory**, in 1-, 5- or 20-minute slots. A restart starts the history afresh, and the chart says when recording began. A check must fail twice in a row before a `health_failed` event is written, and pass twice before `health_recovered`. |
| Sign-ins | Overview | `GET /audit/stats?action=login` and `GET /system/events/stats?event_type=login_failed` |
| Events per day, most frequent | Events | `GET /system/events/stats`: counts by severity and the ten most frequent kinds |
| Activity per day, actions | Audit log | `GET /audit/stats` |
| Round-trip costs | Risk limits | Arithmetic on `config.yaml`: fees and slippage both ways on the largest position |

Days are counted in the viewer's time zone: the browser sends it (`tz`), the
API accepts only names in the time-zone database, and PostgreSQL groups rows
with `date_trunc('day', …, tz)`. A period is at most 90 days. The Events and
Audit pages' period filter (`days` in the address) limits the list below the
charts too, using `since`.

### The Learn section

Six chapters and a glossary, under `/learn`. The code is loaded only when the
section is opened, so the monitoring pages stay small. The chapters quote
STRATA's settings from `GET /system/status`; until that answers they use
`frontend/src/learn/shipped.json`, a copy of `config.yaml` as shipped that
`scripts/dashboard_defaults.py` writes and a test compares with the real file.
Facts about rules, fees and markets link to official sources only (the
registry is `frontend/src/learn/sources.ts`); pictures drawn from invented
prices are labelled as illustrations, and their captions are worked out from
the same numbers they draw.

Each chapter opens with its main points ("In short") and ends with a short
quiz whose every answer is explained (`checks.ts`). In between are labs: an
order walking the order book, one sell order followed day by day through a
gap, a moving-average crossover and the RSI worked out step by step, position
sizing, the overfitting machine, and a pretend trade walked through STRATA's
rules. Their arithmetic is in `labs/sim.ts`, pure functions checked by hand in
`labs/sim.test.ts`; the components only draw what those return. Which chapters
were opened and each quiz's score are kept in the browser (localStorage) and
shown on the Learn index; nothing about them reaches the API.

## Market data

Everything that needs prices asks `MarketData` (`strata/market_data/service.py`),
never Alpaca directly:

```
 MarketData.daily_bars(symbol, asset class, start, end)      end: a finished day only
   │
   ├─ a cached file for exactly this request, recorded in the database,
   │  its SHA-256 matching that record, and still passing the checks?  ──► use it
   │
   └─ otherwise ask the provider ─────► AlpacaMarketData (paper keys, read-only)
                                        or MockMarketData (made-up, marked "mock")
          │
          ▼
      validate_bars: gaps against the market calendar, duplicates, order,
      impossible prices, huge moves, unfinished bars
          │
          ├─ a problem ─► row in market_data_metadata (valid = false, the issues),
          │               market_data_refused event, BadMarketData raised; nothing cached
          │
          └─ clean ─────► CSV + JSON description + SHA-256 in paths.data_dir/market,
                          row in market_data_metadata, market_data_fetched event
```

| Module | Does |
|---|---|
| `models.py` | `Bar`, `BarSeries`, `Quote`, `Trade`, `OrderBook`: frozen, with every time in UTC |
| `providers.py` | The `MarketDataProvider` interface and `MarketDataError` |
| `alpaca.py` | Stock bars from the configured feed (`sip` or `iex`), adjusted as `data.stock_price_adjustment` says; crypto bars; latest quote, trade and (crypto) order book; failures explained in plain words |
| `mock.py` | Made-up prices from a fixed seed: the same bar for a day whatever range is asked for, and known defects on request for testing the checks |
| `calendars.py` | Trading days (Alpaca's calendar for stocks, every day for crypto), where each market's days begin, and the latest finished day |
| `validation.py` | The checks (BUILD_PLAN D26) |
| `cache.py` | Files written whole and never changed; read back only if the hash matches (D27) |
| `records.py` | Writes `market_data_metadata` rows and events; reads back recorded hashes |

A daily bar covers one day where its market counts days: New York for stocks,
Chicago for crypto. It counts as finished 25 hours after it starts (D28).

## Three kinds of settings

```
config.yaml      trading, risk, strategies    committed; changes are reviewed
STRATA_* vars    hosts, ports, log format     set by docker-compose.yml
.env             keys, passwords, tokens      never committed; mounted read-only
```

Each is validated strictly on start-up. Anything wrong stops the program with a
message instead of falling back to a default.

## An API request

1. The request-context middleware assigns a request ID (or keeps a plain one
   from `X-Request-ID`) and binds it to every log event for the request.
2. Protected routes accept a dashboard session (the `strata_session` cookie;
   anything but GET also needs the `X-Strata-Dashboard: 1` header) or the
   bearer token. The session must exist in Redis, and its operator must still
   be enabled and not have changed password since it began. Failures are
   logged and stored as `auth_failed` system events.
3. The route runs. Health routes call the checks, which have their own time
   limits and never raise.
4. The middleware logs method, path, status and duration (never headers or
   query strings) and adds `X-Request-ID`, `Cache-Control: no-store` and
   `X-Content-Type-Options: nosniff` to the response.

## Data model

| Table | Holds | Rules |
|---|---|---|
| `system_events` | Start-up, shutdown, failed logins, migrations, health problems | Severity must be one of debug/info/warning/error/critical |
| `audit_logs` | Who did what, to what, when, with details | Append-only: a trigger rejects UPDATE, DELETE, TRUNCATE |
| `operators` | Dashboard accounts: name, scrypt hash, disabled, created, password changed, last login | Names are lowercase letters, digits and `._-`, 3–64 characters, unique |
| `market_data_metadata` | Every download of prices: provider, symbol, asset class, timeframe, feed, adjustment, range, bar count, first and last bar, whether it passed, its problems, the cached file and its SHA-256 | Refused data has no file; a hash is 64 hexadecimal characters; the range is in order |

Redis holds, with expiry times: each session (keyed by a SHA-256 hash of its
ID, with an index per operator so all of one operator's sessions can be ended)
and login-failure counters per name and per address (15 minutes). Losing Redis
logs everyone out and resets the counters; nothing else is lost.

Later phases add, each in its own migration: accounts, assets, signals, agent decisions, trade proposals, risk decisions, orders,
fills, positions, portfolio snapshots, performance metrics, backtests,
experiments, strategy versions and risk events.

## Logging and events

Every log record goes to three places: readable `strata.log`, the JSON
`events.jsonl`, and the console (JSON in containers). Decisions also go to
`decisions.log`. JSON events always carry: `timestamp` (UTC), `level`, `logger`,
`message`, `component`, `event_type`, `request_id`, `symbol`, `strategy`,
`agent`, `decision`, `result`, `error` and `details`.

## Failing safely

- Configuration, settings or secrets invalid: the program refuses to start (exit 2).
- Database or Redis unreachable: health checks report it within their time
  limits; readiness returns 503; `strata status` exits 1. Logins and sessions
  are refused with 503 (never let through), and the dashboard says which part
  is down and keeps retrying.
- Database behind the code's migrations: the schema check fails until
  `strata db upgrade` runs (compose runs it before the API starts).
- Prices that fail a check are refused, recorded and never cached; a cached
  file that no longer matches its recorded hash is downloaded again. With no
  database, `strata data fetch` downloads nothing, because every download must
  be recorded.
- From Phase 7 onward, the same rule applies to trading: if data, the broker,
  the database or an order's state is uncertain, STRATA doesn't trade.
