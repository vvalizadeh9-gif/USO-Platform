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

### The site contractor is a master field

Column 31 (پیمانکار اجرایی سایت) is stored as `work_items.site_contractor_id`
(UEP-11), resolved with the same contractor-name matching as the DT
contractor (`CpmImportService._contractor`). Unlike column AV it is a master
field: every import sets it again. A blank cell leaves it alone, because a
site's rows repeat once per village and one blank row must not clear what
another set. Raw rows of earlier imports are not kept, so existing work items
pick it up on the next import.

### Erasing CPM data

Admin Console → CPM Import → *Erase all CPM data* (`POST
/admin/cpm/wipe-data`, Admin only, exact confirmation phrase) deletes
everything derived from CPM so a fresh import can seed from scratch: sites,
work items, villages, acceptances and submissions, letters, health checks and
drive tests with their evidence, **Mojri tracker statuses and import runs**
(village ids are regenerated by the next import, so a surviving status would
attach to the wrong village), import history and monthly snapshots. Users,
roles, contractors, provinces, regions, problem categories, monthly plans and
the audit log are kept.

Every wiped table is listed once, children before parents, in
`data_wipe.WIPE_ORDER`; the deletes are explicit rather than left to `ON DELETE
CASCADE`. Twice a new table referencing CPM data shipped without a line there
and the wipe failed its FK check on PostgreSQL, so `tests/test_data_wipe.py`
now holds `WIPE_ORDER` to the schema: it walks `Base.metadata` and fails if a
table with a foreign-key path to `sites` / `work_items` / `villages` is
missing, or if a table is deleted after one it references. Adding such a table
means adding it to `WIPE_ORDER`.

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

Nobody re-adds a site to the pool by hand, and nobody removes one either. A
site's place in the loop is reported on its row (`hc_state`) rather than
deciding whether the row exists:

| `hc_state` | What it means | Assignable |
|---|---|---|
| `New` | Never health-checked | yes |
| `In health check` | Inside an open task, out with a subcontractor | **no** |
| `Awaiting triage` | Failed, and no PM has categorised it yet | yes |
| `Fix in progress` | At least one resulting fix is still open | yes |
| `Ready for re-check` | Every fix closed; back for the next round | yes |
| `Health check passed` | Passed, and waiting on its drive test | yes |

Only an open check blocks a new assignment, because that is the one case
`create_assignment` refuses (409). The rest are judgements a Coordinator is
allowed to make, so the screen states them and lets them decide.

When the last fix closes, the site reads `Ready for re-check` at the next round
number, carrying a summary of why it came back. A site that passes stays in the
pool — it is still on-air and still owes a drive test — but reads
`Health check passed`.

**Round 3 and beyond is treated as an exception** and surfaced to the PM — a site
failing three times means something is wrong that the loop is not fixing.

### What is in the pool

The pool is **every on-air site whose drive test is not `Done`**. That is the
whole definition, and the pool quantity is the length of that list:

- On-air means the last completed stage is `راه_اندازی_موقت` (temporary launch)
  or `راه_اندازی_دائم` (permanent launch). Anything else — `طراحی` (design), for
  instance — is not.
- A drive-test status of `Done` excludes the site, and nothing else does.
  `Ongoing`, `Problematic` and blank all stay.

`Ongoing` used to exclude a site too, on the reading that a site already with a
drive-test contractor was somebody else's problem. That made the figure smaller
than the thing it is labelled with by however many sites the last import marked
`Ongoing`. The nav badge uses `pool_assignable` instead (what a PM can act on
now), and the Action Center's "Assign sites" ticket counts the pool's
"Ready to assign" filter (never checked, or due a re-check), because those
two ask "what needs me", not "how much is there".

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

### The four states on the Drive Test dashboard

Every on-air site is in exactly one of these, and each one is read off the DT
status column through the same normaliser (`services/drive_test_analytics.py`,
which the drill-through site list imports rather than re-implementing):

| State | Definition |
|---|---|
| **DT Done** | `dt_status == 'Done'` |
| **Ongoing** | `dt_status == 'Ongoing'` — a drive test under way |
| **Problematic** | `dt_status == 'Problematic'`, **or** the in-app health check flagged it (`current_stage == 'Problematic'`); wins where both apply |
| **Not started** | none of the above — in practice a blank DT status |

**Remaining** stays on-air minus done, and is the sum of the other three.

The one case where a site lands in two of them is a CPM `Done` status sitting
over an in-app Not-Ready health check. That predates this split and is what
`MonthlySnapshot.flow_ongoing_adjustment` exists to keep visible rather than
absorb.

Ongoing used to be defined by negation — "not Done and not Problematic" —
which swept every on-air site with a *blank* DT status into it. A blank column
is a drive test nobody has started, not one in flight, so the card, the
contractor scorecard and every ongoing breakdown reported the untouched
backlog as work in progress. `Not started` is that population, named.

One consequence worth knowing: nothing in the platform writes `Ongoing`. The
column is seeded by the CPM import and only ever written to `Done` again, by
drive-test approval. So a site assigned to a contractor **inside the app**
stays `Not started` until an import says otherwise.

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
contractor's filing is a *claim*; a coordinator or PM turns it into a *fact*:

```
contractor                        coordinator or PM
   files a letter    →    confirms           →   acceptances
  (per-tech results        or returns it            (the record)
   + scanned letter)       with a reason  →  contractor files round 2

coordinator or PM
   saves a letter    →   recorded decided at once   →   acceptances
  (a letter they received themselves; reviewed_by = them, audited)
```

The second path is the one sanctioned exception to "someone else agrees"
(`acceptance_workflow.record_decided`, see §6): a coordinator or PM entering
a letter the office sent *them* has no one else to confirm it, and the letter
is the evidence. It never lets anyone confirm their own *pending* filing --
`review()` still refuses that.

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
`/acceptance/overview` and `/acceptance/progress`) is the read surface. It
computes from current state on every request and writes nothing. See
"The Acceptance Dashboard" below.

**My Work** (`/my-work`) is the work surface; see "My Work" below.

#### The Acceptance Dashboard

The page answers two questions for a PM: *am I on plan month by month, and
what happened in a given month?* It has one tab per **stream**:

| Tab (`?tab=`) | Counts | Plan stream |
|---|---|---|
| Fully accepted (`village`) | villages **fully accepted** (ICT and CRA both approved) | `ACCEPTANCE` |
| ICT (`ict`) | villages approved by ICT, whatever CRA has said | `ICT` |
| CRA (`cra`) | villages approved by CRA, whatever ICT has said | `CRA` |

Since UEP-07 the page is the **Acceptance app's first rail page** (Dashboard,
with a divider, like Drive test's) as well as Insights → Acceptance dashboard,
and wears the Drive test dashboard's look (`.dt-page acc-page`). All data is
the accent on every tab; ICT and CRA show only an 8px authority dot on their
tab. Each tab is a KPI strip (four equal tiles), one Shamsi year's chart
(`?year=`, Farvardin to Esfand, with the year plan track) and the PIP card for
one month (`?month=`). Two reads feed the whole page, and each card loads,
fails and retries on its own:

- `GET /acceptance/overview` -- the KPI band. Unchanged apart from an
  optional `province_id`, so the page-wide scope picker narrows the band and
  the chart alike.
- `GET /acceptance/progress?year=1405&province_id&contractor_id` -- the chart
  and the PIP card, **all three streams at once**, so a tab switch never
  refetches (`services/acceptance_progress.py`, response
  `schemas.AcceptanceProgress`). With `year`, that Shamsi year's twelve
  months; a month after the running one carries its plans, `approved` and
  `approved_cumulative` `null`, and `is_future: true`. `years` lists every
  year with a dated approval or a plan the caller may see, plus the current
  year, newest first (the year dropdown). Without `year` the window is the
  last `months` months, as before (the export and older callers). `GET /acceptance/progress/export` is the
  same payload as a workbook, one sheet per stream.

**Two plans, and what they are called.** The **Internal PIP** is the PM's own
monthly number for the team (`AcceptanceMonthlyTarget`, set on Monthly Plan,
formerly "MTN internal target"). The **Contractor PIP** is the contractors'
approved PIPs in force (`ContractorMonthlyPlan`): every contractor's summed,
or one contractor's when the page is narrowed to it. A contractor reads its
own as "Your PIP" and never sees the Internal PIP.

**The progress payload's rules.**

- `approved` is the villages that cleared the stream in that Shamsi month,
  attributed by `acceptance_plan.approval_period` -- the one month rule the
  older trend and the scorecards use too (the authority's verdict date; for
  Village the later of the two).
- **Undated approvals are an opening balance.** A village approved without a
  verdict date has no month. It is counted in every month's
  `approved_cumulative` from the first month of the window, and in no month's
  `approved`. That is what makes the last month's running total equal the
  overview's approved figure (`villages_both_approved`, `total_ict_approval`,
  `total_cra_approval`) for the same scope -- a test holds it.
- Plans are monthly amounts. **Every plan field is `null`, never 0**, when no
  plan exists for that month and stream; all of them when the page is
  narrowed to a province (`plans_available: false`, plans are programme-wide);
  and the `internal_*` pair for a contractor, or staff narrowed to one
  contractor (`internal_visible: false`). A contractor's `contractor_id` is
  always its own company, whatever it sends.
- Cumulative plans are anchored on actuals (`acceptance_plan.cumulative_plan`):
  what was actually approved before the first planned month, plus each
  month's plan. They are `null` wherever the monthly plan is.
- The universe is the overview's: `acceptance_plan.load_scoped_villages`,
  DT done and pure هدف, loaded once and bucketed for all three streams in one
  pass -- no per-month queries.

The PIP card's and the year track's arithmetic (due by today, pace, what is
left, per day) is in
`pages/reports/acceptance/model.js`, from the server's `today` (day of month
and its length -- the browser does no calendar arithmetic).

Every figure opens the sites behind it. `GET /acceptance/sites` takes an
optional `authority=ICT|CRA`, which gives the approved, remaining, rejected and
waiting (`remained`) metrics that authority's reading, so the ICT and CRA
cards open lists that add up to exactly their figures.

Not on this page, on purpose: per-owner and per-contractor performance (Roles
Performance), and every breakdown the old page carried (see CHANGELOG.md).

`GET /acceptance/trends` is **deprecated**: nothing in this codebase reads it
since the dashboard moved to `/progress`. It is kept for any outside reader.

#### Plan streams: DT, ACCEPTANCE, ICT, CRA

