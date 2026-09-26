# Deployment

STRATA runs on one machine with Docker Compose. This page covers starting,
checking, stopping, the dashboard (including opening it from other devices),
settings, data, backups and upgrades. For a first-time setup on a fresh
Debian machine, follow the README first.

## What runs

| Service | Does | Reachable at |
|---|---|---|
| `postgres` | PostgreSQL 16: the permanent record | `127.0.0.1:5432` |
| `redis` | Redis 7: sessions, caches, queues, locks. Saves nothing to disk | `127.0.0.1:6379` |
| `migrate` | Runs once at start-up: brings the database schema up to date, then exits | — |
| `api` | The STRATA API | `http://127.0.0.1:8000` |
| `frontend` | The dashboard: HTTPS, login, and `/api/` passed on to the API | `https://localhost:8443`, or your home-network address if you choose |
| `tests`, `frontend-tests` | Only with `--profile test`: the Python and dashboard test suites | — |

Every port listens on `127.0.0.1`, so nothing is reachable from other
machines. The one exception you can choose is the dashboard (see
[Opening the dashboard from other devices](#opening-the-dashboard-from-other-devices)).
Agent workers and the scheduler are added in later phases.

## Before you start

1. Docker Engine with the Compose plugin (`docker compose version` should work).
2. A `.env` file next to `docker-compose.yml` (copy `.env.example`) with at least
   `POSTGRES_PASSWORD` set, and `ADMIN_API_TOKEN` if scripts will use the API.
   Generate both with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.
3. The dashboard's certificate: run `scripts/make-dashboard-cert.sh` once, as
   your normal user (not with `sudo`). It needs `openssl`.
4. If your user ID isn't 1000 (check with `id -u`), put your IDs in `.env`, so
   the containers run as you and can read `.env` and the certificate key:

   ```
   STRATA_UID=1001
   STRATA_GID=1001
   ```

   (use the numbers `id -u` and `id -g` print), then `docker compose build`.

## Start, check, stop

```bash
docker compose up --build -d                  # build and start everything
docker compose ps                             # all "healthy" (migrate "exited")
curl http://127.0.0.1:8000/health/ready       # {"status":"ok",...}
docker compose logs -f api                    # follow the API's log (JSON lines)
docker compose down                           # stop; data is kept
```

Interactive API documentation is at `http://127.0.0.1:8000/docs` (on this
machine only; the dashboard doesn't pass it on to the network).

Run the `strata` command inside the running stack with, for example,
`docker compose exec api strata status`.

## The dashboard

### Accounts

Accounts can only be made on this machine; the dashboard has no sign-up page.

```bash
docker compose exec api strata operator create alex     # asks for a password twice
docker compose exec api strata operator list
docker compose exec api strata operator reset-password alex
docker compose exec api strata operator disable alex    # also logs out all of alex's sessions
docker compose exec api strata operator enable alex
```

Passwords need at least 12 characters, and must not contain the username.
Every change is written to the audit log.

Then open <https://localhost:8443> and log in. Sessions last 8 hours. After 5
wrong passwords in 15 minutes for one name, or from one address, logins pause
for 15 minutes, and nginx allows at most 10 login attempts a minute from any
one address.

### Opening the dashboard from other devices

On your phone or laptop, on the same home network:

1. **Give this machine a fixed address.** In your router's settings, reserve
   its current address (often called a DHCP reservation). `hostname -I` shows
   it, for example `192.168.1.50`.
2. **Tell compose to listen there.** In `.env`, set
   `STRATA_DASHBOARD_BIND=192.168.1.50` (your address).
3. **Make the certificate cover that address.** Run
   `scripts/make-dashboard-cert.sh` again. It finds this machine's
   home-network addresses by itself; add any others as arguments, for example
   `scripts/make-dashboard-cert.sh 192.168.1.50 strata.lan`. It keeps the same
   CA, so devices that already trust it need nothing new.
4. **Restart the dashboard:** `docker compose up -d --force-recreate frontend`.
5. **Install the CA on each device** (next section), once per device.
6. Open `https://192.168.1.50:8443`. Names work too if your network resolves
   them: `https://HOSTNAME.local:8443` needs `avahi-daemon` on this machine
   (`sudo apt install avahi-daemon`).

Never forward port 8443 in your router. The dashboard is for your home
network; for access from outside, use a VPN into your home network.

Docker's published ports bypass `ufw` and similar firewalls, so a firewall rule
won't hide the dashboard. Binding it to the home-network address, as above, is
what keeps it off every other network this machine is on.

### Installing the CA on a device

Copy `certs/strata-local-ca.crt` to the device (email it to yourself, or use a
USB stick). Copy **only** that file, never a `.key` file. Before trusting it,
check that its SHA-256 fingerprint matches the one
`scripts/make-dashboard-cert.sh` printed.

| Device | How |
|---|---|
| Debian / Ubuntu (system) | `sudo cp strata-local-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates` |
| Chrome or Chromium on Linux | Settings → Privacy and security → Security → Manage certificates → Authorities → Import. Tick "Trust this certificate for identifying websites". |
| Firefox (any system) | Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import. Tick "Trust this CA to identify websites". |
| Windows | Double-click the file → Install Certificate → Current User → "Place all certificates in the following store" → Trusted Root Certification Authorities. |
| macOS | Double-click the file to add it to Keychain Access, double-click it there → Trust → "When using this certificate: Always Trust". |
| iPhone, iPad | Open the file (AirDrop or Mail) → Settings → Profile Downloaded → Install. Then Settings → General → About → Certificate Trust Settings: turn on "STRATA local CA". |
| Android | Settings → Security → More security settings → Encryption and credentials → Install a certificate → CA certificate. Names vary by phone maker. |

The CA can only vouch for home-network names (localhost, this machine's name,
and names ending in `.local`, `.lan`, `.home.arpa` or `.internal`) and private
addresses. A device that trusts it can't be fooled about any other website,
even by someone who stole the CA's key.

### Renewing the certificate

The dashboard certificate lasts 397 days (the CA 5 years). Before it runs out,
run `scripts/make-dashboard-cert.sh` again and then
`docker compose up -d --force-recreate frontend`. To start over with a new CA
(for example after renaming this machine), run it with `--new-ca` and install
the new CA on every device again.

## Settings (`STRATA_` variables)

Non-secret infrastructure settings. The defaults suit running directly on your
computer; `docker-compose.yml` sets the container values. A misspelled
`STRATA_` variable stops the program with an error.

| Variable | Default | What it sets |
|---|---|---|
| `STRATA_CONFIG_FILE` | `config.yaml` in the project folder | Trading, risk and strategy settings |
| `STRATA_SECRETS_FILE` | `.env` in the project folder | Secrets. Containers use `/run/secrets/strata_env` |
| `STRATA_COMPONENT` | `cli` | This process's name in logs and events (`api`, `migrate`, ...) |
| `STRATA_LOG_FORMAT` | `text` | `json` prints one JSON object per line (containers) |
| `STRATA_GIT_COMMIT` | from `git`, else unknown | Code version; baked into images at build time |
| `STRATA_DB_HOST` | `127.0.0.1` | PostgreSQL host (`postgres` in containers) |
| `STRATA_DB_PORT` | `5432` | PostgreSQL port |
| `STRATA_DB_NAME` | `strata` | Database name |
| `STRATA_DB_USER` | `strata` | Database user (password: `POSTGRES_PASSWORD` in `.env`) |
| `STRATA_DB_CONNECT_TIMEOUT_S` | `5` | Give up connecting after this many seconds |
| `STRATA_DB_STATEMENT_TIMEOUT_MS` | `15000` | PostgreSQL cancels any statement running longer |
| `STRATA_REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis address (`redis://redis:6379/0` in containers) |
| `STRATA_REDIS_TIMEOUT_S` | `5` | Time limit for each Redis call |
| `STRATA_API_HOST` | `127.0.0.1` | Address the API listens on (`0.0.0.0` inside its container only) |
| `STRATA_API_PORT` | `8000` | API port |

### Compose settings

Docker Compose reads these from `.env` (or your shell). STRATA itself ignores them.

| Variable | Default | What it sets |
|---|---|---|
| `STRATA_DASHBOARD_BIND` | `127.0.0.1` | The address the dashboard listens on |
| `STRATA_DASHBOARD_PORT` | `8443` | The dashboard's port on that address |
| `STRATA_CERTS_DIR` | `./certs` | Where the dashboard's certificate and key are (also used by the certificate script) |
| `STRATA_UID`, `STRATA_GID` | `1000` | The user and group the containers run as (build time for the STRATA image) |
| `STRATA_SECRETS_PATH` | `./.env` | A secrets file other than `./.env` |
| `GIT_COMMIT` | `unknown` | Code version baked into the image, for example `GIT_COMMIT=$(git rev-parse HEAD) docker compose build` |

## Where data lives

| Where | Holds |
|---|---|
| Volume `pgdata` | The database |
| Volume `strata_logs` | `strata.log`, `decisions.log`, `events.jsonl` |
| Volumes `strata_state`, `strata_data`, `strata_reports` | The bot's memory, price data and reports (later phases) |
| Folder `certs/` | The dashboard certificate, its key, and the local CA (certificate and key) |

Read the logs with, for example, `docker compose exec api tail -n 50 logs/decisions.log`.
The dashboard's access log (address, time, path without the query string,
status) is `docker compose logs frontend`. `docker compose down` keeps all
volumes; `docker compose down -v` **deletes** them, database included.

## Backups

```bash
docker compose exec -T postgres pg_dump -U strata strata > strata-$(date +%F).sql
```

To restore into an empty database (after `docker compose down -v` and
`docker compose up -d postgres`):

```bash
docker compose exec -T postgres psql -U strata strata < strata-2026-09-25.sql
```

Keep backups somewhere other than this machine. They contain your trading
history and the operators' password hashes, but no API keys (those only live in
`.env`). You don't need to back up `certs/`: if it's lost, make a new CA with
the script and install it on your devices again.

## Updating

```bash
git pull
docker compose up --build -d      # rebuilds the images; migrate applies new migrations
docker compose ps
```

## Security notes

- `docker compose config` prints the resolved configuration, **including the
  database password**. Don't share its output.
- Being in the `docker` group is equivalent to having root on the machine.
  Only add users you'd trust with root.
- The API has no TLS of its own and stays on this machine: never publish port
  8000. Other devices reach it only through the dashboard, over HTTPS.
- `certs/strata-local-ca.key` can make certificates your devices will trust
  (for home-network names only). Keep it on this machine; `certs/` is
  git-ignored and never copied into images.
- Addresses of other devices are recorded as they are. Logins from this
  machine itself are recorded with Docker's network address (such as
  `172.18.0.1`), so they share one set of rate limits.

