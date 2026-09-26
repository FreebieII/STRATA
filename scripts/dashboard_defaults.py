#!/usr/bin/env python3
"""Copy config.yaml's trading settings into the dashboard.

    python scripts/dashboard_defaults.py

The Learn pages quote STRATA's settings (the risk limits, the strategies'
periods, the cost estimates). They read them from the running API, and use
this copy of config.yaml as shipped until the API answers. Run this after
changing config.yaml; tests/unit/test_dashboard_defaults.py fails until you do.
"""

from __future__ import annotations

import json

from strata import PROJECT_ROOT
from strata.api.routes import trading_summary
from strata.config import load_config

TARGET = PROJECT_ROOT / "frontend" / "src" / "learn" / "shipped.json"


def shipped() -> dict[str, object]:
    """What GET /system/status would say about config.yaml, live switch off."""
    return trading_summary(load_config(), live_trading_switch=False).model_dump(mode="json")


if __name__ == "__main__":
    TARGET.write_text(json.dumps(shipped(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {TARGET.relative_to(PROJECT_ROOT)}")
