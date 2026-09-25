"""STRATA: a small, safety-first trading bot for Alpaca.

The package is split into small modules, one job each:

    config.py          reads and checks config.yaml
    credentials.py     reads API keys from .env and keeps them hidden
    logging_setup.py   writes every decision, with its reason, to log files
    modes.py           picks backtest / paper / live and guards live mode
    alpaca_clients.py  creates Alpaca connections with safe defaults

Later stages add the backtester, the risk manager and the trading loop.
"""

from pathlib import Path

# The project folder (the one holding main.py and config.yaml). Default
# file locations are relative to it, so commands work from any folder.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