## Troubleshooting

| Message | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` | Add it to `.env` (see `.env.example`). |
| `Permission denied` reading `/run/secrets/strata_env` | Your user ID isn't 1000: set `STRATA_UID`/`STRATA_GID` (above) and rebuild. |
| `secret ... dashboard.crt ... no such file` | Run `scripts/make-dashboard-cert.sh`. |
| `frontend` keeps restarting, `Permission denied` on `dashboard_key` in its log | The key belongs to another user (made with `sudo`?). Run the script again as yourself, or set `STRATA_UID`/`STRATA_GID`. |
| `cannot assign requested address` starting `frontend` | `STRATA_DASHBOARD_BIND` isn't one of this machine's addresses (did it change?). Check `hostname -I` and reserve the address in your router. |
| The browser warns the connection isn't private | That device doesn't trust the CA yet, or the address isn't in the certificate: run the script again with it, then recreate `frontend`. |
| Logging in works, but the next page asks again | Open the dashboard with `https://`. Browsers only keep the login over HTTPS. |
| `Too many failed logins. Try again in N minute(s).` | Wait. The pause ends by itself after 15 minutes. |
| `port is already allocated` | Something else uses 5432, 6379, 8000 or 8443 (often a local PostgreSQL). Stop it, or change the left-hand port in `docker-compose.yml` (or `STRATA_DASHBOARD_PORT`). |
| `api` stays unhealthy | `docker compose logs api` and `docker compose logs migrate`. |
| `password authentication failed` after changing `POSTGRES_PASSWORD` | PostgreSQL keeps the password it was created with. Put the old one back in `.env`, or set the new one inside the database: `docker compose exec postgres psql -U strata -d strata -c "ALTER USER strata PASSWORD 'the-new-password'"`. With no data worth keeping yet, `docker compose down -v` starts afresh. |
| `Unknown STRATA_ variable(s)` | A `STRATA_` variable is misspelled; the table above lists the valid ones. |
