# Development

## Requirements

- Python 3.12 or newer (tested on 3.12 and 3.13).
- PostgreSQL 16 and Redis 7 for the integration tests. The easiest source is the
  compose stack: `docker compose up -d postgres redis`.
- For the dashboard: Node.js 22 and npm, only if you work on it outside Docker
  (Debian's own Node is older; see <https://nodejs.org>). Docker alone is enough
  to build it and run its tests.

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

## The dashboard (`frontend/`)

React 19 and TypeScript, built by Vite. Every package version is exact and
locked with hashes in `package-lock.json`.

```bash
cd frontend
npm ci                 # install exactly what package-lock.json lists
npm run dev            # http://127.0.0.1:5173, /api passed to a local `strata api` on port 8000
npm test               # unit tests (Vitest and Testing Library)
npm run typecheck      # strict TypeScript
npm run build          # type-check, then build into dist/
```

`npm run dev` needs the API running on this machine (`strata api`, with
PostgreSQL and Redis) and an operator account (`strata operator create`).
Browsers keep the login on `http://127.0.0.1` because they treat this computer
as secure; any other address needs HTTPS.

Without Node: `docker compose --profile test run --build --rm frontend-tests`.

**Browser tests** (Playwright) drive the whole stack through nginx over HTTPS:
login, every page and its charts, the Learn section and glossary, the dark
theme, logging out, a phone-sized screen, strict headers, no console errors and
no Content-Security-Policy violations. They save screenshots in
`frontend/e2e/screenshots/`.

```bash
docker compose up --build -d
cd frontend
npx playwright install chromium          # once
STRATA_E2E_USERNAME=alex STRATA_E2E_PASSWORD='...' npm run e2e
```

Rules the dashboard follows:

- **Only real data.** A view whose data doesn't exist yet says so and names the
  phase that brings it (the list is in `src/nav.tsx`). No sample numbers.
- **Status is never colour alone.** Good, warning, serious and critical always
  come with an icon and a word (`StatusBadge`). Chart colours and status colours
  come from the dataviz reference palette in `src/styles/tokens.css`; pages use
  the tokens, never raw colours, so light and dark mode change in one place.
- **Nothing runs from data.** Text from the API is rendered as text; there is no
  `dangerouslySetInnerHTML`, and the Content-Security-Policy would refuse it
  anyway.
- **Every request goes through `src/api/client.ts`**, which adds the
  `X-Strata-Dashboard` header and turns failures into readable messages.
- **The API's shapes are mirrored** in `src/api/types.ts`; change it together
  with `strata/api/schemas.py`.
- **Every chart has a table view** with the same numbers, a legend when it has
  two or more series, and marks you can reach with the keyboard. Colours are
  assigned in a fixed order (`--series-1`, `-2`, `-3`) and follow the thing
  they stand for, never its rank.

### The Learn section (`src/learn/`)

It teaches, so it must be right. The tests in `src/learn/learn.test.tsx`
enforce most of this; the rest is for review.

- **Official sources only.** Every source is in `sources.ts`, on a domain in
  `OFFICIAL_DOMAINS` (regulators, exchanges, SIPC, the index provider, the fund
  issuer, Alpaca). Cite with `<Cite id="…" />`. A chapter's source list must
  match what it cites, and every registered source must be cited somewhere.
- **No claim without a source or a reason.** Rules, fees, dates and figures
  cite the page they come from. If a fact changes (a fee, a rule), update the
  text and `CHECKED_ON` together.
- **Glossary words** are linked with `<Term id="…">`; the id must exist in
  `glossary.ts`, which stays in A-to-Z order (the test says where an entry
  belongs). Notes that quote STRATA's settings are functions of them, so they
  follow `config.yaml`.
- **Pictures say what they are**: made-up prices, STRATA's settings,
  arithmetic, real times, or how STRATA is built (the `kind` of a `Figure`).
  Made-up prices come from fixed seeds in `synthetic.ts`, so pictures never
  change, and captions are worked out from the numbers drawn, never typed in.
- **STRATA's numbers come from its settings.** Use `useSetup()`. After changing
  `config.yaml`, run `python scripts/dashboard_defaults.py`; a Python test fails
  until you do.
- **Labs compute, components draw.** A lab's arithmetic goes in `labs/sim.ts`
  as a pure function with a hand-checked test; the component only shows what
  it returns, and its tag says what its numbers are (made-up prices,
  arithmetic, or STRATA's rules).
- **No look-ahead, even in a lab.** A signal made by a day's close is acted on
  the next day. The Testing chapter warns against trading at the close that
  made the signal, so nothing in the section does it.
- **Quizzes teach.** Every answer's explanation says why, in the chapter's own
  terms, and adds no new facts. Questions that quote a setting compute it.
- **Nothing is advice.** Explain; don't recommend buying or selling anything.

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
  auth/             operator accounts, passwords, sessions, login limits
  db/               models, sessions, records, migrations helper
  cli.py            the `strata` command
  config.py         config.yaml (trading, risk, strategies)
  settings.py       STRATA_ variables (infrastructure)
  credentials.py    the .env secrets file
  logging_setup.py  text logs, decisions log, JSON events, redaction
  health.py         database, schema and Redis checks
  modes.py          backtest / paper / live and the live-mode lock
migrations/         Alembic migrations
frontend/           the dashboard
  src/api/          API client, polling, shared system status
  src/pages/        one file per page
  src/components/   layout, banner, badges, sparkline, meters, filters
  src/styles/       colour tokens (light and dark) and the stylesheet
  nginx/            the HTTPS server's configuration
  e2e/              browser tests of the running stack
scripts/            make-dashboard-cert.sh
tests/unit/         tests without services
tests/integration/  tests against PostgreSQL and Redis
docs/               the documentation
main.py             the original start-up checks per mode
check_setup.py      read-only self-check
```
