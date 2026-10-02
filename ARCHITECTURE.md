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
now), and the Action Center's "Sites to assign" ticket counts the pool's
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

| Tab | Counts | Plan stream | Colour |
|---|---|---|---|
| Village | villages **fully accepted** (ICT and CRA both approved) | `ACCEPTANCE` | `--accent` |
| ICT | villages approved by ICT, whatever CRA has said | `ICT` | `--ict` |
| CRA | villages approved by CRA, whatever ICT has said | `CRA` | `--cra` / `--cra-ink` |

Each tab is a KPI band, a progress chart (Monthly bars or Cumulative lines)
and a month panel. Two reads feed the whole page, and each card loads, fails
and retries on its own:

- `GET /acceptance/overview` -- the KPI band. Unchanged apart from an
  optional `province_id`, so the page-wide scope picker narrows the band and
  the chart alike.
- `GET /acceptance/progress?months=12&province_id&contractor_id` -- the chart
  and the panel, **all three streams at once**, so a tab switch never
  refetches (`services/acceptance_progress.py`, response
  `schemas.AcceptanceProgress`). `GET /acceptance/progress/export` is the
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

The panel's arithmetic (due by today, pace, what is left, per day) is in
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

On Monthly Plan the PM sets an Internal PIP per stream (the Internal PIP card
on PIP vs Achieved), and a contractor files all four PIPs on one form, each
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

## 5b. KPI & Performance

One reporting page, added after the rest. It answers a question none of the
dashboards above could: **how is one owner doing, against the country?** The
owner is a Regional Manager, a PSO Coordinator, a Contractor or a CRA Region —
four lenses over the same numbers.

### The mapping is new master data

`province_mapping` records who owns a province over a period of time: its CRA
region, PSO coordinator and regional manager, between `effective_from` and
`effective_to`. A reassignment closes the open row and opens a new one, so a
figure computed for last quarter still belongs to whoever held the province
then. A partial unique index enforces one open row per province — two rows in
force at once would make every lens count that province twice, with no error
anywhere.

It sits **beside** `provinces.coordinator_user_id` / `regional_manager_user_id`,
not instead of them. Those columns are Admin's, are read by the Acceptance
dashboard's filters, and carry neither a CRA region nor any history. The two
can be set independently and can disagree; only this table decides the KPI page.

`users.kpi_person_name` says which person in that table an account is — matched
against `regional_manager` for a RegionalManager account and `pso_coordinator`
for a Coordinator one. Contractors need nothing new: `users.contractor_id`
already holds what CPM carries in DT SC. An unlinked account is refused the
page with a message saying so.

### The metric rules

Stated once, in `services/kpi.py`, and followed by the screen and both exports
because all three read the same payload.

* **Final status only.** A village rejected and later approved counts as
  approved. `villages.ict_status` / `cra_status` are current standing, and are
  maintained in the same transaction as every change that could alter them.
* **Two denominators, deliberately.** On air and DT done divide by the scope's
  total. ICT and CRA approval and rejection divide by **DT-done villages** — a
  village whose drive test is unfinished was never eligible for acceptance.
  The "remained" counts keep the total-villages base.
* **The country average is weighted**: the sum of every province's numerator
  over the sum of their denominators, never the mean of 31 percentages.
* **It is the whole country, always**, whatever the viewer can see. It is the
  one figure computed outside the viewer's scope, and it is an aggregate of
  thirty-one provinces, so it identifies nobody.
* **Fewer than ten DT-done villages and a province is not compared.** It is
  still shown, in grey, reading "not compared", taking no colour and sorting
  last. Three approvals out of three is not a 23-point lead.
* **Nothing ranks people.** The heatmap ranks provinces inside one scope.

### Everything is one GROUP BY

`last_stage`, `dt_status` and `target_classification` are free text that the
import normalises on the way in, but rows written by earlier imports carry
spacing and letter-form variants. The distinct values are read first — a few
dozen across the whole table — and passed through the same `cpm_columns`
helpers the rest of the platform uses, then used as an `IN` list. The
aggregation stays a single pass and cannot disagree with what the other screens
call on air, DT done or a target village.

### Sites with no province

A CPM `استان` cell matching none of the 31 leaves `sites.province_id` NULL.
Those work items have no province and therefore no owner, so they cannot appear
in anybody's lens. They are counted in the **country total** and shown as one
"Unknown province" row rather than dropped: otherwise the per-province rows
would quietly fail to add up to the country figure, which is the one property
that makes this page checkable.

### Who sees what

| Role | Scope | Lenses | Contractor comparison |
|---|---|---|---|
| PM | All 31 provinces | All four, any person | All contractors |
| Regional Manager | Own provinces | Own only | Hidden |
| PSO Coordinator | Own CRA regions | Own only | All contractors in own regions |
| Contractor | Own sites (DT SC) | Own only | Hidden |
| Admin | **No access** | — | — |

Enforced on every endpoint, exports included. A non-PM asking for someone
else's lens or key gets a **403**, not a silent substitution — a substitution
would show a manager a page headed with another manager's name and let them
believe it. Admin's absence here is the Admin/PM separation in section 6,
applied to reporting.

