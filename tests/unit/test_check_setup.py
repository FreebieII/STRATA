"""Tests for check_setup.py.

The --connect checks are exercised with stand-in Alpaca clients that
return real alpaca-py data objects, so nothing goes over the network.
"""

from __future__ import annotations

import shutil
import subprocess
from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from alpaca.common.exceptions import APIError
from alpaca.data.models import BarSet
from alpaca.trading.enums import AccountStatus, AssetClass, AssetExchange, AssetStatus
from alpaca.trading.models import Asset, Clock, TradeAccount

import check_setup
from check_setup import FAIL, OK, WARN
from strata import alpaca_clients
from strata.config import load_config
from strata.logging_setup import register_secrets
from tests.helpers import FAKE_PAPER_KEY, FAKE_PAPER_SECRET, PROJECT_ROOT, env_text

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


def test_python_version_check():
    assert check_setup.check_python((3, 12, 0)).status == OK
    assert check_setup.check_python((3, 13, 2)).status == OK
    assert check_setup.check_python((3, 11, 9)).status == FAIL


@pytest.mark.parametrize("lock_file", ["requirements.txt", "requirements-dev.txt"])
def test_every_locked_package_is_pinned_and_hash_checked(lock_file):
    path = PROJECT_ROOT / lock_file
    packages = check_setup.requirement_lines(path)  # raises on any unpinned line
    assert packages, f"{lock_file} lists no packages"
    lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    package_starts = [
        i for i, line in enumerate(lines) if line and not line.startswith(("#", "--"))
    ]
    for i in package_starts:
        assert lines[i + 1].startswith("--hash=sha256:"), f"{lines[i]} has no hash"


def test_runtime_lock_holds_the_direct_dependencies():
    pins = check_setup.pinned_requirements()
    for name in ("alpaca-py", "fastapi", "sqlalchemy", "alembic", "redis", "pydantic"):
        assert name in pins


def test_windows_only_packages_are_not_required_everywhere():
    dev_lines = check_setup.requirement_lines(PROJECT_ROOT / "requirements-dev.txt")
    conditional = {name for name, _version, marker in dev_lines if marker}
    assert "colorama" in conditional
    assert "colorama" not in check_setup.pinned_requirements(PROJECT_ROOT / "requirements-dev.txt")


def test_unreadable_lock_line_is_reported(tmp_path):
    path = tmp_path / "requirements.txt"
    path.write_text("somepackage>=1.0\n", encoding="utf-8")
    with pytest.raises(ValueError, match="can't read"):
        check_setup.requirement_lines(path)


def test_installed_packages_are_found():
    assert all(c.status != FAIL for c in check_setup.check_packages())


def test_config_check_passes_for_the_shipped_config():
    checks, config = check_setup.check_config(PROJECT_ROOT / "config.yaml")
    assert config is not None
    assert {c.status for c in checks} == {OK}
    assert "$60.00" in " ".join(c.detail for c in checks)


def test_config_check_reports_problems(config_dict, write_config):
    config_dict["risk"]["MAX_CAPITAL"] = -5
    checks, config = check_setup.check_config(write_config(config_dict))
    assert config is None
    assert checks[0].status == FAIL


def test_env_check_passes_for_paper_keys(write_env):
    checks, env = check_setup.check_env(write_env(env_text()))
    assert env is not None
    assert {c.status for c in checks} == {OK}


def test_env_check_never_prints_keys(write_env):
    checks, _ = check_setup.check_env(write_env(env_text(live_keys=True, live_trading="true")))
    printed = "\n".join(c.line() for c in checks)
    assert FAKE_PAPER_KEY not in printed
    assert FAKE_PAPER_SECRET not in printed


def test_env_check_warns_when_live_mode_is_unlocked(write_env):
    checks, _ = check_setup.check_env(write_env(env_text(live_trading="true")))
    assert any(c.name == "LIVE_TRADING" and c.status == WARN for c in checks)


def test_env_check_warns_when_live_keys_are_filled_in(write_env):
    checks, _ = check_setup.check_env(write_env(env_text(live_keys=True)))
    assert any(c.name == "live keys" and c.status == WARN for c in checks)


