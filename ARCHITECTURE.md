# UEP Architecture

Written for a competent engineer who has never seen this system. It explains the
domain in words before it explains any code, because almost every surprising
thing in this codebase is surprising only until you know what it is modelling.

Read this before changing behaviour. Several rules that look like bugs are
deliberate, and are marked where they appear.

---

## 1. The problem being solved

Iran's **Universal Service Obligation (USO)** programme requires rural villages
to be given telecommunications coverage. A programme office plans which villages
get connected, contractors build the sites, the network is tested, and the
regulator formally accepts the result.

UEP is the record of that process. Its job is to answer, at any moment:

- Which villages are we obliged to cover, and by which site?
- Is that site built and on the air?
- Does the network actually work there — and if not, whose problem is it?
- Has it been drive-tested?
- Has ICT accepted it? Has CRA accepted it? On what date?

That last question is why the system exists. **Acceptance dates carry
contractual consequences.** A date that is wrong by a day, or attributed to the
wrong person, is a commercial problem — which is why so much of this codebase is
about not losing or corrupting information.

### The vocabulary

| Term | Meaning |
|---|---|
| **CPM** | The master planning workbook, reissued monthly. The programme's source of truth for what exists. |
| **هدف** (*hadaf*) | "Target". A village that is genuinely part of the obligation. |
| **اقماری** (*eqmari*) | "Satellite". A village that is *not* part of the obligation. |
| **ICT** | Ministry of Information and Communications Technology — first acceptance authority. |
| **CRA** | Communications Regulatory Authority — second acceptance authority. |
| **Drive test (DT)** | Driving a route with measuring equipment to verify real-world coverage. |
| **Health check (HC)** | A per-site confirmation that each requested technology is working. |
| **On-air** | The site is live — launched either temporarily or permanently. |

---

## 2. The domain model

### Sites, villages, and work items

The three central tables, and the relationship between them is the thing to
understand first:

```
Province ──< Site ──< WorkItem ──< Village
                          │
                          ├──< HealthCheck / HcTask
                          ├──< Assignment
                          └──< DriveTest
```

- A **Site** is a physical installation. It has a site code, coordinates, and
  belongs to a province and a region.
- A **Village** is a settlement that a site serves. **One site usually serves
  several villages** — this is the normal case, not an edge case.
- A **WorkItem** sits between them, and is the unit almost everything else hangs
  off.

**Why a WorkItem exists at all**, which is the first thing that confuses people:
a single site can be built out in more than one *type* (`Macro`, `Micro`,
`Rooftop`), and each type is tracked separately through the whole lifecycle. So
the real unit of work is not the site, it is *(site, site type)*. That pair is
unique — enforced by the `uq_site_type` constraint — and it is what gets
assigned, health-checked, drive-tested and accepted.

**Acceptance is recorded per village, per technology.** A site serving four
villages with 2G, 3G and 4G produces twelve acceptance rows. That granularity is
required because ICT and CRA accept village-technology combinations, not sites.

### Where the numbers come from

Almost nothing is a stored counter. Dashboards compute from current state on
every request. `MonthlySnapshot` exists only to give month-over-month deltas a
fixed historical point to compare against — it is not the source of any current
figure.

---

## 3. The CPM import

An administrator uploads the monthly CPM workbook. This is the only way domain
data enters the system.

### How the file is read

- Sheet name: **`CPM`**
- Header row: the **third** row (index 2)
- **Columns are read by position, not by name** — the map lives in
  `app/services/cpm_columns.py`

Reading by position is deliberate. The Persian headers vary in spelling and
spacing between monthly issues; positions do not. If the layout ever genuinely
changes, `cpm_columns.py` is the single file to edit.

### The هدف filter — the most important rule in the system

The classification column carries six distinct values. **Only the bare `هدف` is
imported.** Everything else is counted and dropped:

| Value | Meaning | Imported? |
|---|---|---|
| `هدف` | Target | **Yes** |
| `اقماری` | Satellite | No |
| `اقماری جهت بررسی پوشش` | Satellite, for coverage review | No |
| `هدف (Verbally)` | Target, agreed only verbally | No |
| `هدف  (Removed Verbally)` | Removed, verbally *(note: two spaces, as in the real file)* | No |
| `اقماری (Removed Verbally)` | Satellite, removed verbally | No |

The two `(Verbally)` variants of `هدف` used to be stored. They were excluded from
every KPI anyway, so all they did was inflate village counts and produce
spurious change requests. They are now rejected at the door.

