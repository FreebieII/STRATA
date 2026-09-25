"""Shared test fixtures.

Every test runs with the network switched off, so no test can ever reach
Alpaca, place an order, or need real API keys.
"""

from __future__ import annotations

import copy
import socket
from pathlib import Path

import pytest
import yaml

from strata import logging_setup
from tests.helpers import PROJECT_ROOT


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise RuntimeError("tests must not use the network")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)


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
