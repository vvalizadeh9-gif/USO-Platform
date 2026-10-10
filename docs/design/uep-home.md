# UEP Home — design

Status: **built**, then redesigned to Microsoft 365 / Fluent 2 (§0). Source brief: `uep-home-landing-prompt.md`;
approved screen: `design-previews/home/uep-home-design-reference.html`.

Home is the landing page for PM, Coordinator, Contractor and problem owners,
and is open to Regional Managers from the sidebar.
In one glance it shows how much is waiting on the user, what is late or due
soon, how each has moved over 14 days, and every app they can open. It reads the
Action Center's queue registry and adds nothing that could disagree with it.

---

## 0. The Microsoft 365 redesign (current)

This section describes Home as it is now. Sections 1–9 below record the
first build; where they disagree with this section, this section wins.

### 0.1 Rules

| Rule | What it means |
|---|---|
| **Status is text** | No coloured bars or dots. A row says "3 late" (red tag) or "2 due soon" (orange tag). Every number is black. |
| **No green** | Green means approved in UEP, so nothing on Home is green, including the footer's status dot (grey). |
| **No Up next** | No queue is singled out. Every card has one neutral button: Drive test → its top queue's action, Acceptance → "Open acceptance", Plans → "Approve plans" (or "Open monthly plan" with no queue). `board.up_next` was removed: Home was its only reader. |
| **Totals are the cards** | `totals.pending == Σ ticket.count`, `totals.queues == number of tickets`, `overdue == Σ late`, `due_soon == Σ due_soon`; every app badge is the sum of its tickets and carries them as `parts`. The figures are summed from the tickets the response returns, never from the whole board. |
| **SLA unchanged** | Late and due soon are the Action Center's rules, unchanged (`sla.item_status`). The product owner chose not to add a separate "backlog" status for items imported from CPM; that may come later. |

### 0.2 Which queues Home shows

Declared once, in `action_queues/types.py`:

```python
HOME_QUEUES = {
    HomeGroup.ROLLOUT: None,                              # every board queue of HC + DT
    HomeGroup.ACCEPTANCE: ("ict_pending", "cra_pending"), # the two headline queues only
    HomeGroup.PLANS: None,
}
HOME_KEEPS_EMPTY = {HomeGroup.ACCEPTANCE}  # its two rows show even at 0
```

`registry.home_queues_for(role)` reads it. The detailed acceptance queues
(follow-up, to file, to validate, re-file, corrections) stay on the Action
Center board unchanged.

**Pending ICT / Pending CRA** (`ict_pending`, `cra_pending`, unit
*villages*, `on_board=False`): My Work's "remaining" population (هدف, drive
test Done, on air; `my_work_query.base_select`, so each role's own scope)
whose ICT (or CRA) side is not Approved, counted **once per site, site type
and village code** (`sources/acceptance.one_per_village`: a village CPM lists
for 3G and 4G on the same site is one village). Their clock is that side's
own waiting clock (`my_work_query.waiting_since(authority)`: the last
acceptance activity on that side, else the DT date); the codebase records no
"entered pending" date. They are snapshotted daily like every queue but are
not on the board or in the digest, where they would count villages twice.

### 0.3 Roles and scope

| Role | Home? | Lands on | Scope label | Done today |
|---|---|---|---|---|
| PM | yes | Home | All project | yes |
| Coordinator | yes | Home | Your regions | yes |
| Regional manager | **yes (new)** | Roles Performance (Home is in the sidebar) | Your regions (their provinces, `apply_work_item_scope`) | **hidden** |
| Contractor | yes | Home | Your sites | yes |
| Problem owner | unchanged | Home | "<role> fixes" | yes |
| Viewer, Admin | no (403) | unchanged | — | — |

A Regional Manager's Home is the Acceptance card (and the month's plan).
They have no Action Center, so their KPI cells are figures, not links.
`context.home_role(user)` decides; `board_role` is unchanged.