Matching is tolerant of Persian typography — Arabic versus Persian letter forms
(`ي`/`ی`, `ك`/`ک`), zero-width joiners, and repeated whitespace are all
normalised — so a plainly-typed `هدف` matches however it was entered, while
anything with a parenthetical suffix does not.

> **Do not "fix" this filter.** It is the definition of the programme's scope.
> The count of skipped rows is recorded on every import batch, so nothing is
> silently lost.

### First import versus every import after

**The first import seeds.** Everything is created directly.

**Every later import validates.** Changes to significant fields are *not*
applied. They are recorded as `CpmChangeRequest` rows, and an Admin or PM
decides on each one. The fields that behave this way are the village count for a
site, the site type, and the requested technology.

This exists because the CPM workbook is edited by many hands, and an accidental
edit that silently changed a site's technology would invalidate its health check
and its acceptance. So the file proposes; a person disposes.

**One category of data is re-applied on every import without asking:** the
ICT/CRA acceptance columns. This is intentional — it lets the acceptance record
be maintained by editing the workbook. A blank cell is ignored rather than
treated as a value, so an empty cell can never downgrade an approval that is
already recorded.

### The drive-test columns are seeded once, then owned by the app

Columns AV–AZ (contractor, status, problem category, assignment, date) are read
from the file on the **first** import only. After that the application owns them,
because they change through the app's own workflow. A later CPM file cannot
overwrite a drive-test result recorded in UEP.

---

## 4. The health check lifecycle

This is the most intricate part of the system, and the part most worth
understanding before touching anything.

### The shape of it

```
        ┌────────────────────────────────────────────────┐
        │                   BASKET                       │
        │   on-air sites that need a health check        │
        └────────────────────────┬───────────────────────┘
                                 │  Coordinator or PM assigns
                                 │  a batch to a subcontractor
                                 ▼
                          HcAssignment
                                 │
                                 │  one HcTask per site
                                 ▼
   Stage 1  ─────────────────────────────────────────────────
   The subcontractor marks each requested technology
   Normal or NotNormal.  NotNormal requires a comment.
   Result computed:  all Normal → Ready,  any NotNormal → NotReady
                                 │
                                 ▼
   Stage 2  ─────────────────────────────────────────────────
   A Coordinator or PM validates the result.
        Ready     → needs no category.  Site leaves the loop.
        NotReady  → MUST be given one of four problem categories.
                                 │
                                 ▼
                          HcRemediation
                one owned fix, with a role and a deadline
                                 │
                                 │  the owning team does the work
                                 │  and closes the fix
                                 ▼
              all fixes closed → site returns to the BASKET
                        at round_no + 1
```

### Stage 1 and stage 2 do different jobs

The separation is the point, and it is a rule about accountability:

- **The subcontractor reports what they observed.** They may say a technology is
  not working, and must explain why in a comment. **They may not assign a problem
  category** — that would let the party being measured decide who is to blame.
- **The Coordinator or PM decides what it means.** They validate the result, and
  for a failure they choose the category, which determines the team that owns
  the fix.

A `NotReady` site cannot be validated without a category. That is enforced, not
conventional: it is what stops a failure from sitting unowned.

### The four problem categories

Each has an owning role and a service level:

| Category | Owning role | SLA |
|---|---|---|
| Temporary Power | CPG Power | 7 days |
| Project Responsibility | CPG Rollout PM (On-Site) | 7 days |
| MS Responsibility | Managed Service | 10 days |
| NWG Responsibility | NWG Planning | 14 days |

These are **seeded as data, not written into code**. An Admin can add a category,
point it at a role, and set its SLA, and the queue appears for that role with no
release required. Permission checks ask `Role.is_category_owner` rather than
comparing against a list of names, which is what makes a fifth category possible
without touching the code.

Seeding only fills in what is missing. If an Admin re-points a category at a
different role, that choice survives every restart.

### Re-routing

A team given a fix that is not theirs can **propose** moving it to a different
category. They cannot move it themselves. A PM or Admin approves or rejects the
proposal.

This is a deliberate friction. Letting owners reassign their own work freely
turns the queue into a hot potato and destroys the SLA record.

### The loop closes itself

Nobody re-adds a site to the basket by hand. A site is withheld from the basket
while:

- it is inside an open health-check task, **or**
- its last check was `NotReady` and no PM has triaged it yet — the PM owes a
  decision, and it is visible in HC Results, **or**
