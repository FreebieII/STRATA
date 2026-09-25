"""Shared test fixtures.

No test can reach the internet: connections are only allowed to this
computer and to private network addresses (where the test database and
Redis live). So no test can ever reach Alpaca, place an order, or need
real API keys.
"""

from __future__ import annotations

import copy
import ipaddress
import os
import socket
from pathlib import Path

import pytest
import yaml

from strata import logging_setup
from tests.helpers import PROJECT_ROOT

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex


def _is_local(address: object) -> bool:
    """True for Unix sockets, this computer, and private network addresses."""
    if isinstance(address, str | bytes):  # a Unix socket path
        return True
    host = address[0] if isinstance(address, tuple) and address else None
    if host == "localhost":
        return True
    try:
        ip = ipaddress.ip_address(host)  # type: ignore[arg-type]
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


@pytest.fixture(autouse=True)
def _internet_blocked(monkeypatch):
    def guarded_connect(self, address):
        if not _is_local(address):
            raise RuntimeError(f"tests must not use the internet (tried to reach {address!r})")
        return _real_connect(self, address)

    def guarded_connect_ex(self, address):
        if not _is_local(address):
            raise RuntimeError(f"tests must not use the internet (tried to reach {address!r})")
        return _real_connect_ex(self, address)

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", guarded_connect_ex)


@pytest.fixture(autouse=True)
def _no_stray_strata_variables(monkeypatch):
    """STRATA_ variables from the developer's shell must not change test results."""
    for name in list(os.environ):
        if name.startswith("STRATA_") and not name.startswith("STRATA_TEST_"):
            monkeypatch.delenv(name)


@pytest.fixture(autouse=True)
def _fresh_logging():
    yield
    logging_setup.shutdown_logging()
    logging_setup._secrets.clear()


@pytest.fixture
def config_dict() -> dict:
    """A fresh copy of the real config.yaml, as a plain dict, to modify."""
    with (PROJECT_ROOT / "config.yaml").open(encoding="utf-8") as fh:
        return copy.deepcopy(yaml.safe_load(fh))


@pytest.fixture
def write_config(tmp_path):
    """Save a config dict as tmp_path/config.yaml and return its path."""

    def _write(data: dict) -> Path:
        path = tmp_path / "config.yaml"
        path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
        return path

    return _write


@pytest.fixture
def write_env(tmp_path):
    """Save text as tmp_path/.env and return its path."""

    def _write(text: str) -> Path:
        path = tmp_path / ".env"
        path.write_text(text, encoding="utf-8")
        return path

    return _write
