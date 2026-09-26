"""The dashboard's copy of the shipped settings must match config.yaml."""

from __future__ import annotations

import importlib.util
import json

from tests.helpers import PROJECT_ROOT

SCRIPT = PROJECT_ROOT / "scripts" / "dashboard_defaults.py"


def _script():
    spec = importlib.util.spec_from_file_location("dashboard_defaults", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_learn_pages_quote_the_shipped_config():
    script = _script()
    copy = json.loads(script.TARGET.read_text(encoding="utf-8"))
    assert copy == script.shipped(), (
        "frontend/src/learn/shipped.json no longer matches config.yaml. "
        "Run: python scripts/dashboard_defaults.py"
    )


def test_the_copy_never_says_live_trading_is_switched_on():
    copy = json.loads(_script().TARGET.read_text(encoding="utf-8"))
    assert copy["live_trading_switch"] is False
    assert copy["default_mode"] == "paper"
