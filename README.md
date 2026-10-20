# UEP — USO Enterprise Platform

UEP tracks the rollout of rural telecommunications sites under Iran's
**Universal Service Obligation** programme: which villages are due to be
connected, whether their sites are built and on the air, whether the network
actually works when checked, and whether the regulator has formally accepted it.

The acceptance dates it records carry contractual consequences, so the data is
the point. Everything else in this repository exists to keep it correct.

---

## What it does

A monthly **CPM** workbook — around fifteen thousand rows of villages and their
sites — is imported by an administrator. From that, UEP tracks each site through:

1. **Health check** — a subcontractor confirms each requested technology (2G, 3G,
   4G) is working. A coordinator or project manager then validates that result.
2. **Remediation** — a site that fails is assigned to one of four problem
   categories, each owned by a team who must fix it within an agreed number of
   days. Once every fix is closed, the site returns for re-checking.
3. **Drive test** — field measurement, assigned to a contractor and reviewed.
4. **Acceptance** — ICT and CRA approval, recorded per village and per
   technology. A contractor or coordinator submits the authority's letter with
   a verdict for each requested technology and the scan to back it; a
   coordinator or PM validates it into the record, or returns it with a reason
   for another round. Every round is kept. The filing and validating happens in
   **My Work**; where every village stands is read in
   **Reports → Acceptance Dashboard**.

Who can see and do what is tightly controlled: contractors see only their own
work, most staff see only their assigned provinces, and the roles that fix
problems see only the sites routed to them.

`ARCHITECTURE.md` explains the domain in full. Read it before changing anything —
several rules that look arbitrary are deliberate.

---

## The stack

| Part | Technology |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, psycopg 3 |
| Database | PostgreSQL 16 |
| Frontend | React 18, Vite 6 |
| Serving | nginx, reverse-proxying `/api/` to the backend |
| Deployment | Docker Compose on a Linux server |

```
Browser
   │
   ▼
nginx  ── /api/ ──►  FastAPI  ──►  PostgreSQL
  (also serves the built React app)
```

Everything runs in containers defined by `docker-compose.yml`. The database and
the uploaded files live in named Docker volumes and survive rebuilds.

---

## Running it locally

**You need:** Docker, and Docker Compose.

```bash
git clone https://github.com/vvalizadeh9-gif/USO-Platform.git
cd USO-Platform
```

**On a server**, generate a `.env` with real secrets:

```bash
./scripts/setup-env.sh
```

It generates the signing key and passwords, asks for the site address, and
prints the admin login once — write it down.

**For local development**, `cp backend/.env.example .env` and set just these:

```
APP_ENV=development
POSTGRES_PASSWORD=local-dev-password
DATABASE_URL=postgresql+psycopg://uep:local-dev-password@db:5432/uep
```

