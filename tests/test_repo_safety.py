"""Repository-wide safety checks: no keys in the code, .env stays private."""

from __future__ import annotations

import re
import shutil
import subprocess

import pytest

from strata.credentials import SECRET_NAMES, live_trading_switch_on, read_env_file
from tests.helpers import PROJECT_ROOT

# Alpaca key IDs look like PK... (paper) or AK... (live) plus 16+ letters/digits.
KEY_PATTERN = re.compile(r"\b[PA]K[A-Z0-9]{16,}\b")


def test_env_example_holds_no_keys_and_keeps_live_off():
    env = read_env_file(PROJECT_ROOT / ".env.example")
    for name in SECRET_NAMES:
        assert env.get(name, "") == "", f"{name} must be empty in .env.example"
    assert env["LIVE_TRADING"] == "false"
    assert not live_trading_switch_on(env)


def test_gitignore_lists_env():
    lines = (PROJECT_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert ".env" in lines
    assert "!.env.example" in lines


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_git_really_ignores_env():
    inside = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"], cwd=PROJECT_ROOT, capture_output=True
    )
    if inside.returncode != 0:
        pytest.skip("not a git checkout")
    ignored = subprocess.run(["git", "check-ignore", "-q", ".env"], cwd=PROJECT_ROOT)
    assert ignored.returncode == 0


def test_no_api_keys_written_into_the_code():
    suspects = []
    files = list(PROJECT_ROOT.glob("*.py")) + list(PROJECT_ROOT.glob("*.yaml"))
    files += list((PROJECT_ROOT / "strata").rglob("*.py")) + list(
        (PROJECT_ROOT / "tests").rglob("*.py")
    )
    files.append(PROJECT_ROOT / ".env.example")
    for path in files:
        for match in KEY_PATTERN.finditer(path.read_text(encoding="utf-8")):
            if "TESTFAKE" not in match.group():  # the obviously fake test keys
                suspects.append(f"{path.relative_to(PROJECT_ROOT)}: {match.group()[:4]}...")
    assert suspects == []
