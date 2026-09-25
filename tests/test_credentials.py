"""Tests for reading API keys from .env (strata/credentials.py)."""

from __future__ import annotations

import os

import pytest

from strata.credentials import (
    AlpacaKeys,
    CredentialsError,
    live_trading_switch_on,
    load_live_keys,
    load_paper_keys,
    looks_like_paper_key,
    read_env_file,
    secret_values,
)
from tests.helpers import (
    FAKE_LIVE_KEY,
    FAKE_LIVE_SECRET,
    FAKE_PAPER_KEY,
    FAKE_PAPER_SECRET,
    env_text,
)


def test_missing_env_file_explains_how_to_create_it(tmp_path):
    with pytest.raises(CredentialsError, match="cp .env.example .env"):
        read_env_file(tmp_path / ".env")


def test_paper_keys_are_read(write_env):
    keys = load_paper_keys(read_env_file(write_env(env_text())))
    assert keys.account == "paper"
    assert keys.is_paper
    assert keys.api_key == FAKE_PAPER_KEY
    assert keys.secret_key == FAKE_PAPER_SECRET


@pytest.mark.parametrize("text", [env_text(paper=False), "LIVE_TRADING=false\n"])
def test_missing_paper_keys_are_refused(write_env, text):
    with pytest.raises(CredentialsError, match="ALPACA_PAPER_API_KEY and ALPACA_PAPER_SECRET_KEY"):
        load_paper_keys(read_env_file(write_env(text)))


def test_paper_mode_never_falls_back_to_live_keys(write_env):
    env = read_env_file(write_env(env_text(paper=False, live_keys=True, live_trading="true")))
    with pytest.raises(CredentialsError):
        load_paper_keys(env)


def test_live_keys_are_read_separately(write_env):
    keys = load_live_keys(read_env_file(write_env(env_text(live_keys=True))))
    assert keys.account == "live"
    assert not keys.is_paper
    assert keys.api_key == FAKE_LIVE_KEY


def test_keys_are_hidden_when_printed():
    keys = AlpacaKeys("paper", FAKE_PAPER_KEY, FAKE_PAPER_SECRET)
    for text in (repr(keys), str(keys), f"{keys}", f"{keys!r}", str([keys]), str({"k": keys})):
        assert FAKE_PAPER_KEY not in text
        assert FAKE_PAPER_SECRET not in text
        assert "<hidden>" in text


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("true", True),
        ("TRUE", True),
        ("True", True),
        ("  true  ", True),
        ("false", False),
        ("", False),
        ("1", False),
        ("yes", False),
        ("on", False),
        ("truee", False),
        ("true!", False),
    ],
)
def test_live_trading_switch_needs_exactly_true(value, expected):
    assert live_trading_switch_on({"LIVE_TRADING": value}) is expected


def test_missing_live_trading_line_means_off():
    assert live_trading_switch_on({}) is False


def test_quoted_true_in_env_file_counts(write_env):
    assert live_trading_switch_on(read_env_file(write_env('LIVE_TRADING="true"\n')))


def test_shell_environment_variables_are_ignored(monkeypatch, write_env):
    monkeypatch.setenv("LIVE_TRADING", "true")
    monkeypatch.setenv("ALPACA_PAPER_API_KEY", "PKFROMTHESHELL")
    env = read_env_file(write_env(env_text(live_trading="false")))
    assert not live_trading_switch_on(env)
    assert load_paper_keys(env).api_key == FAKE_PAPER_KEY


def test_reading_env_does_not_copy_keys_into_the_environment(monkeypatch, write_env):
    monkeypatch.delenv("ALPACA_PAPER_API_KEY", raising=False)
    read_env_file(write_env(env_text()))
    assert "ALPACA_PAPER_API_KEY" not in os.environ


def test_repeated_name_is_refused(write_env):
    with pytest.raises(CredentialsError, match="more than once: LIVE_TRADING"):
        read_env_file(write_env(env_text(live_trading="false") + "LIVE_TRADING=true\n"))


def test_malformed_line_is_refused_without_showing_it(write_env):
    text = env_text() + "oops SECRETVALUE123 pasted without a name\n"
    with pytest.raises(CredentialsError) as info:
        read_env_file(write_env(text))
    assert "line(s) 6" in str(info.value)
    assert "SECRETVALUE123" not in str(info.value)


def test_comments_quotes_and_export_are_understood(write_env):
    text = (
        "# my paper keys\n"
        'export ALPACA_PAPER_API_KEY="PK123456"   # from the dashboard\n'
        "ALPACA_PAPER_SECRET_KEY='secret with spaces'\n"
        "LIVE_TRADING=false  # keep it off\n"
    )
    env = read_env_file(write_env(text))
    keys = load_paper_keys(env)
    assert keys.api_key == "PK123456"
    assert keys.secret_key == "secret with spaces"
    assert not live_trading_switch_on(env)


def test_no_variable_expansion(monkeypatch, write_env):
    monkeypatch.setenv("SOMEVAR", "expanded")
    text = "ALPACA_PAPER_API_KEY=PK${SOMEVAR}\nALPACA_PAPER_SECRET_KEY=x1234\n"
    assert load_paper_keys(read_env_file(write_env(text))).api_key == "PK${SOMEVAR}"


def test_file_saved_by_windows_notepad_with_bom_works(tmp_path):
    path = tmp_path / ".env"
    path.write_bytes(b"\xef\xbb\xbf" + env_text().encode("utf-8"))
    assert load_paper_keys(read_env_file(path)).api_key == FAKE_PAPER_KEY


def test_non_utf8_file_gets_a_clear_message(tmp_path):
    path = tmp_path / ".env"
    path.write_text(env_text(), encoding="utf-16")
    with pytest.raises(CredentialsError, match="UTF-8"):
        read_env_file(path)


def test_secret_values_lists_every_key(write_env):
    env = read_env_file(write_env(env_text(live_keys=True)))
    assert set(secret_values(env)) == {
        FAKE_PAPER_KEY,
        FAKE_PAPER_SECRET,
        FAKE_LIVE_KEY,
        FAKE_LIVE_SECRET,
    }


def test_paper_key_shape_hint():
    assert looks_like_paper_key("PKABCDEF")
    assert not looks_like_paper_key("AKABCDEF")