def test_env_check_warns_about_a_live_looking_paper_key(write_env):
    text = "ALPACA_PAPER_API_KEY=AKLOOKSLIVE123\nALPACA_PAPER_SECRET_KEY=secret123\n"
    checks, _ = check_setup.check_env(write_env(text))
    assert any(c.name == "paper keys" and c.status == WARN for c in checks)


def test_env_check_fails_without_env_file(tmp_path):
    checks, env = check_setup.check_env(tmp_path / ".env")
    assert env is None
    assert checks[0].status == FAIL


# --- is .env kept out of git? -----------------------------------------------------


def test_this_repository_ignores_env():
    assert check_setup.check_env_not_in_git(PROJECT_ROOT).status in {OK, WARN}


def _git_repo(tmp_path, gitignore: str | None):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    if gitignore is not None:
        (tmp_path / ".gitignore").write_text(gitignore, encoding="utf-8")
    (tmp_path / ".env").write_text(env_text(), encoding="utf-8")
    return tmp_path


@needs_git
def test_git_check_ok_when_env_is_ignored(tmp_path):
    repo = _git_repo(tmp_path, ".env\n")
    assert check_setup.check_env_not_in_git(repo).status == OK


@needs_git
def test_git_check_fails_when_env_is_not_ignored(tmp_path):
    repo = _git_repo(tmp_path, None)
    assert check_setup.check_env_not_in_git(repo).status == FAIL


@needs_git
def test_git_check_fails_when_env_is_already_committed(tmp_path):
    repo = _git_repo(tmp_path, None)
    subprocess.run(["git", "add", ".env"], cwd=repo, check=True)
    (repo / ".gitignore").write_text(".env\n", encoding="utf-8")  # too late: already tracked
    result = check_setup.check_env_not_in_git(repo)
    assert result.status == FAIL
    assert "COMMITTED" in result.detail


def test_git_check_outside_a_repository(tmp_path):
    assert check_setup.check_env_not_in_git(tmp_path).status == WARN


# --- the --connect checks, with stand-in clients ------------------------------------


def _account(**changes) -> TradeAccount:
    fields = dict(
        id=uuid4(),
        account_number="PA0TEST",
        status=AccountStatus.ACTIVE,
        crypto_status=AccountStatus.ACTIVE,
        cash="100000",
        pattern_day_trader=False,
        trading_blocked=False,
        account_blocked=False,
        trade_suspended_by_user=False,
        daytrade_count=0,
    )
    fields.update(changes)
    return TradeAccount(**fields)


def _asset(symbol: str, crypto: bool, fractionable: bool = True) -> Asset:
    return Asset(
        **{
            "id": uuid4(),
            "class": AssetClass.CRYPTO if crypto else AssetClass.US_EQUITY,
            "exchange": AssetExchange.CRYPTO if crypto else AssetExchange.ARCA,
            "symbol": symbol,
            "status": AssetStatus.ACTIVE,
            "tradable": True,
            "marginable": not crypto,
            "shortable": not crypto,
            "easy_to_borrow": not crypto,
            "fractionable": fractionable,
            "min_order_size": 0.0001 if crypto else None,
        }
    )


def _bars(symbol: str, close: float) -> BarSet:
    bar = {
        "t": "2026-09-24T04:00:00Z",
        "o": close,
        "h": close,
        "l": close,
        "c": close,
        "v": 1,
        "n": 1,
        "vw": close,
    }
    return BarSet(raw_data={symbol: [bar]})


class FakeTradingClient:
    def __init__(self, account: TradeAccount, spy_fractionable: bool = True):
        self.account = account
        self.spy_fractionable = spy_fractionable
        self.calls: list[str] = []

    def get_account(self):
        self.calls.append("get_account")
        return self.account

    def get_clock(self):
        self.calls.append("get_clock")
        now = datetime(2026, 9, 25, 12, tzinfo=UTC)
        return Clock(timestamp=now, is_open=True, next_open=now, next_close=now)

    def get_asset(self, symbol):
        self.calls.append(f"get_asset {symbol}")
        return _asset(symbol, crypto="/" in symbol, fractionable=self.spy_fractionable)

    def __getattr__(self, name):  # anything else (e.g. submit_order) is forbidden
        raise AssertionError(f"check_setup must be read-only, but it called {name}")