### Exports

Built from the payload the screen already received, never from a second query,
so a number in the file cannot differ from the one on screen. Excel uses
`openpyxl`, already present. The PDF uses `reportlab` — a pure-Python renderer,
no browser and no extra container, because this server has no route to the
public internet.

---

## 5c. Lifecycle Gaps

The second reporting page over the same villages, and it asks the opposite
question to the one above it. KPI & Performance asks "how is this owner doing?"
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
`resolve_scope` rather than restating them: Admin is refused, PM sees the
country under any of the five lenses, and every other role sees **only their
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
province and region: approved, pending and remained over the drive-tested
base, and the owners behind them by coordinator, contractor, RM (and, for a
region, province — weakest CRA approval first). **The detail counts like the
Gaps tab, not like the map colours**: it is a fold of the overview's grid
(same scope, same cells), because every count in it is an export and an
export lists the overview's villages. So a province's panel can read a little
differently from its colour (the colour's CRA base is ICT-approved villages); the tests hold the panel
to the overview and to its exports, and the map to its own counting.
`tests/test_gaps_map.py`, `tests/test_gaps_export.py`.

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

## 5e. The Action Center

Before this, people tracked their work in Excel and nobody could see what was
waiting on whom. The Action Center is each person's one answer to **"what is
pending for me, across the whole lifecycle from Health Check to acceptance,
and how late is it?"** Each queue is a **ticket**: its name, how many items,
the oldest item's date, and how many are past the SLA. A ticket is a link to
the queue screen that holds those items.

### Who gets it

| Role | Action Center | Lands on |
|---|---|---|
| PM, Coordinator, Contractor | Yes | Action Center |
| Problem owner (any `is_category_owner` role) | Yes | Action Center |
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
| HC | Sites to assign | PM, Coord | pool waiting-since (on-air, or last fix closed) | HC Pool, "Ready to assign" |
| HC | HC results to review | PM, Coord | `hc_tasks.completed_at` | HC Review |
| HC | Re-route decisions | PM, Coord | `reroute_at` | Re-routes |
| HC | HC to submit | Contractor | `hc_assignments.assigned_at` | My Health Check |
| HC | Fixes assigned to me | Problem owner | `opened_at`; late after `due_at` (the category's SLA) | My Fix Queue |
| DT | DT to assign | PM, Coord | HC review, or `returned_at` if handed back | Drive Test → Assignment |
| DT | DT results to review | PM, Coord | `drive_tests.submitted_at` | Drive Test → Review |
| DT | Sites to drive test | Contractor | `assignments.assigned_at` | My Drive Tests, `status=with_contractor` |
| DT | Returned to redo | Contractor | `coordinator_reviewed_at` | My Drive Tests, `status=sent_back` |
| ICT/CRA | Follow up with ICT / CRA | PM | request letter `sent_at` | My Work → With authority |
| ICT/CRA | Villages to file | Coord, Contractor | last activity, else DT date | My Work → Not filed |
| ICT/CRA | Contractor filings to validate | Coord | submission `submitted_at` | My Work → To check |
| ICT/CRA | Rejected, to re-file | Contractor | rejection `reviewed_at` | My Work → New letter needed |
| ICT/CRA | Returned, to correct | Contractor | return `reviewed_at` | My Work → Returned |
| Plans | Plans to approve | PM | `submitted_at` (revisions too) | Monthly Plan → Plans |
| Plans | CPM changes to validate | PM | `cpm_change_requests.created_at` | Admin → Validate CPM |
| Plans | Monthly plan to submit | Contractor | **due** on the day-3 deadline | Monthly Plan |

"Returned, to correct" is separate from "Rejected, to re-file" because they
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
stays on "Villages to file" until the answer is filed.

### SLA and overdue (`sla.py`)

- Default **14 days** per queue, stored in `action_queue_sla` (a missing row
  is the default) and set by an Admin in **Admin → Action SLA** or
  `PUT /admin/action-sla`. No deploy.
- An item is overdue when `now − started_at > sla_days`, strictly: 14 days
  exactly is on time.
- **Fixes** are late after their own `due_at`, set from the problem category's
  SLA when the fix opened. **Monthly plan to submit** is late after the end
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

`frontend/src/pages/ActionCenter.jsx`, a one-screen page (`PageFrame`): the
Shamsi date and title on the left, `N pending` and `N overdue` on the right,
then a grid with one equal column per stage. Every ticket is the same height
(172px) and is a real link. A column with more tickets than fit scrolls
inside itself; the page never does (`e2e/noPageScroll.spec.js`,
`e2e/actionCenter.spec.js`). The motion is one entrance, then nothing:
tickets drop in staggered by column and by place, numbers count up, overdue
pills fade in after. With `prefers-reduced-motion` the final state shows at
once. The sidebar badge is the board's `totals.pending`. The component and
its tokens are in `design-system-cobalt.md`, "Ticket board".

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
  a long tab that is not a one-screen design (HC Review, History, the Plans
  board) scrolls inside the frame; the document still never does. The
  one-screen designs (DT dashboard Overview, PIP vs Achieved, HC Pool, HC In
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