### 0.4 Trends

Each KPI has a 14-day series (`services/home_trends.py`), oldest first,
ending today. Today's point is the live figure. An earlier day is `null`
(drawn as a gap, never as zero) when that day's `action_daily_snapshot` rows
do not cover **every** queue Home shows the user (no snapshot that day, or a
day from before a queue existed), and, for due soon, when the rows predate
the `due_soon` column (NULL). "Done" per day is
`action_queues.done.done_per_day`, read from the domain tables, so it is
known for all 14 days.

Change badges: Waiting, Overdue and Due soon compare today with 7 days ago;
Done today compares with yesterday. With no comparison point there is no
badge.

Migration `d4b6f8a1c357` adds `action_daily_snapshot.due_soon`. It is
nullable on purpose: an old row's NULL means "not known", where 0 would
claim "none were due soon".

### 0.5 Tokens (Home scope, `styles/home.css`)

| Token | Value |
|---|---|
| Page / card | `#F4F5F8` / `#FFFFFF`, edge `0 0 0 1px #DCDFE4, 0 2px 6px rgba(0,0,0,.05)` |
| Lines | header `#E1E3E8`, inside cards `#ECEDEF`, button stroke `#C9CCD1` |
| Neutral tint / row hover | `#EFF0F3` / `#F3F4F6` |
| Text | primary `#1F1F1F`, secondary `#3D3D3D` (never lighter) |
| Brand (`lib/theme.js`, overridable) | `#0F6CBD`, ink `#0C3B5E`, tint `#EBF3FC` |
| Hero tile | `linear-gradient(135deg, #0F6CBD, #4F52B2)`, white text |
| Tags | late `#B10E1C` on `#FDE7E9`; due soon `#A8420A` on `#FEEEE5` |
| Area tiles | Drive test / Rollout `#2B88D8→#0F6CBD`; Acceptance / Insights `#7B83EB→#4F52B2`; Plans / Programme office `#C94FAE→#8E2483`, each with a 5–6% header band and a 14–16% band line |
| Sparklines | `#0F6CBD` 2px over `rgba(15,108,189,.10)`; white over `rgba(255,255,255,.18)` on the hero |
| Plan bar | delivered `#0F6CBD`, remaining `#E3E6EB`, 6px |
| Radii | cards 12, hero 8, rows 8, buttons 6, tags/badges/search round |

**Type** (Fluent 2 ramp, weights 400 and 600 only, `tabular-nums`):
`'Segoe UI Variable Text', 'Segoe UI', 'Inter', system-ui`. Inter is bundled;
no web font is ever fetched. Greeting 28/36, date 14/20, KPI label 16/22,
KPI number 40/52, change badge 13/24, headings and card titles 20/28, queue
name 16/22, queue count 28/36, tags 13, row text 14/20, buttons 14/20,
captions 12–13. The Shamsi date is Vazirmatn in `<span lang="fa" dir="rtl">`.

### 0.6 Icons

`pages/home/homeIcons.jsx`: bold two-path line icons on a 24px grid, with a
grey base stroke (`#616161`) and one accent (stroke or fill) in its own
colour. The same drawing renders all white inside a colour tile. Apps pick
theirs with `app.glyph` in `lib/nav.js`, beside a sentence-case `app.label`.
`lucide-react` stays for small single-colour UI glyphs (search, arrows, the
clock in a tag). The Action Center is no longer listed among the Apps: the
KPI figures open it. Overdue opens `/action-center?view=overdue`; Due soon
and Done open the whole board, which has no such views yet.

### 0.7 The "268 in 6 queues" report

The backend could not produce it: its totals were always the sum of the
tickets it returned. The figures came from the hand-written e2e and
screenshot fixture (`e2e/fixtures.js`). Its totals were typed in (268) while
its tickets added up to 266, and its 4th Drive test row (DT assignment, 22)
sat below the card's internal scroll fold: 266 − 22 = 244 visible. The
fixture now sums its totals from its tickets, and an e2e test fails if any
card hides a row at 1440×900. The new `HOME_QUEUES` rule is what could make
the server disagree with its cards, and
`test_queues_home_does_not_show_are_not_in_its_totals` holds it.

