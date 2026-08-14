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
   technology.

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

cp backend/.env.example .env
```

Now edit `.env`. For local work the quickest correct setup is:

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
.venv/bin/pip install -r requirements.txt

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

That gives **147 passed, 10 skipped**. The ten skips are migration tests that
need a real PostgreSQL. To run those too:

```bash
# A scratch database — its contents are destroyed by the tests.
docker run -d --name uep-test-db \
  -e POSTGRES_USER=uep -e POSTGRES_PASSWORD=test -e POSTGRES_DB=uep_test \
  -p 5433:5432 postgres:16-alpine

UEP_TEST_POSTGRES_URL="postgresql+psycopg://uep:test@localhost:5433/uep_test" \
  .venv/bin/pytest
```

That gives **157 passed**, which is what GitHub Actions runs on every push and
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
