# Migration Runbook

**Who this is for:** the person running the UEP server. It assumes no
programming knowledge. Where a command must be typed, it is given in full.

---

## What changed, in one paragraph

The application used to build and modify its own database structure every time
it started, in three different ways at once. Those three ways disagreed with each
other, which meant the live database had slowly drifted into a shape the code did
not quite expect. From now on there is exactly one mechanism — **Alembic
migrations** — and it runs once when you deploy, not every time the app starts.

The first time you deploy this version, a **repair migration** runs. It brings the
existing database into line with what the code expects: it adds three missing
foreign keys, converts two date columns to timezone-aware ones, and re-creates
ten indexes. It does not delete anything.

---

## Before you deploy: take a backup

Do this every time, no exceptions. It takes under a minute and it is the only
thing standing between a bad surprise and a lost afternoon.

```bash
cd /path/to/USO-Platform
docker compose exec -T db pg_dump -U uep -Fc uep > backup-before-migration-$(date +%F).dump
```

Check that the file is not empty:

```bash
ls -lh backup-before-migration-*.dump
```

If it is zero bytes, **stop** and fix that before going further. A zero-byte
backup is not a backup.

> There is also an automated backup script — see `BACKUP-RUNBOOK.md`. This
> manual one is the belt to that script's braces, taken at the exact moment
> before you change something.

---

## Running the migration

You do not run it by hand. It runs automatically when the backend container
starts, before the application accepts any traffic:

```bash
docker compose up -d --build
```

Then watch what it did:

```bash
docker compose logs backend | head -40
```

### What success looks like

```
[entrypoint] Applying database migrations...
Checking whether this database needs the legacy schema repair...
    hc_tasks.reviewed_by: added foreign key -> users.id.
    work_items.dt_sc_contractor_id: added foreign key -> contractors.id.
    problem_categories.owner_role_id: added foreign key -> roles.id.
    hc_tasks.reviewed_at: no values stored yet, so there are no dates to shift. Converting as UTC.
    hc_tasks.reviewed_at: converted to timestamptz using UTC.
    assignments.returned_at: ... converted to timestamptz using UTC.
Legacy schema repair complete.
[entrypoint] Migrations applied.
[entrypoint] Starting API server...
```

On the **second** and every later deploy you will see much less, because there is
nothing left to repair:

```
    hc_tasks.reviewed_by: foreign key already present, skipping.
    hc_tasks.reviewed_at: already timezone-aware, skipping.
```

That is correct and expected. The migration is safe to run any number of times.

### What failure looks like

The backend container **stops** and does not serve traffic. This is deliberate:
it is much better than a half-changed database going live. The website will be
down until you resolve it, and the two situations that can cause it are both
explained below.

Your data is untouched — a failed migration undoes everything it did.

---

## When the migration reports orphaned rows

You will see something like:

```
Cannot add the foreign key problem_categories.owner_role_id -> roles.id.

Some rows in 'problem_categories' point at a 'roles' record that no longer exists:

    problem_categories.owner_role_id = 404 (2 rows) -- no roles row has id = 404
```

### What it means, in plain language

Somewhere in the database, a record refers to another record that has been
deleted. In the example above, two problem categories say "role number 404 owns
me", but there is no role 404 any more — it was deleted at some point.

The migration is trying to add a rule that says "this reference must always point
at something real". It cannot add that rule while these broken references exist.

### Why it stopped instead of fixing it

The obvious fix — quietly blanking those references — would destroy information.
If an `hc_tasks.reviewed_by` pointed at a deleted user, blanking it means the
health check no longer records *who reviewed it*. On a platform where acceptance
dates carry contractual consequences, that is not a decision a script should make
on its own.

### What to do

1. **Nothing has changed yet.** You are not in a hurry. The old version of the
   application is still running if you have not restarted it.