- any resulting fix is still open — an owner owes the work, and it is visible in
  their Fix Queue.

When the last fix closes, the site reappears in the basket at the next round
number, carrying a summary of why it came back. A site that passes leaves the
loop permanently.

**Round 3 and beyond is treated as an exception** and surfaced to the PM — a site
failing three times means something is wrong that the loop is not fixing.

### What is eligible for the basket

A site enters the basket when it is **on-air** and its drive test is not already
done or in progress:

- On-air means the last completed stage is `راه_اندازی_موقت` (temporary launch)
  or `راه_اندازی_دائم` (permanent launch). Anything else — `طراحی` (design), for
  instance — is not.
- Drive-test status `Done` or `Ongoing` excludes the site. Only sites still
  awaiting a drive test (blank or `Problematic`) are eligible.

---

## 5. Drive test and acceptance

### Drive test

A PM assigns a work item to a drive-test contractor. The contractor either
submits a result or returns it to the coordinator with a reason. A submitted
result is reviewed by a Coordinator.

Work-item stages through this flow: `New` → `Ready for Assignment` → `Assigned`
→ `DT Submitted` → `Coordinator Approved`, with `Returned by Contractor` and
`Problematic` as branches. The current stage is **computed** from the underlying
records rather than stored as a field that could drift out of step with them.

### Acceptance

Acceptance is the approval of finished drive-test work, so a site whose drive
test is not Done cannot be submitted at all. It is recorded per village and per
technology, by two independent authorities:

```
Village + Technology
        │
        ├── ICT status:  Pending → Approved / Rejected   (+ date, letter, comment)
        │
        └── CRA status:  Pending → Approved / Rejected   (+ date, letter, comment)
```

ICT (the province office) and CRA (the region office) are separate authorities
and are tracked separately. A village-technology can be ICT-approved and still
awaiting CRA. Only these two stages are recorded today; the upstream ones
(ICT HQ, CRA Setad) are deliberately left out until they are needed, and
`authority` is stored as a value rather than a column so adding them later is a
data change, not a migration.

#### How a verdict is reached

Nothing a contractor types reaches the `acceptances` table directly. A
submission is a *claim*; a coordinator or PM turns it into a *fact*:

```
contractor or coordinator          coordinator or PM
        submits              →         validates            →   acceptances
  (letter + per-tech verdicts                                    (the record)
   + scanned evidence)              or returns it
                                    with a reason  →  submitter files round 2
```

Every round is kept. A village rejected, fixed and re-submitted has both rounds
on the record, with who decided each and why — `acceptance_submissions`,
`acceptance_submission_techs` and `acceptance_evidence` hold that history, and
the status the dashboard counts is derived from it rather than typed over it.

#### Two surfaces: reading and doing

Acceptance is read by one set of people and worked by another, so it is two
screens rather than one page of tabs:

```
Reports
  ├─ DT Dashboard          how far the drive-test programme has got
  └─ Acceptance Dashboard  where ICT and CRA approval stands, by province

My Work                    where letters are actually filed and validated
```

**Reports → Acceptance Dashboard** (`/reports/acceptance`, served by
`/acceptance/overview` and `acceptance_analytics.py`) is the read surface. It
computes from current state on every request and writes nothing.

**My Work** (`/my-work`) is the work surface. Its left pane is a queue of
villages, its right pane is one village and the one thing to do about it. The
same screen serves a contractor and a coordinator — only the buckets and the
form differ, because a submitter filling in a letter and a reviewer reading it
back are two sides of one object, and a coordinator does both jobs in the same
afternoon.

The queue groups villages into four buckets, which **partition** the list (a
village is in exactly one, so the chip counts sum to the total):

| Bucket | What it means | Whose move |
|---|---|---|
| Closed | ICT and CRA both approved | nobody's |
| Needs attention | either authority Returned or Rejected | the submitter's |
| Awaiting review | a submission is waiting on a PM or coordinator | the reviewer's |
| Ready to file | drive test done, nothing in flight, not closed | the submitter's |

They are evaluated in that order, so a village whose ICT was returned while CRA
is awaiting review counts as needing attention: the contractor has to move
before anyone else can.

#### Where a village stands, and the cache underneath it

`villages.ict_status` and `cra_status` hold one of **Approved / Rejected /
Returned / Pending / NotFiled** per authority. That is a wider vocabulary than
the three verdicts, deliberately: a verdict answers *what has been decided*, and
the queue has to answer *whose move is it*. A village rejected by ICT and
already re-filed has the same verdict as one nobody has touched since the
rejection, but only the second is work for the contractor.

