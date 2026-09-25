"""Tests for choosing the mode and for the live-mode safety gate (strata/modes.py).

No test here connects to Alpaca: the network is switched off for every
test (see conftest.py) and only obviously fake keys are used.
"""

from __future__ import annotations

import io

import pytest

from main import build_parser, main
from strata.config import load_config
from strata.modes import (
    LIVE_CONFIRMATION_PHRASE,
    LiveModeRefused,
    Mode,
    resolve_mode,
    unlock_live_mode,
)
from tests.helpers import FAKE_LIVE_KEY, FAKE_PAPER_KEY, FAKE_PAPER_SECRET, PROJECT_ROOT, env_text

RISK = load_config(PROJECT_ROOT / "config.yaml").risk


class Keyboard:
    """Stands in for a person typing at the terminal."""

    def __init__(self, typed):
        self.typed = typed
        self.prompts: list[str] = []

    def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if isinstance(self.typed, BaseException):
            raise self.typed
        return self.typed


def env(*, live_trading="true", live_keys=True) -> dict:
    values = {"LIVE_TRADING": live_trading}
    if live_keys:
        values["ALPACA_LIVE_API_KEY"] = FAKE_LIVE_KEY
        values["ALPACA_LIVE_SECRET_KEY"] = "fake-live-secret"
    return values


def try_unlock(
    *, live_flag=True, env_values=None, typed=LIVE_CONFIRMATION_PHRASE, interactive=True
):
    keyboard = Keyboard(typed)
    shown: list[str] = []
    try:
        keys = unlock_live_mode(
            live_flag=live_flag,
            env=env() if env_values is None else env_values,
            risk=RISK,
            ask=keyboard,
            interactive=interactive,
            say=shown.append,
        )
    except LiveModeRefused as exc:
        return None, str(exc), keyboard, shown
    return keys, "", keyboard, shown


# --- choosing a mode --------------------------------------------------------


def test_default_mode_is_paper():
    args = build_parser().parse_args([])
    assert resolve_mode(args.mode, args.live) is Mode.PAPER


@pytest.mark.parametrize("name", ["backtest", "paper", "live"])
def test_each_mode_can_be_chosen(name):
    args = build_parser().parse_args(["--mode", name] + (["--live"] if name == "live" else []))
    assert resolve_mode(args.mode, args.live) is Mode(name)


@pytest.mark.parametrize("mode", [None, "paper", "backtest"])
def test_live_flag_without_live_mode_is_refused(mode):
    with pytest.raises(ValueError, match="--live only works together with --mode live"):
        resolve_mode(mode, live_flag=True)


def test_unknown_mode_is_refused():
    with pytest.raises(SystemExit):
        build_parser().parse_args(["--mode", "real-money"])


# --- the live-mode gate ------------------------------------------------------------


def test_live_refused_without_the_live_flag():
    keys, message, keyboard, _ = try_unlock(live_flag=False)
    assert keys is None
    assert "--live flag" in message
    assert keyboard.prompts == []  # never even asked for the phrase


@pytest.mark.parametrize("switch", ["false", "", "1", "yes", "TRUE!"])
def test_live_refused_unless_env_says_live_trading_true(switch):
    keys, message, keyboard, _ = try_unlock(env_values=env(live_trading=switch))
    assert keys is None
    assert "LIVE_TRADING=true" in message
    assert keyboard.prompts == []


def test_live_refused_when_the_switch_line_is_missing():
    values = env()
    del values["LIVE_TRADING"]
    keys, message, _, _ = try_unlock(env_values=values)
    assert keys is None
    assert "LIVE_TRADING=true" in message


def test_every_missing_switch_is_named_at_once():
    _, message, _, _ = try_unlock(live_flag=False, env_values=env(live_trading="false"))
    assert "--live flag" in message
    assert "LIVE_TRADING=true" in message


def test_live_refused_without_live_keys():
    keys, message, keyboard, _ = try_unlock(env_values=env(live_keys=False))
    assert keys is None
    assert "ALPACA_LIVE_API_KEY" in message
    assert keyboard.prompts == []


def test_live_refused_when_nobody_is_at_a_terminal():
    keys, message, keyboard, _ = try_unlock(interactive=False)
    assert keys is None
    assert "typed by a person" in message
    assert keyboard.prompts == []