---

## 1. Decisions

The product owner delegated these. Each one is reversible unless marked.

| # | Topic | Decision |
|---|---|---|
| 1 | Font | Home only, on **Manrope**, scoped to the Home shell through `--font-home`. Self-hosted woff2 (OFL) in `assets/fonts/`, like Inter; never Google Fonts at runtime. App-wide adoption is decided later, after Home has been seen beside the other pages. |
| 2 | Colours | New tokens (§4) are added beside Cobalt's and used by Home only. `--bg` and `--accent` stay as they are app-wide. |
| 3 | Icons | Tinted round icons are a **scoped exception** to Cobalt rule 6, for Home and its Apps panel only. It is documented the same way as the Action Center's stage-marker exception. |
| 4 | "Done" | An item **left a queue today through an action recorded against this user** (Tehran day). It is read from the actor and timestamp columns the domain tables already have (§3.3). **No new table.** A queue whose completing action records no actor is left out of "done", and the doc lists which. |
| 5 | Shell | `/home` is a **full-width shell** outside `Layout`: header, main, Apps panel, footer. Other pages keep `Layout` unchanged, and the sidebar gains a "Home" item at the top of *Today*. |
| 6 | Problem owners | Same Home. Their only queue (Fix assigned problems) gives them one card; there is no Plans card. |
| 7 | Tenant theming | Token structure only: `lib/theme.js` exports `DEFAULT_BRAND` and `applyBrand(brand)`. No loading mechanism this sprint. |
| 8 | Cards | Three fixed groups. **Drive test** = HC + DT stages. **Acceptance** = ICT + CRA. **Plans** = Plans & Data. A group is shown when the role has any queue in it, so the layout stays stable even when a card is empty. Rows use a new `short_label` on `QueueDefinition` ("HC review", "ICT filings", "CRA filings"); the registry `label` stays the board's and the button's verb. |
| 9 | SLA heading | "SLA 14 days" when every configured-SLA queue on this user's board has the same days. Otherwise "SLA per queue", with a tooltip listing each queue's days. |
| 10 | Due soon | Late items are never also due soon. For configured-SLA queues, due = `effective_start + sla_days`. For category and deadline queues, due = `due_at`. An item is due soon when `0 ≤ due − now ≤ window`. The window is `HOME_DUE_SOON_DAYS=3` in `Settings`. |
| 11 | Header | The **search pill** is honest: "Search sites" opens Work Items with its search focused, and ⌘K / Ctrl+K does the same. A real cross-entity search is its own project. The **bell is omitted** until notifications exist. **Help** links to `VITE_HELP_URL` and is hidden when that is unset. |
| 12 | Who holds it | No invented Latin initials. Under each row, up to two **owner names** (Farsi, Vazirmatn, `dir="auto"`) and "+N". They are left out when the only owner is the viewer or the "PM" role. Scope is inherited from each queue's own fetch, so a contractor only ever sees themself (and therefore no line). |
| 13 | Plan progress | The **DT stream**, for the running **Shamsi** month ("Mehr plan"). It reuses `monthly_plan.running_month()`, which is already role-scoped: a contractor sees only their own figures, and staff see their visible scope. It shows "41 of 64 sites delivered · 22 days left", where days left runs to the Shamsi month end. With no approved plan it says so; the PIP is never 0. |
| 14 | Apps | An optional `app: {group, icon, tint}` on existing `NAV_SECTIONS` items, so `navItemVisible` stays the single visibility rule. The groups are Rollout, Insights and Programme office. Coverage map and Contractor tracker are **dropped** because they don't exist. "Browse all apps" opens a drawer of every visible nav item. |
| 15 | Rule conflicts | These fix WCAG AA. `--h-faint` becomes `#6B6B76` (4.6:1, not 3.4:1). UP NEXT, avatars and group headers are at least 12px. Dots get a 1px inner ring, so each reaches 3:1 against white. Uppercase eyebrows are a documented Home exception. |
| 16 | Footer | Status comes from `GET /api/health`, polled once on load. A failure says "Service unreachable" in words with the danger dot. The version is `VITE_APP_VERSION`, injected from `package.json` at build time. |
| 17 | View reports | Goes to the first dashboard this role can see in `NAV_SECTIONS`, which is `/reports/drive-test` for all four Home roles. |
| 18 | Endpoint | A new `GET /home/summary` (§2). `BoardOut` is left untouched. |