**Both columns are a cache, not a fact.** The truth is derived from
`acceptances` and `acceptance_submissions` by
`acceptance_workflow.authority_status()`; the columns exist only so the queue
can filter, group, sort and count in SQL rather than loading four hundred
acceptance graphs to answer "how many need attention". They are written through
in the same transaction as every state change that could alter them — including
the two paths that change an acceptance without a submission behind it (a
coordinator's per-technology correction, and a stale acceptance cell in a CPM
re-import). If they are ever suspected of drift, the fix is to recompute them
from the submissions, never to read them as the record.

A village rolls up from its two authorities the same way a site rolls up from
its villages: **Closed** when both are approved, **Partial** when one is, **Open**
when neither is.

#### The three rules that look wrong and are not

1. **Only the technologies CPM requested may be answered.** A 3G/4G site never
   shows a 2G box, and the server refuses one if it arrives anyway.
2. **One rejected technology rejects the whole village.** A village approved for
   3G and rejected for 4G is a rejected village, not a partly approved one.
3. **A village is finished only when ICT *and* CRA have both approved every
   requested technology.** ICT alone is not acceptance.

A site rolls up from its villages: **Closed** when all are approved,
**Partial** when some are, **Open** when none are.

> **Acceptance counting does not deduplicate.** Every site/village row is
> counted. This looks like a bug and is not — the obligation is per village, so
> two villages served by one site are two acceptances. Do not "optimise" this.

#### Letters, evidence, and dates

Submission is per village, even though one ICT letter routinely covers a
hundred villages — the letter number is a field on each submission rather than a
shared entity, because each village is judged on its own.

Filing them one at a time is still a hundred identical forms, so
`POST /acceptance/submissions/bulk` takes the letter, the verdicts and the scan
once and writes one submission per village. It is all-or-nothing: every village
goes through the same `flow.submit()` the single-village endpoint calls, and if
any of them fails its rules the whole transaction rolls back and the response
names which ones failed and why. A partly-filed batch would leave the submitter
with no way to tell which villages went in.

Evidence is **content-addressed**: a file is stored under the SHA-256 of its
contents, so that one letter scanned once and attached to a hundred villages is
one file on disk and a hundred rows. The corollary is that deleting an evidence
row must never delete the file. Uploads are type-checked by magic bytes, not by
extension.

Letter dates are entered and displayed in Shamsi and stored Gregorian; the
conversion lives only in `core/jalali.py`, never in the browser.

#### The CPM workbook is no longer the source of acceptance

The several thousand historical verdicts were seeded from the workbook's
acceptance columns on the first import. From this release the app is the system
of record and the monthly file carries no acceptance data, so those columns are
blank and the importer does nothing with them. Should a stale cell ever appear
in a future file, `acceptances.ict_source` / `cra_source` mark verdicts decided
in the app and the importer will not overwrite them.

---

## 6. Roles and permissions

Ten roles. Six are staff and workflow roles; four exist solely to own health-check
problem categories.

| Role | Internal name | What it is for |
|---|---|---|
| Administrator | `Admin` | Users, CPM import, system configuration |
| Project Manager | `PM` | Runs the operational workflow |
| Coordinator | `Coordinator` | Assigns health checks, reviews drive tests |
| Regional Manager | `RegionalManager` | Regional oversight, read-only |
| Contractor | `Contractor` | Subcontractor doing the field work |
| Viewer | `Viewer` | Read-only |
| CPG Power | `CpgPower` | Owns Temporary Power fixes |
| CPG Rollout PM | `CpgRolloutPM` | Owns Project Responsibility fixes |
| Managed Service | `ManagedService` | Owns MS Responsibility fixes |
| NWG Planning | `NwgPlanning` | Owns NWG Responsibility fixes |

### The Admin / PM separation of duties

**This is the single most important permission rule, and the one most likely to
be broken by accident.**

Admin is a *systems* role. PM is an *operational* role. Admin deliberately
**cannot** perform operational actions:

