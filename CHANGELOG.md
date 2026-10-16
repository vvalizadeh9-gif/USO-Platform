# Changelog

## Unreleased

- **UX audit fixes: error screens, one count per queue, DT review safety, one design system (Plex, Carbon, one blue), one page header, rail-is-the-menu, a date rule, less red, one dropdown, full-height pages, Explorer as its own app, copy and polish, contractor pages on a phone (UEP-13).**
  - Trust: card / page / app error screens with an Error ID posted to the new `POST /api/v1/client-errors` (logged, 30/min per user). Page headers lead with the `/me/home` count; plan approvals now count only what the Approvals page lists. DT review sorts longest waiting first, shows `N files` / a grey "No report", and Approve without a report needs "I checked the report outside UEP" — the API answers 422 otherwise and audits the flag. Meta lines never end on " · "; "0 rejected · 0 waiting"; the PIP "Today" label sits above the bar; the Mojri card has one compact empty state.
  - Foundation: the Cobalt `:root` block, Inter and Lucide are gone; every value is a `--uep-*` token (missing ones moved into `uep-tokens.css`), radii 4/8/12/999, type on the `--uep-fs-*` steps; ESLint and stylelint guard it; `design-system-cobalt.md` deleted. Coverage map in six blues (`--uep-map-1…6`), ICT/CRA chips on Explorer, freshness dot never green.
  - Consistency: `PageHeader` (64/104px) on every page; Acceptance rail Filing / Validation / Letters; Monthly plan, Admin and Data without duplicate tabs; `DateText` / `MonthText` and `lib/dateRule.js` (Gregorian day dates, Shamsi months in Persian digits, the other calendar on hover); waiting bars red only past the SLA; Area ranking red on three rows only; `Select` replaces every native `<select>`; Lifecycle gaps and Home fill the viewport.
  - Structure, copy, polish, phone: Explorer app with the record breadcrumb in the header; Insights "Drive test dashboard"; Lifecycle gaps map tab → Roles performance › Map; sentence-case titles and the copy table; flat sparklines, quieter Explorer rows, one tile style, footer status icon; a bottom bar and card rows below 768px.
  - Tests: unit tests for ErrorBoundary, joinMeta, PageHeader, Select, DateText use, map bands, flat sparklines, the review gate and the registry; e2e `designSystem.spec.js` (fonts, colours, icons, screenshots), `phone.spec.js`, and Home / Lifecycle gaps in `noPageScroll.spec.js`; backend `test_client_errors.py` and the DT approve gate.

- **Header search refreshed: filled field that widens on focus, animated results with a sliding selection and a loading line. Home: the greeting spans the page and the Apps panel lines up with the KPI strip and the work cards (UEP-12).**
  - Search: rests at 480px, filled and borderless; widens to 640px on focus with a cobalt border and ring, and the `Ctrl K` hint cross-fades to `Esc`. The results panel enters and leaves (it stays mounted, inert while hidden); rows carry a tinted group icon, the matched text in bold cobalt and Persian parts in `<bdi>`; one highlight slides to the active row; rows rise in only when the panel opens or a new group lands; loading is a 2px line with a hidden "Searching…" for screen readers; a footer lists the keys. **Esc** now clears the text first, then leaves the field. Results, routes, debounce and role scoping are unchanged.
  - Home: the greeting is a full-width page header; under it the Apps panel (now 340px) spans the KPI and work rows, so its top is the KPI strip's and its bottom the work cards'. The panel never scrolls: when a role's apps reach lower than its work cards, the cards stretch down to the same bottom line. Its contents stay at the top. Below 1100px it drops under the cards.
  - New tokens: `--uep-header-search-*`, `--uep-search-*` (fill, radius, tiles, rows, footer, motion), `--uep-dur-search-*`, `--uep-ease-exit`, `--uep-shadow-search`, `--uep-surface-sunken`, `--uep-home-apps-width`. Removed: `--uep-search-max`, `--uep-home-apps-basis`, `--uep-home-main-basis`. New Carbon icons: `enterprise`, `return`.
  - Tests: `e2e/headerSearch.spec.js` (width, Esc, highlight, reduced motion, axe with the panel open); `e2e/home.spec.js` checks both edges per role at 1440×900 and 1366×768. The mock API answers `GET /search`, and `captureHome.spec.js` now serves each role's summary on `/me/home` (it was routing `/home/summary`, so every screenshot showed the PM).

