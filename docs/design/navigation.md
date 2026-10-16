# UEP navigation model and app registry (UEP-02)

## The model

- **No global sidebar.** Every signed-in page sits in `shell/AppShell.jsx`: a
  56px header and, inside an app, that app's rail.
- **Global level:** the header. It holds the app launcher, the logo (links to
  Home), the breadcrumb, global search (Ctrl/⌘+K) and the account menu.
  Search matches apps and pages as you type, and sites, villages, provinces,
  contractors and (for Admin) people through `GET /search`, each scoped to
  what the person may open (`shell/GlobalSearch.jsx`, `backend/app/api/search.py`).
- **App level:** a left rail lists only the current app's pages (3–7). An app
  with one page has no rail. The rail collapses below 1100px and stacks above
  the content below 720px.
- **Home** is the only page with the full Apps panel. It has no rail.

## Header search (UEP-12)

`shell/GlobalSearch.jsx` (state and keyboard), `shell/SearchOption.jsx` (a
result row), `shell/searchLook.js` (group icons and tones, matched text),
styles in `styles/shell.css`. What it finds, its routes, the 200ms debounce
and the role scoping are unchanged; only the presentation moved.

**Field.** Centred in a flex zone between the logo and the avatar.

| State | Look |
|---|---|
| Rest | 480px × 36px (`--uep-header-search-width`, `--uep-header-search-height`), radius 8, `--uep-search-fill`, no visible border (1px transparent), icon and placeholder `--uep-text-3`, a `Ctrl K` / `⌘ K` hint |
| Hover | `--uep-search-fill-hover` |
| Focused | 640px (`--uep-header-search-width-open`), white, `--uep-accent` border and `--uep-focus-ring` (the focus indicator: the input's own outline is off), cobalt icon; the hint cross-fades to `Esc`, the old one moving 3px up and the new one coming from 3px below |

Below 760px the hint is hidden and the open field takes the whole zone. Width
grows over 240ms (`--uep-ease-standard`); colours change over 160ms
(`--uep-ease-productive`).

**Results panel.** 6px under the field, as wide as the open field, radius
12, `--uep-shadow-search`; the list is at most `min(60vh, 460px)` and scrolls
inside. It enters (fade 180ms, rise from `translateY(-6px) scale(.985)` over
240ms, origin top centre) and leaves faster (120ms, `--uep-ease-exit`). It
stays mounted with `data-state="showing|hidden"` and is `inert` and
`aria-hidden` while hidden, so it never pops off mid-animation.

- Groups: "Apps and pages", "Sites", "Villages", "Provinces", "Contractors",
  "People" (12px/600). "Search all sites for “…”" is last, for roles that can
  open Explorer.
- Rows (42px): a 28px tile with the group's Carbon icon in an app hue
  (pages and people neutral, sites Drive test teal, villages Acceptance
  violet, provinces and contractors Insights blue, "Search all sites"
  cobalt), the label with the matched text in 600 cobalt, the meta right
  after it, and a cobalt Enter arrow on the active row. Persian labels and
  meta parts are Vazirmatn inside `<bdi>`, so "کرمان · Acceptance" never
  reorders. Each option is named by its label and meta (`aria-label`).
- One `--uep-accent-tint` highlight behind the rows slides to the active row
  (120ms); it jumps when the list changes. Hover moves it; ↑ ↓ move it and
  scroll the row into view.
- Rows rise 4px and fade in (220ms, 14ms apart, first 10) when the panel
  opens and when a group first appears, such as server results landing.
  Typing within groups already shown does not replay it.
- Loading is a 2px cobalt line across the panel's top edge (900ms loop); a
  visually hidden `role="status"` says "Searching…".
- A footer lists ↑ ↓ Move · ↵ Open · Esc Close (`aria-hidden`).

**Keys.** Ctrl K / ⌘ K focuses and selects. ↑ ↓ cycle, Enter opens the active
result (or the first). **Esc** clears the text if there is any (the field
stays focused and open); on an empty field it leaves it, and the field
shrinks back.

**Reduced motion.** Width, panel, highlight and hint changes take 1ms, rows
do not stagger, and the loading line stands still at 40%.

## The registry

`frontend/src/shell/appRegistry.js` declares every app:

| Field | Meaning |
|---|---|
| `id`, `name`, `description` | Identity and the one-line description |
| `icon` | A Carbon icon name from `components/icons.js` |
| `color`, `tint` | CSS custom properties for the tile and card-header tint |
| `group` | `rollout`, `planning`, `insights` or `platform` |
| `roles` | Who sees the app (absent: everyone) |
| `pages[]` | `id`, `label`, `route`, `roles`, `queues`, `divider`, `also` |

`pages[].queues` is the page's count query: the Home queue keys whose counts
it sums (`'*'` for all of them). Counts are read from the one `GET /me/home`
response (`shell/HomeData.jsx`), so a rail count, an Apps-panel pill, a card
total and a KPI can never disagree.

`pages[].divider` draws a 1px rule under the page in the rail, setting it apart
from the queue pages below. The Acceptance app uses it for its **Dashboard**.

The Drive test app has no Dashboard in its rail since UEP-11: the Drive Test
dashboard (`/reports/drive-test`) is Insights → Dashboards, and the app opens
on its first page for the role through `appRoute` (staff and contractors: HC
check; category owners: Fix queue). The Drive test rail reads: HC check ·
HC review · Assignment · DT review · In progress · Explorer (pages filtered by
role as usual). **Explorer** (`/explorer`) is the site list, and every site's
record page (`/explorer/sites/:id`) lights it too; `/work-items` and
`/work-items/:id` redirect there.

Acceptance's first page has been its **Dashboard** since UEP-07
(`/reports/acceptance`, divider, no count), the page Insights → Acceptance
dashboard also opens. Its address carries `?tab=village|ict|cra`,
`?year=1405` (default the current Shamsi year) and `?month=1405-07`.

The launcher, the Apps panel and every rail are generated from this list with
`appsFor(role)`. The rail's active page is the page whose route best matches
the URL (`locate`): same path, and the most query params in common. A page's
`also` routes make it active too, matched on their path and exact `tab`.

### Drive test rail and the pipeline (UEP-06)

Health check and Drive test are one pipeline on two pages, and the step is the
URL's `?tab=` (`lib/pipelineSteps.js`). The rail is unchanged; each step
lights the rail item for its part of the work:

| Step | Route | Rail item |
|---|---|---|
| 1 · Assign health check | `/health-check?tab=pool` (legacy `basket`; also `/health-check`) | HC check |
| 2 · In health check | `/health-check?tab=running` | HC check |
| 3 · Review results | `/health-check?tab=review` (legacy `results`) | HC review |
| 4 · Assign drive test | `/drive-test?tab=assignment` (also `/drive-test`) | Assignment |
| 5 · With contractor | `/drive-test?tab=in-progress` | Assignment |
| 6 · Review drive test | `/drive-test?tab=review` | DT review |
| DT done | `/drive-test?tab=done` (links to `/drive-test/sites?bucket=done`) | — |
| Loop · Remediation | `/health-check?tab=remediation` | HC check |
| Loop · Re-routes | `/health-check?tab=reroutes` | HC check |
| Loop · Sent back | `/drive-test?tab=sent-back` | Assignment |
| History | `?tab=history` on either page | — |

`/health-check?tab=dt-assign` and `?tab=dt-review` redirect to the Drive test
page's steps and keep the rest of the query. Rail counts still come from
`GET /me/home`. The strip's counts come from `GET /drive-test/pipeline/summary`,
which counts through the same queue service.


### Monthly plan rail (UEP-08)

The rail's pages are the staff page's four tabs, in tab order:

| Rail item | Route | Roles | Count |
|---|---|---|---|
| Approvals | `/monthly-plan` (also `?tab=approvals`) | everyone with the app | `plans_approve`, `plan_submit` |
| Plans | `/monthly-plan?tab=plans` | PM, Coordinator, RegionalManager, Viewer | — |
| History | `/monthly-plan?tab=history` | PM, Coordinator, RegionalManager, Viewer | — |
| Internal PIP | `/monthly-plan?tab=internal` | PM, Coordinator, RegionalManager, Viewer | — |

A contractor's Approvals item opens their own filing page, as the old
*Contractor PIP* item did. Home's *Approve plans* links to
`/monthly-plan?tab=approvals`. History reads `GET /pip/overview?period=year`,
whose streams carry `months[]` (`plan`, `delivered`, `internal`, `is_running`,
`is_future`, `contractors[]`); see ARCHITECTURE §5h.

### Roles performance tabs (UEP-09)

Insights' *Roles performance* item opens `/reports/kpi`, which lands on the
role's first tab:

| Tab | Route | Roles |
|---|---|---|
| Month | `/reports/kpi/month` (`?month=YYYY-MM&measure=`) | PM, Viewer |
| Area / My area | `/reports/kpi/area` (`?lens=&key=&measure=`) | PM, Viewer / RegionalManager, Coordinator, Contractor |
| Map | `/reports/kpi/map` | everyone with the page |

Any other tab, including the removed `/reports/kpi/performance` and
`/reports/kpi/compare`, redirects to the role's first tab and keeps `?lens=&key=`.
A Month owner opens `/reports/kpi/area?lens=&key=`; an Area row opens
Lifecycle Gaps with `?lens=&key=`. Month reads `GET /kpi/month?by=owners`
(three owner lists per row in one call); Area reads `GET /kpi/area`, whose rows
carry `measures: {onair, dt, full, ict, cra}` with `totals` and `national`
(see docs/design/roles-performance-api.md).

### Adding an app or a page

1. Add the app (or the page) to `APPS`. Give it roles and, if it has pending
   work, the queue keys behind it.
2. Add its route in `App.jsx`, inside the shell route.
3. Add a Carbon icon to `components/icons.js` if it needs a new one, and its
   tile colour to `styles/uep-tokens.css` (and `design/tokens.js`).

The shell is not touched.

## Not mapped yet

The Admin console has no separate "Organizations" or "HC import" screen, and
the Action Center has no "Due soon" or "Done" view (both open the whole
board). Those pages appear once the screens exist.

## One count per queue (UEP-13)

For every queue, the Home work-card row, the app-rail badge and the page
header show the same number: the items waiting on the signed-in user, read
from the queue's `count` in `GET /me/home`. Pages with a header count
(`PageHeading`, Monthly plan Approvals) read that field through
`useHomeData().counts`; `/drive-test/pipeline/summary` counts through the same
queue service and is only the fallback while `/me/home` loads. A page that
lists more than the waiting items shows the wider list as a filter with its
own count, never under the same name (`pool_total` in an API).

| Queue key | Where | Counts |
|---|---|---|
| `hc_assign` | HC assignment | Sites on air with no health check assigned, in the user's scope |
| `hc_review` | HC review | Submitted health-check results nobody has reviewed |
| `hc_reroutes` | Re-routes | Fixes whose owner disputes the category |
| `hc_submit` | HC check (contractor) | Health checks assigned to the contractor and not submitted |
| `hc_fixes` | Fix queue | Open fixes owned by the user's role |
| `dt_assign` | DT assignment | Confirmed-Ready sites with no official drive-test assignment |
| `dt_review` | DT review | Submitted drive tests awaiting the PM/Coordinator's decision |
| `dt_todo` / `dt_redo` | In progress (contractor) | Drive tests with the contractor / sent back to them |
| `ict_*` / `cra_*` | Filing, Validation | My Work buckets, per authority |
| `plans_approve` | Monthly plan › Approvals | Plans Submitted for the planning month (next month) + revision requests on the running month |
| `cpm_changes` | Data › CPM changes | CPM change requests pending validation, in scope |
| `plan_submit` | Monthly plan (contractor) | Streams the contractor has not filed, plus returned plans still answerable |

Why Monthly plan used to disagree (2 in the menu, 15 on the tab): Home
counted every current Submitted/RevisionRequested plan of any month, the tab
counted per stream for the planning month only. Both now use the tab's
definition (`plans_awaiting_pm`).

## Where things live (UEP-13)

- **Explorer** is its own app, first in Rollout (Drive test roles). One page,
  so no rail. The record page's breadcrumb is in the header only:
  `UEP / Explorer / W4303`, where "Explorer" goes back to the list with its
  filters (`usePageCrumb` in `shell/crumbs.js`).
- **Insights** rail: Drive test dashboard · Acceptance dashboard · Roles
  performance · Lifecycle gaps · Exports.
- **Acceptance** rail: Dashboard · Filing · Validation · Letters. One
  workspace (`/my-work`), titled by its rail page: Filing (the filing buckets
  as a filter), Validation (`?tab=filled`), Letters (`?tab=all`).
- **Monthly plan**, **Admin** and **Data** draw no tab bar of their own; the
  rail is the menu and the page title is the rail label.
- Lifecycle gaps has no map tab; `/reports/gaps?tab=map` goes to Roles
  performance › Map, the only map.
- Remaining case: the Health check / Drive test pipeline pages keep the step
  name as the title (the strip is the view inside one page).