`APP_ENV=development` matters: without it the backend refuses to start on the
example secrets, which is deliberate — see [Configuration](#configuration).

```bash
docker compose up -d --build
```

Open <http://localhost>. Sign in with the username and password from
`FIRST_ADMIN_USERNAME` and `FIRST_ADMIN_PASSWORD`.

To see what happened:

```bash
docker compose ps            # is everything healthy?
docker compose logs -f backend
```

### Running the backend without Docker

Useful when working on the Python.

```bash
cd backend
python3.12 -m venv .venv
# The lock file, with hashes -- the same set the Docker image installs.
.venv/bin/pip install --require-hashes -r requirements.lock

# Point at a database you have running, then:
export APP_ENV=development
export DATABASE_URL="postgresql+psycopg://uep:password@localhost:5432/uep"

.venv/bin/alembic upgrade head          # apply migrations
.venv/bin/uvicorn app.main:app --reload
```

Interactive API documentation is then at <http://localhost:8000/docs>.

### Running the frontend without Docker

```bash
cd frontend
npm ci          # not `npm install` — see below
npm run dev
```

Vite serves on <http://localhost:5173> and proxies `/api/` to port 8000.

> Use `npm ci`, not `npm install`. `ci` installs exactly what
> `package-lock.json` specifies; `install` may quietly resolve newer versions,
> so your local build stops matching the server's.

---

## Running the tests

```bash
cd backend
.venv/bin/pytest
```

That gives **167 passed, 10 skipped**. The ten skips are migration tests that
need a real PostgreSQL. To run those too:

```bash
# A scratch database — its contents are destroyed by the tests.
docker run -d --name uep-test-db \
  -e POSTGRES_USER=uep -e POSTGRES_PASSWORD=test -e POSTGRES_DB=uep_test \
  -p 5433:5432 postgres:16-alpine

UEP_TEST_POSTGRES_URL="postgresql+psycopg://uep:test@localhost:5433/uep_test" \
  .venv/bin/pytest
```

That gives **177 passed**, which is what GitHub Actions runs on every push and
pull request.

Everything except the migration tests runs against a throwaway SQLite file, so
no database is needed for ordinary work.

### The CPM test fixture

The tests import a small synthetic CPM workbook at
`backend/tests/fixtures/sample_cpm.xlsx`. It contains no real data — invented
village names, `TST` site codes — but is structurally identical to a real file.
`generate_sample_cpm.py` beside it rebuilds and extends it.

To run against a genuine workbook instead:

```bash
UEP_TEST_CPM_XLSX=/path/to/real/CPM.xlsx .venv/bin/pytest
```

---

## Configuration

Everything is read from `.env` in the repository root. Start from
`backend/.env.example`, which documents every setting.

**The backend refuses to start if it is not configured safely.** It stops, and
tells you exactly what is wrong, when:

- `JWT_SECRET_KEY` is still the example value, or is shorter than 32 characters
- `FIRST_ADMIN_PASSWORD` is still the example value
- `CORS_ORIGINS` is `*`, or empty

This is deliberate. If `.env` goes missing or fails to mount, every setting falls
back to a default published in this repository — including the key that signs
login tokens. Anyone who noticed could sign themselves an administrator token.
Failing loudly turns a silent compromise into an obvious deployment error.

Set `APP_ENV=development` to allow the example values on a local machine.

Generate a real signing key with:

```bash
openssl rand -hex 32
```

### Sign-in

| Setting | Default | What it does |
|---|---|---|
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `30` | The idle timeout. Every request the person makes slides it forward (the page's own background refresh does not), so a session ends 30 minutes after they stop working. They are then sent to sign in with "Your session expired. Sign in again." and returned to the page they were on. |
| `SESSION_ABSOLUTE_TIMEOUT_MINUTES` | `480` (8 hours) | The absolute timeout: a sign-in ends this long after it began, however busy. |
| `LOGIN_MAX_ATTEMPTS_PER_USERNAME` | `5` | Failed attempts for one username, inside the window, that lock it. |
| `LOGIN_ATTEMPT_WINDOW_SECONDS` | `900` (15 min) | The window those failures are counted in. |
| `LOGIN_LOCKOUT_SECONDS` | `900` (15 min) | How long the lock lasts. The page says "Too many attempts. Try again in N minutes." |
| `LOGIN_MAX_ATTEMPTS_PER_IP` | `20` | The same limit per source address, against one password tried across many usernames. |
| `LOGIN_CAPTCHA_AFTER_FAILURES` | `2` | Failures after which the security check is asked for. |
| `SESSION_COOKIE_SECURE` | unset (follow the request) | Mark the session cookies Secure. Set `true` once TLS is in place. |

Only failures count, and a successful sign-in clears them. Every success and
failure, including a refusal during a lockout, is written to the audit log
(Admin → Audit log, module "Auth"); the password never is.

The session is an **HttpOnly, SameSite=Strict cookie** (`uep_session`, path
`/api`) that page scripts cannot read. Writes are protected against CSRF twice:
a request whose `Origin` names another site is refused, and a write made with
the cookie must echo the readable `uep_csrf` cookie in an `X-CSRF-Token`
header. API clients may still send `Authorization: Bearer <token>`; those need
no CSRF header. See `backend/app/core/session_cookies.py` and `csrf.py`.

---

## Deploying

```bash
git pull
docker compose up -d --build
docker compose logs backend | head -40
```

Database migrations run automatically before the application starts. If a
migration fails the backend stops rather than serving against a half-changed
database, so the site goes down instead of going wrong.

**Take a backup first, every time.** `RUNBOOK.md` has the full procedure.

### The Action Center digest

Once a day a scheduled command snapshots every user's Action Center and, on
digest days, emails each user a short version of their board. It runs **outside
the API** (one API worker each would mean duplicate emails), and running it
twice in a day is harmless: the snapshot is replaced and each user gets at most
one email per day (see ARCHITECTURE.md, § 5e).

1. **Mail settings** in `.env` (all in `backend/.env.example`):

   | Setting | Meaning |
   |---|---|
   | `SMTP_HOST`, `SMTP_PORT` | The internal relay. Empty host means no email is sent; snapshots still are. |
   | `SMTP_SECURITY` | `starttls` (default), `ssl` or `none` |
   | `SMTP_USERNAME`, `SMTP_PASSWORD` | Only if the relay wants a login |
   | `MAIL_FROM` | The sender, e.g. `UEP Action Center <uep-noreply@example.ir>` |
   | `APP_BASE_URL` | Where UEP is opened; every link in the email starts here |
   | `DIGEST_WEEKDAYS` | Days the email goes out, Tehran calendar. Default `sat,sun,mon,tue,wed` |

2. **Schedule it daily at 07:30 Tehran time.** The command itself decides
   whether today is a digest day, so run it every day (the snapshot is daily).
   On the host, `crontab -e` (cronie honours `CRON_TZ`):

   ```
   CRON_TZ=Asia/Tehran
   30 7 * * * cd /path/to/USO-Platform && docker compose exec -T backend python -m app.jobs.daily_digest >> backups/digest.log 2>&1
   ```

   Without `CRON_TZ`, a host clock on UTC needs `0 4 * * *` (Tehran is UTC+3:30
   all year). On Kubernetes, a `CronJob` with `timeZone: Asia/Tehran`,
   `schedule: "30 7 * * *"`, `concurrencyPolicy: Forbid`, running the same
   command in the backend image.

3. **Check a run** -- it prints one line, e.g.
   `{"day": "2026-10-03", "snapshots": 41, "sent": 37, "skipped_empty": 4}`.
   Failures are in the `digest_log` table with their error; the next run
   retries them. `--no-email` writes the snapshot only, `--date YYYY-MM-DD`
   runs for another day, `--force-email` sends on a non-digest day.

Users who have no email address are skipped (and logged); each user can turn
the email off from their account menu ("Daily email digest").

### Changing an SLA

Every SLA in UEP is set on **Admin → SLA policies** (`/admin/sla`), by a PM
or an Admin: change the days, press Update. It applies on the next read
everywhere (Home, rail counts, Health check / Drive test pages, remediation due
dates, the digest); no deploy or restart. History lists every change and Revert
undoes one. The API is `PUT /api/v1/admin/sla-policies` with
`{"changes": [{"step_key": "dt_review", "days": 2, "expected_days": 1}]}`.
The monthly plan keeps its day-3 deadline.

### Changing a region's coordinator

Coordinators are assigned per **CRA region** on **Admin → Province
assignments** (`/admin/provinces`; PM reaches it from Data), by a PM or an
Admin: click the coordinator's circle on the region's row, then Update. All
the region's provinces follow, and the new coordinator sees the region's work
on Home, Acceptance Validation, Lifecycle Gaps and Roles Performance at once,
past months included; no restart. History lists every change and Revert
undoes one. Viewers see the page read-only. A new coordinator account must
first be linked to its coordinator name on the KPI mapping page. The API is
`PUT /api/v1/admin/province-assignments` with
`{"changes": [{"cra_region": "Central", "coordinator_user_id": 13, "expected_coordinator_user_id": 11}]}`.
Regional managers and the province → region link are not edited there.

---

## Where to look

| Document | What it covers |
|---|---|
| **`ARCHITECTURE.md`** | The domain: sites, villages, work items, the health-check lifecycle, the CPM import rules, acceptance, and the full role and permission matrix. Read this first. |
| **`RUNBOOK.md`** | Deploying, rolling back, restoring, rotating the signing key, resetting a password, and what to do when the backend will not start. |
| **`MIGRATION-RUNBOOK.md`** | Database migrations: what they do, what the error messages mean, how to roll back. |
| **`BACKUP-RUNBOOK.md`** | Backups, and the restore drill that proves they work. |
| **`TLS-SETUP.md`** | Turning on HTTPS, for a public domain or an internal certificate. |
| **`FINDINGS.md`** | Known issues deliberately left alone, and why. Read before assuming something is an oversight. |

---

## Repository layout

```
backend/
  app/
    api/         HTTP endpoints, one module per area
    core/        config, database, security, permissions, logging
    models/      SQLAlchemy tables
    schemas/     request and response shapes
    services/    the business logic — CPM import, health check, acceptance
  alembic/       database migrations
  tests/
frontend/
  src/
    pages/       one per screen
    components/  shared UI
    context/     authentication, notifications
scripts/         backup.sh, restore.sh
.github/         CI workflow
```

The business rules live in `backend/app/services/`. `api/` is a thin layer over
them, and the frontend has no rules of its own — it only shows what the backend
allows.

---

## Two things worth knowing before you change anything

**The database schema is owned by Alembic alone.** The application no longer
creates or alters tables at startup. Change a model, then generate a migration:

```bash
cd backend
.venv/bin/alembic revision --autogenerate -m "what changed"
```

Read the generated file before committing it — autogenerate is a good first
draft, not a finished migration.

**Nothing deletes user records.** Users are referenced by audit entries and by
health-check reviews, so removing one would make the history anonymous.
Deactivation replaces deletion throughout. The same instinct applies broadly
here: this is a system of record, and the record has to stay readable for a
decade.
