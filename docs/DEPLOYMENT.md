# Deployment

STRATA runs on one machine with Docker Compose. This page covers starting,
checking, stopping, settings, data, backups and upgrades. For a first-time
setup on a fresh Debian machine, follow the README first.

## What runs

| Service | Does | Reachable at |
|---|---|---|
| `postgres` | PostgreSQL 16: the permanent record | `127.0.0.1:5432` |
| `redis` | Redis 7: caches, queues, locks. Saves nothing to disk | `127.0.0.1:6379` |
| `migrate` | Runs once at start-up: brings the database schema up to date, then exits | — |
| `api` | The STRATA API | `http://127.0.0.1:8000` |
| `tests` | Only with `--profile test`: runs the full test suite against the containers | — |

Every port listens on `127.0.0.1`, so nothing is reachable from other machines.
Agent workers, the scheduler and the dashboard are added in later phases.

## Before you start

1. Docker Engine with the Compose plugin (`docker compose version` should work).
2. A `.env` file next to `docker-compose.yml` (copy `.env.example`) with at least
   `POSTGRES_PASSWORD` set, and `ADMIN_API_TOKEN` if you want to use the
   protected API endpoints. Generate both with
   `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.
3. If your user ID isn't 1000 (check with `id -u`), build with your IDs so the
   containers can read your `.env`:
   `STRATA_UID=$(id -u) STRATA_GID=$(id -g) docker compose build`.

## Start, check, stop

```bash
docker compose up --build -d                  # build and start everything
docker compose ps                             # all services "healthy" (migrate "exited")
curl http://127.0.0.1:8000/health/ready       # {"status":"ok",...}
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://127.0.0.1:8000/system/status
docker compose logs -f api                    # follow the API's log (JSON lines)
docker compose down                           # stop; data is kept
```

Interactive API documentation is at `http://127.0.0.1:8000/docs`.

Run the `strata` command inside the running stack with, for example,
`docker compose exec api strata status`.

## Settings (`STRATA_` variables)

Non-secret infrastructure settings. The defaults suit running directly on your
computer; `docker-compose.yml` sets the container values. A misspelled
`STRATA_` variable stops the program with an error.

| Variable | Default | What it sets |
|---|---|---|
| `STRATA_CONFIG_FILE` | `config.yaml` in the project folder | Trading, risk and strategy settings |
| `STRATA_SECRETS_FILE` | `.env` in the project folder | Secrets. Containers use `/run/secrets/strata_env` |
| `STRATA_COMPONENT` | `cli` | This process's name in logs and events (`api`, `migrate`, ...) |
| `STRATA_LOG_FORMAT` | `text` | `json` prints one JSON object per line (containers) |
| `STRATA_GIT_COMMIT` | from `git`, else unknown | Code version; baked into images at build time |
| `STRATA_DB_HOST` | `127.0.0.1` | PostgreSQL host (`postgres` in containers) |
| `STRATA_DB_PORT` | `5432` | PostgreSQL port |
| `STRATA_DB_NAME` | `strata` | Database name |
| `STRATA_DB_USER` | `strata` | Database user (password: `POSTGRES_PASSWORD` in `.env`) |
| `STRATA_DB_CONNECT_TIMEOUT_S` | `5` | Give up connecting after this many seconds |
| `STRATA_DB_STATEMENT_TIMEOUT_MS` | `15000` | PostgreSQL cancels any statement running longer |
| `STRATA_REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis address (`redis://redis:6379/0` in containers) |
| `STRATA_REDIS_TIMEOUT_S` | `5` | Time limit for each Redis call |
| `STRATA_API_HOST` | `127.0.0.1` | Address the API listens on (`0.0.0.0` inside its container only) |
| `STRATA_API_PORT` | `8000` | API port |

Build-time variables for `docker compose build`: `STRATA_UID`, `STRATA_GID`
(container user IDs, default 1000) and `GIT_COMMIT` (for example
`GIT_COMMIT=$(git rev-parse HEAD) docker compose build`). `STRATA_SECRETS_PATH`
points compose at a secrets file other than `./.env`.

## Where data lives

| Volume | Holds |
|---|---|
| `pgdata` | The database |
| `strata_logs` | `strata.log`, `decisions.log`, `events.jsonl` |
| `strata_state`, `strata_data`, `strata_reports` | The bot's memory, price data and reports (later phases) |

Read the logs with, for example, `docker compose exec api tail -n 50 logs/decisions.log`.
`docker compose down` keeps all volumes; `docker compose down -v` **deletes**
them, database included.

## Backups

```bash
docker compose exec -T postgres pg_dump -U strata strata > strata-$(date +%F).sql
```

To restore into an empty database (after `docker compose down -v` and
`docker compose up -d postgres`):

```bash
docker compose exec -T postgres psql -U strata strata < strata-2026-09-25.sql
```

Keep backups somewhere other than this machine. They contain your trading
history, but no API keys (those only live in `.env`).

## Updating

```bash
git pull
docker compose up --build -d      # the migrate service applies any new migrations
docker compose ps
```

## Security notes

- `docker compose config` prints the resolved configuration, **including the
  database password**. Don't share its output.
- Being in the `docker` group is equivalent to having root on the machine.
  Only add users you'd trust with root.
- The API has no TLS: it's meant to be used from this machine only. Don't
  publish port 8000 to a network.

## Troubleshooting

| Message | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` | Add it to `.env` (see `.env.example`). |
| `Permission denied` reading `/run/secrets/strata_env` | Your user ID isn't 1000: rebuild with `STRATA_UID`/`STRATA_GID` (above). |
| `port is already allocated` | Something else uses 5432, 6379 or 8000 (often a local PostgreSQL). Stop it, or change the left-hand port in `docker-compose.yml`. |
| `api` stays unhealthy | `docker compose logs api` and `docker compose logs migrate`. |
| `password authentication failed` after changing `POSTGRES_PASSWORD` | PostgreSQL keeps the password it was created with. Put the old one back in `.env`, or set the new one inside the database: `docker compose exec postgres psql -U strata -d strata -c "ALTER USER strata PASSWORD 'the-new-password'"`. With no data worth keeping yet, `docker compose down -v` starts afresh. |
| `Unknown STRATA_ variable(s)` | A `STRATA_` variable is misspelled; the table above lists the valid ones. |