- **Explorer list redesigned: one card with search, filters and sortable column headers, rows that open the site record, inline villages, continuous scroll, keyboard navigation. Stage chips and numbered pages removed. Site journey now starts with On air (UEP-11a).**
  - List: search (site ID, village ID, village name, province; Persian letter forms folded), a Filter popover (Province, Site type, Requested tech, DT contractor) with removable chips, sortable SITE · PROVINCE · TYPE · TECHNOLOGY · VILLAGES · DT CONTRACTOR headers, all kept in the URL (`?q=&province=&type=&tech=&dt_contractor=&sort=&dir=`). The whole row opens the record; the villages pill opens the site's hadaf villages under the row. Fifty rows a page, loaded as the end comes into view; coming back from a record restores the rows and the scroll offset. Selecting rows shows a bulk bar (Export, Copy IDs). ↑ ↓ move between rows, Enter opens, Esc clears the search.
  - Removed from the list: the stage chips, the Stage, On air and assignment-contractor columns, the stage date columns, numbered pages and bulk assignment (assign from the Drive test page). The Contractor column is now the DT contractor (`dt_sc_contractor`). History stays beside Export. The header search's province and contractor results link with the new `province` / `dt_contractor` filters; old `?province_id=` / `?contractor_id=` links are read as those.
  - The list's village count is the record page's hadaf count (live villages whose classification is هدف), and a test holds the two equal. The old list counted every named village, removed ones included.
  - API: `GET /explorer/sites` (search, filters, sort, keyset `cursor`, `limit` ≤ 100; a fixed number of queries per request), `GET /explorer/sites/{id}/villages`, `GET /explorer/sites/filters` and `GET /explorer/sites/export` (same parameters, plus `ids` for a selection), in `api/explorer.py` → `services/explorer_list.py`. `GET /work-items` is unchanged. `work_item_export.build_sheet` is the shared spreadsheet builder.
  - Journey: On air is the first step (the order was already right in code; this confirms it). **Total aging** now counts from the on-air date only ("since on air"); a site without one has no total rather than one from a later step. 569 of 4,201 live sites have a DT date earlier than their on-air date; their pill reads "—", never a negative number.
  - Layout (Part A): in every full-height work page, fixed rows (title, tool bar, header row, footer) are `flex: none` and only the scroll region may shrink (`styles/work.css`), so a row can no longer collapse to its scrollbar's height as the stage-chip row did.
  - Motion: rows rise in 6px (360ms, 24ms stagger, first 20 rows) on a new result; the record page's cards do the same, Journey 60ms after General information. Popovers, chips, the village strip and the bulk bar fade and slide 4px. Nothing animates under reduced motion.
  - New tokens: `--uep-explorer-*` list sizes and motion, `--uep-row-hover-accent`, `--uep-row-selected`, `--uep-search-mark`. New Carbon icons: `filter`, `copy`, `arrow--up`, `arrow--down`. Field icons and hues are shared with the record page (`FIELD_ICONS` in `explorerModel.js`).

