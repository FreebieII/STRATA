# STRATA

A safety-first algorithmic trading platform for [Alpaca](https://alpaca.markets),
in Python. It is being built to research markets, test strategy ideas on past
data, run independent analysis agents that check each other, paper trade, and
only much later, and only if you decide so, trade live.

Its first job is the original brief: compare two simple long-only strategies
(moving-average crossover and RSI mean-reversion) on SPY and BTC/USD, under
strict risk limits. **Safety and reliability come before profit.** No leverage,
margin, short selling or options.

> **This is not financial advice and not a promise of profit.** Past results,
> backtested or paper, do not predict future results. Automated trading can
> lose money quickly. Only ever trade money you can afford to lose completely.

---

## Status

STRATA is built in 14 phases; [BUILD_PLAN.md](BUILD_PLAN.md) has the details.

| Phase | What it adds | Status |
|---|---|---|
| 1 | Foundation: config, secrets, logging, PostgreSQL, Redis, API, CLI, Docker, tests | **Done** |
| 1b | Dashboard foundation: operator logins, the HTTPS web dashboard, health, setup, limits, events, audit log | **Done** |
| 1c | Dashboard charts from real data, and the Learn section: how trading works, and how STRATA does it | **Done** |
| 2 | Market data: one interface for prices, validation, cached history | Next |
| 3 | Indicators, technical and quantitative analysis, market regimes | |
| 4 | Backtesting with fees and slippage, walk-forward tests, experiment records | |
| 5–6 | Analysis agents, the critic, the supervisor, structured trade proposals | |
| 7 | Deterministic risk engine, portfolio checks, kill switch | |
| 8 | Paper trading, order management, `close_all.py` | |
| 9 | Dashboard trading views: equity, positions, orders, P&L, agent decisions | |
| 10–14 | Real broker adapter, security hardening, end-to-end tests, paper validation, live preparation | |

**Nothing in STRATA can place an order yet.**

---

## Quick start on a fresh Debian machine

Run each box separately. Some commands stop to ask for a password or a yes/no
answer, and if you paste several lines at once, the next line gets typed in as
the answer.

### 1. Basic tools

```bash
sudo apt update && sudo apt install -y git python3 openssh-client ca-certificates curl openssl
```

If `sudo` is missing, or says you aren't allowed to use it: run `su -`, type the
ROOT password you chose when installing Debian, then run the lines below
(replace `YOUR_USERNAME`), and log out and back in.

```bash
apt install -y sudo
usermod -aG sudo YOUR_USERNAME
exit
```

Check the clock is kept in time (the daily limits depend on it). You want
`System clock synchronized: yes`; if not, run `sudo apt install -y systemd-timesyncd`.

```bash
timedatectl
```

### 2. Docker

These are Docker's own instructions for Debian
(<https://docs.docker.com/engine/install/debian/>). Run the boxes one at a time.

```bash
sudo install -m 0755 -d /etc/apt/keyrings && sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
```

```bash
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Let your user run Docker without `sudo`, then **log out and back in**. (Being in
the `docker` group is equivalent to having root on this machine, so only do this
for your own account.)

```bash
sudo usermod -aG docker "$USER"
```

After logging back in, both of these should work:

```bash
docker run --rm hello-world
docker compose version
```

### 3. Get the code

The repository is public, so this is enough:

```bash
git clone https://github.com/FreebieII/STRATA.git
cd STRATA
```

If you make the repository private, use a read-only deploy key instead (see
[Deploy key](#deploy-key-for-a-private-repository) below).

### 4. Secrets

```bash
cp .env.example .env
chmod 600 .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

Open `.env` with `nano .env` (paste with Ctrl+Shift+V, save with Ctrl+O then
Enter, quit with Ctrl+X) and fill in:

- `POSTGRES_PASSWORD`: the first random string printed above.
- `ADMIN_API_TOKEN`: the second one.
- `ALPACA_PAPER_API_KEY` and `ALPACA_PAPER_SECRET_KEY`: from
  <https://app.alpaca.markets>. Switch to your **Paper Trading** account and
  generate an API key on its home page. The secret is shown only once.

Leave the live keys empty and `LIVE_TRADING=false`.

`.env` never leaves this machine: git ignores it, Docker images never contain
it, and STRATA never prints or logs its contents. If `id -u` doesn't print
`1000`, see [DEPLOYMENT.md](docs/DEPLOYMENT.md#before-you-start).

### 5. Start STRATA

First make the dashboard's HTTPS certificate (once; run it as yourself, not
with `sudo`), then start everything:

```bash
scripts/make-dashboard-cert.sh
```

```bash
docker compose up --build -d
docker compose ps
```

After a minute, `postgres`, `redis`, `api` and `frontend` should say
`healthy`, and `migrate` should have exited. Then:

```bash
curl http://127.0.0.1:8000/health/ready
docker compose exec api strata status
docker compose exec api python check_setup.py --connect
```

The last one logs in to your Alpaca **paper** account (read-only) and fetches a
few prices. It's the first real test of your keys.

### 6. Open the dashboard

Make yourself an account (it asks for a password twice; at least 12
characters):

```bash
docker compose exec api strata operator create YOUR_NAME
```

Open <https://localhost:8443> in a browser on this machine and log in. The
browser warns about the certificate until you install STRATA's own
certificate authority, `certs/strata-local-ca.crt`: see
[Installing the CA on a device](docs/DEPLOYMENT.md#installing-the-ca-on-a-device).
To open the dashboard from your phone or another computer on your home
network, follow
[Opening the dashboard from other devices](docs/DEPLOYMENT.md#opening-the-dashboard-from-other-devices).

The strip across the top always shows the trading mode. Today it says
**PAPER**, and the dashboard has no way to place orders.

New to trading? **Learn** in the menu explains how it works, from order types
and fees to backtesting, and how STRATA does each part, with STRATA's own
settings and links to the official rules. Its glossary covers every word and
abbreviation used.

### 7. Run the tests

```bash
docker compose --profile test run --build --rm tests
docker compose --profile test run --build --rm frontend-tests
```

### 8. Getting each new phase

```bash
git pull
docker compose up --build -d
docker compose --profile test run --build --rm tests
docker compose --profile test run --build --rm frontend-tests
```

Stop everything with `docker compose down` (your data is kept).

---

## Working without Docker

For development you can also run STRATA directly. It needs **Python 3.12 or
newer**: Debian 13 has 3.13; on Debian 12 use Docker. See
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements-dev.txt
pip install --no-deps -e .
python check_setup.py
pytest
```

---

## Commands

| Command | Does |
|---|---|
| `strata status` | Settings summary and database / Redis health |
| `strata db upgrade` | Bring the database schema up to date |
| `strata db current` | Which migration the database is at |
| `strata operator create NAME` | Make a dashboard account (asks for the password) |
| `strata operator list` | Show the dashboard accounts |
| `strata operator reset-password NAME` | Set a new password; logs out that account's sessions |
| `strata operator disable NAME` / `enable NAME` | Lock or unlock an account; disabling logs it out everywhere |
| `strata api` | Run the API (compose does this for you) |
| `python check_setup.py [--connect]` | Read-only self-check; `--connect` logs in to your paper account |
| `python main.py --mode backtest\|paper\|live` | The original start-up checks per mode. Paper is the default. No mode trades yet |

In Docker, prefix them with `docker compose exec api`, for example
`docker compose exec api strata status`.

### API

| Endpoint | Access | Shows |
|---|---|---|
| `GET /health` | public | the API process is running |
| `GET /health/ready` | public | database, schema and Redis: yes/no each |
| `GET /system/status` | login | versions, uptime, trading settings, detailed checks |
| `GET /system/events` | login | system events, newest first, in pages (`since` limits them to a period) |
| `GET /system/events/stats` | login | events per day by severity, and the most frequent kinds (`days`, `tz`, `event_type`) |
| `GET /system/health/history` | login | the API's own health readings over the last `1h`, `6h` or `24h` (kept in memory) |
| `GET /audit` | login | the audit log, newest first, in pages (`since` limits it to a period) |
| `GET /audit/stats` | login | audit entries per day by action (`days`, `tz`, `action`) |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | — | dashboard logins |

"Login" means a dashboard session, or a script sending the token as
`Authorization: Bearer <ADMIN_API_TOKEN>`. Interactive docs are at
<http://127.0.0.1:8000/docs>. The API itself only listens on this machine;
other devices reach it only through the dashboard, as `https://…:8443/api/`.

### How live mode is locked

Live mode starts only if **all** of these are true. If any one is missing,
STRATA refuses to start and tells you which. Details:
[docs/TRADING_MODES.md](docs/TRADING_MODES.md).

1. The `--live` flag (together with `--mode live`).
2. `LIVE_TRADING=true` in `.env`, exactly. A variable set in your terminal
   doesn't count, and neither do values like `1` or `yes`.
3. Live keys filled in in `.env`. Paper and live keys have separate names, so
   paper mode can never use your real-money keys.
4. A confirmation phrase typed by hand after STRATA shows your risk limits. It
   can't be piped in from a file or a script, so live mode never starts unattended.

---

## What each file does

| File | In plain words |
|---|---|
| `README.md` | This guide. |
| `BUILD_PLAN.md` | The architecture, the decisions behind it, the 14 phases, and the decisions you made. |
| `config.yaml` | Trading settings: instruments, strategies, risk limits, costs, backtest dates. Every line is commented. |
| `.env.example` | Template for your secrets file. Safe to share: it holds no values. |
| `.env` | *You create this.* Keys, passwords and the API token. Never share or commit it. |
| `docker-compose.yml` | Starts PostgreSQL, Redis, the migrations, the API and the dashboard. Only the dashboard can be opened from other devices, and only if you choose. |
| `Dockerfile` | How the STRATA container image is built. |
| `frontend/` | The web dashboard (React and TypeScript), its charts, the Learn section (`src/learn/`), its tests, and `nginx/`: the HTTPS server in front of it. |
| `scripts/dashboard_defaults.py` | Copies the trading settings in `config.yaml` into the dashboard's Learn pages, which show them before the API answers. Run it after changing `config.yaml`; a test reminds you. |
| `scripts/make-dashboard-cert.sh` | Makes the dashboard's HTTPS certificate, from a certificate authority of your own that can only vouch for home-network names. |
| `certs/` | *Made by the script.* The certificate, its key and the CA. Git ignores it. |
| `pyproject.toml` | The project's packages and the settings for the test, lint and type-check tools. |
| `requirements.txt`, `requirements-dev.txt` | Exact, hash-checked package versions (generated; don't edit by hand). |
| `alembic.ini`, `migrations/` | Database schema changes, applied by `strata db upgrade`. |
| `check_setup.py` | Read-only self-check of Python, packages, settings and keys. |
| `main.py` | The original start-up checks for backtest, paper and live mode. |
| `strata/config.py` | Reads `config.yaml` and checks every value. Typos, repeats and silly values stop STRATA with a clear message. |
| `strata/settings.py` | Reads the `STRATA_` variables (database, Redis and API addresses). Typos are errors. |
| `strata/credentials.py` | Reads secrets from `.env`, keeps paper and live keys apart, hides keys when printed. |
| `strata/modes.py` | Picks backtest, paper or live, and holds the live-mode lock. |
| `strata/logging_setup.py` | Writes the logs and blanks out any secret that tries to reach them. |
| `strata/db/` | The database tables, connections with time limits, and the audit log writer. |
| `strata/redis_client.py` | Redis connection for short-lived data. |
| `strata/health.py` | Checks that the database, its schema and Redis are working. |
| `strata/api/` | The web API: health, status, events, audit log, logging in, and checking every caller. |
| `strata/auth/` | Dashboard accounts: password hashing, sessions, and pausing logins after repeated failures. |
| `strata/cli.py` | The `strata` command. |
| `strata/alpaca_clients.py` | Connections to Alpaca with time limits; paper keys always reach the paper server. |
| `tests/` | Automated tests. `unit/` needs nothing; `integration/` uses a real PostgreSQL and Redis. No test can reach the internet. |
| `docs/` | Architecture, development, deployment, security and trading-mode guides. |

## Logs: every decision and its reason

- `logs/decisions.log`: one line per decision, always with a reason.
- `logs/strata.log`: everything, readable, for troubleshooting.
- `logs/events.jsonl`: everything again as JSON, with the same fields every time
  (timestamp, component, event type, request ID, symbol, strategy, agent,
  decision, result, error).

In Docker the logs are in the `strata_logs` volume, for example
`docker compose exec api tail -n 50 logs/decisions.log`. Readable logs use New
York time (the `timezone` in `config.yaml`); JSON events use UTC. The database
also keeps `system_events` and an **append-only** `audit_logs` table that can't
be edited after the fact.

## The risk limits (config.yaml)

| Setting | Value | Meaning |
|---|---|---|
| `MAX_CAPITAL` | $300 | The most STRATA may ever have invested. |
| `MAX_POSITION_PCT` | 20 | At most 20% of MAX_CAPITAL in one position: $60. |
| `STOP_LOSS_PCT` | 5 | Sell a position once it falls 5% below the price paid. |
| `DAILY_LOSS_LIMIT` | $15 | Lose this much in a day and trading stops until the next day. |
| `TOTAL_LOSS_LIMIT` | $60 | Lose this much in total and the kill switch trips. Nothing trades until you reset it by hand. |
| `MAX_TRADES_PER_DAY` | 3 | At most 3 orders per day. Buys and sells both count. |

The risk engine (Phase 7) checks these before every order and rejects any order
that would break one, whatever a strategy or agent says. The platform brief adds
percentage-based limits; as you decided, they will be tuned to match these (1% risk
per trade, 5% daily loss, 20% drawdown). See
[BUILD_PLAN.md](BUILD_PLAN.md#6-operator-decisions).

---

## Go-live checklist

Do **not** switch on live trading until you can tick **every** box. There's no
prize for going live early. Passing tests does not make the system safe; it only
shows the tested behaviour is there.

**Understand it**

- [ ] I've read this README, BUILD_PLAN.md, docs/SECURITY.md and every comment
      in `config.yaml`.
- [ ] I've read the backtest report, including the out-of-sample results, and I
      can explain in my own words when and why each strategy lost money.
- [ ] I didn't change strategy settings after seeing the out-of-sample results.
      (If I did, the 30-day paper period below starts again with the new settings.)
- [ ] I understand that past results, backtested or paper, do not predict future
      results, and that I could lose all the money in the account.

**Test it**

- [ ] The full test suite passes on the machine that will trade
      (`docker compose --profile test run --build --rm tests`).
- [ ] `python check_setup.py --connect` shows no `[FAIL]` lines, and broker
      connectivity and credentials are verified against the paper account.
- [ ] I've seen each risk limit reject an order, and the kill switch stop all
      trading, in paper mode.
- [ ] Monitoring and logging work: I can see health, positions, orders,
      rejections and risk events, and every decision has a reason in the logs.

**Paper trade for at least 30 days**

- [ ] STRATA has paper traded for **at least 30 calendar days in a row**, with
      exactly the `config.yaml` I'll use live, on the same machine. If I change any
      setting, the 30 days start again.
- [ ] I reviewed the results: every trade, every rejected order, every warning and
      every error, and I understand why each one happened.
- [ ] I compared paper results with the backtest, and there are no big
      unexplained differences, such as far more trades than expected or fills far
      from the expected prices.
- [ ] No limit was ever broken: no position over $60, never more than $300
      invested, never more than 3 trades a day, and stop-losses fired when they
      should.
- [ ] I stopped and restarted STRATA during the day, and it reconciled its
      positions and orders with Alpaca correctly, without duplicate orders.

**Know what to do in an emergency**

- [ ] I know how to stop STRATA, and I've practised `close_all.py` (cancel all
      orders, close all positions) in paper mode.
- [ ] I know how to reset the kill switch, and not to reset it without finding
      out why it tripped.
- [ ] I can log in to the Alpaca website or app and close positions by hand,
      including from my phone.

**Account and money**

- [ ] My live account holds only money I can afford to lose completely.
- [ ] Fractional shares and crypto trading are enabled on my live account. One
      SPY share costs far more than the $60 position limit, so fractional shares
      are needed.
- [ ] I understand today's day-trading rules. The old pattern day trader rule
      (4 or more day trades in 5 business days needed $25,000 in a margin
      account) was replaced by FINRA's intraday margin rules: approved by the SEC
      on 14 April 2026, in force from 4 June 2026, with brokers switching over
      until 20 October 2027. Alpaca switched on 4 June 2026. I have read Alpaca's
      help pages on how the new rules apply to my account. STRATA still avoids
      same-day round trips in stocks (decision Q4 in `BUILD_PLAN.md`).
- [ ] I understand the fees (crypto trades cost about 0.25% each way) and the tax
      rules for trading where I live.
- [ ] The machine running STRATA is kept secure, and my live keys are stored only
      in `.env` and nowhere else.

**Switching on (only after everything above)**

- [ ] Create live API keys in the Alpaca dashboard of the **live** account and
      paste them into `.env` as `ALPACA_LIVE_API_KEY` / `ALPACA_LIVE_SECRET_KEY`.
- [ ] Set `LIVE_TRADING=true` in `.env`.
- [ ] Start live mode with the command in docs/TRADING_MODES.md, read the limits
      it shows, and type the phrase yourself.
- [ ] Keep the same small limits for at least the first 30 days live. Never raise
      a limit to win back a loss.
- [ ] Check the logs and the Alpaca dashboard every day for the first weeks.
- [ ] Set `LIVE_TRADING=false` again whenever you stop live trading.

---

## Deploy key (for a private repository)

A deploy key lets this one machine download this one repository, and nothing
else. You only need it if the repository is private. Run the boxes one at a time.

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
```

This asks for a passphrase twice. Pressing Enter both times (no passphrase) is
fine for a read-only key.

```bash
ssh-keygen -t ed25519 -C "strata-deploy-$(hostname)" -f ~/.ssh/strata_deploy_key
```

Show the PUBLIC half and copy the whole line (it starts with `ssh-ed25519`):

```bash
cat ~/.ssh/strata_deploy_key.pub
```

On GitHub, open the repository's **Settings → Deploy keys → Add deploy key**.
Paste the line, give it a title such as "Debian bot machine", leave **Allow write
access unticked**, and click **Add key**. Never share `~/.ssh/strata_deploy_key`
(the file without `.pub`): it's the private half.

Tell SSH to use that key for this repository:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github-strata
    HostName github.com
    User git
    IdentityFile ~/.ssh/strata_deploy_key
    IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Test it. The first time, SSH asks you to confirm GitHub's identity: type `yes`
only if the fingerprint matches the one GitHub publishes at
<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints>.
It should answer `Hi FreebieII/STRATA! You've successfully authenticated, but
GitHub does not provide shell access.`

```bash
ssh -T github-strata
```

Then clone with `git clone git@github-strata:FreebieII/STRATA.git`. Setting
`git config --global pull.ff only` also makes `git pull` refuse to merge
anything on this machine.

---

## Troubleshooting

- **`No .env file found`**: `cp .env.example .env` and fill it in (step 4).
- **`Set POSTGRES_PASSWORD in .env`**: compose needs it before anything starts.
- **`config.yaml has N problem(s)`**: each line names the setting and what's
  wrong. Fix it and run again. **`... appears more than once`**: a setting is
  written twice; delete one copy.
- **`Unknown STRATA_ variable(s)`**: a `STRATA_` variable is misspelled; the
  valid ones are listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **`Permission denied` on `/run/secrets/strata_env`**: your user ID isn't 1000;
  see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#before-you-start).
- **`port is already allocated`**: something else uses port 5432, 6379, 8000 or 8443.
- **`couldn't reach Alpaca`**: check your internet connection. STRATA gives up
  after a time limit instead of hanging.
- **`HTTP 401` or `HTTP 403` from Alpaca**: the keys were rejected. Paste the
  **paper** keys again, without spaces. Paper key IDs usually start with `PK`.
- **`ssh -T github-strata` says `Connection timed out`**: your network blocks
  SSH's usual port. In `~/.ssh/config`, change `HostName github.com` to
  `HostName ssh.github.com` and add a line `    Port 443`.
- **`Permission denied (publickey)`**: the deploy key isn't on GitHub yet, or the
  wrong line was pasted.
- **The dashboard**: certificate warnings, keys it can't read, logging in, and
  other devices are covered in
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#troubleshooting).

## Documentation

- [BUILD_PLAN.md](BUILD_PLAN.md): architecture, decisions, phases, your decisions
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit today
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): running with Docker, the dashboard and other devices, settings, backups
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): working on the code, tests, migrations
- [docs/SECURITY.md](docs/SECURITY.md): secrets, the API, the dashboard, the audit log, known limits
- [docs/TRADING_MODES.md](docs/TRADING_MODES.md): backtest, paper, live and the live lock
