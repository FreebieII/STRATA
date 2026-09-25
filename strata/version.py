"""Which version of the code is running.

Experiments, audit records and the API all report this, so any result can be
traced back to the exact code that produced it.
"""

from __future__ import annotations

import subprocess
from functools import cache

from . import PROJECT_ROOT, __version__


def code_version(git_commit_setting: str | None = None) -> dict[str, str | None]:
    """{"version": ..., "git_commit": ...}. Docker images carry the commit in
    STRATA_GIT_COMMIT; a git checkout is asked directly."""
    return {"version": __version__, "git_commit": git_commit_setting or _git_commit()}


@cache
def _git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],  # noqa: S607 - git from PATH is intended
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    commit = result.stdout.strip()
    return commit if result.returncode == 0 and commit else None
