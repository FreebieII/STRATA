# Security

STRATA handles API keys that can move real money. The design assumes mistakes
will happen and tries to make each one harmless: a key pasted into the wrong
place, an order a strategy shouldn't send, an AI agent that is wrong.

## Secrets

| Secret | Lives in | Read by |
|---|---|---|
| Alpaca paper keys | `.env` | backtest and paper mode, `check_setup.py` |
| Alpaca live keys | `.env` | only `modes.unlock_live_mode()`, after the live-mode lock passes |
| `POSTGRES_PASSWORD` | `.env` | the database container and everything that connects to it |
| `ADMIN_API_TOKEN` | `.env` | the API, to check requests |

- `.env` is never committed (`.gitignore`), never copied into an image
  (`.dockerignore`), and is mounted into containers read-only at
  `/run/secrets/strata_env`. `check_setup.py` fails if git tracks it.
- STRATA reads the file directly, not environment variables, so a stray shell
  variable can't switch on live trading or swap keys.
- Malformed or repeated lines in `.env` are refused. Error messages give line
  numbers, never line contents.
- Every secret is registered for redaction as soon as `.env` is read. Log files
  (text and JSON), console output, error tracebacks and database records all
  replace it with `***`.
- HTTP client libraries may only log warnings, because their normal messages
  contain full URLs, query strings included.
- Tests enforce this: no key-shaped strings in the code, `.env.example` holds no
  values, the compose file holds no secret values, and tests can't reach the
  internet.

**If a key leaks:** revoke it in the Alpaca dashboard immediately and generate
a new one. Then look through `decisions.log`, `events.jsonl` and the
`audit_logs` table for activity you don't recognise. Rotate `ADMIN_API_TOKEN`
and `POSTGRES_PASSWORD` too if `.env` itself was exposed.

## Live trading

Live trading is off by default and needs four separate locks: the `--live`
flag, `LIVE_TRADING=true` in `.env`, live keys in `.env`, and a phrase typed
by a person at a terminal. See [TRADING_MODES.md](TRADING_MODES.md). The compose
file can't enable live mode; a test checks it.

## API

- Only `/health` and `/health/ready` are public, and readiness shows component
  names and yes/no only. Everything else needs `Authorization: Bearer <ADMIN_API_TOKEN>`.
- The token must be at least 32 characters and is compared in constant time.
  With no token configured, protected endpoints refuse every request.
- Rejected requests are logged and stored as `auth_failed` system events.
- Requests are logged by method, path, status and duration only: never
  headers or query strings. A caller's `X-Request-ID` is kept only if it is
  plain and short, so it can't inject text into the logs.
- Responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
  the server doesn't announce itself.
- The API listens on `127.0.0.1` only and has no TLS. Don't publish it to a
  network.

## Database

- `audit_logs` is append-only: a database trigger rejects `UPDATE`, `DELETE`
  and `TRUNCATE`, so recorded history can't be edited by application code.
- Every statement has a time limit, and connections time out.
- Addresses are only ever printed with the password hidden.

## Containers

- Images run as an ordinary user, not root.
- pip installs only packages whose hashes match the lock files.
- Redis saves nothing to disk, so it can't become a hidden store of data.

## Known limitations

These are accepted for a single-operator machine and are scheduled for Phase 11.

- One shared API token instead of per-operator accounts.
- Redis has no password (it is reachable only from this machine and the compose
  network).
- The application's database user owns the schema. A separate user without
  permission to change tables would be stronger, and would also stop the
  audit trigger from being dropped.
- `docker compose config` prints the database password.
- The `/docs` API page is public on `127.0.0.1`. It describes the endpoints but
  holds no data.