@pytest.fixture
def connect(monkeypatch, write_env):
    def _run(account=None, spy_fractionable=True):
        fake = FakeTradingClient(account or _account(), spy_fractionable)
        monkeypatch.setattr(alpaca_clients, "trading_client", lambda keys: fake)
        monkeypatch.setattr(
            alpaca_clients,
            "stock_data_client",
            lambda keys: SimpleNamespace(get_stock_bars=lambda request: _bars("SPY", 650.0)),
        )
        monkeypatch.setattr(
            alpaca_clients,
            "crypto_data_client",
            lambda keys: SimpleNamespace(
                get_crypto_bars=lambda request: _bars("BTC/USD", 100_000.0)
            ),
        )
        config = load_config(PROJECT_ROOT / "config.yaml")
        _, env = check_setup.check_env(write_env(env_text()))
        return check_setup.check_connection(config, env), fake

    return _run


def test_connect_checks_pass_for_a_healthy_paper_account(connect):
    checks, fake = connect()
    assert [c for c in checks if c.status != OK] == []
    assert "get_account" in fake.calls


def test_connect_flags_a_blocked_account(connect):
    checks, _ = connect(_account(trading_blocked=True))
    assert any(c.name == "paper account" and c.status == FAIL for c in checks)


def test_connect_copes_without_day_trade_fields(connect):
    # Alpaca's account no longer carries them (the rule behind them was replaced).
    checks, _ = connect(_account(pattern_day_trader=None, daytrade_count=None))
    [day] = [c for c in checks if c.name == "day trading"]
    assert day.status == OK
    assert "unknown" not in day.detail


def test_connect_warns_about_a_pattern_day_trader_flag(connect):
    checks, _ = connect(_account(pattern_day_trader=True))
    assert any(c.name == "day trading" and c.status == WARN for c in checks)


def test_connect_flags_crypto_not_enabled(connect):
    checks, _ = connect(_account(crypto_status=AccountStatus.INACTIVE))
    assert any(c.name == "crypto trading" and c.status == FAIL for c in checks)


def test_connect_flags_a_share_too_big_for_the_position_limit(connect):
    checks, _ = connect(spy_fractionable=False)  # a $650 share vs a $60 limit
    assert any(c.name == "SPY size" and c.status == FAIL for c in checks)


def test_connect_is_skipped_when_offline_checks_fail(tmp_path, capsys):
    code = check_setup.main(["--connect", "--env", str(tmp_path / "missing.env")])
    assert code == 1
    assert "skipped" in capsys.readouterr().out


def test_describe_error_hides_keys():
    register_secrets(FAKE_PAPER_SECRET)
    text = check_setup.describe_error(RuntimeError(f"boom {FAKE_PAPER_SECRET}"))
    assert FAKE_PAPER_SECRET not in text


def test_describe_error_explains_rejected_keys():
    http_error = SimpleNamespace(response=SimpleNamespace(status_code=401))
    error = APIError('{"code": 40110000, "message": "request is not authorized"}', http_error)
    assert "PAPER keys" in check_setup.describe_error(error)


def test_uses_the_secrets_file_named_by_strata_secrets_file(monkeypatch, write_env, capsys):
    # Containers set STRATA_SECRETS_FILE=/run/secrets/strata_env.
    monkeypatch.setenv("STRATA_SECRETS_FILE", str(write_env(env_text())))
    assert check_setup.main([]) == 0
    assert "[ OK ] paper keys" in capsys.readouterr().out


def test_describe_error_blames_the_network_for_a_non_alpaca_refusal():
    http_error = SimpleNamespace(response=SimpleNamespace(status_code=403))
    error = APIError("Host not in allowlist: paper-api.alpaca.markets", http_error)
    text = check_setup.describe_error(error)
    assert "proxy or firewall" in text
    assert "PAPER keys" not in text
