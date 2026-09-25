# Development

## Requirements

- Python 3.12 or newer (tested on 3.12 and 3.13).
- PostgreSQL 16 and Redis 7 for the integration tests. The easiest source is the
  compose stack: `docker compose up -d postgres redis`.

## Set up

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt     # every package is hash-checked
pip install --no-deps -e .              # the `strata` command, from this checkout
```

STRATA always runs from its project folder: an editable install (`-e`) keeps
`config.yaml`, `alembic.ini` and `migrations/` where the code expects them.

## Checks to run before every commit

```bash
ruff format .          # formatting
ruff check .           # lint, including security rules (bandit)
mypy                   # strict type checking of strata/, main.py, check_setup.py
pytest                 # unit tests; integration tests too when configured
```

## Tests

| Folder | Needs | Runs |
|---|---|---|
| `tests/unit` | nothing | always |
| `tests/integration` | PostgreSQL and Redis | when `STRATA_TEST_DATABASE_URL` and `STRATA_TEST_REDIS_URL` are set, otherwise skipped with a message |

With the compose stack running, point the integration tests at it:

```bash
docker compose up -d postgres redis
# Read only the database password; don't load the whole .env into your shell.
DB_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
export STRATA_TEST_DATABASE_URL="postgresql+psycopg://strata:${DB_PASSWORD}@127.0.0.1:5432/postgres"
export STRATA_TEST_REDIS_URL="redis://127.0.0.1:6379/15"
pytest
```

Or run everything inside Docker: `docker compose --profile test run --build --rm tests`.

Integration tests create a throwaway database (`strata_test_<random>`), apply the
real migrations to it and drop it afterwards. They never touch the `strata`
database.

**Network rule.** `tests/conftest.py` lets tests connect only to this computer
and to private addresses (where the test services live). Anything else, such as
Alpaca, raises an error. No test can place an order or needs real keys.

**Safety rules need proof.** Every safety check has a test that fails if the
check is removed. When you add a check, break it on purpose and confirm a test
goes red before you trust it.

## Database migrations

Tables are defined in `strata/db/models.py`; each schema change gets a new
migration in `migrations/versions/`.

1. Change `models.py`.
2. Generate a draft against an up-to-date database:
   ```bash
   python -c "from alembic import command; from strata.db.migrations import alembic_config; \
   from strata.db.session import url_from_environment; \
   command.revision(alembic_config(url_from_environment()), message='describe it', autogenerate=True, rev_id='0002')"
   ```
3. Read and tidy the draft. Autogenerate misses triggers, functions and data
   changes; add those by hand.
4. `strata db upgrade`, then run the tests. `test_models_and_migrations_agree`
   fails if models and migrations disagree, and
   `test_migrations_can_be_undone_and_redone` checks the downgrade.

Never edit a migration that has already been applied to a real database; add
a new one.

## Dependencies

Direct dependencies are pinned in `pyproject.toml`. The lock files are compiled
from it and must be regenerated whenever it changes:

```bash
uv pip compile pyproject.toml --python-version 3.12 --universal --generate-hashes -o requirements.txt
uv pip compile pyproject.toml --extra dev --python-version 3.12 --universal --generate-hashes -o requirements-dev.txt
```

Hashes mean pip refuses any package whose contents differ from what was locked.

## Conventions

- Small, typed functions. Pydantic for data crossing a boundary.
- Deterministic code for anything numeric: indicators, sizing, risk, P&L.
- Every decision is logged with a reason (`log_decision`), every system event
  with a type (`log_event`).
- Nothing trades when anything is uncertain.
- Commits follow `feat:`, `fix:`, `test:`, `docs:`, `build:` and stay focused.
- Docs change in the same commit as the behaviour they describe.

## Layout

```
strata/             the application package
  api/              FastAPI app, auth, routes, response schemas
  db/               models, sessions, records, migrations helper
  cli.py            the `strata` command
  config.py         config.yaml (trading, risk, strategies)
  settings.py       STRATA_ variables (infrastructure)
  credentials.py    the .env secrets file
  logging_setup.py  text logs, decisions log, JSON events, redaction
  health.py         database, schema and Redis checks
  modes.py          backtest / paper / live and the live-mode lock
migrations/         Alembic migrations
tests/unit/         tests without services
tests/integration/  tests against PostgreSQL and Redis
docs/               the documentation
main.py             the original start-up checks per mode
check_setup.py      read-only self-check
```
