"""Tests for logging (strata/logging_setup.py)."""

from __future__ import annotations

import json
import logging
import re
from zoneinfo import ZoneInfo

import pytest

from strata.logging_setup import (
    EVENT_FIELDS,
    log_context,
    log_decision,
    log_event,
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


# --- structured JSON events (events.jsonl) -------------------------------------


def _events(folder) -> list[dict]:
    lines = _read(folder, "events.jsonl").splitlines()
    return [json.loads(line) for line in lines]


def test_every_event_is_one_json_object_with_every_field(tmp_path):
    setup_logging(tmp_path, console=False, component="api")
    log.info("plain message")
    log_event("http_request", "GET /health -> 200", result=200, duration_ms=1.5)
    shutdown_logging()
    events = _events(tmp_path)
    assert len(events) == 2
    for event in events:
        for name in ("timestamp", "level", "logger", "message", *EVENT_FIELDS, "details"):
            assert name in event, name
        assert event["component"] == "api"
        assert event["timestamp"].endswith("Z")  # UTC
    plain, request = events
    assert plain["event_type"] == "log"
    assert request["event_type"] == "http_request"
    assert request["result"] == 200
    assert request["details"] == {"duration_ms": 1.5}


def test_context_fields_reach_every_event_inside_the_block(tmp_path):
    setup_logging(tmp_path, console=False)
    with log_context(request_id="req-1"):
        log.info("inside")
        with log_context(agent="critic"):
            log.info("nested")
    log.info("outside")
    shutdown_logging()
    inside, nested, outside = _events(tmp_path)
    assert inside["request_id"] == "req-1"
    assert inside["agent"] is None
    assert nested["request_id"] == "req-1"
    assert nested["agent"] == "critic"
    assert outside["request_id"] is None


def test_decisions_become_structured_events(tmp_path):
    setup_logging(tmp_path, console=False)
    log_decision("reject", "order too large", symbol="SPY", strategy="ma_crossover", value="70.00")
    shutdown_logging()
    [event] = _events(tmp_path)
    assert event["event_type"] == "decision"
    assert event["decision"] == "REJECT"
    assert event["symbol"] == "SPY"
    assert event["strategy"] == "ma_crossover"
    assert event["details"] == {"reason": "order too large", "value": "70.00"}


def test_errors_carry_their_type_and_traceback(tmp_path):
    setup_logging(tmp_path, console=False)
    try:
        raise ValueError("bad price")
    except ValueError:
        log.exception("price check failed")
    shutdown_logging()
    [event] = _events(tmp_path)
    assert event["level"] == "ERROR"
    assert event["error"] == "ValueError: bad price"
    assert "Traceback" in event["details"]["traceback"]


def test_secrets_are_hidden_in_json_events(tmp_path):
    setup_logging(tmp_path, console=False)
    register_secrets(FAKE_PAPER_SECRET)
    log_event(
        "test",
        f"message {FAKE_PAPER_SECRET}",
        note=f"value {FAKE_PAPER_SECRET}",
        nested={"inner": [FAKE_PAPER_SECRET]},
    )
    try:
        raise RuntimeError(FAKE_PAPER_SECRET)
    except RuntimeError:
        log.exception("boom")
    shutdown_logging()
    text = _read(tmp_path, "events.jsonl")
    assert FAKE_PAPER_SECRET not in text
    assert "***" in text


def test_console_can_print_json_for_containers(tmp_path, capsys):
    setup_logging(tmp_path, console_format="json")
    log.warning("for the container log")
    shutdown_logging()
    line = capsys.readouterr().err.strip().splitlines()[-1]
    assert json.loads(line)["message"] == "for the container log"


@pytest.mark.parametrize("name", ["httpx", "httpcore", "httpx2", "httpcore2", "urllib3"])
def test_http_clients_cannot_log_full_urls(tmp_path, name):
    # Their INFO messages contain whole URLs, query strings (and keys) included.
    setup_logging(tmp_path, console=False)
    assert logging.getLogger(name).getEffectiveLevel() >= logging.WARNING
