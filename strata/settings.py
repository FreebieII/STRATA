"""Infrastructure settings: where the database, Redis and the API live.

STRATA keeps three kinds of settings apart:

    config.yaml         trading, risk and strategy settings   (strata.config)
    STRATA_* variables  non-secret infrastructure settings     (this module)
    .env secrets file   keys, passwords and tokens             (strata.credentials)

The defaults suit running everything on your own computer (all on 127.0.0.1);
docker-compose.yml sets these variables for the containers. Nothing secret
belongs here: passwords and tokens only ever come from the secrets file.

Like config.yaml, this is strict: a misspelled STRATA_ variable is an error,
not silently ignored.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import Field, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from .config import DEFAULT_CONFIG_PATH
from .credentials import DEFAULT_ENV_PATH

ENV_PREFIX = "STRATA_"
# Variables with these prefixes belong to the test suites, not the application.
_NOT_SETTINGS = ("STRATA_TEST_", "STRATA_E2E_")
# docker-compose.yml and the certificate script read these; STRATA doesn't.
_TOOLING = frozenset(
    {
        "STRATA_UID",
        "STRATA_GID",
        "STRATA_SECRETS_PATH",
        "STRATA_CERTS_DIR",
        "STRATA_DASHBOARD_BIND",
        "STRATA_DASHBOARD_PORT",
    }
)


class SettingsError(Exception):
    """A STRATA_ environment variable is unknown or has an invalid value."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix=ENV_PREFIX, frozen=True, extra="forbid")

    # Where the other two kinds of settings live.
    config_file: Path = DEFAULT_CONFIG_PATH
    secrets_file: Path = DEFAULT_ENV_PATH

    # Which process this is (api, migrate, cli, ...). Shown in every log event.
    component: str = Field("cli", pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    # "json" writes one JSON object per line on the console (for containers).
    log_format: Literal["text", "json"] = "text"
    # The code version, baked into Docker images at build time.
    git_commit: str | None = Field(None, pattern=r"^[0-9a-f]{7,40}$|^unknown$")

    db_host: str = "127.0.0.1"
    db_port: int = Field(5432, ge=1, le=65535)
    db_name: str = Field("strata", min_length=1)
    db_user: str = Field("strata", min_length=1)
    db_connect_timeout_s: int = Field(5, ge=1, le=60)
    # Longest a single database statement may run before it is cancelled.
    db_statement_timeout_ms: int = Field(15_000, ge=100, le=600_000)

    redis_url: str = Field("redis://127.0.0.1:6379/0", pattern=r"^rediss?://")
    redis_timeout_s: float = Field(5.0, gt=0, le=60)

    api_host: str = "127.0.0.1"
    api_port: int = Field(8000, ge=1, le=65535)


def unknown_variables(environ: Mapping[str, str] | None = None) -> list[str]:
    """STRATA_ variables that don't match any setting (probably typos)."""
    environ = os.environ if environ is None else environ
    known = {ENV_PREFIX + name.upper() for name in Settings.model_fields}
    return sorted(
        name
        for name in environ
        if name.upper().startswith(ENV_PREFIX)
        and name.upper() not in known
        and name.upper() not in _TOOLING
        and not name.upper().startswith(_NOT_SETTINGS)
    )


def load_settings() -> Settings:
    """Read the STRATA_ variables, check them, and return them read-only."""
    unknown = unknown_variables()
    if unknown:
        raise SettingsError(
            "Unknown STRATA_ variable(s): "
            + ", ".join(unknown)
            + ". Check the spelling (see docs/DEPLOYMENT.md for the list)."
        )
    try:
        return Settings()
    except ValidationError as exc:
        problems = [
            f"  - {ENV_PREFIX}{str(error['loc'][0]).upper()}: {error['msg']}"
            for error in exc.errors()
        ]
        raise SettingsError("Invalid STRATA_ variable(s):\n" + "\n".join(problems)) from None
