"""Create Alpaca API connections with safe defaults.

Everything that talks to Alpaca gets its connection from here, so two
rules always hold:

* Paper keys always connect to the paper (fake money) server and live
  keys to the live server. The server is chosen from which keys were
  loaded, never from a separate setting that could disagree with them.
* Every network request has a time limit. By default alpaca-py waits
  forever, so a dropped connection could freeze the bot. With a limit,
  the request fails with an error the bot can handle.
"""

from __future__ import annotations

from typing import Any

import requests
from alpaca.data.historical import CryptoHistoricalDataClient, StockHistoricalDataClient
from alpaca.trading.client import TradingClient

from .credentials import AlpacaKeys

# (seconds to connect, seconds to wait for a reply)
REQUEST_TIMEOUT: tuple[float, float] = (10.0, 30.0)

# requests.Session.request(method, url, params, data, headers, cookies, files,
# auth, timeout, ...): timeout is the 7th argument after method and url.
_TIMEOUT_POSITION = 7


class TimeoutSession(requests.Session):
    """A requests.Session that gives every request a default time limit."""

    def __init__(self, timeout: tuple[float, float]) -> None:
        super().__init__()
        self.timeout = timeout

    def request(
        self, method: str | bytes, url: str | bytes, *args: Any, **kwargs: Any
    ) -> requests.Response:
        if len(args) < _TIMEOUT_POSITION:  # timeout wasn't passed by position
            kwargs.setdefault("timeout", self.timeout)
        return super().request(method, url, *args, **kwargs)


def trading_client(
    keys: AlpacaKeys, timeout: tuple[float, float] = REQUEST_TIMEOUT
) -> TradingClient:
    """Orders, positions, account and market clock."""
    client = TradingClient(keys.api_key, keys.secret_key, paper=keys.is_paper)
    return _with_timeout(client, timeout)


def stock_data_client(
    keys: AlpacaKeys, timeout: tuple[float, float] = REQUEST_TIMEOUT
) -> StockHistoricalDataClient:
    """Stock and ETF prices. Market data is read-only."""
    return _with_timeout(StockHistoricalDataClient(keys.api_key, keys.secret_key), timeout)


def crypto_data_client(
    keys: AlpacaKeys, timeout: tuple[float, float] = REQUEST_TIMEOUT
) -> CryptoHistoricalDataClient:
    """Crypto prices. Market data is read-only."""
    return _with_timeout(CryptoHistoricalDataClient(keys.api_key, keys.secret_key), timeout)


def _with_timeout[C](client: C, timeout: tuple[float, float]) -> C:
    # alpaca-py (version pinned in requirements.txt) sends every request
    # through `client._session`. Swap in a session that has a time limit.
    old = getattr(client, "_session", None)
    if not isinstance(old, requests.Session):
        raise RuntimeError(
            "Can't set a network time limit: alpaca-py has changed internally. "
            "Install the exact version pinned in requirements.txt."
        )
    old.close()
    client._session = TimeoutSession(timeout)  # type: ignore[attr-defined]
    return client
