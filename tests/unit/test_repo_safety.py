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
    files += [path for path in (PROJECT_ROOT / "scripts").iterdir() if path.is_file()]
    files += [
        path
        for pattern in (
            "src/**/*.ts",
            "src/**/*.tsx",
            "src/**/*.json",
            "e2e/**/*.ts",
            "nginx/*.conf",
        )
        for path in (PROJECT_ROOT / "frontend").glob(pattern)
    ]
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
    for entry in (".env", ".env.*", ".git", "certs", "frontend/node_modules"):
        assert entry in lines


def test_gitignore_lists_the_certificates():
    lines = (PROJECT_ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "certs/" in lines


# Only the dashboard may be opened from other machines, and only when the
# operator sets STRATA_DASHBOARD_BIND; by default it too is this computer only.
DASHBOARD_PORT = "${STRATA_DASHBOARD_BIND:-127.0.0.1}:${STRATA_DASHBOARD_PORT:-8443}:8443"


def test_published_ports_are_only_reachable_from_this_computer():
    for name, service in COMPOSE["services"].items():
        for port in service.get("ports", []):
            if name == "frontend":
                assert port == DASHBOARD_PORT, f"frontend publishes {port}"
            else:
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


def test_frontend_image_runs_as_a_normal_user():
    dockerfile = (PROJECT_ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    stages = {stage.split(" AS ")[1].split()[0]: stage for stage in dockerfile.split("\nFROM ")[1:]}
    assert re.findall(r"^USER (\S+)", stages["build"], flags=re.MULTILINE)[-1] == "node"
    assert re.findall(r"^USER (\S+)", stages["runtime"], flags=re.MULTILINE)[-1] == "nginx"
    assert "USER root" not in dockerfile


# --- the dashboard (nginx) ------------------------------------------------------------

NGINX_DIR = PROJECT_ROOT / "frontend" / "nginx"
NGINX_CONF = (NGINX_DIR / "nginx.conf").read_text(encoding="utf-8")
SECURITY_HEADERS = (NGINX_DIR / "strata-security-headers.conf").read_text(encoding="utf-8")
API_PROXY = (NGINX_DIR / "strata-api-proxy.conf").read_text(encoding="utf-8")


def _directives(text: str, name: str) -> list[str]:
    """Every `name ...;` line (comments ignored), without the name and semicolon."""
    found = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line.startswith(name + " ") and line.endswith(";"):
            found.append(line[len(name) + 1 : -1].strip())
    return found


def test_dashboard_container_is_locked_down():
    frontend = COMPOSE["services"]["frontend"]
    assert frontend["read_only"] is True
    assert frontend["cap_drop"] == ["ALL"]
    assert "no-new-privileges:true" in frontend["security_opt"]
    assert frontend["user"] == "${STRATA_UID:-1000}:${STRATA_GID:-1000}"
    # The dashboard never sees the Alpaca keys or any other secret in .env.
    assert sorted(frontend["secrets"]) == ["dashboard_cert", "dashboard_key"]
    assert "environment" not in frontend


def test_dashboard_speaks_only_https_to_the_network():
    listens = _directives(NGINX_CONF, "listen")
    assert "8443 ssl" in listens
    # The one plain-HTTP listener is the health check, inside the container.
    assert [entry for entry in listens if "ssl" not in entry] == ["127.0.0.1:8081"]
    assert _directives(NGINX_CONF, "ssl_protocols") == ["TLSv1.2 TLSv1.3"]
    assert _directives(NGINX_CONF, "server_tokens") == ["off"]


def test_dashboard_sends_strict_security_headers():
    headers = {}
    for value in _directives(SECURITY_HEADERS, "add_header"):
        name, rest = value.split(" ", 1)
        headers[name] = rest
    csp = headers["Content-Security-Policy"]
    for rule in (
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
    ):
        assert rule in csp
    assert "unsafe" not in csp
    assert "http" not in csp  # nothing from other sites
    assert headers["X-Frame-Options"] == '"DENY" always'
    assert headers["X-Content-Type-Options"] == '"nosniff" always'
    assert headers["Referrer-Policy"] == '"no-referrer" always'
    # Blocks with their own add_header lose inherited ones, so they repeat them.
    for block in re.findall(r"location [^{]+\{[^}]*\}", NGINX_CONF):
        if "add_header" in block:
            assert "include /etc/nginx/strata-security-headers.conf;" in block


def test_dashboard_sets_the_callers_address_itself():
    headers = dict(value.split(" ", 1) for value in _directives(API_PROXY, "proxy_set_header"))
    # $remote_addr is the real connection; anything a caller sends is replaced.
    assert headers["X-Real-IP"] == "$remote_addr"
    assert headers["X-Forwarded-For"] == "$remote_addr"


def test_dashboard_keeps_the_api_docs_off_the_network():
    assert re.search(r"location ~ \^/api/\(docs\|redoc\|openapi\\\.json\)", NGINX_CONF)
    docs_block = NGINX_CONF.split("location ~ ^/api/(docs", 1)[1].split("}", 1)[0]
    assert "return 404;" in docs_block


def test_dashboard_rate_limits_logins():
    login_block = NGINX_CONF.split("location = /api/auth/login", 1)[1].split("}", 1)[0]
    assert "limit_req zone=strata_login" in login_block
