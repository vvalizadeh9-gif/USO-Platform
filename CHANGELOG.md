# Changelog

## UEP Home: Microsoft 365 redesign

Home restyled to Fluent 2 (light only), and its numbers made to reconcile.
Design and rules: `docs/design/uep-home.md` §0.

* **Totals are the cards.** Every headline figure and app badge is summed
  from the tickets Home returns; badges carry their parts for a tooltip
  ("HC assignment 224 + HC review 6").
* **Acceptance is two rows for everyone:** Pending ICT and Pending CRA
  villages (the acceptance universe, one per site, site type and village
  code), scoped by role and labelled "All project", "Your regions" or "Your
  sites". The detailed acceptance queues stay on the Action Center.
* **Regional Managers get Home** from the sidebar (they still land on Roles
  Performance), without "Done today".
* **14-day trends** under each KPI, from the daily snapshot; missing days are
  gaps. Change badges compare with last week (Done: with yesterday).
* **No Up next**, and no status dots or bars: status is a red "late" or
  orange "due soon" tag, and every card has the same neutral button.
* **Look:** neutral page, white cards, gradient area tiles, two-tone icons,
  sentence-case app labels, the Shamsi date in Persian digits. The Action
  Center left the Apps list; the KPI figures open it, and Overdue opens
  `/action-center?view=overdue`.
* **Migration** `d4b6f8a1c357`: `action_daily_snapshot.due_soon` (nullable,
  additive). The snapshot job now also covers Regional Managers and Home's
  own queues; the email digest is unchanged.
* `GET /home/summary` adds `shamsi_date`, `trends`,
  `totals.due_soon_week_delta`, per-ticket `unit` and `owners_total`, and
  per-group `scope_label`; `app_badges` becomes `{count, parts}`; `up_next`
  is removed.

## UEP Home

A new landing page for PM, Coordinator, Contractor and problem owners
(`/home`), replacing the Action Center as where `/` lands for them. Design
and rules: `docs/design/uep-home.md`.

* **One glance.** How much is waiting on you, how much is overdue or due
  within 3 days, what you finished today against yesterday, and the change
  since last week (from the daily snapshot; no chip when there is none).
* **Three cards.** Drive test (health check and drive test queues),
  Acceptance (ICT and CRA) and Plans. Each queue is a row with its count, a
  late or due-soon tag in words, one dot per item (a bar above 30 items),
  who holds the items, and how old the oldest is.
* **One thing next.** The queue with the most late items (then the oldest,
  then the most items) is marked Up next, and its card holds the page's only
  primary button, "Start with …". The server decides, so every reader of
  "next" agrees.
* **The month's plan.** The running Shamsi month's drive-test plan as one
  dot per planned site, filled as delivered.
* **Apps.** Every screen this role can open, grouped as Rollout, Insights
  and Programme office, with a count where something is waiting. The list
  and its visibility are the sidebar's own (`lib/nav.js`).
* **The Action Center stays** at `/action-center`, one link away. Regional
  Manager, Viewer and Admin land where they did.
* `GET /home/summary` serves the page in one request; `GET
  /action-center/board` is unchanged. No migration.

## Sign-in refinements

The sign-in screen, brought closer to Microsoft, Okta and Google.

* **Quieter look.** The brand panel is solid cobalt with the product's name
  only (no rings, no tagline). The form opens with the mark and "Sign in to
  UEP", with no helper sentence. Links stand on their own without underlines
  (underlined on hover and focus). The footer keeps only Privacy and
  Accessibility.
* **One route to help.** "Can't sign in?" beside the Password label opens the
  administrator request; it replaces "Forgot your password?", the footer
  mail address and the captcha's separate unlock link. It is also the
  security check's non-puzzle alternative (WCAG 3.3.8).
* **Errors as one line.** A refusal shows one red line under the password
  and focus moves to the field to fix (the first empty field, or the
  cleared password) instead of a boxed summary. The line is a live region,
  so screen readers still hear it.
* **Compact security check.** One row: "4 + 7 =", the answer, and a refresh
  icon. Still only after 2 failures or when the server asks.
* **Back to where you were.** Anyone sent to sign-in from a page (a
  signed-out link, or a session that expired mid-task) returns to that page
  afterwards. The page travels as `?next=` and is followed only when it is a
  path on this site (`lib/returnTo.js`).
* **Remember my username.** An opt-in checkbox, off by default because
  contractors share laptops. A remembered name is pre-filled and the cursor
  starts on the password. Only the username is stored; sign-out leaves it.
* **Left-to-right fields.** Username, password, security check and the help
  form's identifier are `dir="ltr"`, so a Farsi keyboard cannot flip them.
* The skip link is shown only on the sign-in view, where its target exists
  (it failed axe on the help views). `--signin-ring` is gone.

