# STRATA dashboard

The web dashboard: React 19 and TypeScript, built by Vite into static files
that nginx serves over HTTPS, with the STRATA API behind `/api/`.

It only reads. It shows the trading mode (always PAPER for now), health,
the trading setup, risk limits, system events and the audit log, and says
plainly which views arrive in later phases. It can't place orders or change
settings.

| Command | Does |
|---|---|
| `npm ci` | Install exactly what `package-lock.json` lists |
| `npm run dev` | Development server on http://127.0.0.1:5173 (needs `strata api` on port 8000) |
| `npm test` | Unit tests |
| `npm run typecheck` | Strict TypeScript checks |
| `npm run build` | Type-check and build into `dist/` |
| `npm run e2e` | Browser tests of the running stack (see `playwright.config.ts`) |

In Docker: `docker compose up --build -d` runs it at https://localhost:8443,
and `docker compose --profile test run --build --rm frontend-tests` runs the
unit tests. More in [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md#the-dashboard-frontend)
and [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#the-dashboard).