@pytest.mark.parametrize(
    "typed",
    [
        "",
        "yes",
        "y",
        LIVE_CONFIRMATION_PHRASE.lower(),
        LIVE_CONFIRMATION_PHRASE[:-1],
        LIVE_CONFIRMATION_PHRASE + ".",
        "I ACCEPT THE RISK",
    ],
)
def test_live_refused_when_the_phrase_is_wrong(typed):
    keys, message, keyboard, _ = try_unlock(typed=typed)
    assert keys is None
    assert "phrase did not match" in message
    assert len(keyboard.prompts) == 1


def test_live_refused_when_input_ends_before_typing():
    keys, message, _, _ = try_unlock(typed=EOFError())
    assert keys is None
    assert "phrase did not match" in message


def test_warning_shows_the_risk_limits_before_asking():
    _, _, _, shown = try_unlock()
    warning = "\n".join(shown)
    assert "REAL money" in warning
    assert "$300.00" in warning  # MAX_CAPITAL
    assert "$60.00" in warning  # largest position
    assert "Past results do not predict future results" in warning


def test_live_unlocks_only_when_every_check_passes():
    # A pure function call with fake keys: nothing connects to Alpaca.
    keys, message, keyboard, _ = try_unlock()
    assert message == ""
    assert keys.account == "live"
    assert not keys.is_paper
    assert len(keyboard.prompts) == 1


def test_spaces_around_the_phrase_are_forgiven():
    keys, _, _, _ = try_unlock(typed=f"   {LIVE_CONFIRMATION_PHRASE}  ")
    assert keys is not None


# --- main.py start-up ----------------------------------------------------------------


@pytest.fixture
def start(config_dict, write_config, write_env, monkeypatch):
    """Run main.py's main() with a temporary config and .env."""

    def never_type(prompt=""):
        raise AssertionError("the bot asked for the live phrase when it should have refused first")

    monkeypatch.setattr("builtins.input", never_type)

    def _start(args: list[str], env_file_text: str) -> int:
        config_path = write_config(config_dict)
        env_path = write_env(env_file_text)
        return main([*args, "--config", str(config_path), "--env", str(env_path)])

    return _start


def _decisions(tmp_path) -> str:
    return (tmp_path / "logs" / "decisions.log").read_text(encoding="utf-8")


def test_main_starts_in_paper_mode_by_default(start, tmp_path):
    assert start([], env_text()) == 0
    decisions = _decisions(tmp_path)
    assert "mode=paper" in decisions
    assert "no orders were sent" in decisions


def test_main_never_writes_keys_to_the_logs(start, tmp_path):
    start([], env_text())
    for name in ("strata.log", "decisions.log"):
        text = (tmp_path / "logs" / name).read_text(encoding="utf-8")
        assert FAKE_PAPER_KEY not in text
        assert FAKE_PAPER_SECRET not in text


def test_main_backtest_mode_uses_paper_keys(start, tmp_path):
    assert start(["--mode", "backtest"], env_text()) == 0
    assert "mode=backtest" in _decisions(tmp_path)


def test_main_refuses_live_when_env_switch_is_off(start, tmp_path):
    code = start(["--mode", "live", "--live"], env_text(live_keys=True, live_trading="false"))
    assert code == 2
    decisions = _decisions(tmp_path)
    assert "REFUSE_START" in decisions
    assert "LIVE_TRADING=true" in decisions


def test_main_refuses_live_without_the_flag(start, tmp_path):
    code = start(["--mode", "live"], env_text(live_keys=True, live_trading="true"))
    assert code == 2
    assert "--live flag" in _decisions(tmp_path)


def test_main_refuses_a_piped_in_phrase(start, tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(LIVE_CONFIRMATION_PHRASE + "\n"))
    code = start(["--mode", "live", "--live"], env_text(live_keys=True, live_trading="true"))
    assert code == 2
    assert "typed by a person" in _decisions(tmp_path)


def test_main_refuses_live_flag_in_paper_mode(start, tmp_path):
    assert start(["--live"], env_text()) == 2
    assert "--live only works together with --mode live" in _decisions(tmp_path)


def test_main_refuses_a_bad_config(start, config_dict, tmp_path):
    config_dict["risk"]["MAX_CAPITAL"] = -1
    assert start([], env_text()) == 2
    decisions = _decisions(tmp_path)
    assert "REFUSE_START" in decisions
    assert "risk.MAX_CAPITAL" in decisions


def test_main_refuses_to_start_without_paper_keys(start, tmp_path):
    assert start([], env_text(paper=False)) == 2
    assert "ALPACA_PAPER_API_KEY" in _decisions(tmp_path)
