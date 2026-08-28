# FINDINGS

Things noticed during the pre-launch hardening work that were **deliberately not
changed**, plus the results of the checks the brief asked for.

This file is written for the repository owner, who is not a developer. Where
something is technical, the "What it means" line explains it in plain language.

---

## The short version

If you read nothing else, these are the things that still need a decision or an
action from you. Everything else below is context.

| | What | Where |
|---|---|---|
| 1 | **None of the Docker work could be tested** — this machine had no Docker. The first `docker compose up -d --build` is the first real test. | [Phase 4](#none-of-the-docker-work-could-be-tested-here) |
| 2 | **Backups never leave the server.** That protects against a bad import, not against losing the machine. | [Phase 4](#backups-still-need-to-leave-the-machine) |
| 3 | ~~Uploaded letters are not in the nightly backup.~~ **Fixed** — the nightly job now covers both. | [Phase 4](#uploaded-files-are-not-covered-by-the-database-backup) |
| 4 | ~~The fonts come from Google.~~ **Fixed** — the three fonts are now served by the application itself. | [Phase 2](#found-while-writing-the-content-security-policy-the-fonts-come-from-google) |
| 5 | **Delete the stale branch** — one click in the GitHub web interface; I could not do it from here. | [Phase 0](#the-stale-branch-was-a-duplicate-not-lost-work) |
| 6 | **Pinned images stop receiving security updates** unless someone refreshes them once or twice a year. | [Phase 4](#the-base-images-are-pinned-by-digest-which-means-they-will-go-stale) |

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

---

## Phase 2 — secrets, transport and authentication

### Deliberately not implemented (the brief put these out of scope)

**1. The session token is stored in `localStorage`.**
Any JavaScript running on the page can read it, so a cross-site-scripting hole
anywhere in the frontend turns into a stolen session that stays valid for eight
hours. Storing it in an httpOnly cookie instead would put it out of JavaScript's
reach — but cookies are sent automatically, which opens cross-site request
forgery, so it also requires CSRF tokens on every state-changing request. That
is a frontend change of real size and it belongs in its own piece of work.

The Content-Security-Policy added to `nginx.conf` reduces the risk in the
meantime: `script-src 'self'` means an injected inline script will not run.

**2. `uep_user` is trusted from `localStorage` without revalidation.**
On page load the frontend reads the cached user object — including their role —
rather than asking `/auth/me`. Editing that cached object in browser developer
tools makes the interface *show* administrator screens. **It does not grant any
actual access**: every endpoint re-checks the role server-side against the JWT,
so the buttons appear but the API refuses. The fix is to revalidate on load, and
it naturally belongs with the cookie change above.

### Found while writing the Content-Security-Policy: the fonts come from Google

`frontend/src/styles/app.css` imports three fonts from `fonts.googleapis.com` —
Space Grotesk, Inter, and **Vazirmatn, which is the Farsi font**.

This matters for a reason that has nothing to do with security. If the server is
internal-only and staff computers have no route to the public internet, those
fonts will not load and the interface falls back to system fonts. Farsi text is
what suffers most.

It is also a slow first paint for every user, and a third party learning who
visits the site.

**This has since been fixed.** The three fonts are downloaded into
`frontend/src/assets/fonts/` (13 files, 360 KB) and served by the application.
`scripts/fetch-fonts.py` regenerates them, and is committed so a future
maintainer can add a weight or take a font update without reverse-engineering
what was done.

What changed as a result:

* Farsi renders correctly on a server with no route to the public internet.
* The Content-Security-Policy no longer needs any third-party origin — every
  source is now `self`.
* The built frontend makes **no external network requests at all**. The only
  remaining `http://` strings in the build are React's error-message links, XML
  namespace identifiers and a `window.location` fallback, none of which are ever
  fetched.

The `unicode-range` rules are kept exactly as Google generated them, so a
browser still downloads only the subsets it needs — the Arabic subset is not
fetched for a Latin-only page. All three are variable fonts, so the four weights
of each share one file per subset.

### The per-IP login limit depends on nginx

Rate limiting counts failures per username and per source address. The address
comes from the `X-Forwarded-For` header, because from the backend's point of
view every request arrives from the nginx container.

This is safe **as long as only nginx can reach the backend port**, which is how
`docker-compose.yml` sets it up — port 8000 is not published to the host. If the
backend were ever exposed directly, a caller could forge that header and slip
past the per-IP limit. The per-username limit does not depend on it and would
still apply.

### Login counters are held in memory

They reset if the backend container restarts, and they would be counted
separately by each container if UEP were ever scaled to more than one backend.
Neither is a problem for the current single-container deployment. If a second
backend is ever added, this needs to move to Redis or the database — noted in
`app/core/rate_limit.py` as well.

### `python-jose` is gone, but check for a lock file when adding dependencies

`python-jose==3.3.0` is replaced by `PyJWT==2.10.1`, and no code imports `jose`
any more. Note that `requirements.txt` pins direct dependencies only — there is
no lock file for the backend, so indirect dependencies can still drift between
builds. The frontend now has one (`npm ci` against `package-lock.json`, phase 4).
Doing the same for Python means adding pip-tools or Poetry, which is a bigger
change than this brief covers.

---

## Phase 3 — deactivating users

### There is no `/auth/me` endpoint

The brief listed "revalidating `uep_user` against `/auth/me` on page load" as
out of scope. Worth recording that **the endpoint does not exist** — the API has
`/auth/captcha` and `/auth/login` and nothing else under `/auth`. So that future
change is slightly larger than it sounds: the endpoint has to be written first.

The login response already returns the full user object, which is where the
frontend gets it from today.

### `PATCH active=false` was a second door with no lock

The brief asked to keep the "cannot deactivate yourself" and "cannot remove the
last administrator" guards on the delete endpoint. Those guards existed only
there — but `PATCH /admin/users/{id}` with `active: false` has always done
exactly the same thing and had **no guards at all**. An admin could lock every
administrator out of the platform through the edit form.

Now that delete and that patch are the same operation, both go through the same
check. This was not in the brief; it is included because leaving it would have
meant shipping a guard that is trivially bypassed.

### Deactivation is reversible, and the interface now says so

`frontend/src/pages/admin/UsersTab.jsx` told the admin they were about to
"permanently delete" the user and that it "cannot be undone". After this change
that text was simply false. The dialog now explains what actually happens, and
deactivated users get a reactivate button rather than disappearing from the list.

### Not changed: `POST /admin/users` with a reused username

Creating a user checks that the username is not taken, and a deactivated user
still holds theirs. So if someone leaves and a new starter is given the same
username, creation fails with "Username already exists" and no hint that the
name belongs to a deactivated account. The admin can see the account in the list
(it is shown as inactive), so this is discoverable rather than mysterious.

Left alone because the alternatives are all judgement calls the owner should
make: free the username on deactivation (breaks the "who was this" trail),
auto-suggest a variant, or say plainly that the name belongs to a deactivated
account. The last is probably right, but it is a product decision.

---

## Phase 4 — deployment, backups and builds

### None of the Docker work could be tested here

**Please read this one.** The machine this work was done on has no Docker
daemon, so `docker-compose.yml`, both `Dockerfile`s and the two backup scripts
were **written but never run**. Everything else in this project was executed and
verified; this part was not.

They are written carefully and the shell scripts are syntax-checked, but the
first `docker compose up -d --build` is the first real test. Do it at a time
when a problem is an inconvenience rather than an emergency, and have
`docker compose logs` open.

Most likely places for a first-run problem:

1. **The non-root backend user and the uploads volume.** The image creates
   `/data/uploads` owned by the `uep` user, but Docker creates the named volume
   on first mount and may give it root ownership. If uploads fail with a
   permission error, that is why. Fix on the server with:
   `docker compose exec -u root backend chown -R uep:uep /data/uploads`
2. **The frontend port mapping.** nginx now listens on 8080 inside the container
   (it runs unprivileged and cannot bind port 80), mapped to the host's port 80.
   If the site does not answer, check `docker compose ps` shows `0.0.0.0:80->8080/tcp`.
3. **The backend healthcheck.** It allows 120 seconds before it starts checking,
   because migrations run first. On a slow first migration against a large
   database, raise `start_period`.

### The base images are pinned by digest, which means they will go stale

Every image is pinned to an exact digest rather than a moving tag, so a rebuild
gives the same result in five years as today. The other side of that: **security
updates no longer arrive on their own.** Pinning trades automatic patching for
reproducibility, which is the right trade for this platform, but only if someone
updates the pins deliberately.

Each `Dockerfile` records which tag the digest came from and the command to
refresh it. Worth doing once or twice a year, and whenever a serious advisory
lands. Python 3.12 and Node 20 both reach end of life inside this platform's
expected lifetime and will force the issue.

### Uploaded files are not covered by the database backup

**This has since been fixed.** `backup.sh` now writes an uploads archive beside
each database dump, sharing its timestamp, and `restore.sh` restores the archive
matching the dump you chose — so the database and its letters always go back to
the same moment. Both are rotated together.

Two deliberate choices in how it behaves:

* **A failed uploads step warns rather than aborting.** The database backup has
  already succeeded by that point, and throwing it away because the second half
  failed would be worse than a missing letter.
* **A restore with no matching uploads archive restores the database only**, and
  says so. Putting back last month's letters next to today's database would be
  worse than leaving them alone.

The volume name is looked up rather than assumed, because Compose prefixes it
with the project directory name — the old documented command hardcoded
`uso-platform_uep_uploads`, which would have silently backed up nothing if the
directory were ever renamed.

### Backups still need to leave the machine

The script writes into `backups/` on the same server as the database. That
protects against a bad import or a mistaken deletion — not against disk failure,
loss of the machine, or ransomware.

Copying `backups/` somewhere else is the single most valuable remaining step and
it is **not done**, because the right destination depends on what your
organisation provides. `BACKUP-RUNBOOK.md` has an `rsync` example.

### Fixed while adding logging: Alembic was switching the application's logs off

`alembic/env.py` called `fileConfig(config.config_file_name)`. That function's
default is `disable_existing_loggers=True`, which switches off **every logger
that already exists** — including the application's own.

The new request logging exposed it: logs appeared when the logging tests ran on
their own and vanished when the whole suite ran. The trigger is running
migrations inside the same process as the application, which the test suite does
by design so that tests build their schema the same way a deploy does.

On the server this is currently harmless, because `entrypoint.sh` runs
`alembic upgrade head` as a separate process before the application starts. But
it was a landmine: any future code that ran a migration in-process would have
silently ended request logging, with nothing at all to indicate why. Fixed by
passing `disable_existing_loggers=False`.

### The database is no longer reachable from outside the machine

The PostgreSQL port is deliberately not published to the host — only the other
containers can reach it. If anything on the server currently connects to the
database directly on port 5432, it will stop working. Nothing in this repository
does; mentioned in case some external tool was set up on the server.

---

## Phase 5 — the test suite

### The 13 failures were hiding a second, larger problem

The brief correctly identified that thirteen tests failed because of hardcoded
paths and an unreachable `pytest.skip`. Fixing that was the easy half.

Once the tests could actually find a workbook, **they ran for the first time in a
long while — and eleven of them failed for a completely different reason.** They
signed in as `admin` and then tried to assign a health check, submit a result, or
review one. All three are deliberately closed to Admin under the Admin/PM
separation of duties.

So those tests were written before that permission split and had been broken ever
since. The file-not-found error was masking it: they failed for one reason, and
would have failed for another even if the file had been there.

They now sign in as a PM for the workflow steps and as Admin only for the CPM
import, which is genuinely admin-only. **No business logic was changed** — the
permission model is correct; the tests were out of date with it.

### One test had never actually run

`test_ignored_change_is_not_applied` looked for a pending requested-tech change
request and skipped when it found none. It always found none: the test above it
creates exactly one and then accepts it. So the test had been silently skipping,
appearing in the counts as a skip rather than as a gap.

It now raises its own change request on a different row, and it passes.

### Where the suite stands now

| | Before | After |
|---|---|---|
| Passed | 83 | **157** |
| Failed | 13 | **0** |
| Skipped | 7 | **0** |

Measured on Python 3.12 with a real PostgreSQL, which is what the new GitHub
Actions workflow runs. Without PostgreSQL — a plain laptop checkout — it is 147
passed and 10 skipped, those ten being the migration tests that need a real
database.

### The fixture contains no real data

`backend/tests/fixtures/sample_cpm.xlsx` is generated by the script beside it.
Village names are transparently invented ("آبادی آزمایشی یک" — test village one),
site codes are `TST…`, operators and contractors are placeholders. The only real
values are Iranian province names, which are public administrative names and are
required because the importer resolves every استان cell against the canonical 31
and would drop anything else.

It is structurally faithful: same sheet name, same header row position, same
column positions, all six classification values including the two `(Verbally)`
sub-flags, both on-air stages, all four drive-test statuses, five technology
combinations, and one site serving two villages.

The generator is committed alongside it so the fixture can be extended later
rather than being an opaque binary nobody dares touch. Point
`UEP_TEST_CPM_XLSX` at a real workbook to run the suite against genuine data.

### Not addressed: there are no frontend tests

The CI workflow builds the frontend, which catches syntax errors, missing
imports and references to components that no longer exist. It does not test
behaviour, because there are no frontend tests at all and writing them is well
outside this brief.

Worth knowing where that leaves you: the permission model, the health-check
state machine and the CPM import are all covered on the backend, so the rules
are protected. What is not protected is the interface — a button wired to the
wrong endpoint, or a screen that stops rendering, would reach the server
unnoticed.

---

## Phase 6 — documentation

### The `/auth/me` endpoint mentioned in the brief does not exist

Recorded again here because it affects a planned future change. The brief listed
"revalidating `uep_user` against `/auth/me`" as out of scope; that endpoint has
to be written first. The login response already returns the full user object,
which is where the frontend gets it from today.

### Things that look like bugs and are not

Collected here because they are the most likely thing for a future maintainer to
"fix" by accident. Each is explained in `ARCHITECTURE.md`.

| Looks wrong | Why it is right |
|---|---|
| The هدف filter rejects `هدف (Verbally)` | Those variants were excluded from every KPI anyway; storing them only inflated village counts. The filter defines the programme's scope. |
| Acceptance counts the same site more than once | The obligation is per village. Two villages served by one site are two acceptances. Deduplicating would undercount. |
| Admin gets `403` on operational actions | Deliberate separation of duties: whoever controls user accounts must not also be able to record operational results. |
| Subcontractors cannot set a problem category | The party being measured does not get to assign blame. |
| A failed site vanishes from the basket | It is deliberately withheld until triaged and fixed. That is what makes the remediation loop close by itself. |
| CPM re-import does not apply changes | It raises change requests for a person to decide. An accidental spreadsheet edit would otherwise invalidate a health check. |

### What is not documented, and deliberately so

The frontend components have no architecture document. They are conventional
React, they hold no business rules, and the screens map one-to-one onto the
concepts in `ARCHITECTURE.md`. Documenting them would produce something that
goes stale faster than it helps.

---

# Second audit — application-layer security and the ten-year concerns

The pass above covered version control, schema, secrets, transport
configuration, deployment and the test suite. It did not cover **application
level authorization**, and that turned out to be where the platform was
weakest. This section records the second pass. It supersedes the earlier
statements noted at the end.

## What was wrong, in one sentence

The row-level security model exists, is well designed, and was not applied
consistently. `apply_work_item_scope` was the single source of truth for who
may see what — and roughly half the health-check and workflow endpoints never
called it, or fetched a record by primary key and acted on it with no ownership
check at all.

## Six endpoints reachable by changing a number in a URL

All six were exploitable by an ordinary logged-in user with a valid password.
Object ids are sequential integers, so enumeration was arithmetic.

| | What it allowed |
|---|---|
| `POST /hc/tasks/{id}/result` | Any contractor could submit health-check results for any site in the country, overwriting whatever was there. |
| `POST /hc/assignments/{id}/upload` | The same, in bulk, against a whole assignment belonging to a competitor. |
| `GET /hc/assignments/{id}` and `/template` | Any authenticated user could read any assignment and download its site list. |
| `GET /hc/results`, `/results/export`, `GET /hc/assignments`, `POST /hc/tasks/{id}/review` | Province scoping was never applied, so a coordinator granted one province read, exported and reviewed the national dataset. |
| `POST /drive-tests/{id}/coordinator-review` | Any coordinator could mark any drive test in the country Done, which moves the national KPI. |
| `PATCH /villages/{id}/acceptance/{tech}` | Any PM or coordinator could write ICT/CRA status for any village, bypassing the submit-review pipeline entirely. |

Fixed structurally rather than one endpoint at a time: every handler taking an
id now goes through a loader that resolves *and* authorises in one query,
alongside the two loaders that already existed and that the rest of the code
had simply not copied. All of them answer 404, never 403, for a record that
exists but is out of scope.

## The rest, by theme

* **Transport.** The platform ran on plain HTTP with a complete, correct,
  commented-out TLS configuration beneath it. Turning it on is now
  `UEP_ENABLE_TLS=true` plus a certificate; with TLS on and no certificate the
  container refuses to start rather than silently serving HTTP.
* **Sessions.** A password change did not end existing sessions — only
  rotating `JWT_SECRET_KEY` did, which signs out everybody. `users.token_version`
  fixes that per account.
* **Limits.** Uploads were read fully into memory and then measured; two
  endpoints returned every health-check result ever recorded; several list
  inputs had no ceiling. All bounded.
* **Integrity.** A reviewer could validate their own acceptance submission. Two
  simultaneous submissions could put a village into a permanent 500. Assignment
  codes were generated by counting rows, against a unique column. The last
  administrator could lock everyone out by changing their own role.
* **The audit trail.** `audit_logs.ip_address` had never been written to — the
  column, the parameter and the API field all existed and no caller ever passed
  a value.

## Corrections to the section above

Two statements in **Phase 2 — deliberately not implemented** have changed:

* **`uep_user` is trusted from `localStorage` without revalidation.** Still
  true of the frontend, but `GET /auth/me` now exists, so the fix no longer
  requires new backend work. The assessment that it grants no actual access is
  unchanged and was re-verified.
* **The session token is stored in `localStorage`.** Unchanged, and still the
  right call to take as its own piece of work. The exposure is smaller than it
  was: a stolen token can now be revoked for one account without signing out
  the platform.

And one from **Phase 5**:

* **"there is no lock file for the backend".** There is now —
  `backend/requirements.lock`, with hashes, installed by both the Dockerfile
  and CI, and checked for drift on every run.

## The five that were left open, and then closed

The section above originally deferred five items. Four were defensible calls
stated as they were made; the fifth was a miss. All are now done.

* **Contractors could act on work items reassigned away from them.** Narrowed
  for contractors only, the way `return_to_coordinator` already did. Staff are
  unaffected — a PM submitting on a contractor's behalf is normal.
* **`GET /hc/sites/{id}/history` was visible to every user.** Its docstring
  said so, which is why it survived the first pass. But the timeline names the
  subcontractor, the round count and the problem categories, so it let a
  contractor read how a competitor was doing on any site in the country by
  walking the ids. Scoped now.
* **The login throttle and captcha store were per-process.** Moved into the
  database. The restart case is what settled it: a deploy restarted the
  backend and cleared any lockout in progress.
* **Password rules were `min_length=8` and nothing else.** Now length 12, a
  common-password blocklist that sees through leet substitutions, and a check
  against the username — and deliberately *no* character-class rule, for the
  reason set out in `app/core/passwords.py`.
* **There were no frontend tests.** This one was promised in the phase plan and
  then skipped, which should have been said at the time rather than glossed.
  There are now 67, covering the queue-status logic that mirrors backend rules,
  the localStorage boot path, the API client's 401 handling, the audit-log
  describer and the route guards. `npm test` runs in CI.

### Still open, deliberately

* **Twelve ESLint warnings**, mostly hook dependency arrays. Each is a real
  observation and fixing them changes render behaviour, which does not belong
  in the same change as a lint rollout.
* **`FIRST_ADMIN_PASSWORD` is not held to the new password policy.** The
  seeded admin is created by `bootstrap.py` calling `hash_password` directly,
  not through the schema. Production already refuses to start on the published
  default, which is the case that matters; holding the seed to the full policy
  would be a sensible follow-up.