- **Drive test rail: Dashboard removed (still under Insights › Dashboards). All sites is now Explorer: a site record page with general information, the journey with aging between steps, and ICT/CRA acceptance per village; header search opens it directly (UEP-11).**
  - Part A: the Drive test app opens on its first queue for the role (staff: HC check; contractor: HC check; category owners: Fix queue). `/reports/drive-test` and every link to it still work; the Acceptance app keeps its own Dashboard.
  - Routes: `/explorer` (the list), `/explorer/sites/:workItemId` and `?village=V10232` to highlight a village. `/work-items` redirects to `/explorer` keeping its query; `/work-items/:id` to `/explorer/sites/:id`. Header search opens a site's record, a village result opens its site with the village highlighted, and "Search all sites for …" opens `/explorer?q=…`. The DT dashboard's site list and My Work's village record link to the record page.
  - List: titled Explorer, search also matches village ID (and village name, as before), a Villages column, and a row opens the record when the stage is not one sites are selected on.
  - Record page: General information (seven rows with colour icon tiles), the step path in process order (On air → Health check → Assigned → DT done → Acceptance) with an aging pill between steps, four compact aging tiles, and Acceptance by village (two panels up to six villages, one table with a scrolling body above). Every date on Explorer is Gregorian, "6 Oct 2026" (`lib/dates.formatGregorian`).
  - The old detail page's forms (assign, submit DT, return to coordinator, DT review) are kept, unchanged, in a **Take action** drawer shown only when the user has one of them. Assignment is now offered only on sites awaiting it (Ready for assignment, Returned by contractor), as on the list; the server refused it everywhere else.
  - API: new read-only `GET /explorer/sites/{work_item_id}` (`api/explorer.py`, `services/explorer.py`, `services/explorer_journey.py`), a fixed number of queries per request. `GET /work-items?q=` also matches village codes and ignores removed villages. `GET /work-items/{id}` is unchanged.
  - Database: `work_items.site_contractor_id` (nullable FK to `contractors`, indexed), filled by the CPM import from column 31 on every import with the DT contractor's name matching. Raw rows of earlier imports are not kept, so it fills on the next import.
  - My Work reads `?q=` from its address (Explorer's "Open in My Work" and "File letter").
  - Removed: `pages/WorkItemDetail.jsx`, `pages/WorkItems.jsx` (now `pages/explorer/ExplorerList.jsx`), the unused `queueLink` and the `.detail-grid` / `.detail-rail` / `.rail-row` CSS. New tokens: `--uep-field-*` and the `--uep-explorer-*` sizes and motion values. New Carbon icons: `car`, `portfolio`, `connection-signal`, `building`, `task--complete`, `hourglass`, `meter`, `pending`.

- **Acceptance dashboard: moved into the Acceptance app, DT dashboard look, one Shamsi year per chart with planned months, PIP card replaces the rings (UEP-07).**
  - Fixes the blank screen on `/reports/acceptance`: the view model had moved to the new shapes while the page still read the old ones, so the first render threw.
  - API: `GET /acceptance/progress` gains `year` (that year's twelve months; future months carry plans, `approved: null` and `is_future: true`) and `years` for the dropdown. Without `year` the response is unchanged.
  - Page: tabs Fully accepted · ICT · CRA; province and contractor scope buttons (the Drive test `ScopeMenu`); the dense four-tile KPI strip with Remaining split into rejected and waiting, each a drill-through; the year chart with a year plan track, readout, keyboard model and Table view; the PIP card with per-plan pace lines and the totals to date.
  - Removed: the rings (`PlanRing`), the Monthly/Cumulative switch and `chartGeometry`, the month `<select>`, the `.acc-stream-*` colours and the old `.accd-*` CSS. `Section` and `MonthLabel` move to `components/`; the DT `KpiSkeleton` is shared.

- **Roles Performance · Map: fits the window without scrolling; the detail panel shows sites and villages for delivery, ICT and CRA; the owner list and its switch are removed; CRA borders are white (UEP-10).**
  - API: `GET /gaps/map` rows' `detail` is now `{delivery: {assigned, on_air, dt}, ict: {approved, pending}, cra: {approved, pending}}`, every leaf `{sites, villages}`; `ict`/`cra` gain `sites: {approved, reached}` for the tooltip. `detail.owners` and the `base`/`remained` counters are removed. New `_site_grid` (one site = one work item, approved when every village is).
  - Removed: the List by switch, `DETAIL_LENSES`, `detailRows`, `REMAINED_NOTES`, the Pending / Remained tiles, the caption under the map and their CSS. New token `--uep-ease-standard`.

- **Roles Performance: Month shows who each month's results belong to (contractors, regional managers, coordinators side by side); Area ranks provinces, CRA regions and owners against national; Performance and Compare tabs removed (UEP-09).**
  - Tabs: PM and Viewer get Month · Area · Map; everyone else My area · Map. Old `/reports/kpi/performance` and `/compare` links land on the role's first tab with `?lens=&key=` kept. Map is unchanged.
  - Month and Area share one layout: a measure list on the left (selection in `?measure=`) and a breakdown on the right. Month's title is a Shamsi month picker, it opens on the last closed month, and it shows no comparison with the previous month. Clicking an owner opens their Area.
  - Area lists the pipeline (Total villages, On air, DT done, Fully approved, ICT, CRA) with rates and, when scoped, the gap to national. It ranks every breakdown member by gap to national on a deviation bar, with the national row pinned and rows under 10 DT-done villages "Not compared".
  - API: `GET /kpi/month` gains `by=owners` (`owners_by` per row: three lists summing to the row total), `current_month` and `first_year`, and defaults to the last closed month (`default_month`). `GET /kpi/area` accepts `breakdown=coordinator|rm` (PM and Viewer only) and returns `totals`, `national` and per-row `measures`; `cards`, `open_work` and the per-row `dt_done`, `on_air_only`, `not_on_air`, `remaining`, `ict`, `cra` and `attributed` are gone, and the Area workbook follows the new shape. The default breakdown is now Provinces for every role.
  - Removed: `/kpi/performance`, `/kpi/compare` and their `.xlsx`, `PerformancePayload`, `ComparePayload`, `services/performance/person.py`, `compare.py` and `activity.py` (the per-person trend and the UEP activity and response-time measures go with them), `PerformanceTab`, `CompareTab`, block rows, delta chips, the headline cards, the old breakdown table and Open work, with their CSS, tests and docs.
  - The page now uses the UEP tokens, IBM Plex Sans and Carbon icons, and the shared `PageBar` (which gains an optional `subtitle`) and `Tabs`. New tokens: `--uep-rank-second`, `--uep-danger-stripe`, `--uep-danger-edge`, `--uep-weight-bold` (with the Plex 700 face) and a few Roles Performance sizes and motion values. Its old page-local dark mode is gone, like on the other UEP pages.

- **Monthly plan: Approvals first (all waiting plans on one page), Plans, new History table, refined Internal PIP (UEP-08).**
  - The staff page has four tabs: **Approvals** (default, `?tab=approvals`), **Plans** (`?tab=plans`), **History** (`?tab=history`) and **Internal PIP** (`?tab=internal`). Unknown keys, including the old `?tab=pip`, open Approvals. The rail pages match the tabs; Home's *Approve plans* links to Approvals.
  - Approvals shows one card per contractor with a plan waiting, plus one per pending revision request. **Approve** decides every waiting plan on the card (one `POST /pip/{id}/approve` each, in parallel; a partial failure names the stream and keeps the card). **Return** asks for a required comment in a dialog. There is no Undo, because the API cannot reverse an approval.
  - Plans lists who shared for the planning month (a segmented bar and a *Not shared yet* strip). Each stream column shows the plan's status and the running month's delivered against plan. It has one column per stream in `STREAM_LIST`.
  - History is a new table of plan against delivered, month by month, for any year. It can be filtered by contractor and stream. The running month is shown but excluded from the totals. *Below 80%* is the only coloured result.
  - Internal PIP sets each stream's target for the running or planning month with a stepper (Enter saves), against a coverage bar per contractor.
  - API (additive): `GET /pip/overview?period=year` gains a per-stream `months[]` (12 entries: `plan`, `delivered`, `internal`, `is_running`, `is_future`, per-contractor figures). The `month` and `since_start` views return `months: null` and are otherwise unchanged.
  - Removed: the PIP vs Achieved tab (`PipTab`), the old Plans board, `PlanQueue`, `Scorecard`, `AcceptanceTarget`/`AcceptanceTargetCard`, `SetTargetForm` and their CSS and tests. `Tabs` gains `panelId` (ids and `aria-controls`) and a `countLabel`.

- **Drive test app: Health check and Drive test share one pipeline strip with volume bars; full-width site lists with Village and Province; contractor workload cards with a suggested contractor; persistent confirmations with Undo and a History view; DT review side panel; All sites restyled. WCAG 2.2 AA (UEP-06).**
  - Both pages show the same strip: steps 1–6, DT done, and the Remediation, Re-routes and Sent back loops. The step is the URL's `?tab=`, so Back and Forward work. Legacy `basket`, `results`, `dt-assign` and `dt-review` links still work. The old tab rows, the HC Pool state filter, `AssignDock` and its CSS are removed. `ProcessStepper` stays for Monthly plan only, and `LifecycleStrip` for the contractor pages.
  - Step 4 is the drive-test assignment queue. The pool's "Health check passed" state is no longer a tile: its rows are in steps 3, 5 and 6.
  - Assigning is: select sites, then click a contractor card. The suggested contractor is the one whose last 90 days cover the most of the selected provinces. Undo is available for two minutes, from the panel or from History.
  - Waiting is measured against each queue's configured SLA. Ready is cobalt, not green. Late is always written.
  - Reassign on late rows is not shown, because there is no reassign endpoint (see ARCHITECTURE §5g).
  - API (additive): `GET /drive-test/pipeline/summary`, `GET /hc/contractors/load`, `GET /drive-test/contractors/load`, `GET /work-items/counts`, `POST /hc/results/confirm` and three undo endpoints. `POST /work-items/assign` returns `batch_id`. List rows gain `village`, `village_count`, `pending`, `completed_at` / `days_waiting` and `launch_date_shamsi`, and `GET /work-items` gains `q`. `GET /hc/queues/counts` is deprecated. New audit action: `UNDONE`.

- **Drive Test dashboard: equal KPI tiles, chart always cumulative over all months, readout in place of the hover card, simpler PIP card (UEP-04a).**
  - The four KPI tiles are equal in width and lower (the dense dashboard variant). On air's line reads "+N this month". Home's KPI strip is unchanged.
  - "On air vs DT done" always shows every month cumulatively. The period switch, its subtitle and the net-change row under the chart are removed.
  - A readout beside the chart key shows the latest month, or the hovered or focused one, in place of the floating hover card.
  - PIP this month drops the pace and approval note (and the Monthly plan link). The bar and its "Today" tick stay. The month is bold in the PIP this month and What moved headers.

- **Removed the Action Center; Home shows each user's pending work. Fix queue moved to the Drive test app and restyled (UEP-05).**
  - `/action-center` (with or without `?view=`) and `/notifications` redirect to `/home`. The header bell links to Home; the account menu's Action Center item is gone; Home's KPI tiles are static figures.
  - The *My work* app is removed. Fix queue (`/my-fix-queue`) is in the Drive test app, and a category owner's Drive test rail shows only Fix queue.
  - API: `GET /action-center`, `/action-center/summary`, `/action-center/board` and `/action-center/owners` are removed (404). `/admin/action-sla` and `/me/notifications` are unchanged and now live in `api/work_queues.py` (tag `work-queues`).
  - The queue services still feed Home, the rail counts, the daily digest (which now links to Home) and the Admin SLA settings.
  - `ACTION_CENTER_ROLES` / `hasActionCenter` are renamed `WORK_ROLES` / `hasWorkQueues`.

- **Drive Test dashboard refresh (UEP-04):** the dashboard now matches Home, with the same figures, drill-throughs and API calls.
  - Dashboard is the first page of the Drive test app.
  - Cards have white headers with a 28px app tile.
  - The KPI strip is shared with Home: three tiles with 12-month sparklines, the "% of on air" in the change line, and Pending by status as the fourth tile.
  - "Where this is going" is renamed **"On air vs DT done"**. It gains keyboard reading (← → Home End), a tooltip that defaults to the latest month, and a "View as table" toggle.
  - PIP this month reads Plan · Assigned · Achieved · Remaining. The pace tick is labelled "Today", and "N behind pace" replaces the green Ahead/Behind pill.
  - What moved is four rows. Breakdown bars have column captions.
  - The tables have sticky headers, and the province table says when no province matches the search.
  - New empty-province state, and KPI skeletons at their final size.
  - Nothing on the page is green, and no chart uses teal.

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