`ContractorMonthlyPlan` (a contractor's PIP) and `AcceptanceMonthlyTarget`
(the Internal PIP) share one set of streams, `models/monthly_plan.PLAN_STREAMS`:
`DT` (drive tests), `ACCEPTANCE` (villages fully accepted), `ICT` and `CRA`
(villages approved by that authority). `stream` is a plain `VARCHAR(20)` on
both tables with no CHECK constraint or enum, so adding `ICT` and `CRA` needed
no migration -- the validators are the tuple and the `PlanStream` request type.
Existing rows are untouched and there is no backfill: months before the new
streams simply have no ICT or CRA plan. Versioning (`version`, `is_current`,
append on every change) is identical for every stream.

On Monthly Plan the PM sets an Internal PIP per stream (the Internal PIP
tab, see §5h), and a contractor files all four PIPs on one form, each
decided, returned and revised on its own. The deadline and "not submitted"
chips, the Action Center items and the export (one sheet per stream) cover
all four. Only the PM sets an Internal PIP; a contractor never reads one.

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

#### Every number opens the list it counted

The Acceptance Dashboard counts its own universe -- DT done and هدف, whether
or not the site is on air. A figure that links into My Work passes
`scope=universe`, so the list holds exactly the villages the figure counted;
the sidebar opens `scope=remaining` (§ My Work). Under `scope=universe` an
**All** tab appears for every role, because a fully approved village is in no
other tab. The Action Center's ICT and CRA tickets each link to one tab
narrowed to one authority, for example `/my-work?authority=ICT&tab=not_filed`
(§ 5e).

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
`POST /acceptance/letters` takes one authority, one letter number, one date and
one scan for 1-500 villages, each with its own per-technology claims, and
writes one round per village (`services/acceptance_letters.py`). It is
all-or-nothing: every village goes through `flow.submit()` (or
`record_decided()`), every failure is collected, and if there is any the
transaction rolls back and the response names each village and field that
failed. A partly-filed letter would leave the submitter with no way to tell
which villages went in. The villages are row-locked in id order first, so two
letters filed at once cannot both take the same round number.

The scan is uploaded once, before the letter, by `POST /acceptance/scans`,
which stores the file and returns a signed `scan_id`
(`services/scan_tokens.py`: HMAC over the stored file's facts, valid 24
hours, usable only by its uploader). Nothing is written to the database until
the letter is filed; an upload that is never used leaves one content-addressed
blob behind.

Evidence is **content-addressed**: a file is stored under the SHA-256 of its
contents, so that one letter scanned once and attached to a hundred villages is
one file on disk and a hundred rows. The corollary is that deleting an evidence
row must never delete the file. Uploads are type-checked by magic bytes, not by
extension.

Letter dates are entered and displayed in Shamsi and stored Gregorian; the
conversion lives only in `core/jalali.py`, never in the browser.

#### My Work

`/my-work`, the acceptance work surface. The API contract is
`docs/design/my-work-api.md`; this is how it is put together.

**Who sees which villages.** Rows are villages, never sites. Two scopes, each
a Python rule with a SQL twin held to it by a test (`services/my_work_scope.py`):

| Scope | Villages | Opened from |
|---|---|---|
| `remaining` (default) | DT done, **on air**, هدف, ICT or CRA not approved | the sidebar |
| `universe` | the Acceptance Dashboard's universe: DT done, هدف | a dashboard figure |

On air is `cpm_columns.is_onair_stage`, applied in SQL as `kpi.onair_values`
does -- the distinct `last_stage` values are read and the Python rule picks
them -- so the two cannot drift. Row visibility is `apply_work_item_scope`
underneath: a contractor sees their own villages, a coordinator their granted
provinces, a PM everything. Admin is refused (it does no operational work);
Regional Manager and Viewer get the coordinator view, read-only.

**One vocabulary** (`services/my_work_status.py`). Each village has two
independent sides, ICT and CRA, each in one of five statuses, read from the
cached `villages.ict_status` / `cra_status` (which keep their stored words):

| Status | Stored | Whose move |
|---|---|---|
| waiting | `NotFiled` | contractor |
| filled | `Pending` | coordinator / PM |
| returned | `Returned` | contractor |
| rejected | `Rejected` | contractor |
| approved | `Approved` | nobody |

The tabs are one table there, from which both the Python check and the SQL
predicate are built: **New letter needed** = any side rejected; else
**Returned** = any side returned; else **Not filed** = any side waiting;
**Your move** = those three together; **With coordinator / To check** = any
side filled. They are **not** a partition: a village with ICT filled and CRA
waiting is in both. The browser never derives a tab; the server sends each
row's side statuses and the counts. `pages/mywork/statusVocabulary.json` holds
only labels and tones, and a backend test holds its keys to the server's.

**One query** (`services/my_work_query.py`). `base_select` is the whole
population (visibility, scope, search). The rows are it plus the tab
predicate; the tab counts and the PageBar totals are `count(*) FILTER` over
the very same select. The sidebar badge is `GET /my-work?limit=0` -- the
first tab's count, "Your move" or "To check" -- so a badge, a tab and its list
can never disagree. Pagination is an opaque cursor bound to its filters.

**Rounds and carry-over** (`services/acceptance_rounds.py`). Every filing is
a round per village per authority, numbered 1, 2, 3, and never changed once
decided. A returned or rejected side is filed again as the next round. When
a round was partly rejected, the next one claims **only the technologies
still to file** (`acceptance_workflow.techs_to_file`, read from the
`acceptances` projection so a seeded approval counts too); the approved ones
carry over with their original approval and date. Claiming a carried tech
again is refused (`tech_carried`).

**Filing and deciding.** ICT and CRA are filed and sent separately -- one
authority per request, and nothing in the path touches the other side. A
contractor's letter creates pending rounds; a coordinator's or PM's is
recorded decided (`record_decided`). A coordinator or PM decides a contractor's
pending round with `POST /letters/review`: Confirm (approved if every claim
was, otherwise rejected with the contractor's reasons), Return (a reason is
required and is shown to the contractor), or Confirm all on the letter -- the
pending rounds on the same authority and letter number in the viewer's scope,
not filed by the viewer (`confirmable_on_letter`, which is also what the
"Confirm all N" count is read from). An approved side is locked here;
corrections go through an admin path.

**Undo** holds every send and decision in the browser for six seconds
(`pages/mywork/useDeferredSend.js`) and sends it only then; Undo simply never
sends. Nothing decided ever has to be rolled back. A held send is never
dropped: closing the tab sends it at once with `fetch(..., { keepalive })`,
and leaving the page or dismissing the toast sends it immediately. While a
send is held the row and card show the outcome it will have.

**Digits.** Shamsi dates and letter numbers are shown in Persian digits and
stored, validated and sent in Latin ones. `core/digits.py` and
`lib/persianDigits.js` are the two readers and share their test vectors
(`lib/digitVectors.json`); the server normalises again, because "Confirm all
on this letter" matches on the letter number.

**Retired.** The old workspace's endpoints (`GET /villages`,
`/villages/bucket-counts`, `POST /villages/{id}/submissions`,
`/submissions/bulk`, the per-submission update, withdraw, review and evidence
routes) answer with `Deprecation: true` for one release and are then removed.
`GET /villages/{id}` keeps its old fields beside the new ones for the same
release.

#### The CPM workbook is no longer the source of acceptance

The several thousand historical verdicts were seeded from the workbook's
acceptance columns on the first import. From this release the app is the system
of record and the monthly file carries no acceptance data, so those columns are
blank and the importer does nothing with them. Should a stale cell ever appear
in a future file, `acceptances.ict_source` / `cra_source` mark verdicts decided
in the app and the importer will not overwrite them.

---

## 5b. Roles Performance

