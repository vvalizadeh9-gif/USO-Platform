# Changelog

## Performance → Roles Performance, rebuilt

The KPI & Performance page is replaced by five tabs at `/reports/kpi/…`. The
sidebar keeps its one item, and `/reports/kpi` (and any old bookmark) opens
the role's own first tab.

| Role | Tabs | Lands on |
|---|---|---|
| PM, Viewer | Month · Area · Performance · Compare · Map | Month |
| Regional manager, coordinator, contractor | My area · My performance · Map | My area |

* **Month:** this month so far against last month up to the same day, in four
  cards (project delivery, acceptance, full config, problematic). Each row is
  shown as blocks, or as a ranked line of owners per coordinator, contractor
  or regional manager.
* **Area:** today's standing, with six cards, a breakdown by province, CRA
  region or contractor, and the open work, each linking to Lifecycle Gaps.
* **Performance:** result tiles against the national rate and the role
  average, delivered per month, activity in UEP and three median response
  times.
* **Compare:** owners of one kind, ranked. Low-sample owners are "Not
  compared" and listed last. Speed ranks contractors and coordinators by
  median days.
* **Map:** the Lifecycle Gaps coverage map, unchanged.

Rule changes:

* **Viewer (general manager) is a read-only PM.** Viewer reads Roles
  Performance and Lifecycle Gaps for any scope and may download Excel. Every
  write route still refuses Viewer.
* **The "never rank people" rule is retired.** PM and Viewer may rank owners;
  everyone else still sees only their own scope.
* **Credit follows ownership at the time**: a province handed over mid-month
  credits each owner with their own days.
* **Before Mehr 1405, approvals, full config and problematic flows read "Not
  recorded"**, never 0.

New endpoints: `GET /kpi/month`, `/kpi/area`, `/kpi/performance`,
`/kpi/compare` and their `.xlsx` exports. `GET /kpi/lenses` gains provinces,
past owners and province labels (docs/design/roles-performance-api.md). User
guide: docs/user-guide/roles-performance/.

**Deprecated, removed next release:** `GET /kpi/summary`, `/kpi/contractors`,
`/kpi/export.xlsx`, `/kpi/export.pdf`.

**Deploy note:** migration `c2e8f4a6b913` adds `lifecycle_status_history`
(additive). The first CPM import after deploy fills it and marks those rows
`backfilled`. It is the fallback on-air date where CPM carries no launch date.
The brief's `performance_event` table is **not** created: activity is read
from `acceptance_submissions`, which already is that log (ARCHITECTURE.md
5b). The CPM data wipe now also empties `lifecycle_status_history`.

## Acceptance → My Work, rebuilt

My Work is a one-screen workspace (1440×900 and 1280×800, the page never
scrolls): the village list on the left, what CPM requested for the focused
village, then its ICT and CRA side by side, each filed, sent and checked on
its own. Ticking two or more villages files one letter for all of them.

* **Who is listed:** villages, never sites, that are DT done, on air, هدف and
  not yet approved by both authorities. A dashboard figure opens the
  dashboard's own universe instead (`scope=universe`).
* **Tabs:** Your move · New letter needed · Returned · Not filed · With
  coordinator for a contractor; To check · Not filed · New letter needed ·
  Returned · All for a coordinator or PM. The counts, the totals in the page
  header and the sidebar badge come from the same query as the list.
* **Re-filing after a partial rejection** claims only the refused
  technologies; the approved ones carry over with their original date.
* **A coordinator's or PM's saved letter is recorded decided at once**,
  reviewed by them, and audited as such. Confirming a contractor's filing is
  unchanged, and nobody confirms their own.
* **Confirm all on this letter** decides every filed village on the same
  letter in one go. Return needs a reason.
* **Undo** for six seconds after every send or decision: nothing is sent
  until then.
* Letter numbers and dates are shown in Persian digits and stored in Latin.

New endpoints: `GET /acceptance/my-work`, `GET /acceptance/villages/{id}/suggestions`,
`POST /acceptance/villages/resolve`, `POST /acceptance/scans`,
`POST /acceptance/letters`, `POST /acceptance/letters/review`
(docs/design/my-work-api.md). `GET /acceptance/villages/{id}` gains the new
fields beside its old ones.

