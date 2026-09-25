"""`python -m strata ...` runs the same command as `strata ...`."""

from .cli import main

raise SystemExit(main())