The reporting page about **people**, at `/reports/kpi` (sidebar: "Roles
Performance", one item). It replaced the single-scope KPI & Performance page
in 1405. Since UEP-09 it answers two questions, one tab each:

| Question | Tab |
|---|---|
| What happened in a month, and who does it belong to? | **Month** (PM, Viewer) |
| Where do things stand today, against national? | **Area** (PM, Viewer) / **My area** (everyone else) |

**Map** is the Lifecycle Gaps coverage map (`/gaps/map`, `CoverageMap.jsx`)
embedded unchanged. The Performance and Compare tabs were removed in UEP-09,
with the per-person monthly trend and the UEP activity measures (filings,
validations, response times); old `/reports/kpi/performance` and `/compare`
links land on the role's first tab with `?lens=&key=` kept.

| Role | Tabs, in order | Lands on |
|---|---|---|
| PM | Month · Area · Map | Month |
| Viewer | Month · Area · Map (read-only) | Month |
| Regional Manager | My area · Map | My area |
| Coordinator | My area · Map | My area |
| Contractor | My area · Map | My area |
| Admin | none: 403 on every route | n/a |

Both tabs share one layout: a **measure list** on the left (`MeasureList.jsx`,
the selection in `?measure=`) and a breakdown of the selected measure on the
right. Month splits it three ways side by side (contractors, regional
managers, coordinators), each column adding up to the total, from one
`GET /kpi/month?by=owners`. Area ranks every member of a breakdown by its gap
to national with `RankBar.jsx` (grey to the lower of rate and national, the
difference cobalt when ahead and red stripes when behind), from
`GET /kpi/area`, whose rows carry all five measures. Month shows no
comparison with the previous month; the payload still has it, for the export.

### The mapping is master data

`province_mapping` records who owns a province over a period of time: its CRA
region, PSO coordinator and regional manager, valid over the half-open interval
`[effective_from, effective_to)`. A reassignment closes the open row on the
day the new one starts, so nothing is ever owned twice or by nobody. A partial
unique index enforces one open row per province.

It sits **beside** `provinces.coordinator_user_id` / `regional_manager_user_id`,
not instead of them. Those are Admin's, carry no CRA region and no history,
and only this table decides this page. `users.kpi_person_name` says which
person in it an account is; contractors use `users.contractor_id`. An
unlinked account is refused with a message saying so.

### Coordinators are assigned per CRA region, and their stores are kept in sync (UEP-17)

A coordinator owns whole CRA regions, never single provinces. The province →
region link (`province_mapping.cra_region`, seeded from
`core/province_directory.py`) is fixed: 9 regions, 31 provinces. Three
existing places record who coordinates a province, and each screen keeps
reading the one it always read:

| Store | Read by |
|---|---|
| `provinces.coordinator_user_id` | Acceptance dashboard's coordinator filter, the Action Center's owner names, `/reference/coordinators` |
| `province_mapping.pso_coordinator` (open rows, the account's `kpi_person_name`) | Roles Performance and Lifecycle Gaps, through `kpi.resolve_scope` |
| the coordinator's province grants (`user_province_access`) | Home and Acceptance Validation, through `services/visibility` |

`services/province_assignment.py` is the **only writer** of a coordinator for
all three, and writes them in one transaction (Admin → Province assignments,
`PUT /admin/province-assignments`). It locks the region's rows, checks the
client's `expected_coordinator_user_id` (409 when stale), then for each changed
region sets `coordinator_user_id`, corrects `pso_coordinator` in place on the
open rows (`kpi_mapping.correct`: no new effective-dated row, so past months
move to the new coordinator too, as agreed), and moves the region's province
grants from every other coordinator account to the new one. Visibility
follows on the next request; nothing is cached across a commit.

Nothing else may set a coordinator. `PUT /admin/provinces/{id}/assignment`
and the KPI mapping's `PUT /kpi/mapping/{id}` and
`POST /kpi/mapping/{id}/reassign` answer 422 *Coordinators are assigned per CRA
region in Province assignments* for any coordinator other than the region's;
regional managers are handled there as before. A coordinator account may be
linked (`kpi_person_name`) to a name no region carries yet, so a new
coordinator can be linked first and given regions after.

`province_assignment_history` keeps one row per region per change, grouped by
`change_id`, for the page's History and Revert (a revert is a new change).
Every write is also in the audit log (module `Admin`, entity
`CraRegionCoordinator`). Migration `a3c9e6f1d274` made the stores agree where
they had drifted (majority across both stores, ties to `province_mapping`),
printed each fix, and wrote one `System` history entry.

### One definitions module

Every measure is defined once, in `services/performance/definitions.py`, and
every tab and every export reads it. No tab computes a measure its own way;
that is how two screens start disagreeing about the same number.

| Measure | Unit | Dated by | Recorded from |
|---|---|---|---|
| On air | sites, villages | the site's CPM launch date (`launch_date_gregorian`, else the parsed `launch_date_shamsi`); failing both, `lifecycle_status_history.first_seen_at`. A village inherits its site's date. | wherever a date exists |
| DT done | sites, villages | `work_items.dt_date_gregorian` (CPM) | wherever a date exists |
| ICT approved | villages | `reviewed_at` of the validated submission that made the village's last requested technology ICT-approved | Mehr 1405 |
| CRA approved | villages | the same, for CRA | Mehr 1405 |
| Fully approved | villages | the later of the two | Mehr 1405 |
| Became full config | sites | `hc_tasks.reviewed_at` of a confirmed `Ready` that follows anything but `Ready`: confirmation, not submission | Mehr 1405 |
| Fell back | sites | `reviewed_at` of a confirmed `NotReady` whose previous confirmed result was `Ready` | Mehr 1405 |
| Problematic, new / resolved | sites | the transitions in `drive_test_analytics.problem_events()` | Mehr 1405 |
| Problematic basket | sites | `is_problematic()` today: a balance, not a flow | n/a |
| Remaining | villages | not yet approved by **both** ICT and CRA | n/a |

Some notes on the table:

* **Approval is when UEP records it.** A village counts as approved when a PM
  or coordinator validates someone else's filing, or files and decides it
  themselves (`record_decided`). Both set `reviewed_at`. The letter date is
  typed in and can be backdated, so using it would let a late filing change a
  closed month.
* **On air uses the launch date, not "first import seen on air".** The launch
  date gives real history today. A history table that starts at deploy would
  read "Not recorded" for all of Mehr. A site with neither date is counted in
  no month, and the payload says how many such sites there are.
* **Problematic flows come from dated per-site events, not
  `MonthlySnapshot`.** The snapshot is one row per province per month,
  refreshed on login. It cannot be cut at a day of the month, split by
  contractor, or split by who owned a province mid-month. `problem_events()`
  is the function the snapshot itself is built on, so both readings share
  one definition. The snapshot stays as an independent cross-check.
* **Before Mehr 1405, approvals and the HC/problematic flows have no
  trustworthy dates.** Those months return `null` with `recorded: false`,
  never `0`. "Nothing happened" and "nobody wrote it down" are different
  facts.

**Rates.** On air % and DT done % divide by the scope's villages (or sites).
ICT % and CRA % divide by **DT-done villages**, because a village whose drive
test is unfinished was never eligible for acceptance. Fully accepted % divides
by villages in scope.

**Low sample.** Fewer than `LOW_SAMPLE_DT_DONE` (10) DT-done villages means the
row is "Not compared": shown in grey, with no bar and no gap, sorted last.

**National** is always the whole country, weighted: the sum of numerators over
the sum of denominators. Area's gap is the row's rate minus national, in whole
points.

**Default month.** `month.default_month` is the last closed month, or the
running month while the last closed month is before `RECORDED_FROM`.

### Months, and the same-day comparison

All months are Shamsi, bucketed with `core/jalali.py`. "Today" is
`jalali.tehran_today()`. `services/performance/periods.py` turns a month into
a window pair:

* **The running month** is compared from day 1 up to today with the previous
  month **up to the same day**, capped at that month's length (Mehr 10 vs
  Shahrivar 10; Esfand 30 vs Bahman 30).
* **A closed month** is compared whole against whole.

Every comparison is returned as `{now, ref, delta, lower_is_better, recorded}`.
Only the Month export shows `ref` and `delta`; the screen reads `now`.

### Ownership at the time

A month's figure goes to whoever owned the province **on the event date**: the
mapping row whose `[effective_from, effective_to)` contains it. Reassigning a
province therefore never rewrites history. If a province changed hands
mid-month, each owner is credited with their own days.
`services/performance/ownership.py` loads the mapping rows once per request
and finds each event's row with a binary search. There are 31 provinces and a
handful of rows each, so this takes microseconds and reads more simply than a
range join.

* **Before the first row, the first row.** The seed rows open on the day the
  table was created, but the CPM DT dates go back years. So a province's
  earliest known owner is credited with the time before their row opened.
  Otherwise every owner view would be empty before the deploy. Later
  reassignments are exact.
* A **contractor** is credited through the work item's DT SC
  (`dt_sc_contractor_id`), as the old contractor lens was.
* An event with no attributable owner (unknown province, unmapped province,
  no DT SC) goes to an **"Unattributed"** bucket. It is never dropped, so the
  owner splits always add up to the row total.
* **Area is "today"** and uses the current mapping rows only.
* `/kpi/lenses` lists **past owners** under `past`, and the picker marks them
  "(past)". Their Area is empty.
* On Month (`by=owners`), every owner who could have been credited is
  returned, at 0 if they had nothing; the screen lists those with something,
  highest first, and folds the rest into "N with none this month".

### `lifecycle_status_history`

`(entity_type, entity_id, status, first_seen_at, cpm_import_batch_id,
backfilled)`, unique on the first three. The CPM import writes it after each
batch, in the batch's transaction, for every site and village it sees on air
for the first time. The first run marks its rows `backfilled = true`, because
"first seen on the day the table was created" is not an on-air date. Those
rows never feed a monthly flow. It is the fallback date for on air, used only
when CPM carries no launch date.

### No rollup tables

Every figure is a live read. `facts.load()` reads the live work items through
`dt_universe.load_all` (the Drive Test dashboard's own loader, so "on air",
"DT done" and "problematic" use the same predicates). It also reads the
target villages and the approval dates: a handful of queries, a few
milliseconds at about 4.4k villages. Every tab then folds those rows:

* Month counts dated events;
* Area folds today's counters, grouped by (province, contractor), so a region
  agrees with its provinces and the rows agree with the headline.

The one load is the one function a materialised view would replace, with no
route changing. A CPM `استان` that matches none of the 31 provinces becomes an
"Unknown province" row, so per-province rows always add up to the country.

### Code layout

```
services/kpi.py                 Scope, require_kpi_access, may_compare, resolve_scope, lenses
services/performance/
  definitions.py                measures, units, rates, recorded-from, low-sample, lower-is-better
  periods.py                    Shamsi months and the same-day cut
  ownership.py                  who owned a province on a day
  facts.py                      dated CPM-side facts and today's cells (the read model)
  common.py                     shared shapes: comparison, scope, rates, low sample
  month.py  area.py             one payload builder per tab
  export.py                     workbooks built from the same payloads
  onair_history.py              writes lifecycle_status_history after a CPM import
schemas/roles_performance.py    the response models
api/kpi.py                      read routes; mapping and linking routes unchanged
```

```
frontend/src/pages/reports/rolesPerformance/
  RolesPerformance.jsx          tab router, role landing, scope in the URL
  PerfHeader.jsx                the shared PageBar: eyebrow · title · subtitle · Export · Tabs
  ScopePicker.jsx               "whose?" (PM, Viewer)
  MonthPicker.jsx               the Month title: a Shamsi month dialog
  MeasureList.jsx  RankBar.jsx  the two pieces both tabs share
  MonthTab.jsx  AreaTab.jsx  MapTab.jsx
  parts.jsx                     Num (LTR span), CountUp, Fa, IconTile, RpCard
  hooks.js                      useRpData (with retry), useExport, useCountUp
  model.js                      tabs per role, owner columns, ranking, formats
  rolesPerformance.css          on the UEP tokens (uep-tokens.css), motion
```

The logic module is `model.js`, not `rolesPerformance.js`. A file whose name
differs from `RolesPerformance.jsx` only by case is resolved in its place on a
case-insensitive disk (Windows, macOS), because `.js` is tried before `.jsx`.

`MapTab.jsx` only renders the existing `CoverageMap`. The map itself is not
modified.

### Who sees what

| Role | Scope | May choose whose? | Ranking | Writes |
|---|---|---|---|---|
| PM | the country | anyone, any province or CRA region, past owners too | yes | mapping, links |
| Viewer | the country | same as PM | yes | **none** |
| Regional Manager | own provinces | no | no | none |
| Coordinator | own provinces and CRA regions | no | no | none |
| Contractor | own sites (DT SC) | no | no | none |
| Admin | **no access** | | | |

* **Viewer is a read-only PM.** It is in the KPI roles, and `resolve_scope`
  gives it the PM's choice of lens and key. Every write route stays
  `require_roles(PM)`, so Viewer gets a 403 there. Lifecycle Gaps calls the
  same `require_kpi_access`, so Viewer reads it too, choosing the lens as PM
  does. Viewer may download Excel. It never sees the Mojri tracker or the
  mapping screens, and both are refused on the server, not just hidden.
* **Month is PM's and Viewer's** (`kpi.require_compare`).
  Anyone else gets a 403 on them, exports included.
* **Asking for another scope is a 403**, never an empty result and never a
  silent substitution. A substituted page would be headed with someone
  else's name.
* **Area breakdowns.** PM and Viewer: provinces, CRA regions, contractors,
  coordinators and regional managers (minus the scope's own kind).
  Coordinators and regional managers: provinces, CRA regions and contractors
  in their own provinces. Contractors: provinces and CRA regions. Anything
  else is a 403.
* **Ranking.** *The old "never rank people" rule is retired.* Area ranks every
  breakdown against national, and Month orders owners by count. Outside PM
  and Viewer, the ranking only covers the caller's own scope.

### Exports

`/kpi/{month,area}.xlsx` are built from the payload the
screen receives, never from a second query. A number in the file cannot
differ from the one on screen, and the row counts match: each response says
how many rows its main sheet has in `X-Row-Count`, and the tests compare that
with the screen. They stream above the Lifecycle Gaps threshold. The access
rules are the screen's.

An Area breakdown row links to Lifecycle Gaps with `?lens=` set to the
breakdown (province, region, contractor, coordinator or regional manager), so PM and Viewer land on the
lens they were reading. Everyone else is confined there anyway.

`GET /kpi/summary`, `/kpi/contractors` and `/kpi/export.{xlsx,pdf}` serve the
old page. They stay for one release, marked deprecated, and are then removed.

---

## 5c. Lifecycle Gaps

The second reporting page over the same villages, and it asks the opposite
question to the one above it. Roles Performance asks "how is this owner doing?"
Lifecycle Gaps asks **"where are villages stuck, and whose villages are they?"**

`/reports/gaps` (Performance → Lifecycle Gaps; `/reports/lifecycle-gaps`
redirects there), two tabs:

* **Gaps**, served by `GET /gaps/overview`;
* **Coverage map**, served by `GET /gaps/map`;

and behind every village count on either tab, `GET /gaps/villages.xlsx`.

All three live in `services/gaps.py` (the workbook itself in
`services/gap_export.py`). A pure read: no table, no migration, nothing
written.

> The Gaps tab used to be "the road": four stretches drawn in sequence (ICT →
> CRA → Mojri tracker → depreciation), served by `GET /gaps/road`. It was
> retired with the redesign, together with its endpoint, its tests and the
> `gap_road_precheck` script. The road assumed ICT came before CRA; the
> overview does not.

### The overview: where villages are stuck (`GET /gaps/overview`)

**Cards 1–2 use the Acceptance dashboard's universe exactly** — هدف, drive
test done, not soft-deleted (`acceptance_universe`), with no on-air condition.
The same SQL condition serves both screens and a parity test holds their
figures equal. The Mojri card counts every approved village
(`mojri_tracker.comparison_scope`). The coverage map keeps its own counting.

Concretely, the overview's universe (`_universe`) is every live هدف village
that is either drive-test done or approved by ICT or CRA, and each counter
narrows it:

* **Cards 1–2** (pending, one approved/other pending) AND every counter with
  `acceptance_universe.dt_done_universe` — the SQL twin of
  `acceptance_universe.in_dt_done_universe`, the rule the Acceptance dashboard
  applies in Python. `tests/test_gaps_dashboard_parity.py` holds eligible,
  pending ICT/CRA and ICT/CRA approved equal to the dashboard's
  `total_dt_done_villages`, `total_ict_remained` / `total_cra_remained` and
  `total_ict_approval` / `total_cra_approval` for PM, regional manager and
  coordinator (each with their own scoping), and holds the SQL and Python
  twins to the same village ids.
* **Card 3** (ICT vs CRA vs Mojri tracker) counts **every approved village**,
  drive test done or not — `mojri_tracker.comparison_scope`, the same set the
  Mojri template lists (§5d). The PM downloads the template, fills it, uploads
  it, and the card is read against exactly those rows. Its bases are
  `ict_approved_all` / `cra_approved_all`; `ict_approved` / `cra_approved`
  keep their drive-tested meaning for card 2 and the map panel.

> **Why no on-air condition.** Cards 1–2 used to require the site on air
> (drive test done *and* `last_stage` a launch stage). Site E2953 has its drive
> test done but CPM's last stage is still `Site Survey`, so its four villages
> were on the Acceptance dashboard and not on Lifecycle Gaps: 4,437 vs 4,433
> villages, and 760 vs 758 CRA pending. Two screens answering the same
> question must not disagree, so the product owner chose the dashboard's
> universe for both.

The coverage map is unchanged (below).

**ICT and CRA are parallel, not sequential.** Neither is counted "after" the
other, so a village CRA-approved without ICT is simply "ICT remained", not an
anomaly — which is why the road's `cra_approved_without_ict` data-quality note
is gone. Approved is the village roll-up (`Village.ict_status == Approved`);
everything else, Pending and Rejected alike, is not approved — the
dashboard's "remained" (rejected + pending).

| Figure | Counted | Base |
|---|---|---|
| Pending ICT / CRA | drive-tested, not approved by that authority | eligible (drive-tested) |
| ICT remained | drive-tested, CRA approved, ICT not | CRA approved (drive-tested) |
| CRA remained | drive-tested, ICT approved, CRA not | ICT approved (drive-tested) |
| ICT / CRA missing in Mojri | approved (drive test done or not), and Mojri's status for that authority is not `in_tracker` | approved (drive test done or not) |

No `mojri_tracker_status` row reads as not in the tracker; `needs_look` counts
as missing, and its count travels separately (not shown on the page yet). No
de-duplication, as everywhere in acceptance counting.

Every figure is counted directly in the one GROUP BY (`_gap_grid`), not derived
by subtraction, over the one definition of the universe (`_universe`, below), so the identities the tests check — `approved + pending =
eligible`, `pending = remained + neither`, `missing + in_tracker =
approved_all` —
are evidence rather than arithmetic that holds by construction.

### Every lens is a partition of the same rows

Five lenses — regional manager, PSO coordinator, contractor, CRA region,
province. The property that makes the page worth reading is that **each one sums
back to the same total.**

A design preview of this page once showed a country figure of 2,570 beside an
owner list adding up to 445, because two of the five lenses were built from a
different query than the rest. Two aggregates that are supposed to agree are not
protected by anyone's good intentions, so they are not used:

* each view has **one** GROUP BY over villages, by (province, DT SC contractor)
  — `_gap_grid()` for the overview, `_grid()` for the map;
* an owner list is `_fold()` over those cells with a key function naming the
  owner;
* the total is the same `_fold()` with a key function that answers "country"
  for every cell.

Two groupings of one result set cannot disagree about their total.
`tests/test_gaps_overview.py` asserts it for every lens against every figure
anyway.

The page then does the same sum **in the browser**: the drawer's footer adds up
the rows it received ("Adds up to 1,391 ✓") and says so loudly when they do not
balance. A check that only shows when it passes is decoration.

### Villages nobody owns are named, never dropped

Three things the programme would like to be true, none of which the schema
enforces: every village has a province (`sites.province_id` is nullable), every
work item has a DT SC (nullable too), and every province has a current
`province_mapping` row. Each missing case becomes its own named row — "Unknown
province", "Unmapped province", "Unassigned" — carrying an `attribution` the page
flags. Dropping them would break the sum above, which is the same reason the KPI
heatmap shows an "Unknown province" row. Villages without a province and
provinces without an owner are also counted under `data_quality`, and the page
shows them behind its "data note" button.

### Who sees what

Not decided here. `services/kpi.py` already answers "may this account see
delivery numbers, and whose?", so this page calls `require_kpi_access` and
`resolve_scope` rather than restating them: Admin is refused, PM and Viewer
see the country under any of the five lenses (Viewer read-only: no Mojri
tracker, no action buttons), and every other role sees **only their
own villages**: totals, gaps and bases are all computed over the cells that
roll up to their own key, and their one row therefore adds up to the totals they
see. Asking for another lens is a 403, and the endpoint takes no key at all.

### The page

Clean first, detail on demand. At 1440 × 900 and 1280 × 800 the browser page
does not scroll on either tab, with the drawer open or closed (a `PageFrame`
under a `PageBar`; `e2e/lifecycleGaps.spec.js` measures it).

**Gaps tab.** At rest, six numbers in three cards (Pending approval · One
approved, other pending · ICT vs CRA vs Mojri tracker), **ICT always left and
CRA always right**. Each is a `WaffleTile`: a 10 × 10 waffle whose 100 squares
are that gap's own base, `round(100 × gap ÷ base)` of them filled, and under
the figure only the share of that base ("13%"; "—" over a base of 0). The
base itself ("13% of 4,433 drive-tested") is spoken in the tile's accessible
name rather than printed. Authority tokens (`--ict`, `--cra`) colour data only;
cobalt marks the tile whose drawer is open. Before any Mojri import the two
Mojri tiles show a dotted grid, "—" and the approved-in-UEP count instead of a
guessed gap.

**The drawer.** Clicking a tile opens `GapDrawer`, a right-side modal dialog
over a scrim — fixed to the viewport, so the page behind never moves (the
earlier docked panel re-laid the chart out on every click). The hero figure,
then "Group by" (Coordinator · Contractor · Province · CRA region · Regional
manager; PM only, re-asking `/gaps/overview` for the lens), then **every** owner
row — the list scrolls inside the drawer, nothing is folded into "N more" — each
with a 20-square mark of its share of the gap, its count and that share, and
coordinators with their regional manager(s) (`managers` on the coordinator
rows, from the same current mapping). Attribution rows stay named. The footer
is the checksum.

### Exports: the villages behind a figure (`GET /gaps/villages.xlsx`)

**Every number that counts villages is a button that downloads exactly those
villages**: the tile figures, the Mojri tiles' approved-in-UEP counts, the
drawer's hero and every drawer row, and every count in the coverage map's
panel. Percentages are not exportable. Parameters: `gap` (the six gaps, plus
`ict_approved` / `cra_approved` and the Mojri bases `ict_approved_all` /
`cra_approved_all`), optionally `lens` + `key` (one owner, named
as its row names it) and `scope` (`province:<Persian name>` or
`region:<CRA region>`, from the map).

**The one-selection rule.** The file for a figure must have that figure's row
count, so the export is not a second query that is supposed to agree with the
overview. Three pieces are defined once and shared:

* `_universe()` — joins and filters (هدف, not deleted, on air *or* approved).
  The grid aggregates over it; the export selects rows from it.
* `_counter_conditions()` — each counter as the SQL condition a village meets
  to count in it, on-air included for cards 1–2. The grid counts each one; the
  export filters by one.
* `_owner()` / `_owned_by()` — which owner a (province, contractor) cell rolls
  up to under each lens, attribution rows included. The folds group by it, a
  non-PM's scope narrows by it, and the export narrows by it.

`tests/test_gaps_export.py` asserts the row count equals the figure for every
exportable gap, under every lens, for every owner row the overview returns,
and for every number in every map panel.

**Access** is the overview's: `require_kpi_access` (Admin is a 403) and
`resolve_scope` (a non-PM is confined to their own villages; naming another
person under their own lens is a 403). A non-PM may narrow further — by another
lens or a map scope — only to owners inside their own villages; anything else
is a 403, never an empty file that reads like "nothing pending".

**The workbook** (`services/gap_export.py`, following
`acceptance_site_export.py`): a *Villages* sheet (village ID and Farsi name,
province, CRA region, RM, coordinator, contractor, ICT and CRA status and
Jalali date, Mojri standing, attribution; bold frozen header, autofilter) and a
*Summary* sheet (the figure, the filter, the count, exported-at in Jalali and
Gregorian, who). The filename is `uep-<gap>-<filter>-<jalali date>.xlsx`,
ASCII-safe (a Farsi name becomes a short hash). Rows are streamed from the
database into an openpyxl write-only workbook in a spooled temporary file, and
over 20,000 villages the response is streamed in chunks.

### The coverage map (`GET /gaps/map`)

ICT approval by province and CRA approval by CRA region, one map at a time (a
segmented control switches; switching clears the selection). The map counts
every هدف village (no on-air rule) and reads each authority on its own
stretch: ICT is drive-test-done-not-ICT-approved over drive-test-done, CRA is
ICT-approved-not-CRA-approved over ICT-approved. A region is the fold of its
provinces, so a region can never disagree with the provinces inside it. The
six fixed bands, the labels and the low-sample hatch are unchanged.

Beside the map, a detail panel that is empty until a shape is clicked (a
second click, ✕ or Esc clears it). Its figures are a `detail` block on every
province, region and the total:

    detail: { delivery: { assigned, on_air, dt },
              ict: { approved, pending }, cra: { approved, pending } }

and every leaf is `{sites, villages}`. Villages for ICT and CRA are the Gaps
tab's counters (`ict_approved`/`pending_ict`, `cra_approved`/`pending_cra`, a
fold of `_gap_grid`), so each exports exactly. Sites come from `_site_grid`:
one row per work item (its live هدف villages and how many each authority
approved), then one GROUP BY (province, DT SC contractor). A work item has one
Site (one province) and one contractor, so site counts add across cells like
villages. A site is approved when every one of its villages is; pending is the
rest of the base. The panel's base is the DT-done sites for both authorities
(ICT and CRA are parallel there, as on the Gaps tab); the map's own stretches,
in `ict.sites`/`cra.sites` for the tooltip, are ICT over DT-done sites and CRA
over ICT-approved sites. Delivery counts the whole هدف universe: assigned is a
DT SC contractor set, on air is a temporary or permanent launch, DT is
`dt_status == Done`. `tests/test_gaps_map.py`, `tests/test_gaps_export.py`.

### Deliberately not built

Monthly deltas and "vs last month" (they need a snapshot job that does not
exist), plan versus actual (it needs the Monthly Plan redesign), and reason
codes on the ICT/CRA stretches — the last rejected by
the product owner as more complexity than can be handled now.

---

## 5d. The Mojri tracker

ICT HQ (Mojri) keeps **its own** tracker of which villages are registered with
it, and it lags behind the verdicts we have already recorded. This feature
answers one question per village per authority: *has their tracker caught up?*

**It is not a third authority.** `AUTHORITIES` is still `("ICT", "CRA")` and
this feature never touches it. Mojri is the keeper of a spreadsheet, not a
party to the acceptance decision — putting it in the value set would drag "ICT
HQ has typed this village in" into the submit/review pipeline and into every
figure that counts approvals. It is a separate table
(`mojri_tracker_status`), read independently of the acceptance arithmetic.
Nothing here writes `acceptances`, `villages.ict_status`/`cra_status` or any
submission, and a test asserts it.

### Template out, filled file in

Mojri's raw file is somebody else's, its layout moves, and parsing it is not
attempted. Instead:

```
Admin Console ──▶ mojri_template_1404_06.xlsx ──▶ filled by hand, outside UEP
                    (one row per هدف village we                 │
                     have already approved)                     ▼
                                              PM · Mojri Tracker: upload,
                                              preview, confirm
```

**One definition of the compared villages.** The template lists
`mojri_tracker.comparison_scope`: every live هدف village ICT or CRA approved
(CPM verdicts and in-app approvals alike), on air or not, drive test done or
not. The Lifecycle Gaps Mojri card (§5c) counts exactly the same set, so every
row the PM fills in is a row the card reads back, and none it reads is missing
from the template. `tests/test_gaps_overview.py` holds the two equal. A
non-هدف (legacy sub-flag) village is in neither; no report counts those.

### How a row finds its village

The template's columns are `site_code`, `site_type`, `village_code`,
`village_name`, then `ict_2g … cra_4g`. **The template and the importer key on
`(site_code, site_type, village_code)`** — the codes the team's own tracker
uses — and the internal `villages.id` is never shown to people. That triple is
exactly what identifies a village: a work item is unique per (site, site_type),
and a village belongs to one work item. `village_name` is for reading only.

The first release matched on `villages.id`. Nobody filling the file can know a
primary key, so the team filled that column with CPM village codes; rows
matched nothing, or matched the unrelated village whose primary key equalled
the code. Lifecycle Gaps then read 100% "Not in Mojri".

* **Normalisation** is one function (`mojri_tracker.normalize_key_part`) used
  for the file and the database alike: trimmed, internal spaces collapsed,
  case-folded, and an integral number compared as the text of the integer
  (`229164`, `229164.0` and `"229164"` are one code).
* **Only live villages** are candidates: neither the village nor its work item
  soft-deleted.
* **One key, several villages.** CPM legitimately lists the same village twice
  on one work item and UEP counts both rows, so a row's statuses are written to
  every live village its key matches.
* **One key, several rows.** Rows that read the same are one answer. Rows that
  disagree are listed in the preview and none of them is written.
* **Legacy headers, for one transition.** `site_id` is read as `site_code`, and
  `village_id` as `village_code`: the old template wrote the site code under
  `site_id`, and the team's current file holds village codes under
  `village_id`. The canonical header wins when a file carries both. Remove the
  aliases (`LEGACY_HEADER_ALIASES`) once the team is on the new template.

The template is a **read**, which is why Admin may take it — and the import is a
write, which is why it is PM's alone. That is the Admin/PM separation in §6,
applied here. Coordinator reaches neither.

### How a cell is read

Per authority, for **each technology the village actually requested**: a
positive cell → registered; blank → not registered; anything else —
an unrecognised word, a note, a cell carrying an Excel comment → **needs a
look**. The village's status is `in_tracker` only if every requested technology
reads registered, and `needs_look` if any single one does. Never an average.

A positive cell is `acceptance_tokens.is_positive(token, tech)`: a recognised
yes, **or the column's own technology name** — `2G` in the 2G column, the
original CPM convention. The rule is part of the shared token vocabulary, used
by the CPM importer (`CpmImportService._approval`) and this one alike; it used
to live only inside the CPM importer, and the Mojri importer read every such
cell as "needs a look". Another technology's name (`3G` in the 2G column) is
not positive and needs a look.

Two rules that look like omissions:

* a **recognised negative** ("no", "رد") routes to `needs_look`, not to "not
  registered". In a registration column, refused and not-yet-done are different
  facts, and reading one as the other records a decision nobody made. The token
  sets themselves are shared with the CPM importer
  (`services/acceptance_tokens.py`) rather than copied — two copies would not
  fail, they would drift;
* cells for **technologies the village never requested** are ignored entirely,
  whatever they contain. A 3G/4G village's 2G column is not a gap that can
  never close.

### Nothing writes before Confirm

`POST /mojri/import/preview` opens the file, reads every cell and returns what
would happen. It writes nothing at all — no staging table, no temporary file —
so an abandoned upload leaves nothing behind. Confirm sends the same file back
with the SHA-256 the preview returned, and a file whose digest does not match is
refused: without that, "preview then confirm" would guarantee nothing.

The preview opens with **"Matched X of Y rows"** (`matched_rows` /
`total_rows`; `villages_matched` counts villages, which can be more when one key
holds two), and turns red below 90%: a correct file matches nearly every row,
so a low share means the wrong file or the wrong columns. **Confirm is refused
(400) when no row matched** — such an import would change nothing while
reading, in the run history, as this month's reconciliation.

It then names three things rather than counting them: rows that matched no live
village, shown by the `site_code / site_type / village_code` that was typed;
rows repeating a key with different answers (none is written — taking the last
would silently lose the other claim); and **villages that were in the tracker
last import and are absent from this file**. That last group is left exactly as
it was. Each file is a full snapshot of the villages it names; a row filtered
out of a spreadsheet is not a registration being withdrawn.

### The one-time cleanup

Migration `e9a4c7b2d153` deletes every row of `mojri_tracker_status`. Each was
matched by primary key against village codes, and a correct row cannot be told
from one written onto the wrong village. `mojri_import_runs` is kept: it is
the audit history of who imported which file. The downgrade is a no-op — the
deleted rows were wrong. **After deploy, the PM re-uploads the current file
once.**

### Not built, deliberately

Aging on the tracker gap (low priority per the product owner), automatic
parsing of Mojri's raw file (the clean-by-hand step stays manual and outside
UEP), and depreciation (it will come from Mojri's tracker later). The tracker
is read by the Lifecycle Gaps overview's two "missing in Mojri" figures (§5c).

---

## 5e. Pending work (queues)

> **UEP-05:** the Action Center screen and its board endpoints were removed.
> Home (`/home`) is each user's single view of their pending work. The queue
> services in `services/action_queues/` (registry, SLA, done, context) feed
> Home, the app rail counts, the daily digest and Admin *SLA policies*
> (`/admin/sla`, UEP-15); the settings endpoints are in `api/work_queues.py`. Where the text below
> says "Action Center" or "board", read "the pending-work queues". The Fix
> queue lives in the Drive test app, and is a category owner's only page there.

Before this, people tracked their work in Excel and nobody could see what was
waiting on whom. The Action Center is each person's one answer to **"what is
pending for me, across the whole lifecycle from Health Check to acceptance,
and how late is it?"** Each queue is a **ticket**: its name, how many items,
the oldest item's date, and how many are past the SLA. A ticket is a link to
the queue screen that holds those items.

### Who gets it

| Role | Action Center | Lands on |
|---|---|---|
| PM, Coordinator, Contractor | Yes | UEP Home (§5f) |
| Problem owner (any `is_category_owner` role) | Yes | UEP Home (§5f) |
| Regional Manager | No (board answers **403**) | KPI & Performance |
| Viewer | No (board answers **403**) | Drive Test dashboard |
| Admin | No (board answers **403**) | Admin Console |

The board refuses those roles rather than showing them an empty board: an
empty board reads as "nothing to do", which for them would be untrue. The
deprecated `/action-center` and `/action-center/summary` are left exactly as
they were (other code uses `/action-center` as a cheap signed-in check).
`homeFor` in `frontend/src/lib/roles.js` is the
landing table; `board_role` in `services/action_queues/context.py` is the
server's.

### One queue registry (`app/services/action_queues/`)

Every queue is one frozen `QueueDefinition` in `registry.py`: key, stage,
label, the URL of its screen, the roles that act on it, how its SLA is
measured, whether its date reads "since" or "due", and a `fetch` that returns
`PendingItem`s (`entity_id`, `started_at`, `due_at`, `owner`). The board, the
per-owner breakdown, the daily snapshot and the digest all read the registry.
**Adding a queue is adding one definition.**

Each `fetch` (in `sources/`) is an adapter over **the list function behind the
queue's own screen**: `get_basket`, `hc_queues.reroutes`, `dt_assignment`,
`contractor_dt_todo`, My Work's own select and tab predicate, and so on. No
queue condition is restated, so a ticket's count *is* the length of the list
its link opens; `tests/test_action_board.py` holds that for every queue and
every kind of user on a deliberately untidy programme. Scope is inherited
from those functions: coordinators see their provinces, contractors their own
sites, problem owners their own categories, the PM everything.

The trade-off: building lists costs more than the column-only counts behind
the tab badges (`hc_queues.counts`). The board is built once per user and
shared for a few seconds through `count_cache` (emptied by every commit, so
an action shows on the next read), and `QueueContext` loads the scoped work
items once per build for the queues that walk them. Correctness by
construction was worth more here than a second, faster definition of every
queue held together by a parity test.

| Stage | Ticket | Who | Clock starts | Opens |
|---|---|---|---|---|
| HC | Assign sites | PM, Coord | pool waiting-since (on-air, or last fix closed) | HC Pool, "Ready to assign" |
| HC | Review HC results | PM, Coord | `hc_tasks.completed_at` | HC Review |
| HC | Decide re-routes | PM, Coord | `reroute_at` | Re-routes |
| HC | Submit health checks | Contractor | `hc_assignments.assigned_at` | My Health Check |
| HC | Fix assigned problems | Problem owner | `opened_at`; late after `due_at` (the category's SLA) | My Fix Queue |
| DT | Assign drive tests | PM, Coord | HC review, or `returned_at` if handed back | Drive Test → Assignment |
| DT | Review DT results | PM, Coord | `drive_tests.submitted_at` | Drive Test → Review |
| DT | Drive-test sites | Contractor | `assignments.assigned_at` | My Drive Tests, `status=with_contractor` |
| DT | Redo returned drive tests | Contractor | `coordinator_reviewed_at` | My Drive Tests, `status=sent_back` |
| ICT/CRA | Follow up with ICT / CRA | PM | request letter `sent_at` | My Work → With authority |
| ICT/CRA | File villages | Coord, Contractor | last activity, else DT date | My Work → Not filed |
| ICT/CRA | Validate contractor filings | Coord | submission `submitted_at` | My Work → To check |
| ICT/CRA | Re-file rejected villages | Contractor | rejection `reviewed_at` | My Work → New letter needed |
| ICT/CRA | Correct returned villages | Contractor | return `reviewed_at` | My Work → Returned |
| Plans | Approve plans | PM | `submitted_at` (revisions too) | Monthly Plan → Approvals |
| Plans | Validate CPM changes | PM | `cpm_change_requests.created_at` | Admin → Validate CPM |
| Plans | Submit monthly plan | Contractor | **due** on the day-3 deadline | Monthly Plan |

"Correct returned villages" is separate from "Re-file rejected villages" because they
are separate My Work tabs, and a ticket must open exactly what it counted.

### "With the authority": the one new clock

Every queue already recorded when its clock starts, except one: nothing
recorded that a request letter had gone to ICT or CRA. A side's status went
from "not filed" straight to "filed" (the authority's answer, entered for the
coordinator to check), so the time a village spent with the authority was
invisible. `acceptance_authority_requests` records the outgoing letter
(`POST /acceptance/authority-requests`, the "Mark as sent to ICT/CRA" action
on a My Work side). A request is **open** until any non-withdrawn submission
for the same village and authority is filed at or after it
(`acceptance_requests.open_request_clause`); that rule is My Work's staff
**With authority** tab and the PM's follow-up ticket, and nothing else
restates it. Rows are never updated: asking again after a rejection is a
second request. Sending one does not change the side's status, so the village
stays on "File villages" until the answer is filed.

### SLA and overdue (`sla.py`)

- Since UEP-15 every SLA is a **step** in `sla_policy`, read through
  `services/sla_policy.py` (`get_days`, `get_all`, cached per request). Each
  queue maps to a step in `sla_policy.QUEUE_STEP`; remediation has one step per
  problem category (`remediation:<id>`). Set by PM or Admin on **Admin → SLA
  policies** or `PUT /admin/sla-policies`. No deploy. Queues not mapped to a
  step still read `action_queue_sla` (read-only, removed next release).
- An item is overdue when `now − started_at > sla_days`, strictly: 14 days
  exactly is on time.
- **Fixes** are late after their own `due_at`, set from the problem category's
  SLA when the fix opened. **Submit monthly plan** is late after the end
  (Tehran) of its deadline day. The configured days do not apply to either,
  and the SLA screen shows them read-only.
- **The tracking epoch.** CPM-imported data carries no dates from before
  **1 Mehr 1405**. An item with no clock start, or one from before that day,
  is measured from 1 Mehr 1405 (midnight, Tehran). That is a read rule, not a
  backfill: stored dates are not rewritten.

### The board API

`GET /action-center/board` returns the role, a scope label (provinces, the
contractor's name, or the owned category), `generated_at`, `totals`
(`pending`, `overdue`) and `stages`, in lifecycle order. Each stage has a
`total` and its `tickets` (`queue_key`, `label`, `count`, `overdue`,
`oldest_started_at`, `earliest_due_at`, `date_kind`, `url`). Tickets reading
0 are left out, and so are stages left with no tickets; a board with nothing
pending says so once. Dates are ISO UTC; the browser shows them as Shamsi
days in Tehran with Persian digits (`shamsiDayLabel`, display only).

`GET /action-center/owners?queue=<key>` returns who holds a queue's items,
worst first: `{owner_type, owner_id, name, count, overdue,
oldest_started_at}`. The owner is the contractor for contractor work, the
province's coordinator for staff work, the category for fixes, "PM" for the
PM's own decisions, and "unassigned" when a province has no coordinator. A
PM sees every owner; a coordinator only the contractors inside their own
provinces; everyone else gets 403. The endpoint exists; **its UI is not built
yet** (its design goes to the product owner first).

`GET`/`PUT /me/notifications` (`{email_digest: bool}`) is each user's own
digest opt-out, also offered in the account menu.

### The daily digest (`python -m app.jobs.daily_digest`)

A separate scheduled command, never a scheduler inside the API, because every
API worker would run its own copy and send duplicates. One run:

1. For every active user with an Action Center, builds the board and
   **replaces** that day's rows in `action_daily_snapshot` (unique on date,
   user, queue). This happens every day the job runs.
2. On digest weekdays (`DIGEST_WEEKDAYS`, Saturday to Wednesday by default),
   sends each user one email: the totals, then one line per ticket with its
   count, overdue and date (Shamsi, Persian digits), linking into the app.
   Users who opted out, have no email address, or have nothing pending are
   skipped, and the reason is logged.
3. **Exactly once per user per day.** `digest_log` is unique on (user, date).
   A run *claims* a user by inserting that row (`sending`), so of two runs
   only one sends. A failure is recorded (`failed`, with the error), and a
   later run may claim a failed row back with a conditional update, which is
   how a mail outage in the morning still gets everyone their digest.

The job only adds outgoing mail. Password resets stay out of band (see
`Login.jsx`). SMTP settings and the cron entry are in the README.

### The page

`frontend/src/pages/ActionCenter.jsx`, a `PageFrame`: a `PageBar` whose
context is one sentence ("N items waiting on you, M overdue"), with All tasks
/ Overdue tabs; then a sticky step rail and one open column per lifecycle
step under it, all five for every role (an empty step says "Nothing waiting
on you"). One card per queue, a real link, sorted most overdue then oldest;
its age ("Oldest 12 days", or "Due in 3 days" for a deadline queue) is worked
out on the page from the ticket's `oldest_started_at` / `earliest_due_at`.
The board scrolls in the page body when it is taller than the screen; the
document never does and no column scrolls by itself
(`e2e/noPageScroll.spec.js`, `e2e/actionCenter.spec.js`). Arrow keys move
between cards and O toggles the Overdue tab. The motion is one entrance,
done in about a second, with every number final on first paint; with
`prefers-reduced-motion` nothing moves. The sidebar badge is the board's
`totals.pending`. The component and its tokens are in
`docs/design-system.md`, "Task board".

---

## 5f. UEP Home

The landing page for everyone with an Action Center (`/home`; `homeFor` in
`lib/roles.js`). It answers four questions at a glance: how much is waiting
on me, what is late or due soon, what do I do next, and which apps can I
open. The full board stays at `/action-center`. Design, decisions and
trade-offs: `docs/design/uep-home.md`.

### One read (`GET /home/summary`)

`services/home.py` builds the page's whole answer from what already exists,
so nothing on it can disagree with the board: the registry's own fetches
(one per queue), `board.summarize`, the snapshot table, and
`monthly_plan.running_month`. It is cached per user through `count_cache`,
like the board, and refused (403) to the same roles. `/action-center/board`
is unchanged; a test pins its shape.

| Field | From |
|---|---|
| `totals.pending`, `overdue`, `queues` | the same summaries as the board |
| `totals.due_soon`, per-ticket `on_time` / `due_soon` / `late` | `sla.item_status` (below) |
| `totals.pending_week_delta`, `overdue_week_delta` | live totals less this user's `action_daily_snapshot` rows from 7 days ago; `null` when there are none |
| `totals.done_today`, `done_yesterday` | `action_queues/done.py` (below) |
| `up_next` | `board.up_next` (below) |
| `groups` | Drive test (HC + DT), Acceptance (ICT + CRA), Plans: every group the role has a queue in, empty or not; zero-count tickets left off |
| `tickets[].owners`, `owners_more` | up to two holders of the items, most items first; never the viewer, never "PM" |
| `plan` | the running Shamsi month's DT plan (`pip` is `null`, never 0, without an approved plan); `null` for problem owners |
| `app_badges` | ticket counts summed by the path each ticket opens; the page looks them up by a nav item's `to` |
| `sla_uniform_days` | the SLA every configured queue on this board shares, else `null` |

### Due soon, and the one "next"

- **`sla.item_status`** makes every item exactly one of late, due soon or
  on time. Late *is* `is_overdue`. Due soon is turning late within
  `HOME_DUE_SOON_DAYS` (3, in `Settings`): for an SLA queue, `effective_start
  + sla_days`; for fixes and the monthly plan, their own `due_at`. An item
  with no due date is never due soon.
- **`board.up_next`**: the most late items, then the oldest clock, then the
  most items, then registry order, so a tie never flips between reads. It is
  the one definition; the digest does not name a "next" today, and would
  call this if it did.

### "Done"

Read from the actor and timestamp columns the tables already keep (no new
table, no new write path). A rule is defined once per **completing act**, not
per queue, and applies when the user's board has a queue it drains: filing,
re-filing and correcting a village are three queues but one act (a
submission), and a per-queue rule would count it three times. Days are
Tehran days. **Decide re-routes** has no rule (`reroute_by` is the proposer;
the decision records no actor), and neither does **Follow up with ICT/CRA**
(an item leaves it when the authority answers, not by the PM's act).

### The page

`frontend/src/pages/Home.jsx`, outside `Layout`: its own header (the search
pill opens Work Items; ⌘K/Ctrl+K), the greeting, the KPI strip, one card per
group, the Apps panel and a footer (the API's health, "Data as of", the
version). The Apps panel and its visibility are `lib/nav.js` (`app` on an
item, `appsFor`), so it and the sidebar cannot disagree; the sidebar gains a
Home item. It refreshes after any write (`DATA_CHANGED_EVENT`) and every
minute. At 1440x900 and 1280x800 the document does not scroll; long cards
scroll inside themselves. Tokens and components: `docs/design-system.md`,
"UEP Home".

---

## 5g. The work pages: one pipeline (UEP-06)

Health check (`/health-check`) and Drive test (`/drive-test`) are one
pipeline on two pages: six steps, the DT done outcome and three side loops,
drawn as one strip on both. The step is the URL's `?tab=`; the map from tab
to step, the legacy keys and the redirects live in
`frontend/src/lib/pipelineSteps.js`, and both pages render
`pages/pipeline/PipelinePage.jsx`.

### Pipeline summary: `GET /drive-test/pipeline/summary`

`services/pipeline.py`. Per strip key, `{count, late, oldest_days, sla_days}`,
each from `action_queues.board.summarize`, the function Home and the rail
use. A step that also has a Home row is that queue, so its count **is** Home's
and the rail's:

| Key | Queue | On Home / rail |
|---|---|---|
| `hc1` | `hc_assign` (pool rows New or Ready for re-check) | yes |
| `hc2` | `hc_in_check`: open HC tasks (`lifecycle.hc_to_submit`) | pipeline only |
| `hc3` | `hc_review` | yes |
| `dt4` | `dt_assign` (= `hc_queues.dt_assignment`) | yes |
| `dt5` | `dt_in_test`: with a DT contractor (`lifecycle.sites_to_drive_test`) | pipeline only |
| `dt6` | `dt_review` | yes |
| `done` | on-air sites with DT done (the DT site list's `done` bucket) | never late |
| `remediation` | `hc_remediation`: open fixes, late by their own due date | pipeline only |
| `reroutes` | `hc_reroutes` | yes |
| `sent_back` | `dt_sent_back` (`lifecycle.returned_to_redo`) | pipeline only |

The pipeline-only queues are `QueueDefinition`s held in `pipeline.py`, not in
the registry, because they are work held by somebody else and belong on
neither Home nor the digest. Their SLA rows use the same `action_queue_sla`
table under those keys and default to 14 days. `sla_days` is what the pages
measure "late" against; the frontend never assumes 14.
`tests/test_pipeline_work_pages.py` holds each Home-row step equal to Home's
ticket and each pipeline-only step equal to the list its page shows.

The pages no longer read `GET /hc/queues/counts`. It is marked deprecated and
still answers.

**Step 4 is the drive-test assignment queue, not the pool's "Health check
passed" state.** The two differ: the pool state also holds Ready results not
yet confirmed (step 3) and sites already with a DT contractor or in DT review
(steps 5 and 6), while the queue has no on-air or DT-status filter. The queue
is the one the assignment endpoint enforces, so it is the step.

### Contractor load: `GET /hc/contractors/load`, `GET /drive-test/contractors/load`

`services/contractor_load.py`. One row per active contractor, lowest open
load first: `open` and `late` from the same queue fetches as steps 2 and 5
(plus Sent back for drive tests), in the caller's scope; `avg_submit_days`,
the mean of assigned → submitted over 90 days (null under five samples); and
`provinces`, where at least 20% of their work in this process was assigned in
90 days (at most five). It is used only to order the assign panel's cards and
to suggest one. PM and Coordinator only, like the assign endpoints.

### Undo, from the audit log

`services/undo.py`. Nothing new is stored: the record of a batch is the audit
entry the action already writes, and its id is the `batch_id`.

| Action | Returns | Undo |
|---|---|---|
| `POST /hc/assignments` | the assignment (`id`) | `POST /hc/assignments/{id}/undo` |
| `POST /work-items/assign` | `batch_id` (additive) | `POST /work-items/assign/{batch_id}/undo` |
| `POST /hc/results/confirm` (new: Confirm ready / Confirm all) | `batch_id` | `POST /hc/results/confirm/{batch_id}/undo` |

Allowed only to the user who acted, within two minutes, and while nothing has
happened to the sites since: no result submitted (HC), no drive test filed and
the assignment not handed back (DT), no drive-test assignment and no newer
check (confirm). An undo restores the previous state exactly: a withdrawn HC
assignment's untouched tasks are removed and the sites return to the pool; a
DT batch's new assignments are removed and the ones it replaced reactivated;
a confirmation's review is cleared and the site returns to HC review. The
stage is recomputed and an `UNDONE` audit entry written. Otherwise the answer
is **409** "Too late to undo; reassign the sites instead." (404 for a batch
that is not the caller's). The bulk-assign audit entry's `new_value` now also
carries `created` (work item → new assignment id) and `replaced` (work item →
the active ids it deactivated).

`POST /hc/results/confirm` is the one endpoint added beyond the prompt's
list: confirming was one `POST /hc/tasks/{id}/review` per site, and a Confirm
all that is undone as one needs one batch. It applies the same
`review_task` with no categories, refuses a result that is not Ready (400) or
already decided (409), and is all or nothing.

### Additive row fields

- `GET /hc/basket`, `GET /hc/queues/dt-assignment`, `GET /work-items`:
  `village` (the first of the site's villages by name) and `village_count`,
  attached at the API layer (`hc_queues.with_villages`), so Home's queue reads
  never pay for it.
- `GET /hc/queues/in-progress`: `pending`, the assignment's pending sites one
  by one inside the caller's scope (task id, site, province, days waiting),
  which is what step 2 lists.
- `GET /hc/results`: `completed_at` and `days_waiting`.
- `GET /work-items`: `launch_date_shamsi`, and a `q` search over site ID,
  province and village name (also on its export and counts). Since UEP-11 it
  also matches the village code, and ignores removed villages.
- `GET /work-items/counts` (new): visible sites per `current_stage` plus
  `All`, with the list's `q` and `province_id`. This was chosen over adding a
  counts field because the list answers a bare array.

### Reassign: not built

No reassign endpoint exists, so the Reassign button on late rows in steps 2
and 5 is not shown. A `POST /hc/tasks/{id}/reassign` (and a drive-test
equivalent) would need to: refuse a task with a result; close the task on the
old assignment and open one on a new assignment for the chosen contractor,
keeping the round; recompute the stage; write an audit entry; and decide
whether the SLA clock restarts. That last point is a product decision.

### Not changed

There are no database changes. Every role guard, list scope, validation
message and confirmation dialog is as it was. "Ready" is cobalt, never green.

## 5h. Monthly Plan, staff side (UEP-08)

`/monthly-plan` is the contractor's own filing page (`ContractorPlan`) for a
contractor and, for staff, `PmPlan`: four tabs under one `PageBar`, the tab in
`?tab=`.

| Tab | `?tab=` | Month in the header | Reads |
|---|---|---|---|
| Approvals (default) | `approvals` or none | planning (next) | `GET /pip/queue` per stream, planning and running months (`usePlanBoard`); running `GET /pip/overview` for "behind" |
| Plans | `plans` | planning | the same queue; running `GET /pip/overview` for delivered against plan |
| History | `history` | running | `GET /pip/overview?period=year&year=` (each stream's `months[]`) |
| Internal PIP | `internal` (staff who read it) | running | `GET /pip/overview` for the running and the planning month; the queue for planning coverage |

Everything the tabs derive from the queue is in `planBoard.js`
(`buildBoard`, `buildApprovals`, `countWaiting`), so the Approvals badge and
the cards cannot disagree. The History arithmetic is in `history.js`.

- **Approvals.** One card per contractor with a plan `Submitted` for the
  planning month, then one per contractor with a `RevisionRequested` on the
  running month. A card's Approve sends `POST /pip/{id}/approve` for every
  waiting plan in parallel. If any fails, the toast names the stream and the
  card stays. Return sends `POST /pip/{id}/return` with one required comment
  (the shared `Modal`, with the page made `inert` behind it). The red lines
  are only "N above sites held" (DT, plan above the running month's
  assignment) and "N behind" (the running overview's `pace_diff` below zero).
  There is no Undo: no endpoint reverses an approval. Roles that cannot decide
  see the same cards with no buttons.
- **Plans.** Read-only. Shared = Submitted, Returned or Approved (a pending or
  returned revision keeps the approved number). Running-month progress per
  stream comes from the overview, not from the queue row's `delivered`,
  because that field is always the DT figure.
- **History.** Closed months get a verdict: Met plan (100% or more), Near plan
  (80–99%) or Below 80%, judged on the exact share. The running month is shown
  but never judged and never totalled. Future months are a dash. One
  contractor's view drops the Internal PIP columns.
- **Internal PIP.** `PUT /pip/internal-target` (PM only on the server, so
  `canSetTarget` decides only whether the stepper is offered).

`GET /pip/overview?period=year` adds `months[]` to each stream
(`OverviewYearMonth`): `plan` (in-force contractor plans summed, `null` when
none), `delivered` (`null` for a future month), `internal` (the stream's
Internal PIP; `null` for a contractor, although the endpoint is closed to
contractors anyway), `is_running`, `is_future`, and `contractors[]` of
`{id, name, plan, delivered}`. The `month` and `since_start` views carry
`months: null`.

## 5i. Explorer: a site's record (UEP-11)

All sites became **Explorer**: the list at `/explorer` and one record page per
site at `/explorer/sites/{work_item_id}` (`?village=V10232` highlights a
village). `/work-items` and `/work-items/{id}` redirect there. The Drive Test
dashboard left the Drive test rail at the same time; it is Insights ›
Dashboards (docs/design/navigation.md).

### The list: `GET /explorer/sites` and friends (UEP-11a)

Read-only, in `api/explorer.py` → `services/explorer_list.py`. The fixed
paths are declared before `/sites/{work_item_id}`.

| Endpoint | Answers |
|---|---|
| `GET /explorer/sites` | `{items, total, next_cursor}`. Params: `q`; `province`, `type`, `tech`, `dt_contractor` (each repeatable); `sort` = `site` (default) · `province` · `type` · `tech` · `villages` · `dt_contractor`; `dir` = `asc` · `desc`; `cursor`, `limit` (default 50, max 100) |
| `GET /explorer/sites/{id}/villages` | `[{code, name}]`, the site's hadaf villages; 404 outside scope |
| `GET /explorer/sites/filters` | `{provinces, types, technologies, dt_contractors}` the caller's own sites carry |
| `GET /explorer/sites/export` | the list's rows as .xlsx, same params, plus `ids` to narrow to a selection (≤ 20,000 rows) |

An item: `{id, site_code, province, type, requested_technology: ["3G","4G"],
hadaf_villages, dt_contractor: {id, name} | null, village_match: {code, name} | null}`.

- **Scope** is `visible_work_item_ids`, the same rule as every list; filters
  and search are applied inside it, so they can only narrow it.
- **Search** matches site code, province name, and the code or name of a live
  هدف village (`village_match` names the first). The term goes through
  `digits.to_latin` and `normalize_persian`; the searched columns fold ي/ك and
  zero-width marks in SQL with nested `replace()` (PostgreSQL and SQLite alike).
- **Hadaf count** is one grouped subquery over live villages whose
  classification is in `kpi.target_values` (what `is_pure_target` accepts):
  the record page's count, held equal by a test.
- **Keyset paging.** The order is the chosen column (empty values last in
  either direction), then site code and id ascending; the cursor is those
  values, base64 JSON, and is refused (400) for another sort. The page reads
  `limit + 1` rows to know there is more.
- **Queries per request are fixed**: the هدف values, the total, the page, and
  (when searching) the matched villages. A test holds 1 and 100 rows to the
  same count.

### `GET /explorer/sites/{work_item_id}`

Read-only, in `api/explorer.py` → `services/explorer.py` (loading) and
`services/explorer_journey.py` (pure rules, testable without a session).
`GET /work-items/{id}` is deliberately not grown: it keeps villages out, and
the assignment screens rely on that.

```json
{
  "id": 123, "site_code": "W4318",
  "status": {"step": "acceptance", "state": "in_progress"},
  "general": {"on_air_date": "2026-10-06", "dt_date": "2026-09-30",
              "site_contractor": "…", "dt_contractor": "…",
              "requested_technology": ["3G", "4G"], "province": "…", "hadaf_villages": 3},
  "journey": {
    "steps": [{"key": "on_air", "state": "done", "date": "2026-09-02", "gap_days": null}, "…"],
    "aging": {"total_days": 42, "current_step_days": 14,
              "longest_step": {"from": "assigned", "to": "dt_done", "days": 14},
              "oldest_pending": {"authority": "CRA", "days": 14, "villages": 2}}
  },
  "acceptance_started": true,
  "villages": [{"id": 9, "code": "V10232", "name": "…",
                "ict": {"status": "approved|pending|rejected", "phase": "…",
                        "filed_date": "…", "decided_date": "…", "days": 4,
                        "round": 1, "filed": true, "refiled": false},
                "cra": {"…": "same shape"}}],
  "counts": {"ict": {"approved": 1, "pending": 1, "rejected": 1}, "cra": {"…": "…"}},
  "workflow": {"current_stage": "DT Done", "active_drive_test_id": 3, "dt_submission_date": "2026-09-30"}
}
```

- **Scope** is `apply_work_item_scope`; a site the caller may not see is 404.
- **Queries:** a fixed number however many villages: the work item with its
  graph (`selectinload`), the villages with their acceptance rows, and the
  site's rounds and request letters as plain columns. A test holds 1 and 20
  villages to the same statement count.
- **Days** are whole Tehran days (`jalali.tehran_today`, `tehran_day`), never
  negative; a missing date makes every count that needs it `null`.

### Where each field comes from

| Field | Source |
|---|---|
| On air date | `launch_date_gregorian`, else `launch_date_shamsi` parsed |
| DT date | `dt_date_gregorian`, the date the DT dashboard counts by |
| Site contractor | `site_contractor_id` (CPM column 31) |
| DT contractor | `dt_sc_contractor_id` (CPM column AV) |
| Requested technology | `requested_technology` through `tech_parser` |
| Hadaf villages | live villages passing `cpm_columns.is_pure_target`. For a DT-done site this is exactly the acceptance universe (`in_dt_done_universe`); before the drive test it still counts the site's villages rather than reading 0 |

**The step path follows the process** (confirmed in UEP-11a: no site has a
health check or assignment dated before its on-air date; 569 have a DT date
before it, shown with a "—" pill). A site goes on air first: the health
check pool is every on-air site whose drive test is not Done. So the steps are
On air → Health check → Assigned → DT done → Acceptance. A step is done when
it, or any later step, is done (a drive test seeded Done from CPM proves the
site was assigned). Dates: on air as above; health check is the latest
`hc_tasks` row with a Ready result (`completed_at`), falling back to the legacy
`health_checks` table; assigned is `relevant_assignment().assigned_at`; DT
done is `dt_date_gregorian`; acceptance is the date the last village became
fully approved (the latest ICT and CRA verdict date), when every village has
one. Acceptance starts when the drive test is Done. Total aging runs from
the on-air date only; without it, `total_days` is `null`.

**A village side** is My Work's state (`villages.ict_status` / `cra_status`
read through `my_work_status.display_status`), in three words with a phase:

| Code state | Shown | Phase | Dates |
|---|---|---|---|
| approved | Approved | `decided` | decided = `authority_verdict_date` (the answer letter's date in `acceptances`); filed = the newest request letter sent on or before it; days = filed → decided |
| filled | Pending | `with_coordinator` | filed = the pending submission's `submitted_at`; days since |
| returned | Pending + Returned chip | `returned` | the returned round's `reviewed_at`; days since |
| waiting or rejected, with an unanswered request letter | Pending (+ Re-filed when round ≥ 2) | `with_authority` | filed = the request's letter date, else `sent_at`; days since `sent_at` |
| rejected | Rejected | `rejected` | decided = the latest rejected technology's date |
| waiting | Pending | `not_filed` | days on My Work's clock (latest submission or review, else the DT date) |

A request is unanswered while no non-withdrawn submission for the side was
recorded on or after it, the rule in `acceptance_requests`. Fully approved
means both sides approved, which is the existing `village_verdict`.

### The page

`pages/explorer/`: `ExplorerList` (the list: `useSiteList`, `SiteRows`,
`FilterPopover`, `BulkBar`, with its URL, words and back-navigation memory in
`listModel.js`),
`SiteRecord` (one request, `useSiteRecord`), `GeneralInfoCard`, `JourneyCard`
(`AgingTiles`, `StepPath`, `VillageAcceptance`) and `TakeActionDrawer`.
Labels, the row order and which workflow forms apply are in `explorerModel.js`.
The old detail page's forms (assign, submit DT, return to coordinator, DT
review) live in the drawer unchanged; assignment is offered only on sites
awaiting one. Every link to a site goes through `lib/explorerLinks.js`.

### Database

One column: `work_items.site_contractor_id`, nullable, FK `contractors.id`,
indexed (migration `a7c3e9d2f514`). See §3.

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
| Viewer | `Viewer` | Read-only; the general manager. Reads Roles Performance and Lifecycle Gaps as a PM would, and writes nothing |
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
| Record a received letter as decided | **No** | Yes | Yes |
| Decide a CPM change request | Yes | Yes | No |
| View baskets, results, reports | Yes | Yes | Yes |

The reason is auditability. Whoever controls user accounts should not also be
able to record operational results — otherwise one account can both perform an
action and alter who appears to have performed it.

**The one deliberate exception to four eyes.** A coordinator or PM who saves a
letter on My Work records it decided at once -- approved, or rejected if any
technology was -- with `reviewed_by` set to them and an audit entry that says
so (`decided_by_filer`). They are entering a letter the authority sent them,
and there is no one else in the loop. Confirming somebody else's *pending*
filing is unchanged: nobody may confirm a round they filed themselves.

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
`app/core/jalali.py`. One exception, on Explorer only (UEP-11): every date there
is Gregorian in English digits, "6 Oct 2026" (`lib/dates.formatGregorian`). Reporting periods are Shamsi months, so monthly snapshots
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
| `kpi.py` | Who may see delivery numbers, and whose: `require_kpi_access`, `resolve_scope` |
| `performance/` | Roles Performance: the one definitions module, Shamsi windows, owner-at-date, the tab payloads |
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

### The frontend layout contract

**The browser page never scrolls.** `html`, `body` and `#root` are one
viewport high with `overflow: hidden`; the shell (`.app-shell`) is a
`216px minmax(0, 1fr)` grid, `100dvh` high. `minmax(0, 1fr)` rather than
`1fr` is load-bearing: a `1fr` track's minimum is its content's, so one
`nowrap` cell used to widen the column past the window and scroll the page
sideways. The sidebar scrolls itself; `.main` is a flex column that never
scrolls.

Inside `.main`, `.page-outlet` is the only box that can scroll, and how it
does is the page's choice (`components/pageMode.js`):

| Mode | Opted into by | Behaviour |
|---|---|---|
| scroll (default) | nothing | The page scrolls inside `.page-outlet`, with the usual padding and 1,280px cap. Every page outside the redesign works as before. |
| fill | rendering `<PageFrame>` | The page takes exactly the remaining height: a fixed `PageBar`, a `.page-body` that fills the rest, and the dock slot. Long lists scroll inside their card (`.card-fill` > `.table-scroll`, sticky header). |

The mode is registered by the page through context, not listed by route,
because one URL can be both: `/monthly-plan` is a one-screen board for a PM
and a long form for a contractor. `PageFrame` sets fill mode in a layout
effect, so the first paint is already in the right frame.

A fill page's parts:

```
.main (flex column, overflow hidden)
  .page-outlet (flex 1, min-height 0)
    .page-frame
      PageBar            131px: eyebrow/title · context · actions / tabs · tabsRight
      .page-body         flex 1, min-height 0; padding 20 32 24
        .card-fill       flex 1, min-height 0
          .table-scroll  the only thing that scrolls; sticky <th>
      .page-dock         the AssignDock, rendered here through <PageDock>
```

Two rules keep it honest:

- **Nothing is clipped.** `.page-body` has `overflow-y: auto` as a fallback:
  a long tab that is not a one-screen design (HC Review, History) scrolls
  inside the frame; the document still never does. The
  one-screen designs (DT dashboard Overview, the Monthly Plan tabs, HC Pool, HC In
  Progress, DT Assignment) are laid out to fit at 1440x900 and 1280x800
  without using it -- `e2e/noPageScroll.spec.js` asserts both.
- **Tab panels do not animate their height.** A tab change is a 120ms opacity
  fade with no exit animation (`.tab-panel`), so the page never collapses
  between panels.

The layout tests run the real app on Vite's dev server with the API mocked in
the page (`frontend/e2e/`), so they need no backend: `npm run test:e2e`.

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
- **Approvals dated by `reviewed_at`, not the letter date** — deliberate; a
  typed letter date would let a late filing rewrite a closed month.
- **Action Center tickets calling the screens' own list functions** instead
  of fast counts — deliberate; a ticket must open exactly what it counted
  (§ 5e).
- **The tracking epoch (1 Mehr 1405)** flooring every clock — deliberate; CPM
  data has no earlier dates, and a 2023 date would make everything overdue.
- **The page itself never scrolling** — deliberate; see "The frontend layout
  contract" above. A page that needs to scroll does so inside `.page-outlet`
  (or its own card), never by giving the body a height.

The backend tests cover all of these. If a change breaks one, the test is
probably right.
