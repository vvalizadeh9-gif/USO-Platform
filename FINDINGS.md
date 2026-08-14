# FINDINGS

Things noticed during the pre-launch hardening work that were **deliberately not
changed**, plus the results of the checks the brief asked for.

This file is written for the repository owner, who is not a developer. Where
something is technical, the "What it means" line explains it in plain language.

---

## Phase 0 — version control

### The eight prior merges did not lose the login captcha or the login UX work

**The worry:** every previous commit changed only one file, `uep-v2-changes.tar.gz`
— a compressed archive. Git cannot merge inside an archive. When two branches both
changed it, the only way to resolve the conflict was to throw away one side
completely. Eight branches were merged this way, so there was a real chance some
work had silently vanished.

**What I checked and found:**

| Thing checked | Result |
|---|---|
| `create_captcha_challenge` in `backend/app/core/security.py` | **Present.** Also wired up in `app/api/auth.py` at the `/auth/captcha` endpoint and verified on login. |
| Login UX changes in `frontend/src/pages/Login.jsx` | **Present.** 193 lines, including captcha refresh, numeric-only validation, focus management, and inline error messages. |

**Conclusion: nothing was lost.** Both features survived intact.

### The stale branch was a duplicate, not lost work

The brief said `claude/action-center-notifications-d0ghuh` could be deleted because
its commit was superseded. Git initially disagreed — the commit was *not* an
ancestor of `main`, which normally means unmerged work.

I checked further, and it is a false alarm. The branch commit `a16c052` and the
`main` commit `addf900` have the **identical file tree** (`16f99cb3…`) and the
**identical parent** (`e222311`). They differ only in who signed them: GitHub
re-authored and re-signed the commit when it was merged through the web UI, which
produces a new commit ID for byte-identical content.

**What it means:** the work is fully present in `main`. Deleting the branch loses
nothing, and it is safe for you to delete.

**I could not delete it myself.** The sandbox this work ran in allows pushing new
commits but blocks deleting remote branches, and the GitHub tools available to me
have no "delete branch" operation. This is a one-click job for you:

1. Go to <https://github.com/vvalizadeh9-gif/USO-Platform/branches>
2. Find `claude/action-center-notifications-d0ghuh`
3. Click the wastebasket icon on its row.

If you ever change your mind, GitHub keeps a "Restore" button next to deleted
branches on that same page for a while afterwards.

### Other stale branches left alone

Eight further merged branches still exist on GitHub:

`claude/acceptance-tab-kpi-analysis-f5ndgw`, `claude/admin-console-restructure-asaz0x`,
`claude/cpm-import-filtering-1uoddy`, `claude/health-check-flow-discussion-ijpq5y`,
`claude/login-page-captcha-hei0mj`, `claude/login-page-ux-review-ouqn87`,
`claude/pm-action-center-kpi-lvr78g`, `claude/uep-permissions-admin-stats-naip0s`

The brief only authorised deleting one, so I left these. They are harmless — just
clutter in the branch dropdown. You can delete them from the GitHub web UI at any
time; their work is all in `main` already.

### The tarball is kept in history, not lost

`uep-v2-changes.tar.gz` was deleted from the working tree, but it still exists in
every historical commit. Nothing is unrecoverable. `.gitignore` now blocks `*.tar.gz`
so the pattern cannot come back by accident.

---

## Phase 1 — database schema

### All ten hand-managed indexes were already declared on the models

The old startup code kept an `ADDITIVE_INDEXES` list and re-created those ten
indexes on every boot. Before deleting it I checked whether any of them existed
*only* there — if so, removing the code would have silently dropped an index and
made the platform slower and slower as data accumulated.

All ten are already declared on the ORM models (`index=True`), so they are in the
baseline migration and no index is lost. **No model changes were needed.**

### A gap that the removal would have opened, and how it was closed

There was one real hole. A database already bookmarked at the old migration
`97e73674816a` skips the baseline entirely, so if such a database were *missing*
an index, nothing would ever create it once the startup code was gone. The repair
migration therefore re-creates any of the ten that are absent. This was caught by
comparing a freshly built database against a repaired one and finding
`ix_work_items_dt_sc_contractor_id` missing from the repaired one.

### How thoroughly this was checked

A real PostgreSQL 16 server was used to build all four kinds of database and
compare the results:

| Starting point | Result |
|---|---|
| Brand-new empty database | Full schema, 26 tables |
| Legacy database, bookmarked at `97e73674816a` | Repaired |
| Legacy database, never bookmarked | Repaired |
| Already-correct database | No change at all |

A fresh database and a repaired legacy one were then compared across **394
schema facts** (every column type and nullability, every constraint, every index)
and are byte-for-byte identical. Ten tests in `backend/tests/test_migrations.py`
lock this in permanently, including the orphan refusal and the timezone
detection. They skip unless a PostgreSQL server is available, and the GitHub
Actions workflow provides one.

### The timezone question was answered by measurement, not assumption

The brief asked whether the two naive `TIMESTAMP` columns held UTC or Tehran
local time, and said to verify empirically. Since the database holds no real
data yet there was nothing to measure — so instead of hardcoding a guess, **the
migration measures it at run time**, on whatever database it is applied to. It
compares each value against a neighbouring timezone-aware column and converts
using what it finds; if the values disagree with each other it stops rather than
shifting dates by 3.5 hours. All three outcomes are covered by tests.

This means the answer stays correct even if you run the migration much later,
against data that does not exist yet.

### The original migration was re-pointed, deliberately

`97e73674816a` used to be the first migration in the chain, and it assumed the
`users` table already existed — which was only true because `create_all()` had
made it first. It now runs *after* the baseline, and its column-add is guarded so
it does nothing when the baseline has already created that column. A database
already bookmarked at `97e73674816a` is unaffected: Alembic treats everything
before that bookmark as done.

### Not changed: tests run on SQLite, production runs on PostgreSQL

Every test except `test_migrations.py` uses a throwaway SQLite file. That is
fast and needs no server, but it means the suite cannot catch anything
PostgreSQL-specific — the exact class of bug this phase was about. Converting
the whole suite to PostgreSQL is a larger change than this brief covers, so it
was not attempted. `test_migrations.py` is the beginning of a second track that
does use real PostgreSQL, and it is where PostgreSQL-specific tests should go.

### Not changed: the test modules share one database engine

Each test module sets `DATABASE_URL` to its own SQLite path, but only the first
one to be imported takes effect — SQLAlchemy builds the engine once, at import.
Every module therefore shares one database file, and isolation comes from each
module rebuilding the schema from scratch. It works, but the per-module paths in
those files are misleading to read. Left alone: it is cosmetic, and touching it
means editing all twelve test modules for no behavioural gain.