## 2. Endpoint: `GET /home/summary`

**Why a new endpoint rather than extending `BoardOut`.**

- Extending is one fewer route. But it adds per-row owners, plan progress, snapshot deltas and done counts to a payload that the sidebar badge polls every 60s on every page. Those reads aren't free (plan progress is a pass over work items).
- A separate endpoint keeps the polled board cheap and backward compatible. Both are built from the same summaries, so they cannot disagree.
- The cost of this choice is a second schema, which is acceptable.

Same access rule as the board: `NotOnBoard` → **403** for Regional Manager, Viewer and Admin.

```jsonc
{
  "role": "PM",                       // board display role
  "scope_label": "All provinces",
  "generated_at": "2026-10-09T08:54:00Z",
  "due_soon_days": 3,
  "sla_uniform_days": 14,             // null when queues differ
  "sla_days": {"hc_review": 14, ...}, // for the tooltip
  "totals": {
    "pending": 34, "queues": 6, "overdue": 6, "due_soon": 5,
    "pending_week_delta": 4,          // null when no snapshot 7 days ago
    "overdue_week_delta": -2,
    "done_today": 6, "done_yesterday": 4
  },
  "up_next": "dt_review",             // null when nothing pending
  "groups": [{
    "key": "drive_test", "label": "Drive test",
    "tickets": [{
      "queue_key": "dt_review", "label": "Review DT results",
      "short_label": "DT review", "count": 9,
      "on_time": 6, "due_soon": 0, "late": 3,
      "oldest_started_at": "...", "earliest_due_at": null,
      "date_kind": "since", "url": "/drive-test?tab=review",
      "owners": ["پیشرو فن", "آرین"], "owners_more": 7
    }]
  }],
  "plan": {                            // null for problem owners / no data
    "stream": "DT", "shamsi_year": 1405, "shamsi_month": 7,
    "month_name": "Mehr", "pip": 64, "delivered": 41, "days_left": 22
  },
  "app_badges": {"/drive-test": 21, "/health-check": 6, "/my-work": 5, "/monthly-plan": 2}
}
```

- **Tickets** are zero-count-free, as on the board. Within a group they are sorted as on the board: most late, then oldest. `on_time + due_soon + late == count` always holds.
- **`app_badges`** are ticket counts summed by the path of each ticket's `url` (`/my-work?…` → `/my-work`). The frontend looks badges up by a nav item's `to`. No query runs per app.
- **Up-next rule** (`board.up_next(summaries)`): most late, then earliest `oldest_started_at`, then highest count, then registry order so ties stay deterministic. It is one function. The digest doesn't show a "next" item today; if it ever does, it calls this.

## 3. Backend

### 3.1 Files

