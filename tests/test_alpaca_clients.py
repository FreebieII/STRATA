"""Tests for creating Alpaca connections (strata/alpaca_clients.py).

Creating a client object sends nothing over the network; these tests only
inspect how the client was set up.
"""

from __future__ import annotations

import pytest
import requests
from alpaca.common.enums import BaseURL

from strata import alpaca_clients
from strata.alpaca_clients import (
    REQUEST_TIMEOUT,
    TimeoutSession,
    crypto_data_client,
    stock_data_client,
    trading_client,
)
from strata.credentials import AlpacaKeys
from tests.helpers import FAKE_LIVE_KEY, FAKE_PAPER_KEY, FAKE_PAPER_SECRET

PAPER_KEYS = AlpacaKeys("paper", FAKE_PAPER_KEY, FAKE_PAPER_SECRET)


def test_paper_keys_connect_to_the_paper_server():
    assert trading_client(PAPER_KEYS)._base_url == BaseURL.TRADING_PAPER


def test_the_server_is_chosen_by_which_keys_were_loaded(monkeypatch):
    # A stand-in records how the client would be created; no real live
    # client is ever made in the tests.
    created = []

    class RecordingClient:
        def __init__(self, api_key, secret_key, paper):
            created.append(paper)
            self._session = requests.Session()

    monkeypatch.setattr(alpaca_clients, "TradingClient", RecordingClient)
    trading_client(PAPER_KEYS)
    trading_client(AlpacaKeys("live", FAKE_LIVE_KEY, "fake-live-secret"))
    assert created == [True, False]


@pytest.mark.parametrize("make", [trading_client, stock_data_client, crypto_data_client])
def test_every_client_has_a_network_time_limit(make):
    client = make(PAPER_KEYS)
    assert isinstance(client._session, TimeoutSession)
    assert client._session.timeout == REQUEST_TIMEOUT


def test_time_limit_is_added_to_each_request(monkeypatch):
    seen = {}

    def fake_request(self, method, url, **kwargs):
        seen.update(kwargs)
        return "response"

    monkeypatch.setattr(requests.Session, "request", fake_request)
    TimeoutSession((1.0, 2.0)).request("GET", "https://example.invalid")
    assert seen["timeout"] == (1.0, 2.0)


def test_an_explicit_time_limit_is_respected(monkeypatch):
    seen = {}
    monkeypatch.setattr(requests.Session, "request", lambda self, m, u, **kw: seen.update(kw))
    TimeoutSession((1.0, 2.0)).request("GET", "https://example.invalid", timeout=5)
    assert seen["timeout"] == 5


def test_refuses_when_alpaca_py_internals_change():
    class NoSession:
        pass

    with pytest.raises(RuntimeError, match="requirements.txt"):
        alpaca_clients._with_timeout(NoSession(), REQUEST_TIMEOUT)
