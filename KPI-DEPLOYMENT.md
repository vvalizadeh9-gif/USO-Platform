# Deploying KPI & Performance

Copy and paste these, one block at a time, on the server. There is **no `-v`**
anywhere in this file, and there must never be: `docker compose down -v` deletes
the database volume.

## 1. Back up the database first

This release adds a table and a column. Neither touches existing data, but a
backup before any migration is the rule.

```bash
cd /opt/uep
docker compose exec -T db pg_dump -U uep uep > ~/uep-backup-before-kpi.sql
ls -lh ~/uep-backup-before-kpi.sql
```

The file should be several megabytes. If it is empty or tiny, stop and check
`BACKUP-RUNBOOK.md` before going further.

## 2. Pull the code

```bash
cd /opt/uep
git pull
```

## 3. Rebuild and start

The backend image installs from `requirements.lock`, which now carries
`reportlab` for the PDF export, so the backend must be rebuilt rather than just
restarted.

```bash
cd /opt/uep
docker compose build
docker compose up -d
```

`docker compose up -d` recreates only what changed. It does **not** remove
volumes.

## 4. Check the migration actually ran

The backend's entrypoint applies migrations before it starts serving, and it
fails the container rather than serving against a half-migrated database. This
is how you confirm it:

```bash
cd /opt/uep
docker compose exec -T backend alembic current
```

Expected output — the last line must read:

```
f7a2c5d91b34 (head)
```

If it says anything else, or the command fails, the backend did not migrate.
Check the logs before using the page:

```bash
docker compose logs --tail=80 backend
```

## 5. Check the 31 provinces were seeded

The mapping rows are inserted on startup, once, and are never overwritten
afterwards — so an assignment you change in the product survives every later
restart.

```bash
cd /opt/uep
docker compose exec -T db psql -U uep -d uep -c \
  "SELECT count(*) AS open_rows FROM province_mapping WHERE effective_to IS NULL;"
```

Expected: `31`.

To see them:

```bash
cd /opt/uep
docker compose exec -T db psql -U uep -d uep -c \
  "SELECT province_en, cra_region, pso_coordinator, regional_manager, effective_from
     FROM province_mapping WHERE effective_to IS NULL ORDER BY province_en;"
```

## 6. Link the accounts

Sign in as the PM and open **Reports → KPI & Performance → Mapping**. The
right-hand **Account links** panel lists every Regional Manager and Coordinator
account. Each one needs a name chosen from the list.

An account that is not linked cannot open the page — it is told so in plain
words rather than being shown someone else's provinces. Contractor accounts
need nothing here: they are already linked through their contractor, which is
the DT SC value from CPM.

## 7. Look at the page

Sign in as the PM and open **Reports → KPI & Performance**.

- Switch the lens between Regional Manager, PSO Coordinator, Contractor and
  CRA Region, and change the person.
- Check **Export Excel** and **Export PDF** both download.
- Sign in as one Regional Manager and one Contractor and confirm each sees
  only their own scope, with no lens control.

## If you need to go back

The release is additive, so rolling the code back is enough — the new table and
column can simply stay in place, unused.

```bash
cd /opt/uep
git checkout <the previous commit>
docker compose build
docker compose up -d
```

If you also want the table gone (you almost certainly do not):

```bash
cd /opt/uep
docker compose exec -T backend alembic downgrade -1
```

That drops `province_mapping` and `users.kpi_person_name` and nothing else. Any
reassignment history you had entered is lost with it.