| File | Change |
|---|---|
| `services/action_queues/types.py` | `QueueDefinition` gains `short_label`. Add `HomeGroup` and `STAGE_GROUP` (stage → group). |
| `services/action_queues/registry.py` | `short_label` for each queue. |
| `services/action_queues/sla.py` | `due_at_for(item, kind, sla_days)` and `item_status(item, kind, sla_days, now, window) -> "late" \| "soon" \| "on_time"`. `is_overdue` is re-expressed through it, with identical behaviour. |
| `services/action_queues/board.py` | `QueueSummary` gains `due_soon` and `top_owners` (default-valued, so existing callers are unchanged). `summarize` counts them. Add `up_next()`. |
| `services/action_queues/done.py` | **new**. `RULES`, one per completing act, each naming the queues it drains; `done_by_day(db, user, role, today)`. |
| `services/home.py` | **new**. Composes one summary pass, snapshot deltas, done counts, plan progress and app badges. Cached through `count_cache`, keyed like the board. |
| `schemas/home.py`, `api/home.py` | **new**. A thin router, registered in `main.py`. |
| `core/config.py` | `home_due_soon_days: int = 3`. |

**No migration.** Snapshots already exist, and "done" reads existing columns. If `EXPLAIN` on production-sized data shows the done queries scanning, the remedy is composite `(actor, timestamp)` indexes in one Alembic migration with a downgrade. That gets decided on measurement, not up front.

### 3.2 One pass

`home.summary(db, user)` builds a `QueueContext` once, fetches each of the role's queues once, and from those items derives the board summaries, the per-status counts and the owners. Plan progress is a single call to `running_month()`. Snapshot deltas are one query: this user's rows for today − 7. Done counts are about 8 grouped queries, whatever the data size. **The query count is constant in the number of sites**, and a test asserts it at two programme sizes (the pattern in `test_dashboard_query_counts.py`).

### 3.3 "Done"

**As built:** rules are defined once per *completing act*, each naming the queues it drains, not once per queue. Filing, re-filing and correcting a village are three queues but one act (a submission); a rule per queue would count it three times. The acts are the ones below.

| Queue | Done today when… |
|---|---|
| Assign sites | `HcAssignment.assigned_by = me`, `assigned_at` today |
| Review HC results | `HcTask.reviewed_by = me`, `reviewed_at` today |
| Decide re-routes | *Not counted.* `reroute_by` is the proposer; the decision records no actor. |
| Submit health checks | `HcTask.completed_at` today on my contractor's assignment |
| Fix assigned problems | `HcRemediation.closed_by = me`, `closed_at` today |
| Assign drive tests | `Assignment.assigned_by = me`, `assigned_at` today |
| Review DT results | `DriveTest.coordinator_reviewed_by` or `pm_reviewed_by = me`, that `_at` today |
| Drive-test sites / Redo | `DriveTest.submitted_at` today on my contractor's assignment |
| File / Re-file / Correct (ICT, CRA) | submission `submitted_by = me`, `submitted_at` today |
| Validate contractor filings | submission `reviewed_by = me`, `reviewed_at` today |
| Follow up with ICT/CRA | *Not counted.* The item leaves the queue when the authority answers, not by the PM's act. |
| Approve plans | `ContractorMonthlyPlan.decided_by = me`, `decided_at` today |
| Validate CPM changes | `CpmChangeRequest.decided_by = me`, `decided_at` today |
| Submit monthly plan | `ContractorMonthlyPlan.submitted_by = me`, `submitted_at` today |

"Today" and "yesterday" are Tehran calendar days (`jalali.TEHRAN`). Counts are actions, not distinct items: a plan approved and re-approved counts twice, as the person did two things.

### 3.4 Snapshot deltas

`pending_week_delta = live pending − Σ count` of this user's `action_daily_snapshot` rows for today − 7, and the same for overdue. No snapshot that day (a new user, or a cron gap) gives `null`, and the chip is not drawn. Nothing is extrapolated.

## 4. Tokens

Added to `:root` in `app.css`. The brand block is the only thing a tenant changes.