**Deprecated, removed next release:** `GET /acceptance/villages`,
`/villages/bucket-counts`, `POST /villages/{id}/submissions`,
`/submissions/bulk`, and the per-submission update, withdraw, review and
evidence routes. They answer with `Deprecation: true`.

**Deploy note:** migration `b7d3e5a1c826` replaces the index on
`acceptance_submissions (village_id, authority)` with one on
`(village_id, authority, round_no)`. No data changes.

## Mojri import matches on site and village codes; "2G" in the 2G column reads registered

After a Mojri import, **Lifecycle Gaps** showed every approved village as "Not
in Mojri". Two causes, either enough on its own:

* the importer matched each row on the internal village id, which nobody
  filling the file can know. The team's file holds CPM village codes, so rows
  matched nothing — or matched an unrelated village whose id equalled the code.
  Rows are now matched on **site_code, site_type and village_code**; the
  template carries those three plus `village_name`, and no internal id. The old
  `site_id` / `village_id` headers are still read, as codes, for one transition;
* a technology marked by writing its own name ("2G" in the 2G column), the CPM
  convention, read as "needs a look". The rule now lives in the shared token
  vocabulary, so the CPM and Mojri importers read a cell the same way.

The preview now says **"Matched X of Y rows"**, turns red below 90%, and
Confirm is refused when nothing matched. Each Mojri tile on Lifecycle Gaps
shows its split: in Mojri · needs a look · missing.

**Deploy note:** migration `e9a4c7b2d153` deletes every Mojri tracker status
(each was matched on the wrong key; the import-run history is kept). **The PM
re-uploads the current Mojri file once after deploy.**

## Erase CPM data after a Mojri import; the Mojri card compares every approved village

**Admin → Erase all CPM data** failed ("Erase failed") on any database that had
ever had a Mojri tracker import: `mojri_tracker_status` references `villages`
and was never deleted, so the village delete failed its foreign-key check and
the whole wipe rolled back. The wipe now also erases Mojri tracker statuses and
import runs (and drive-test evidence, explicitly). Every wiped table is listed
once in `data_wipe.WIPE_ORDER`, and a test walks the schema so a new table
that references CPM data can no longer be forgotten.

**Lifecycle Gaps → ICT vs CRA vs Mojri tracker** now compares **every** village
ICT or CRA approved (CPM and in-app, on air or not, drive test done or not)
with Mojri's tracker. It used to count on-air, drive-tested villages only,
while the Mojri template lists every approved village, so approved villages
off air were in the uploaded file but never counted on the page. The template
and the card now share one definition, and a test holds them equal. The
template now lists هدف villages only, like every other report. Cards 1 and 2
are unchanged. The Mojri import still never writes acceptance data.

## Acceptance Dashboard redesign; ICT and CRA plan streams

**Acceptance → Dashboard** is rebuilt around one question per card: *am I on
plan month by month, and what happened in a given month?* It now has one tab
per stream (Village = fully accepted, ICT, CRA), each with a KPI band, a
progress chart against the **Internal PIP** and the **Contractor PIP** (Monthly
bars or Cumulative lines), and a month panel with the two plans as rings.
It is one screen at 1440×900, and a new read, `GET /acceptance/progress`,
feeds the chart and the panel for all three streams at once.

**Monthly Plan** gains two plan streams, **ICT** and **CRA**, beside DT and
Acceptance: the PM sets an Internal PIP for each, and contractors file, and
revise, an ICT and a CRA PIP through the same flow. "MTN internal target" is
now called **Internal PIP** everywhere on screen.

### Removed, and why

One question per card; per-owner and per-contractor detail lives in Roles
Performance, not here. So the dashboard no longer has:

- the approval-flow Sankey;
- the monthly velocity chart;
- the ICT and CRA mini approval charts;
- the ICT vs CRA comparison;
- the remaining-split strip, and any breakdown of Village *Remaining*;
- the per-chart contractor filter (the page-wide scope picker replaces it);
- the on-air permanent / temporary split;
- "Not tested yet", and "ICT and CRA both approved, +N this month".

`GET /acceptance/trends`, which only the old charts read, is kept but marked
deprecated.
