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

## What exists after Phase 1

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
| API | `strata/api/` | FastAPI: health, readiness, status; bearer-token auth; request IDs |
| CLI | `strata/cli.py` | `strata status`, `strata db upgrade/current`, `strata api` |
| Alpaca clients | `strata/alpaca_clients.py` | Connections with time limits; becomes part of the broker and data adapters |
| Containers | `Dockerfile`, `docker-compose.yml` | postgres, redis, migrate, api, tests |

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
2. Protected routes check the bearer token. Failures are logged and stored as
   `auth_failed` system events.
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

Later phases add, each in its own migration: accounts, assets, market data
metadata, signals, agent decisions, trade proposals, risk decisions, orders,
fills, positions, portfolio snapshots, performance metrics, backtests,
experiments, strategy versions, risk events and operators.

## Logging and events

Every log record goes to three places: readable `strata.log`, the JSON
`events.jsonl`, and the console (JSON in containers). Decisions also go to
`decisions.log`. JSON events always carry: `timestamp` (UTC), `level`, `logger`,
`message`, `component`, `event_type`, `request_id`, `symbol`, `strategy`,
`agent`, `decision`, `result`, `error` and `details`.

## Failing safely

- Configuration, settings or secrets invalid: the program refuses to start (exit 2).
- Database or Redis unreachable: health checks report it within their time
  limits; readiness returns 503; `strata status` exits 1.
- Database behind the code's migrations: the schema check fails until
  `strata db upgrade` runs (compose runs it before the API starts).
- From Phase 7 onward, the same rule applies to trading: if data, the broker,
  the database or an order's state is uncertain, STRATA doesn't trade.