## Action Center → Task Board

The ticket board is replaced by an open task board (approved design "Action
Center Final").

* **One sentence, not figures.** The PageBar says "N items waiting on you, M
  overdue", with when it was last updated and a Refresh button. Tabs: All
  tasks and Overdue ("M late"), which keeps only queues with something late.
* **A step rail** pinned under the PageBar draws the lifecycle once: Health
  Check → Drive Test → ICT acceptance → CRA acceptance → Accepted, with
  Plans & Data alongside. Every role sees all five steps.
* **Minimal cards:** the count, "N overdue" in words when something is late,
  the action verb first, and the oldest item's age. Sorted most overdue,
  then oldest. The whole card is one link.
* **Verb-first queue names** in the registry ("Assign sites", "Review HC
  results", "File villages", …); the digest and the SLA screen use them too.
* **Keyboard:** arrow keys between cards, O for Overdue, and a "Skip to
  tasks" link.
* **Layout:** the board may scroll in the page body; no column scrolls by
  itself. Loading keeps the final layout; the error and all-caught-up states
  are Cobalt banners.
* Cobalt gains amendments D–G (open columns, one summary sentence, card
  hover, step rail). The ticket-only tokens (`--fs-board-total`,
  `--fs-ticket-count`, `--shadow-ticket`, the stage tints and lines) are
  gone.

## Sign-in redesign

The login screen is now a cobalt brand panel beside the form (the panel gives
way to a small brand row below 900px), built to WCAG 2.2 AA and NIST SP
800-63B.

* **Security check only after repeated failures.** The server asks for the
  captcha once a username or address has 2 recent failed sign-ins
  (`login_captcha_after_failures`), answering 400 with `X-Captcha-Required`
  until it is solved. It does this for usernames that don't exist too, so the
  400 doesn't reveal which accounts are real. Lockout is unchanged. The check
  accepts Persian and Arabic digits and links to an administrator for anyone
  who can't complete it.
* **Errors:** a focused error summary whose entries jump to the field, inline
  messages above each input, and one generic "The username or password is
  incorrect". Lockout and suspension messages come from the server.
* **Forms:** visible labels, no placeholders, paste allowed, a text
  Show/Hide button in the tab order, Caps Lock in a live status region, and
  focus moved to each view's heading on every view change.
* **Motion:** four rings expand once and stop by 4.9s. With reduced motion
  they are hidden.
* The privacy notice and accessibility statement links are placeholders
  (`PRIVACY_NOTICE_URL`, `ACCESSIBILITY_STATEMENT_URL` in `Login.jsx`) until
  those documents exist.

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

## Action Center → Ticket Board

The Action Center is one screen answering "what is pending for me, across the
lifecycle, and how late is it?": one column per stage (Health Check, Drive
Test, ICT, CRA, Plans & Data), one equal-size ticket per queue with its count,
the oldest item's Shamsi date and how many are overdue. A ticket opens the
queue screen holding exactly the items it counted.

* **Who gets it:** PM, Coordinator, Contractor and problem owners, each
  landing on it. Regional Manager lands on KPI & Performance and Viewer on the
  Drive Test dashboard; the board answers them (and Admin) 403.
* **One queue registry** (`services/action_queues`): every queue defined once,
  each reading the list function behind its own screen. The board, the
  per-owner breakdown, the daily snapshot and the digest all read it.
* **SLA:** 14 days per queue by default, changed in Admin → Action SLA with no
  deploy. Fixes follow their category's SLA; the monthly plan its deadline.
  Undated items, and anything from before tracking began, start at 1 Mehr 1405.
* **Daily email digest:** `python -m app.jobs.daily_digest`, run by cron.
  Snapshots every board daily, emails Saturday to Wednesday, at most once per
  user per day, failures logged and retried. Each user can turn it off from
  their account menu. The platform's first outgoing mail.
* **"Mark as sent to ICT / CRA"** in My Work records the request letter, and
  a new staff tab, **With authority**, lists what is waiting on an answer —
  the PM's "Follow up with ICT / CRA" ticket.
* The HC Pool opens on a state from the URL (`?state=ready`) and My Drive
  Tests on a row status (`?status=sent_back`), so the tickets can link to
  exactly what they counted.

New endpoints: `GET /action-center/board`, `GET /action-center/owners`,
`GET`/`PUT /admin/action-sla`, `GET`/`PUT /me/notifications`,
`POST /acceptance/authority-requests`. `GET /action-center/summary` is
deprecated. Migration `a1c3e5f7b902` adds `action_queue_sla`,
`action_daily_snapshot`, `digest_log`, `acceptance_authority_requests` and
`users.email_digest_enabled`.

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
