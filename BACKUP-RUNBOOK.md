# Backup Runbook

**Who this is for:** the person running the UEP server. No programming knowledge
assumed.

---

## The one thing to take from this document

> **A backup you have never restored is not a backup. It is a file you hope is a
> backup.**

Backups fail silently. The script runs every night, writes a file, reports
success, and the file is empty — or it is fine but nobody knows the command to
get the data back, and they are learning it for the first time at 9pm during an
outage.

The only way to know your backups work is to restore one and look at it. There
are step-by-step instructions for doing that safely, without touching the live
system, in [Practising a restore](#practising-a-restore-do-this-every-six-months).
**Do it every six months.** Put it in a calendar now.

---

## What exists

| | |
|---|---|
| `scripts/backup.sh` | Backs up the database, which includes every uploaded file. Rotates old ones. |
| `scripts/restore.sh` | Puts it back. Asks for confirmation first. |
| `backups/daily/` | One dump per night, the last **14** kept. |
| `backups/weekly/` | Every Sunday's dump, kept **3 months**. |
| `backups/pre-restore/` | A safety copy taken automatically before any restore. |

Two levels of retention because problems are found at two speeds. Someone
noticing a bad CPM import the next morning needs yesterday's; someone noticing
in March that acceptance figures went wrong in January needs the weekly set.

### What is backed up

One thing, every night, automatically: **the database** — sites, villages, work
items, health checks, drive tests, acceptances, users, audit log, and, since
UEP-20, **every uploaded file** (ICT/CRA letters and evidence, drive-test
evidence, MTN submission letters, CPM workbooks) in the `stored_files` table.
Written as `uep-<date>.dump`.

There is no uploads volume any more, so a filing and its letter are always
backed up and restored together. Older backups may still have an
`uep-uploads-<date>.tar.gz` beside them; they are rotated out like the dumps.
To bring one of those into a restored database, unpack it into a folder and run
the one-time copy described in *Uploads archives from before UEP-20* below.

Expect the database to grow by about **10 GB a year** from files alone, and CPM
workbooks are kept forever: size the disk and the backup storage (here, or on
IT's PostgreSQL server) for a growing database kept for 1 month and 1 year.

---

## Setting it up (once)

### 1. Check it works by hand

```bash
cd /path/to/USO-Platform
./scripts/backup.sh
```

You should see something ending in `Backup complete.` Confirm the file is there
and is a sensible size:

```bash
ls -lh backups/daily/
```

A real UEP database, once CPM has been imported, produces a file of several
megabytes. **If it is a few kilobytes, something is wrong** — the script refuses
anything under 1 KB, but a suspiciously small file is worth investigating rather
than accepting.

### 2. Run it every night

```bash
crontab -e
```

Add this line, with the real path:

```
30 2 * * * cd /path/to/USO-Platform && ./scripts/backup.sh >> backups/backup.log 2>&1
```

That runs at 02:30 every night and appends the output to `backups/backup.log`.

Check the next morning:

```bash
tail -20 backups/backup.log
ls -lh backups/daily/
```

### 3. Copy the backups off the machine

**This matters more than anything else in this document.**

A backup sitting on the same server as the database protects you from a mistaken
deletion or a bad import. It protects you from nothing else. If that machine's
disk fails, or it is lost, or someone gets into it and encrypts everything, the
backups go with it.

Something must copy `backups/` somewhere else — another server, a NAS, object
storage, an external drive that gets swapped. Which one depends on what your
organisation provides, so it is not scripted here, but **it is not optional**.

A simple version, if you have another machine you can reach over SSH:

```
0 4 * * * rsync -az --delete /path/to/USO-Platform/backups/ backup-user@other-host:/srv/uep-backups/
```

---

## Practising a restore (do this every six months)

This is the part people skip. It takes about twenty minutes and it is the
difference between having backups and thinking you have backups.

**Nothing here touches the live system.** You build a separate, temporary copy,
restore into it, look at it, and throw it away.

### 1. Pick a backup

```bash
ls -lht backups/daily/ | head
```

Use the most recent one.

### 2. Start a scratch database

This runs a second PostgreSQL alongside the real one, on a different port, with
nothing else attached to it:

```bash
docker run -d --name uep-drill \
  -e POSTGRES_USER=uep \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_DB=uep \
  -p 55433:5432 \
  postgres:16-alpine
```

Wait about ten seconds, then check it is up:

```bash
docker exec uep-drill pg_isready -U uep
```

You want `accepting connections`.

### 3. Restore the backup into it

```bash
docker exec -i uep-drill pg_restore -U uep -d uep --clean --if-exists --no-owner \
  < backups/daily/uep-YYYY-MM-DD_HHMM.dump
```

Use a real filename from step 1. Some warnings are normal — `pg_restore`
complains about dropping things that were not there yet.

### 4. Look at what you restored

This is the actual test. An empty backup restores perfectly silently.

```bash
docker exec uep-drill psql -U uep -d uep -c "
SELECT 'users' AS table, count(*) FROM users
UNION ALL SELECT 'sites', count(*) FROM sites
UNION ALL SELECT 'villages', count(*) FROM villages
UNION ALL SELECT 'work_items', count(*) FROM work_items
UNION ALL SELECT 'acceptances', count(*) FROM acceptances
UNION ALL SELECT 'hc_tasks', count(*) FROM hc_tasks
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;"
```

**Do the numbers look right?** They should be close to the live system. Compare:

```bash
docker compose exec db psql -U uep -d uep -c "SELECT count(*) FROM villages;"
```

Then check the most recent activity actually arrived:

```bash
docker exec uep-drill psql -U uep -d uep -c \
  "SELECT created_at, module, reason FROM audit_logs ORDER BY id DESC LIMIT 5;"
```

The newest entry should be from shortly before the backup ran. **If it is weeks
old, your backups have been silently failing** — and you have just found out
during a drill rather than during an emergency.

### 5. Clean up

```bash
docker rm -f uep-drill
```

That deletes the scratch database entirely. The live system was never involved.

### 6. Write down that you did it

Keep a note — in this file, in a calendar, anywhere findable:

```
Restore drills
--------------
2026-08-14  restored 2026-08-13 backup, 14,982 villages, newest audit entry 02:28. OK.
```

Then set the next reminder for six months out.

---

## Restoring for real

Only when the live database is genuinely wrong: a bad import, a mistaken bulk
change, corruption.

**Everything entered since the backup was taken will be lost.** Before starting,
be sure someone has decided that is acceptable, and tell users the system is
going down.

```bash
cd /path/to/USO-Platform
./scripts/restore.sh backups/daily/uep-2026-08-14_0230.dump
```

The script:

1. Shows what it is about to do and waits for you to type `replace`.
2. Takes a safety copy of the current database into `backups/pre-restore/`, so a
   restore you regret can itself be undone.
3. Stops the application so nothing writes mid-restore.
4. Restores the database. Uploaded files are part of it, so they come back to
   the same moment as everything else.
5. Starts everything again and waits for the backend to report healthy.

Afterwards, check in the application: sign in, open Reports → Acceptance
Dashboard and see whether the numbers match that date, open Admin → Audit Log
and confirm the newest entry is from around when the backup was taken.

If it was the wrong choice, restore the safety copy the same way.

---

## Uploads archives from before UEP-20

Until UEP-20 uploaded files lived in a Docker volume and were backed up as
`uep-uploads-<date>.tar.gz`. They now live in the database, so you only need
this section to bring files from such an archive (or from an old server's
uploads folder) into a database:

```bash
mkdir -p /tmp/old-uploads && tar xzf backups/daily/uep-uploads-YYYY-MM-DD_HHMM.tar.gz -C /tmp/old-uploads
docker compose run --rm -v /tmp/old-uploads:/old-uploads:ro backend   python -m app.scripts.migrate_uploads_to_db --upload-dir /old-uploads --dry-run
docker compose run --rm -v /tmp/old-uploads:/old-uploads:ro backend   python -m app.scripts.migrate_uploads_to_db --upload-dir /old-uploads
```

It checks every file's SHA-256 against its name, never deletes anything, is
safe to run twice, and ends with a report: files copied, already present, hash
mismatches, CPM workbooks linked to their import, and rows whose file is still
missing, per table. It exits non-zero while any row points at a missing file.

---

## When something goes wrong

**"the 'db' container is not running"**
Start it: `docker compose up -d db`, wait ten seconds, run the backup again.

**The backup file is tiny, or the script reports `.suspect`**
`pg_dump` produced almost nothing. Check the database is really there:

```bash
docker compose exec db psql -U uep -d uep -c "SELECT count(*) FROM villages;"
```

If that errors, the problem is the database, not the backup. Do not delete
anything; the previous backups are still in `backups/daily/`.

**The cron job never runs**
Check the log first: `tail backups/backup.log`. If it is empty, cron is not
running the line — confirm the path in `crontab -e` is the real absolute path,
since cron starts in a different directory and with a much smaller `PATH` than
your shell.

**`docker compose` not found in the cron log**
cron's `PATH` is minimal. Use the full path in the crontab line — find it with
`which docker`, then write `/usr/bin/docker compose` in the script call, or set
`PATH=/usr/local/bin:/usr/bin:/bin` at the top of the crontab.

**The restore reported errors**
Some `pg_restore` messages are harmless. Check the application before assuming
the worst. The safety copy in `backups/pre-restore/` puts things back exactly as
they were.
