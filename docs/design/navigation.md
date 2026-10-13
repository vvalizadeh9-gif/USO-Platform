# UEP navigation model and app registry (UEP-02)

## The model

- **No global sidebar.** Every signed-in page sits in `shell/AppShell.jsx`: a
  56px header and, inside an app, that app's rail.
- **Global level:** the header. It holds the app launcher, the logo (links to
  Home), the breadcrumb, the tenant switcher, global search (Ctrl/⌘+K),
  notifications and the account menu.
- **App level:** a left rail lists only the current app's pages (3–7). An app
  with one page has no rail. The rail collapses below 1100px and stacks above
  the content below 720px.
- **Home** is the only page with the full Apps panel. It has no rail.

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
total, a KPI and the notification badge can never disagree.

`pages[].divider` draws a 1px rule under the page in the rail, setting it apart
from the queue pages below. Drive test uses it for **Dashboard**
(`/reports/drive-test`, UEP-04): it is the app's first page, carries no count,
and is the same page that Insights → Dashboards opens, not a copy. The Drive
test rail reads: Dashboard · HC check · HC review · Assignment · DT review ·
In progress · All sites (pages filtered by role as usual).

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
