# Security

STRATA handles API keys that can move real money. The design assumes mistakes
will happen and tries to make each one harmless: a key pasted into the wrong
place, an order a strategy shouldn't send, an AI agent that is wrong.

## Secrets

| Secret | Lives in | Read by |
|---|---|---|
| Alpaca paper keys | `.env` | backtest and paper mode, `check_setup.py` |
| Alpaca live keys | `.env` | only `modes.unlock_live_mode()`, after the live-mode lock passes |
| `POSTGRES_PASSWORD` | `.env` | the database container and everything that connects to it |
| `ADMIN_API_TOKEN` | `.env` | the API, to check requests from scripts |
| Operators' passwords | only as scrypt hashes, in the `operators` table | the API, at login |
| Dashboard certificate key and local CA key | `certs/` (readable only by you) | nginx (the certificate key only); the certificate script |

- `.env` is never committed (`.gitignore`), never copied into an image
  (`.dockerignore`), and is mounted into containers read-only at
  `/run/secrets/strata_env`. `check_setup.py` fails if git tracks it.
- STRATA reads the file directly, not environment variables, so a stray shell
  variable can't switch on live trading or swap keys.
- Malformed or repeated lines in `.env` are refused. Error messages give line
  numbers, never line contents.
- Every secret is registered for redaction as soon as `.env` is read. Log files
  (text and JSON), console output, error tracebacks and database records all
  replace it with `***`.
- HTTP client libraries may only log warnings, because their normal messages
  contain full URLs, query strings included.
- Tests enforce this: no key-shaped strings in the code, `.env.example` holds no
  values, the compose file holds no secret values, and tests can't reach the
  internet.

**If a key leaks:** revoke it in the Alpaca dashboard immediately and generate
a new one. Then look through `decisions.log`, `events.jsonl` and the
`audit_logs` table for activity you don't recognise. Rotate `ADMIN_API_TOKEN`
and `POSTGRES_PASSWORD` too if `.env` itself was exposed.

## Live trading

Live trading is off by default and needs four separate locks: the `--live`
flag, `LIVE_TRADING=true` in `.env`, live keys in `.env`, and a phrase typed
by a person at a terminal. See [TRADING_MODES.md](TRADING_MODES.md). The compose
file can't enable live mode; a test checks it.

## API

- Only `/health` and `/health/ready` are public, and readiness shows component
  names and yes/no only. Everything else needs a dashboard session, or a
  script's `Authorization: Bearer <ADMIN_API_TOKEN>`.
- The token must be at least 32 characters and is compared in constant time.
  With no token configured, only dashboard logins work.
- Rejected requests are logged and stored as `auth_failed` system events.
- When PostgreSQL or Redis fails, the API answers 503 with a one-line reason,
  never a stack trace.
- Requests are logged by method, path, status and duration only: never
  headers or query strings. A caller's `X-Request-ID` is kept only if it is
  plain and short, so it can't inject text into the logs.
- Responses carry `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`;
  the server doesn't announce itself.
- The API listens on `127.0.0.1` only and has no TLS. Other devices reach it
  only through the dashboard's nginx, over HTTPS.
- The chart endpoints take a time zone from the caller. It must match a strict
  pattern and be a name in the time-zone database; anything else is refused
  (422) before it reaches PostgreSQL, where it is passed as a bound parameter,
  never as SQL text. Periods are capped at 90 days, so no request can ask the
  database for an unbounded count.
- The health history lives in the API's memory (24 hours, one reading every 15
  seconds, a fixed size) and holds check names, results, times and each
  check's detail: one line of at most 300 characters with every known secret
  blanked out, as in the logs. Its background thread is stopped, and waited
  for, before the database and Redis connections close.

## Dashboard logins

- Accounts are made on the machine (`strata operator create`); there is no
  sign-up page. Every account change is written to the audit log.
- Passwords are stored as scrypt hashes (N=2^16, r=8, p=2), with at most two
  hashed at once so a flood of logins can't exhaust memory. They need at least
  12 characters, at least 4 different characters, and must not contain the
  username. Logging in as a missing or disabled account takes as long as a
  real check, so timing doesn't reveal which names exist.
- The session is a random 256-bit ID in a cookie that page scripts can't read
  (`HttpOnly`), that travels only over HTTPS (`Secure`) and that other sites
  can't make the browser send (`SameSite=Strict`). It lasts 8 hours. Redis
  stores only a SHA-256 hash of it, so a copy of Redis holds no usable
  sessions.
- Logging out ends the session on the server. Disabling an account or
  resetting its password ends all of its sessions, and a session that began
  before the password changed is refused.
