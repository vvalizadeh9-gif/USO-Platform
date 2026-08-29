# UEP Runbook

Operational procedures for the UEP server: deploying, rolling back, restoring,
rotating secrets, and getting out of trouble.

Written so that someone who is not a developer can follow it. Every command is
given in full. Run all of them from the directory holding `docker-compose.yml`,
unless a step says otherwise.

**In an emergency, jump to [When the backend will not start](#when-the-backend-will-not-start).**

---

## Quick reference

| I want to… | Go to |
|---|---|
| Set the server up for the first time | [First-time setup](#first-time-setup) |
| Deploy a new version | [Deploying](#deploying) |
| Undo a deploy | [Rolling back](#rolling-back) |
| Put back yesterday's data | [Restoring a backup](#restoring-a-backup) |
| Sign everyone out / replace the signing key | [Rotating the JWT secret](#rotating-the-jwt-secret) |
| Reset a forgotten admin password | [Resetting the admin password](#resetting-the-admin-password) |
| See what the server is doing | [Where the logs are](#where-the-logs-are) |
| The site is down | [When the backend will not start](#when-the-backend-will-not-start) |

### Checking the state of things

```bash
docker compose ps
```

Every service should say `running`, and `db` and `backend` should say `healthy`.

There is also an **Admin → System Health** screen in the application, which
shows whether the database is reachable, whether migrations are up to date, when
CPM was last imported, and how many change requests are waiting. Check there
first — it needs no terminal.

---

## First-time setup

Only once, before the very first deploy. Skip to [Deploying](#deploying) if
`.env` already exists.

```bash
cd /path/to/USO-Platform
./scripts/setup-env.sh
```

It generates the JWT signing key, the database password and a first admin
password, asks you for the address people will type into their browser, and
writes `.env`. It then prints the admin username and password once — **write
them down before closing the terminal.**

It refuses to overwrite an existing `.env`, because changing the database
password out from under a database that is already using it locks the
application out of its own data.

> `.env` is deliberately excluded from git, so it is **not** backed up with your
> code. It is the only copy of the database password. Keep a copy wherever your
> organisation stores passwords — if it is lost, the data cannot be opened.

---

## Deploying

### 1. Back up first. Every time.

```bash
./scripts/backup.sh
```

Wait for `Backup complete.` If it reports an error, **stop** and fix that before
deploying. Deploying without a good backup is the one step you cannot undo.

### 2. Get the new code

```bash
git pull
```

### 3. Build and start

```bash
docker compose up -d --build
```

This rebuilds the images, applies any database migrations, and restarts the
services. Expect one to three minutes.

### 4. Check what happened

```bash
docker compose logs backend | head -40
```

You want to see:

```
[entrypoint] Applying database migrations...
[entrypoint] Migrations applied.
[entrypoint] Starting API server...
```

Then:

```bash
docker compose ps
```

Everything `running`, `db` and `backend` `healthy`.

### 5. Check the application itself

Open it in a browser, sign in, and look at one real screen — My Work or Work
Items. A backend that starts is not the same as an application that works.

> **Migrations run automatically, before the application starts serving.** If a
> migration fails the backend stops rather than serving against a half-changed
> database. The site goes down instead of going wrong, which is the intended
> behaviour. See `MIGRATION-RUNBOOK.md`.

---

## Rolling back

### If the deploy failed and the site is down

Nothing has been committed to the database if the migration failed. Go back to
the previous version:

```bash
git log --oneline -10          # find the commit before the bad one
git checkout <that commit>
docker compose up -d --build
```

### If the deploy worked but the application is wrong

If the new version applied a database migration, going back to the old code is
not enough on its own — the old code may not understand the new schema. In that
case restore the backup you took in step 1, then go back to the old code. See
[Restoring a backup](#restoring-a-backup).

If no migration ran (the log said nothing about applying migrations), the code
rollback above is sufficient.

### Getting back to the latest version afterwards

```bash
git checkout main
git pull
docker compose up -d --build
```

---

## Restoring a backup

**This replaces the current database.** Everything entered since that backup is
lost. Make sure someone has decided that is acceptable, and tell users the
system is going down.

```bash
./scripts/restore.sh backups/daily/uep-2026-08-14_0230.dump
```

The script shows what it is about to do, makes you type `replace`, takes a safety
copy of the current database first, stops the application, restores, and starts
everything again.

To see what backups exist:

```bash
./scripts/restore.sh
```

Full detail — including how to practise a restore safely without touching the
live system — is in `BACKUP-RUNBOOK.md`. **Practise it every six months.**

---

## Rotating the JWT secret

The JWT secret signs login sessions. Rotate it if it may have been exposed — for
example if `.env` was copied somewhere it should not have been, or someone who
had server access has left.

**Everyone is signed out immediately.** No data is affected; people simply log in
again.

### 1. Generate a new key

```bash
openssl rand -hex 32
```

That prints a 64-character string. Copy it.

### 2. Put it in `.env`

```bash
nano .env
```

Replace the value after `JWT_SECRET_KEY=`. Save with `Ctrl+O`, `Enter`, then exit
with `Ctrl+X`.

### 3. Restart the backend

```bash
docker compose up -d backend
docker compose logs backend | tail -20
```

### 4. Confirm

Reload the application in your browser. You should be sent back to the login
page. Sign in again.

> The key must be at least 32 characters. The backend refuses to start on a
> shorter one, or on the example value from `.env.example`.
>
> The login captcha is signed with a separate key, derived automatically from
> this one, so rotating this rotates that too. Nothing extra to do.

---

## Resetting the admin password

### If you can still sign in as another administrator

Use the application: **Admin → Users → the key button on their row → Reset
password**. It generates a temporary password, shows it once, and signs that
account out everywhere. Hand it over; they will be asked to choose their own
before they can use anything else.

That is the whole procedure, and it leaves an audit entry naming you.

> The temporary password is shown once and cannot be looked up afterwards —
> what is stored is a hash. If it is lost before you pass it on, reset again.

### If nobody can sign in as an administrator

Set the password directly in the database. It has to be stored as an Argon2id
hash, so it is generated first.

**1. Generate the hash:**

```bash
docker compose exec backend python -c "
from app.core.security import hash_password
print(hash_password('YOUR-NEW-PASSWORD-HERE'))
"
```

Replace `YOUR-NEW-PASSWORD-HERE` with the real password. It prints a string
starting `$argon2id$…`. Copy the whole thing, including the dollar signs.

> Older installations hold `$2b$12$…` (bcrypt) hashes. Those still work and are
> rewritten as Argon2id the next time their owner signs in, so a mixture is
> expected and is not a fault.

**2. Apply it:**

```bash
docker compose exec db psql -U uep -d uep -c \
  "UPDATE users SET password_hash = 'PASTE-THE-HASH-HERE', must_change_password = false
   WHERE username = 'admin';"
```

You want `UPDATE 1`. If it says `UPDATE 0`, the username is different — list them:

```bash
docker compose exec db psql -U uep -d uep -c \
  "SELECT id, username, first_name, family_name, status FROM users ORDER BY id;"
```

**3. If the account is not `Active`**, switch it back on. `status` is
`Active`, `Inactive` or `Suspended`; only `Active` can sign in:

```bash
docker compose exec db psql -U uep -d uep -c \
  "UPDATE users SET status = 'Active', status_changed_at = NULL, status_changed_by = NULL
   WHERE username = 'admin';"
```

**4. Sessions.** The two statements above do not end sessions anybody else is
holding — the application does that by bumping `token_version`, and a hand-run
`UPDATE` does not. If you are doing this because an account was compromised,
add `token_version = token_version + 1` to step 2.

Then sign in.

> `FIRST_ADMIN_PASSWORD` in `.env` does **not** do this. That setting only
> applies when the admin user is first created; changing it later has no effect
> on an account that already exists.

---

## Reclaiming disk space

Two things build up on the uploads volume and nothing removes them on its own:
the CPM workbook from every import, and evidence files no submission points at
any more (evidence is shared between submissions, so deleting a row correctly
does not delete the file — but nothing ever counted the references either).

Neither grows fast. Both grow without limit, on a volume that is **not** part
of the database backup, and the first symptom of a full disk is PostgreSQL
failing to write.

Always look before you cut. `--dry-run` prints what would go and removes
nothing:

```bash
docker compose exec backend python -m app.scripts.reclaim_uploads --dry-run
```

If the list looks right:

```bash
docker compose exec backend python -m app.scripts.reclaim_uploads
```

Workbooks are kept for 180 days by default. To keep them longer, pass
`--keep-days 365`. The workbook is only a convenience copy — the import is
recorded in the database and so is everything it loaded — so the question is
how far back you want to be able to answer "what exactly was in the file we
loaded that month".

Worth running monthly. On the host, `crontab -e`:

```
0 3 1 * * cd /path/to/USO-Platform && docker compose exec -T backend python -m app.scripts.reclaim_uploads
```

Check free space at any time with:

```bash
docker system df -v | grep uep_uploads
```

---

## Where the logs are

Everything goes to Docker's log stream. Nothing is written to files inside the
containers.

```bash
docker compose logs -f backend      # follow the backend, live
docker compose logs --tail 200 backend
docker compose logs db
docker compose logs frontend
```

### What a log line looks like

Each request produces one line:

```json
{"timestamp":"2026-08-14T09:12:44+00:00","level":"INFO","logger":"uep.request",
 "message":"POST /api/v1/admin/cpm/import -> 200","request_id":"0bd67104b6c3",
 "method":"POST","path":"/api/v1/admin/cpm/import","user_id":3,
 "status_code":200,"duration_ms":8421.3}
```

The useful fields are `path` (what was called), `user_id` (who called it),
`status_code`, and `duration_ms`. Anything with `"level":"ERROR"` is a genuine
failure and includes a stack trace.

**Passwords, tokens, request bodies and query strings are deliberately never
logged.** So a log line will not tell you which province someone was filtering
by — that is the intended trade.

### Finding a specific problem

```bash
# Only errors
docker compose logs backend | grep '"level":"ERROR"'

# Everything one user did
docker compose logs backend | grep '"user_id":3'

# Slow requests
docker compose logs backend | grep -E '"duration_ms":[0-9]{5,}'
```

Every response also carries an `X-Request-ID` header. If a user reports an error
and can give you that id, `grep` it to find the exact request and its stack
trace.

### Making the logs quieter or louder

In `.env`:

```
LOG_LEVEL=INFO      # DEBUG, INFO, WARNING or ERROR
LOG_FORMAT=json     # or "text", which is easier to read by eye
```

Then `docker compose up -d backend`. `WARNING` stops the per-request lines and
keeps the failures.

---

## When the backend will not start

Work through these in order.

### 1. Look at the log

```bash
docker compose logs --tail 50 backend
```

The reason is almost always in the last twenty lines.

### 2. "The application will not start with this configuration"

The backend is refusing because of unsafe settings. The message lists every
problem. Typically:

- `JWT_SECRET_KEY is still the default value` — see
  [Rotating the JWT secret](#rotating-the-jwt-secret) for how to generate one.
- `FIRST_ADMIN_PASSWORD is still the default value` — set a real one in `.env`.
- `CORS_ORIGINS is "*"` — set it to the address the application is served from,
  e.g. `CORS_ORIGINS=http://uep.example.com`.

**If `.env` looks correct and you still see this**, the file is not reaching the
container. Check:

```bash
ls -la .env                                   # is it there, beside docker-compose.yml?
docker compose exec backend printenv | grep JWT_SECRET_KEY
```

If the second command prints nothing or prints `CHANGE_ME_IN_PRODUCTION`, the
file is not being loaded. That is exactly the failure this check exists to
catch: without it the application would have started happily on a signing key
published in this repository.

### 3. The database is not ready

```
could not connect to server
```

```bash
docker compose ps db
docker compose logs db | tail -30
```

If `db` is not healthy, start it and wait:

```bash
docker compose up -d db
sleep 20
docker compose up -d backend
```

If the database container will not start at all, the disk may be full — see
[The disk is full](#6-the-disk-is-full).

### 4. A migration failed

```
[entrypoint] Applying database migrations...
... then an error, and the container stops
```

**Your data is safe.** Migrations run in a transaction; a failure undoes
everything it did. `MIGRATION-RUNBOOK.md` explains the two errors that stop a
migration on purpose — orphaned rows, and dates it cannot interpret — and what
to do about each.

### 5. A port is already in use

```
bind: address already in use
```

Something else is on port 80:

```bash
sudo lsof -i :80
```

Usually an nginx or Apache installed directly on the server. Stop it, or change
the left-hand number in the `ports:` line of `docker-compose.yml`.

### 6. The disk is full

```bash
df -h
docker system df
```

Old images are the usual culprit:

```bash
docker image prune -a          # unused images. Safe: it does not touch volumes.
```

> **Never run `docker system prune --volumes` or `docker compose down -v`.**
> Both delete named volumes, which means the database and every uploaded file.

Old backups are the other culprit. The rotation keeps 14 daily and 3 months of
weekly copies; if `backups/` is very large, check whether the rotation is
running by looking at `backups/backup.log`.

---

## Worked example: the `alembic_version` bootstrap incident

This is worth reading even if nothing is currently wrong, because it explains
the single most confusing failure this system can produce, and why the deployment
now works the way it does.

### What Alembic is doing

Alembic tracks database structure. It keeps one row, in a table called
`alembic_version`, recording which migration the database has reached. On each
deploy it compares that bookmark against the migrations in the code and runs the
ones in between.

### What went wrong

Historically the application built its own tables at startup by calling
`create_all()`. That created every table directly from the code's models — and
**it did not write anything into `alembic_version`.**

So the database had a complete, modern set of tables, while Alembic's bookmark
said *nothing has been applied at all*.

The first time anyone ran `alembic upgrade head` on that database, Alembic did
what it was told: it started from the beginning and tried to apply the first
migration, which adds the `last_login_at` column to `users`. That column already
existed, because `create_all()` had made it. PostgreSQL refused:

```
sqlalchemy.exc.ProgrammingError: (psycopg.errors.DuplicateColumn)
column "last_login_at" of relation "users" already exists
```

The confusing part is that **nothing was actually broken**. The database was
fine. The application was fine. Only the bookmark was wrong.

### The tempting wrong fix

The obvious move is to edit `alembic_version` by hand and set it to the latest
revision. Sometimes that even works. It is dangerous because it tells Alembic
that migrations have been applied when they have not, so genuinely necessary
changes get skipped — and the failure surfaces much later, as unrelated errors
in the application, with nothing pointing back at the cause.

### The correct fix

Tell Alembic where the database really is, using `stamp`. It writes the bookmark
without running any migration:

```bash
docker compose exec backend alembic stamp 97e73674816a
```

Then upgrade normally:

```bash
docker compose exec backend alembic upgrade head
```

Alembic now applies only the migrations that come after that point.

`stamp` is the right tool because it is honest about what it does: it records a
position, and you are responsible for choosing the true one.

### Why it cannot happen again

Three things changed:

1. **`create_all()` is gone.** Alembic is the only thing that creates or alters
   tables, so the bookmark can no longer drift from reality.
2. **Migrations run at deploy time**, from `entrypoint.sh`, before the
   application starts — not from inside the running application.
3. **The migrations tolerate both starting points.** The baseline migration
   creates only what is missing, and the repair migration checks the current
   state before each step. A database built the old way and one created fresh
   both converge on exactly the same schema.

### Checking the bookmark

Admin → System Health shows the current and expected revision and flags a
mismatch. From the terminal:

```bash
docker compose exec db psql -U uep -d uep -c "SELECT * FROM alembic_version;"
docker compose exec backend alembic heads
```

Those two should match. If they do not, and you have not just deployed, ask for
help rather than editing the table.

---

## Routine maintenance

| How often | What |
|---|---|
| Daily (automatic) | Backups, via cron. Check `backups/backup.log` occasionally. |
| Weekly | Glance at Admin → System Health. |
| **Every 6 months** | **Do a restore drill.** See `BACKUP-RUNBOOK.md`. This is the one that gets skipped, and the one that matters. |
| Every 6–12 months | Update the pinned base image digests in the two `Dockerfile`s. Pinning means security updates do not arrive on their own. |
| Before Node 20 / Python 3.12 end of life | Move to newer base images. Both fall inside this platform's expected lifetime. |

### Updating a pinned base image

Each `Dockerfile` records the tag its digest came from. To refresh:

```bash
docker pull python:3.12-slim
docker inspect --format='{{index .RepoDigests 0}}' python:3.12-slim
```

Paste the new digest into `backend/Dockerfile`, then deploy as usual. The tests
run in CI on every push, so a problem shows up before it reaches the server.