```css
/* Tenant brand: the only per-operator values (lib/theme.js DEFAULT_BRAND) */
--brand: #2563EB;  --brand-hover: #1D4ED8;  --brand-soft: #EFF6FF;
--brand-ink: #1E3A8A;  --brand-950: #172554;
/* Home neutrals and status (fixed) */
--h-ink: #111113;  --h-ink-2: #3F3F46;  --h-muted: #5F5F6B;  --h-faint: #6B6B76;
--h-canvas: #F0F0F2;  --h-line: #EAEAEE;  --h-dot: #DCDCE2;  --h-dot-ring: #B9B9C3;
--late-ink: #B91C1C;  --late-soft: #FEE2E2;  --late-dot: #E5484D;
--soon-ink: #B45309;  --soon-soft: #FEF3C7;  --soon-dot: #F5A524;
--h-radius-card: 24px;  --h-radius-hero: 18px;  --h-radius-row: 16px;
--font-home: 'Manrope', 'Vazirmatn', sans-serif;
/* Soft round icons: --tint-{blue,violet,teal,slate,red,amber}-{from,to,icon} */
```

**White-label rule.** Brand appears only on the logo, the one primary button, the Up-next highlight, the hero tile and the focus ring. Status, data and neutrals never change per tenant.

## 5. Frontend

### 5.1 Component tree

```
App.jsx  route /home  (RequireAuth, outside <Layout>)
└─ pages/Home.jsx                    data load, state machine, ⌘K
   └─ home/HomeShell.jsx             grid: header / main+aside / footer; 100dvh, no scroll
      ├─ home/HomeHeader.jsx         BrandMark, SearchPill, HelpButton?, AccountMenu (reused)
      ├─ main
      │  ├─ home/Greeting.jsx        eyebrow (Gregorian date · role), "Good morning, Mina", View reports
      │  ├─ home/KpiStrip.jsx        HeroTile + KpiCell×3 + TrendChip
      │  └─ home/YourWork.jsx        heading, SLA label, legend
      │     └─ home/WorkCard.jsx ×N  header (SoftIcon, title, ↗), body scrolls
      │        ├─ home/QueueRow.jsx  label, StatusTag, count, <ItemDots>, owners · age
      │        ├─ home/PlanProgress.jsx   (Plans card only) dot grid / meter
      │        └─ footer button  (primary only in the Up-next card)
      ├─ home/AppsPanel.jsx          groups from NAV_SECTIONS[].app, badges, Browse all → AllAppsDrawer
      └─ home/HomeFooter.jsx         status, "Data as of HH:MM", Help, Privacy, version
components/ItemDots.jsx              THE dot rule: ≤30 → dots, >30 → segmented bar
components/SoftIcon.jsx              tinted round icon (Home-scoped exception)
lib/theme.js                         DEFAULT_BRAND, applyBrand()
lib/greeting.js                      greetingFor(date), gregorianLabel(date) — Tehran time
styles/home.css                      everything under .uep-home
```

`AccountMenu` moves out of `Layout.jsx` into `components/AccountMenu.jsx` with no behaviour change, so the Home header reuses it rather than copying it.

### 5.2 States

- **Loading:** skeletons with the final geometry: a hero tile, three cells, three cards of two rows each, and the Apps panel. No layout shift (Playwright compares element boxes before and after load).
- **Empty** (`pending == 0`): the cards area becomes "Nothing waiting on you", with Done today still shown.
- **Error:** a Cobalt error banner with Retry, inside the main area. The header, Apps panel and footer still render.
- **403:** the route redirects to `homeFor(role)`, so it can only happen if roles drift. It shows "Home isn't available for your role" with a link to that landing.

### 5.3 Accessibility

- The dots and bar are `aria-hidden`. Their row link's label carries "Test review, 9 items: 6 on time, 0 due soon, 3 late, oldest 21 days".
- Tags carry an icon and words. The legend is text.
- Tab order: header → greeting → KPI → cards left to right (rows, then button) → Apps → footer.
- Focus rings use `--brand`.
- Motion: card hover lift (amendment F) and a 200ms number fade, via the existing `fadeUp`/`stagger`. Nothing moves under `prefers-reduced-motion`.

### 5.4 Fit