- Every change made with a session cookie must carry the header
  `X-Strata-Dashboard: 1`. Other websites can't add it, which stops cross-site
  request forgery; the API allows no cross-origin requests at all.
- After 5 wrong passwords in 15 minutes for one name, or from one address,
  logins for it pause for 15 minutes (the API answers 429 with `Retry-After`).
  nginx separately allows at most 10 login attempts a minute per address.
  Failed logins are logged and stored as `login_failed` events with the name
  that was typed and the address; logins and logouts go to the audit log.

## The dashboard (nginx)

- HTTPS only, TLS 1.2 or newer with modern ciphers. Plain `http://` on the
  dashboard port is redirected to `https://`.
- A strict Content-Security-Policy: the page runs only scripts, styles and
  fonts served by the dashboard itself; no inline scripts, nothing from other
  sites, and Trusted Types, so script injection through the page's own code is
  refused by the browser. Fonts are bundled, so the dashboard never contacts
  another site.
- Other sites can't frame it (`frame-ancestors 'none'`, `X-Frame-Options:
  DENY`); it sends no referrer, and blocks camera, microphone, location,
  payment and USB access.
- Everything the API returns is shown as text. Tests feed HTML and script
  tags through events and details and check that nothing runs.
- nginx sets the caller's address (`X-Real-IP`) itself, replacing anything the
  caller sent, so nobody can pick the address that logins are counted by.
- The API's documentation pages are not passed on to the network, and login
  requests are rate limited. Request bodies are limited to 16 KB.
- The access log records address, time, method, path without the query
  string, status, size and duration: never cookies or other headers.
- The container runs as you, not root, with a read-only filesystem, no Linux
  capabilities and no way to gain privileges. It never receives `.env`: the
  dashboard can't see the Alpaca keys, the database password or the token.
- There is no HSTS header. HSTS applies to every port of a host name, so it
  would force HTTPS on anything else served from `localhost` or this machine's
  name, and browsers ignore it for addresses such as `192.168.1.50`. The
  `Secure` cookie already keeps sessions off plain HTTP.
- The dashboard only reads. It has no way to place, change or cancel orders,
  or to change any setting.
- The Learn section keeps the reader's progress (which chapters were opened,
  quiz scores) in the browser's localStorage, per browser and device. It holds
  no personal data and never reaches the API; anything malformed in it is
  ignored.
- The Learn section's links to official sites open in a new tab with
  `rel="noopener noreferrer"`, so those pages get no hold on the dashboard's tab
  and aren't told where the reader came from. The section's code is loaded
  from the dashboard itself when first opened, under the same
  Content-Security-Policy; the browser tests check for violations.

### The local certificate authority

`scripts/make-dashboard-cert.sh` makes a certificate authority (CA) that only
exists on this machine. Its certificate carries critical name constraints: it
can only vouch for `localhost`, this machine's name, names ending in `.local`,
`.lan`, `.home.arpa` or `.internal`, and private addresses (127.x, 10.x,
172.16–31.x, 192.168.x). Browsers reject anything else it signs, so a device
that trusts it can't be fooled about any other website, even by someone who
stole its key. `tests/unit/test_dashboard_cert.py` proves it: a certificate
for `bank.example.com` signed with the CA's own key fails verification.

Keys are EC P-256, made with `umask 077` and kept `chmod 600` in `certs/`,
which git and Docker both ignore. The dashboard certificate lasts 397 days and
the CA 5 years.

## Database

- `audit_logs` is append-only: a database trigger rejects `UPDATE`, `DELETE`
  and `TRUNCATE`, so recorded history can't be edited by application code.
- Every statement has a time limit, and connections time out.
- Addresses are only ever printed with the password hidden.

## Containers

- Images run as an ordinary user, not root.
- pip installs only packages whose hashes match the lock files; npm installs
  only what `package-lock.json` lists, each checked against its hash.
- Redis saves nothing to disk, so it can't become a hidden store of data.

## Known limitations

These are accepted for a single-operator machine and are scheduled for Phase 11.

- No two-factor login yet, and every operator has the same rights. Scripts
  share one API token.
- Anyone on the home network can pause logins for a username for 15 minutes by
  typing wrong passwords for it. That is the price of the lock-out; only your
  own network can reach the dashboard.
- Logins from the STRATA machine itself reach nginx through Docker with
  Docker's network address, so they share one set of rate limits.
- Redis has no password (it is reachable only from this machine and the compose
  network).
- The application's database user owns the schema. A separate user without
  permission to change tables would be stronger, and would also stop the
  audit trigger from being dropped.
- `docker compose config` prints the database password.
- The `/docs` API page is public on `127.0.0.1` (not through the dashboard). It
  describes the endpoints but holds no data.