2. **Look at what the broken references are.** Connect to the database:

   ```bash
   docker compose exec db psql -U uep -d uep
   ```

   Then, using the table and column from the error message:

   ```sql
   SELECT * FROM problem_categories WHERE owner_role_id = 404;
   ```

   Type `\q` and press Enter to leave.

3. **Decide what those rows should say**, and have someone make that change
   through the application's Admin screens if possible. For the example above,
   an Admin would re-point those problem categories at a role that exists.

4. **Deploy again.** Once no broken references remain, the migration completes
   normally.

If you cannot tell what the rows should say, send the output of step 2 to whoever
maintains the platform. Do not delete the rows.

---

## When the migration cannot read the dates

You will see something like:

```
Cannot safely convert assignments.returned_at to a timezone-aware column.
    rows checked:   40
    smallest gap:   0 seconds
    largest gap:    12600 seconds
```

### What it means, in plain language

Two of the date columns used to be stored without recording which time zone they
were in — just "3 o'clock", with no note of whether that was 3 o'clock in Tehran
or 3 o'clock UTC. The migration is making them record the zone properly, and to
do that it has to decide which clock the existing readings came from.

It checks rather than guesses: it compares each date against a neighbouring
column that *does* record its zone. If those checks all agree, it proceeds. The
message above means they did not all agree — some dates look like UTC and some
look like Tehran local time, which suggests they were written by different
versions of the software.

### Why this matters

Getting it wrong shifts every affected date by 3 hours 30 minutes. These are
health-check review dates and assignment return dates. Since acceptance dates
carry contractual consequences, a silent 3.5-hour shift is exactly the kind of
error that surfaces months later in a dispute.

### What to do

Send the full error message to whoever maintains the platform. This one needs a
person who can look at the history of the data and decide. Nothing has changed
and the old version still runs.

---

## How to roll back

Rolling back has two parts: the code and the database.

### If the migration failed

Nothing was changed. Just redeploy the previous version:

```bash
git checkout <previous-version>
docker compose up -d --build
```

### If the migration succeeded but something else is wrong

Restore the backup you took at the start. **This discards anything entered since
the backup**, so check with the team first.

```bash
# 1. Stop the application (leave the database running).
docker compose stop backend frontend

# 2. Restore.
docker compose exec -T db pg_restore -U uep -d uep --clean --if-exists \
    < backup-before-migration-YYYY-MM-DD.dump

# 3. Go back to the previous code and start up again.
git checkout <previous-version>
docker compose up -d --build
```

Full details, including how to practise this safely, are in `BACKUP-RUNBOOK.md`.

---

## The `alembic_version` bookmark

Alembic keeps a single row in a table called `alembic_version` recording which
migration the database has reached. To see it:

```bash
docker compose exec db psql -U uep -d uep -c "SELECT * FROM alembic_version;"
```

After a successful deploy of this version it reads `b7f1c2d9e4a3`.

**Do not edit this table by hand.** If it says the database is further along than
it really is, migrations that still need to run will be skipped, and the failure
will show up much later as confusing errors. There is a worked example of exactly
this going wrong, and how it was resolved, in `RUNBOOK.md`.

---

## Frequently asked

**Can I run the migration twice?**
Yes. Every step checks whether its work is already done and skips itself. Running
it on an up-to-date database changes nothing.

**Will it delete any data?**
No. It only adds constraints, changes two column types, and creates indexes. No
migration in this project deletes rows or drops tables. The baseline migration
actively refuses to be reversed, because reversing it would drop every table.

**How long does it take?**
On a database of the size UEP will reach, a few seconds. The index creation is
the slowest part and grows with the number of imported rows.

**Do I need to stop the application first?**
No. `docker compose up -d --build` handles it: the new backend applies the
migration before it starts serving.

**What if the server loses power mid-migration?**
The migration runs inside a single database transaction. An interruption rolls it
back completely — you will not get a half-changed database. Deploy again when the
server is back.
