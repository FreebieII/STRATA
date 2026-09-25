"""Tests for logging (strata/logging_setup.py)."""

from __future__ import annotations

import logging
import re
from zoneinfo import ZoneInfo

import pytest

from strata.logging_setup import (
    log_decision,
    redact,
    register_secrets,
    setup_logging,
    shutdown_logging,
)
from tests.helpers import FAKE_PAPER_SECRET

log = logging.getLogger("strata.test")


def _read(folder, name: str) -> str:
    return (folder / name).read_text(encoding="utf-8")


def test_log_files_are_created(tmp_path):
    setup_logging(tmp_path, console=False)
    log.info("hello from the test")
    shutdown_logging()
    assert "hello from the test" in _read(tmp_path, "strata.log")
    assert (tmp_path / "decisions.log").exists()


def test_decision_and_its_reason_go_to_both_files(tmp_path):
    setup_logging(tmp_path, console=False)
    log_decision("skip", "the market is closed", symbol="SPY")
    shutdown_logging()
    expected = "DECISION SKIP | symbol=SPY | reason: the market is closed"
    assert expected in _read(tmp_path, "decisions.log")
    assert expected in _read(tmp_path, "strata.log")


def test_ordinary_messages_stay_out_of_decisions_log(tmp_path):
    setup_logging(tmp_path, console=False)
    log.info("just chatting")
    shutdown_logging()
    assert "just chatting" not in _read(tmp_path, "decisions.log")


@pytest.mark.parametrize("reason", ["", "   "])
def test_a_decision_needs_a_reason(reason):
    with pytest.raises(ValueError, match="needs a reason"):
        log_decision("BUY", reason)


def test_decisions_are_kept_even_when_the_log_level_is_quiet(tmp_path):
    setup_logging(tmp_path, level="WARNING", console=False)
    log.info("hidden detail")
    log_decision("SKIP", "still recorded")
    shutdown_logging()
    assert "hidden detail" not in _read(tmp_path, "strata.log")
    assert "still recorded" in _read(tmp_path, "decisions.log")


def test_keys_never_reach_the_logs_or_the_screen(tmp_path, capsys):
    setup_logging(tmp_path)
    register_secrets(FAKE_PAPER_SECRET)
    log.info("key is %s", FAKE_PAPER_SECRET)
    try:
        raise RuntimeError(f"request failed for key {FAKE_PAPER_SECRET}")
    except RuntimeError:
        log.exception("an error with a traceback")
    log_decision("REFUSE_START", f"bad key {FAKE_PAPER_SECRET}")
    shutdown_logging()

    screen = capsys.readouterr()
    for text in (_read(tmp_path, "strata.log"), _read(tmp_path, "decisions.log"), screen.err):
        assert FAKE_PAPER_SECRET not in text
        assert "***" in text
    assert FAKE_PAPER_SECRET not in screen.out


def test_very_short_strings_are_not_treated_as_secrets():
    register_secrets("abc", "", None)
    assert redact("abc") == "abc"


def test_timestamps_use_the_configured_time_zone(tmp_path):
    setup_logging(tmp_path, tz=ZoneInfo("America/New_York"), console=False)
    log.info("tick")
    shutdown_logging()
    assert re.search(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d E[DS]T \| ", _read(tmp_path, "strata.log"))


def test_setting_up_twice_does_not_double_lines(tmp_path):
    setup_logging(tmp_path, console=False)
    setup_logging(tmp_path, console=False)
    log.info("only once")
    shutdown_logging()
    assert _read(tmp_path, "strata.log").count("only once") == 1