At 1280×800 the main column is 1280 − 64 − 300 − 24 = **892px**, so each card is about 286px wide. The dot rows wrap (11px dots, 4px gap, so 30 dots is 3 rows at most). Cards scroll their rows internally; the document never scrolls. Below 1180px wide the Apps panel moves under the cards and the main area scrolls inside `.uep-home-main`.

## 6. Routing

- `homeFor()`: `ACTION_CENTER_ROLES` → `/home`. Regional Manager, Viewer and Admin are unchanged.
- `/action-center` stays the full board.
- The sidebar gets **Home** (house icon) at the top of *Today* for the same roles.
- Every row, ↗ and footer button links to a ticket `url`. ↗ and the footer button use the card's top-ranked ticket.

## 7. Tests

**Backend (pytest)**
- `item_status` window edges: due in exactly 3d (soon), 3d+1s (on time), past due by 1s (late, not soon), and the SLA-day and due-date kinds.
- `up_next` tie-breaks: late → oldest → count → registry order, and nothing pending → `None`.
- Week deltas: a snapshot present, absent (`null`), and present with a different queue set.
- Owners per role: a contractor sees no foreign owner; a coordinator only contractors in their provinces.
- `app_badges` sum equals ticket sum, and each badge equals the sum of its tickets.
- Done counts per queue rule, Tehran midnight boundary, and someone else's act not counted.
- Query count: the same at 1× and 2× programme size.
- 403 for Regional Manager, Viewer and Admin; 200 for the four roles.
- The `/action-center/board` response is byte-for-byte unchanged (a golden test).

**Frontend (Vitest + Testing Library)**
- `ItemDots` at 30 (dots) and 31 (bar), with its aria label.
- Exactly one `.btn-primary` on the page, and it is in the Up-next card.
- The Up-next highlight follows `up_next` from the API.
- Empty, loading, error and 403 states.
- Apps filtered by role (contractor vs PM), with badges from `app_badges`.
- `greetingFor` boundaries (05:00, 12:00, 18:00 Tehran).

**E2E (Playwright, mocked API as existing specs do)**
- A PM lands on `/home`; there is no document scroll at 1440×900 or 1280×800; "Start with …" navigates to the ticket URL.
- A visual snapshot at 1440×900.

## 8. Commits

1. `sla`: per-item status and due-soon window, plus summary counts (tests)
2. `board`: the up-next rule (tests)
3. `done.py`: done rules per queue (tests)
4. `GET /home/summary`, its schema and service (tests: 403, badges, deltas, owners, query count, board golden)
5. Tokens, Manrope files, `theme.js`
6. `ItemDots` and `SoftIcon` (tests)
7. `AccountMenu` extracted from `Layout` (no behaviour change)
8. The Home page and its states (tests)
9. Routing, the nav `app` metadata, the sidebar Home item (tests)
10. E2E and the visual snapshot
11. Docs: `ARCHITECTURE.md` §5f, `design-system-cobalt.md`, `CHANGELOG.md`

## 9. Trade-offs and risks

- **Derived "done" vs an event table.** Derived needs no migration and no new write path that could be forgotten. In exchange, two queues aren't counted and the rule is per table. An event table would be exact but needs every write path instrumented. Derived is the right size for now.
- **Owner names vs the design's initials.** The design's initials can't be made truthfully from Farsi company names. Names are longer, so they truncate with an ellipsis and the full list is in the title.
- **"Mehr plan" vs "October plan".** Plans are Shamsi months, and a Gregorian label would be wrong for 22 days of every month.
- **Search pill.** It is deliberately reduced to sites and Work Items until a real search exists.
- **The 300ms target.** Board builds already list items, and plan progress is a pass over work items. Both are cached for a few seconds per user. I will measure on the largest seed available and report the real number. I cannot verify production-sized data from here.
- **The Manrope files** have to be downloaded once (OFL, from the official release) into `assets/fonts/`. I'll ask before downloading.