| Action | Admin | PM | Coordinator |
|---|---|---|---|
| Import CPM | **Yes** | No | No |
| Manage users | **Yes** | No | No |
| Wipe CPM data | **Yes** | No | No |
| View audit log | **Yes** | No | No |
| Assign a health check | **No** | Yes | Yes |
| Submit a health-check result | **No** | Yes | No (contractor does) |
| Review a health-check result | **No** | Yes | Yes |
| Assign a work item | **No** | Yes | No |
| Review a drive test | **No** | No | Yes |
| Submit an acceptance letter | **No** | Yes | Yes (contractor too) |
| Validate an acceptance submission | **No** | Yes | Yes |
| Decide a CPM change request | Yes | Yes | No |
| View baskets, results, reports | Yes | Yes | Yes |

The reason is auditability. Whoever controls user accounts should not also be
able to record operational results — otherwise one account can both perform an
action and alter who appears to have performed it.

> If you are writing a test and an admin token gets a `403`, the test is
> probably wrong, not the permission. Several tests in this repository had that
> exact defect for months.

### Row-level visibility

Beyond roles, every work-item query is filtered by who is asking. There are three
distinct models and they are never mixed:

1. **Category owners** see a site because a fix is routed to *their role*. Not by
   geography, not by contract.
2. **Contractors** see a site because they are its drive-test subcontractor or
   hold an assignment for it. Province grants do not apply to them — a
   contractor is defined by what is assigned to them. They keep seeing sites
   they have *ever* held, so their history does not silently empty out.
3. **Staff roles** see sites in the provinces they have been granted, unless
   they are marked as seeing all provinces (typically Admin and PM).

All of this lives in one function, `apply_work_item_scope` in
`app/services/visibility.py`, and every list, dashboard and report goes through
it. **Never write a work-item query that bypasses it** — that is how a data leak
between contractors would happen.

### User management

A user is a first name, a family name, an email address, a username and an
Argon2id password hash. `full_name` is derived from the two name fields rather
than stored, so the ~20 places that display a name did not have to change when
one column became two.

**Passwords.** Argon2id, at OWASP's recommended cost. bcrypt hashes written
before the switch still verify and are rewritten as Argon2id the next time
their owner signs in, so the old format drains away without a mass reset —
which also means raising the cost parameters later is a one-line change with no
migration. Nothing anywhere returns a password or a hash. The policy is length
plus a common-password blocklist, deliberately *not* character classes; see the
docstring in `app/core/passwords.py` for why.

**Three ways a password changes**, and they are separate on purpose:

| Route | Who | Effect |
|---|---|---|
| `POST /auth/me/password` | the account holder | needs the current password; ends every other session |
| `POST /admin/users/{id}/reset-password` | an administrator | returns a temporary password once; ends every session; sets `must_change_password` |
| `POST /auth/password-reset-request` | anyone, signed out | records a request. Grants nothing |

Setting a password used to be a field on the general user edit. It is not any
more, because that made a credential reset and "fix the spelling of their
surname" the same call — and indistinguishable in the audit log afterwards.
`UserUpdate` sets `extra="forbid"` so an old client sending `password` gets a
422 rather than a 200 that silently did nothing.

`must_change_password` is enforced in `get_current_user`: while it is set the
account may call `/auth/me`, `/auth/me/password` and `/auth/logout`, and
nothing else. The 403 carries a machine-readable `code` so the frontend routes
to the change-password screen instead of showing a permission error.

**There is no outbound mail**, which is why "I forgot my password" is a request
an administrator actions rather than a link. Building the usual flow would mean
an SMTP server, a token table and an unauthenticated endpoint that mints
credentials — the largest new attack surface in the system, for a few dozen
internal users who all know their administrator. The request endpoint answers
identically whether or not the account exists, because it is reachable by
anyone who can load the sign-in page.

### The audit log

`audit_logs` is append-only. Nothing in the application updates or deletes a
row, and no endpoint exposes a way to: `GET /admin/audit-logs` and
`GET /admin/users/{id}/audit-logs` are the only routes, both Admin-only. A
record the platform can revise on request is not evidence of anything.

Each row carries who, what (`action`), which record (`module`, `entity_type`,
`entity_id`), when, from where (`ip_address`), the before and after values, and
whether it worked (`result`).

`action` comes from a closed vocabulary in `app/core/audit_actions.py`. Before
it existed the verb was *inferred by the frontend* from the shape of
`new_value` and the wording of a free-text `reason` — so nothing could be
filtered or counted by it, and any event nobody had written a branch for was
described wrongly, confidently, in a table that looks authoritative. Every
`record_audit` call site now names its action; the parameter has no default,
which is what forces each new one to decide.

`result` exists so the log can hold what *failed*. Authentication failures are
written through `record_audit_now`, which commits independently of the request
— an ordinary `record_audit` would leave the row pending in a session that is
about to raise a 401 and never commit, so the log would hold every successful
sign-in and no refused one, which is precisely backwards.

