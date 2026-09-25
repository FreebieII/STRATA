# STRATA

A small, safety-first automated trading bot for [Alpaca](https://alpaca.markets),
written in Python with the official `alpaca-py` SDK.

It compares two simple long-only strategies (moving-average crossover and RSI
mean-reversion) on two instruments (the SPY stock ETF and BTC/USD crypto), and
it can trade them with strict risk limits. **Safety and reliability come before
profit.** The bot never uses leverage, margin, short selling or options.

> **This is not financial advice.** Past results, whether backtested or from paper
> trading, do not predict future results. Automated trading can lose money
> quickly. Only ever trade money you can afford to lose completely.

---

## Project status

The bot is being built in four stages, with a review after each one.

| Stage | What it adds | Status |
|---|---|---|
| 1 | Project setup, configuration, key handling, logging, the live-mode lock | **Done, waiting for review** |
| 2 | Price-data download and backtesting, with a plain-English report | Not started |
| 3 | Risk manager and tests proving every limit works | Not started |
| 4 | Paper-trading loop, reconciliation with Alpaca, and `close_all.py` | Not started |

Until stage 4 is finished, **every mode stops after its start-up checks. The bot
cannot send an order yet.**

---

## Setup

You need **Python 3.11 or newer** (tested on 3.11, 3.12 and 3.13), `git`, and a
free Alpaca account.

### 1. Get the code and install the packages

**macOS / Linux** (Terminal):

```bash
git clone https://github.com/FreebieII/STRATA.git
cd STRATA
python3 -m venv .venv            # a private Python install for this project
source .venv/bin/activate        # do this every time you open a new terminal
python -m pip install --upgrade pip
pip install -r requirements.txt
```

**Windows** (PowerShell):

```powershell
git clone https://github.com/FreebieII/STRATA.git
cd STRATA
py -3 -m venv .venv
.venv\Scripts\Activate.ps1       # do this every time you open a new window
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If Windows refuses to run `Activate.ps1`, run this once, then try again:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### 2. Add your Alpaca paper-trading keys

Paper trading uses fake money, so it's safe to experiment with.

1. Log in at <https://app.alpaca.markets> and switch to your **Paper Trading**
   account.
2. On its home page, generate an API key. Alpaca shows the **secret key only
   once**, so keep the page open until you've copied it.
3. Create your private secrets file from the template:
   - macOS / Linux: `cp .env.example .env`
   - Windows: `copy .env.example .env`
4. Open `.env` in a text editor and paste the two values after
   `ALPACA_PAPER_API_KEY=` and `ALPACA_PAPER_SECRET_KEY=`.
   Leave the live keys empty and leave `LIVE_TRADING=false`.

`.env` never leaves your computer: git is told to ignore it (see `.gitignore`),
and the bot never prints or logs its contents. On macOS / Linux you can also run
`chmod 600 .env` so that only your user account can read it.

### 3. Check everything works

```bash
python check_setup.py             # Python, packages, config.yaml and .env (offline)
python check_setup.py --connect   # also logs in to your PAPER account, read-only
python -m pytest                  # runs all automated tests (about 2 seconds)
python main.py                    # starts in paper mode (stage 1: checks, then stops)
```

`check_setup.py` prints one line per check: `[ OK ]`, `[WARN]` or `[FAIL]`. It
never places an order. If `--connect` fails with a permissions error on SPY prices,
change `historical_stock_feed: sip` to `iex` in `config.yaml`.

---

## Running the bot

```bash
python main.py                       # paper trading: the default
python main.py --mode paper          # the same, spelled out
python main.py --mode backtest       # test the strategies on past prices (stage 2)
python main.py --mode live --live    # REAL money: only after the go-live checklist
```

### How live mode is locked

Live mode starts only if **all** of these are true, checked in this order. If any
one is missing, the bot refuses to start and tells you which.

1. You typed the `--live` flag (together with `--mode live`).
2. Your `.env` file says exactly `LIVE_TRADING=true`. Only the `.env` file counts:
   a variable set in your terminal is ignored, and so are values like `1` or `yes`.
3. Your live keys are filled in in `.env`. Paper and live keys have separate names,
   so paper mode can never use your real-money keys.
4. You type the confirmation phrase by hand, after the bot shows you your risk
   limits. The phrase can't be piped in from a file or a script.

---

## What each file does

| File | In plain words |
|---|---|
| `README.md` | This guide. |
| `config.yaml` | Every setting: what to trade, strategy settings, risk limits, trading costs and backtest dates. Each line is explained in comments. |
| `.env.example` | A template for your secrets file. Safe to share: it holds no keys. |
| `.env` | *You create this.* Your API keys. Never share it and never commit it. |
| `.gitignore` | Tells git which files must never be committed: `.env`, logs, downloaded data. |
| `requirements.txt` | The exact Python packages and versions to install. |
| `pytest.ini` | Settings for the test runner. |
| `main.py` | Starts the bot. It chooses the mode, runs the start-up safety checks and, from stage 4, runs the trading loop. |
| `check_setup.py` | A self-check. Are Python, the packages, your settings and your keys OK? With `--connect`, it also logs in to your paper account (read-only). |
| `strata/config.py` | Reads `config.yaml` and checks every value. A typo, a repeated setting, a missing limit or a silly value stops the bot with a clear message. |
| `strata/credentials.py` | Reads your keys from `.env`, keeps paper and live keys apart, and hides keys whenever they're printed. |
| `strata/logging_setup.py` | Writes the log files, and blanks out any key that tries to reach a log or the screen. |
| `strata/modes.py` | Picks backtest, paper or live, and holds the live-mode lock described above. |
| `strata/alpaca_clients.py` | Opens connections to Alpaca. Paper keys always go to the paper server, and every request has a time limit so a dropped connection can't freeze the bot. |
| `tests/` | Automated tests. The network is switched off during every test, so tests can never reach Alpaca or place an order. |

Folders the bot creates by itself (git ignores all of them): `logs/` (log files),
`data/` (downloaded prices, from stage 2), `state/` (the bot's memory, from stage 4)
and `reports/` (backtest reports, from stage 2).

## Logs: every decision and its reason

- `logs/decisions.log`: one line per decision, always with a reason, for example
  `DECISION STOP | mode=paper | reason: the trading loop is built in stage 4; no orders were sent`
- `logs/strata.log`: everything, including warnings and errors, for troubleshooting.

Times are New York time (set by `timezone` in `config.yaml`), so they line up
with US market hours.

## The risk limits (config.yaml)

| Setting | Value | Meaning |
|---|---|---|
| `MAX_CAPITAL` | $300 | The most the bot may ever have invested. |
| `MAX_POSITION_PCT` | 20 | At most 20% of MAX_CAPITAL in one position: $60. |
| `STOP_LOSS_PCT` | 5 | Sell a position once it falls 5% below the price paid. |
| `DAILY_LOSS_LIMIT` | $15 | Lose this much in a day and the bot stops trading until the next day. |
| `TOTAL_LOSS_LIMIT` | $60 | Lose this much in total and the kill switch trips. The bot stops completely until you reset it by hand. |
| `MAX_TRADES_PER_DAY` | 3 | At most 3 orders per day. Buys and sells both count. |

The risk manager (stage 3) checks these before every order and rejects any order
that would break one, even if a strategy asks for it.

---

## Go-live checklist

Do **not** switch on live trading until you can tick **every** box. There's no
prize for going live early.

**Understand it**

- [ ] I've read this README and every comment in `config.yaml`.
- [ ] I've read the backtest report (stage 2), including the out-of-sample
      results, and I can explain in my own words when and why each strategy lost
      money.
- [ ] I didn't change strategy settings after seeing the out-of-sample results.
      (If I did, the 30-day paper period below starts again with the new settings.)
- [ ] I understand that past results, backtested or paper, do not predict future
      results, and that I could lose all the money in the account.

**Test it**

- [ ] `python -m pytest` passes completely on the computer that will run the bot.
- [ ] `python check_setup.py --connect` shows no `[FAIL]` lines.

**Paper trade for at least 30 days**

- [ ] The bot has paper traded for **at least 30 calendar days in a row**, using
      exactly the `config.yaml` I'll use live, on the same computer. If I change any
      setting, the 30 days start again.
- [ ] I reviewed the results: every trade, every rejected order, every warning and
      every error in `logs/`, and I understand why each one happened.
- [ ] I compared paper results with the backtest and there are no big unexplained
      differences, such as far more trades than expected or fills far from the
      expected prices.
- [ ] No limit was ever broken: no position over $60, never more than $300
      invested, never more than 3 trades a day, and stop-losses fired when
      they should.
- [ ] I stopped and restarted the bot at least once during the day, and it picked
      up its positions and orders correctly, without duplicate orders.

**Know what to do in an emergency**

- [ ] I know how to stop the bot (Ctrl+C), and I've practised `python close_all.py`
      (cancel all orders, close all positions) in paper mode.
- [ ] I know how to reset the kill switch, and I know not to reset it without
      finding out why it tripped.
- [ ] I can log in to the Alpaca website or app and close positions by hand,
      including from my phone.

**Account and money**

- [ ] My live account holds only money I can afford to lose completely.
- [ ] Fractional shares and crypto trading are enabled on my live account. One SPY
      share costs far more than the $60 position limit, so fractional shares are
      needed.
- [ ] I understand the pattern day trader rule. In a US margin account under
      $25,000, making 4 or more day trades (buying and selling the same stock on
      the same day) within 5 business days gets the account restricted. The rule
      has been under review, so check Alpaca's help pages for the current version.
      The bot avoids same-day round trips in stocks.
- [ ] I understand the fees (crypto trades cost about 0.25% each way) and the tax
      rules for trading where I live.
- [ ] The computer running the bot is kept secure, and my live keys are stored
      only in `.env` and nowhere else.

**Switching on (only after everything above)**

- [ ] Create live API keys in the Alpaca dashboard of the **live** account and
      paste them into `.env` as `ALPACA_LIVE_API_KEY` / `ALPACA_LIVE_SECRET_KEY`.
- [ ] Set `LIVE_TRADING=true` in `.env`.
- [ ] Run `python main.py --mode live --live`, read the limits it shows, and type
      the phrase.
- [ ] Keep the same small limits for at least the first 30 days live. Never raise
      a limit to win back a loss.
- [ ] Check the logs and the Alpaca dashboard every day for the first weeks.
- [ ] Set `LIVE_TRADING=false` again whenever you stop live trading.

---

## Troubleshooting

- **`No .env file found`**: create it with `cp .env.example .env` (Windows:
  `copy .env.example .env`) and paste in your paper keys.
- **`config.yaml has N problem(s)`**: each line names the setting and what's
  wrong with it. Fix it and run again.
- **`... appears more than once`**: a setting is written twice; delete one copy.
- **`couldn't reach Alpaca`**: check your internet connection. The bot gives up
  after a time limit instead of hanging.
- **`HTTP 401` or `HTTP 403`**: Alpaca rejected the keys. Paste the **paper**
  keys again, without spaces. Paper key IDs usually start with `PK`.
