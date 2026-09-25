"""Repository-wide safety checks: no keys in the code, .env stays private."""

from __future__ import annotations

import re
import shutil
import subprocess

import pytest
import yaml

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


# --- Docker -------------------------------------------------------------------------

COMPOSE_TEXT = (PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
COMPOSE = yaml.safe_load(COMPOSE_TEXT)
APP_SERVICES = ("migrate", "api")


def test_dockerignore_keeps_secrets_and_history_out_of_images():
    lines = (PROJECT_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    for entry in (".env", ".env.*", ".git"):
        assert entry in lines


def test_published_ports_are_only_reachable_from_this_computer():
    for name, service in COMPOSE["services"].items():
        for port in service.get("ports", []):
            assert str(port).startswith("127.0.0.1:"), f"{name} publishes {port}"


def test_compose_file_holds_no_secret_values():
    assert re.search(r"POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?", COMPOSE_TEXT)
    assert "ADMIN_API_TOKEN" not in COMPOSE_TEXT
    assert KEY_PATTERN.search(COMPOSE_TEXT) is None


def test_app_containers_read_secrets_from_the_mounted_file():
    for name in APP_SERVICES:
        service = COMPOSE["services"][name]
        assert service["environment"]["STRATA_SECRETS_FILE"] == "/run/secrets/strata_env"
        assert "strata_env" in service["secrets"]


def test_redis_never_saves_to_disk():
    command = COMPOSE["services"]["redis"]["command"]
    assert command[command.index("--save") + 1] == ""
    assert command[command.index("--appendonly") + 1] == "no"


def test_compose_never_enables_live_trading():
    assert "LIVE_TRADING" not in COMPOSE_TEXT
    assert "--live" not in COMPOSE_TEXT


def test_images_run_as_a_normal_user():
    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
    for stage in dockerfile.split("\nFROM ")[1:]:
        users = re.findall(r"^USER (\S+)", stage, flags=re.MULTILINE)
        assert users, "every stage must switch user"
        assert users[-1] == "strata"