Recorded events: sign-in (success and failure, including against a username
that does not exist), sign-out, password change, password reset, reset request,
user created / updated / activated / deactivated / suspended / reactivated /
role changed — and every operational action across the rest of the portal.

---

## 7. Dates: Jalali and Gregorian

Iran uses the Jalali (Shamsi) calendar. The CPM workbook carries both, and users
expect to see Jalali.

The rule: **store Gregorian, display Jalali.** Conversion lives in
`app/core/jalali.py`. Reporting periods are Shamsi months, so monthly snapshots
are keyed by Shamsi year and month.

Timestamps are stored as `timestamptz` and written in UTC. Two columns were
historically stored without a timezone; the migration that corrected them
measured which clock the existing values were on rather than assuming — see
`MIGRATION-RUNBOOK.md`.

---

## 8. How the code is arranged

```
backend/app/
  api/         HTTP layer: routing, permission dependencies, request/response
  core/        config, database, security, permission helpers, logging,
               account statuses (user_status.py) and audit verbs (audit_actions.py)
  models/      SQLAlchemy tables
  schemas/     Pydantic request/response shapes
  services/    the business rules
```

**The rules live in `services/`.** `api/` is a thin layer that checks permissions
and calls into them. The frontend contains no rules at all — it shows what the
backend permits, and every check is repeated server-side.

Services worth knowing:

| Module | Responsibility |
|---|---|
| `cpm_import.py` | Reading the workbook, the هدف filter, raising change requests |
| `cpm_columns.py` | Column positions, Persian normalisation, the canonical 31 provinces |
| `health_check.py` | The basket, assignments, results, the remediation loop |
| `visibility.py` | Row-level scoping — the single source of truth |
| `acceptance_analytics.py` | ICT/CRA reporting (the Acceptance Dashboard) |
| `acceptance_workflow.py` | Acceptance submission, review, the derived verdicts and the queue-status cache |
| `evidence_store.py` | Content-addressed storage for scanned letters |
| `workflow.py` | Work-item stage transitions |
| `audit.py` | Audit entries and notifications |

### Two structural decisions

**Alembic owns the schema, alone.** The application used to create and alter
tables at startup through three competing mechanisms that disagreed with each
other. All three are gone. Migrations run at deploy time via `entrypoint.sh`,
before the application starts, so a failed migration stops the deploy instead of
going live half-applied. The application only seeds reference data.

**Nothing is deleted.** Users move between `Active`, `Inactive` and `Suspended`
and are never removed, because they are referenced by audit entries and
health-check reviews. Work items are soft-deleted. Over a ten-year life with
normal staff turnover, deletion would turn the accountability trail anonymous
exactly where it matters most.

There are three statuses rather than a boolean because an administrator needs
to answer two questions, not one: whether the account is in use, and *why* it
is not. "Left the company" and "locked pending an investigation" were the same
row when this was `active = false`, and the difference is exactly what someone
reading the trail a year later needs. See `app/core/user_status.py`.

---

## 9. If you are about to change something

Some rules in this system look wrong until you know why they exist. Before
changing any of these, check `FINDINGS.md` and re-read the relevant section
above:

- The **هدف filter** rejecting the `(Verbally)` variants — deliberate.
- **Acceptance counting without deduplication** — deliberate; the obligation is
  per village.
- **Admin being forbidden** from operational actions — deliberate separation of
  duties.
- **Subcontractors not choosing a problem category** — deliberate; the party
  being measured does not assign blame.
- **Sites withheld from the basket** while untriaged or unfixed — deliberate;
  it is what makes the loop close itself.
- **CPM re-import proposing rather than applying** changes — deliberate.
- **No password field on the general user edit** — deliberate; a credential
  reset and a corrected surname must be distinguishable in the audit log.
- **The password reset request granting nothing**, and answering the same for a
  username that does not exist — deliberate; that endpoint is reachable by
  anyone who can load the sign-in page.
- **No character-class rule** in the password policy — deliberate, and the
  reason is in `app/core/passwords.py`. Adding one measurably moves people
  towards `Password1!`.
- **bcrypt still being verifiable** after the move to Argon2id — deliberate;
  removing it locks out every user at once.
- **No route that deletes a user** — deliberate; see "Nothing is deleted" above.

The backend tests cover all of these. If a change breaks one, the test is
probably right.
