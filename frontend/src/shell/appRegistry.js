/**
 * The UEP app registry: the one place an app or an app page is declared.
 *
 * The launcher, Home's Apps panel and every app rail are generated from this
 * list, filtered by the signed-in user's features (GET /me/access, UEP-25).
 * Adding an app or a page is an entry here and a route in App.jsx; the shell
 * itself never changes. See docs/design/navigation.md.
 *
 * `need` names the feature an app or page needs, as lib/access.js `meets`
 * reads it: 'explorer', ['hc_work', 'edit'], or a function of the user.
 * Navigation asks for the *offered* answer, so a feature granted URL-only
 * (hidden in menus) is not listed. Features decide nothing here: every
 * endpoint re-checks them server-side.
 */
import { FEATURE as F, meets } from '../lib/access'
import { canOpenMonthlyPlan } from '../lib/roles'

/**
 * @typedef {'rollout' | 'planning' | 'insights' | 'platform'} AppGroup
 * @typedef {import('../components/icons').IconName} IconName
 *
 * @typedef {object} AppPage
 * @property {string} id
 * @property {string} label
 * @property {string} route      Path, optionally with the query that selects a tab.
 * @property {*} [need]         What it needs (lib/access.js meets); absent: everyone who sees the app.
 * @property {boolean} [adminDuplicate] Also in the Admin app: listed here only when the Admin app is not.
 * @property {string[]} [also]  Other routes that make this page the active one,
 *                               matched on their path and exact `tab` (the
 *                               pipeline's steps and loops; see UEP-06 §1).
 * @property {string} [description] One line, where a page is listed as an app (the region landing's Apps panel).
 * @property {string} [section] Rail group caption (UEP-14: Health check, Drive test, …).
 * @property {IconName} [icon]   The rail item's white Carbon icon.
 * @property {string} [tile]     CSS custom property for the rail item's colour tile.
 * @property {string[] | '*'} [queues] Home queue keys ('*' for all of them) whose counts make its pending
 *                               count (the count query). Read from GET /me/home,
 *                               so a rail count always equals Home's.
 *
 * @typedef {object} AppDef
 * @property {string} id
 * @property {string} name
 * @property {string} description  One line.
 * @property {IconName} icon       A Carbon icon.
 * @property {string} color        CSS custom property for the tile.
 * @property {string} [tint]       CSS custom property for a card header.
 * @property {AppGroup} group
 * @property {*} [need]           What the app needs; absent: shown when any page is.
 * @property {AppPage[]} pages
 */

/** @type {{ id: AppGroup, label: string }[]} */
export const APP_GROUPS = [
  { id: 'rollout', label: 'Rollout' },
  { id: 'planning', label: 'Planning' },
  { id: 'insights', label: 'Insights' },
  { id: 'platform', label: 'Platform' },
]

/** Home is not an app; the launcher shows it first, from here. */
export const HOME_APP = Object.freeze({
  id: 'home',
  name: 'Home',
  description: 'Your work at a glance',
  icon: 'home',
  color: '--uep-app-home',
  route: '/home',
})

/** @type {readonly AppDef[]} */
export const APPS = Object.freeze([
  {
    // Every site and village in scope, and each site's record page under it
    // (UEP-13 §3.12). One page, so the shell shows no rail.
    id: 'explorer',
    name: 'Explorer',
    description: 'Every site and village and its full record',
    icon: 'search--locate',
    color: '--uep-app-explorer',
    group: 'rollout',
    need: F.EXPLORER,
    pages: [{ id: 'explorer', label: 'Explorer', route: '/explorer' }],
  },
  {
    id: 'drive-test',
    name: 'Drive test',
    description: 'Health checks and drive tests per site',
    icon: 'connection-signal',
    color: '--uep-app-drive-test',
    tint: '--uep-app-drive-test-tint',
    group: 'rollout',
    // No Dashboard here (UEP-11): the Drive Test dashboard lives under
    // Insights › Dashboards, so the app opens on its first queue.
    //
    // UEP-14 §2: the staff rail runs Health check (Assign, Checks), Drive
    // test (Assign, Tests), Exceptions (Remediation) and History. Each item
    // carries its stage's colour tile and a white Carbon icon.
    pages: [
      { id: 'hc-check', label: 'Health check', route: '/my-health-check', need: F.CONTRACTOR_WORK, queues: ['hc_submit'], icon: 'task--approved', tile: '--uep-accent' },
      {
        id: 'hc-assign', section: 'Health check', label: 'Assign', route: '/health-check?tab=assign', need: [F.HC_WORK, 'edit'], queues: ['hc_assign'],
        icon: 'user--follow', tile: '--uep-accent',
        also: ['/health-check', '/health-check?tab=pool', '/health-check?tab=basket'],
      },
      {
        id: 'hc-checks', section: 'Health check', label: 'Checks', route: '/health-check?tab=checks', need: [F.HC_WORK, 'edit'], queues: ['hc_review'],
        icon: 'task--approved', tile: '--uep-accent',
        also: ['/health-check?tab=running', '/health-check?tab=review', '/health-check?tab=results'],
      },
      {
        id: 'dt-assign', section: 'Drive test', label: 'Assign', route: '/drive-test?tab=assign', need: [F.DT_ASSIGNMENT, 'edit'], queues: ['dt_assign'],
        icon: 'user--follow', tile: '--uep-app-drive-test',
        also: ['/drive-test', '/drive-test?tab=assignment'],
      },
      {
        id: 'dt-tests', section: 'Drive test', label: 'Tests', route: '/drive-test?tab=tests', need: [F.DT_REVIEW, 'edit'], queues: ['dt_review'],
        icon: 'data--check', tile: '--uep-app-drive-test',
        also: ['/drive-test?tab=in-progress', '/drive-test?tab=review', '/drive-test?tab=sent-back', '/drive-test?tab=done'],
      },
      // UEP-21: DT-done villages go to ICT HQ from here, the step after the
      // test. The count is Home's submit_to_ict queue, which only the PM and
      // the owner coordinator have.
      {
        id: 'submissions', section: 'Drive test', label: 'Submissions', route: '/submissions', need: F.SUBMISSIONS, queues: ['submit_to_ict'],
        icon: 'send', tile: '--uep-app-drive-test',
      },
      {
        id: 'remediation', section: 'Exceptions', label: 'Remediation', route: '/health-check?tab=remediation', need: [F.HC_WORK, 'edit'], queues: ['hc_reroutes'],
        icon: 'tool-kit', tile: '--uep-app-monthly-plan',
        also: ['/health-check?tab=reroutes'],
      },
      {
        id: 'history', section: 'History', label: 'History', route: '/drive-test?tab=history', need: [F.HC_WORK, 'edit'],
        icon: 'recently-viewed', tile: '--uep-app-data',
        also: ['/health-check?tab=history'],
      },
      { id: 'in-progress', label: 'Drive tests', route: '/my-drive-tests', need: F.CONTRACTOR_WORK, queues: ['dt_todo', 'dt_redo'], icon: 'data--check', tile: '--uep-app-drive-test' },
      // A fix is health-check remediation, so it lives here. A category owner
      // sees this page and no other in the rail.
      { id: 'fixes', label: 'Fix queue', route: '/my-fix-queue', need: F.FIX_QUEUE, queues: ['hc_fixes'], icon: 'tool-kit', tile: '--uep-app-monthly-plan' },
    ],
  },
  {
    id: 'acceptance',
    name: 'Acceptance',
    description: 'ICT and CRA acceptance per village',
    icon: 'certificate--check',
    color: '--uep-app-acceptance',
    tint: '--uep-app-acceptance-tint',
    group: 'rollout',
    need: F.ACCEPTANCE_CASES,
    pages: [
      // UEP-22: Filing is the acceptance cases inbox (team roles see their own
      // basket). Its count is the rail-only acceptance_filing queue -- every
      // open case in the viewer's inbox, ICT and CRA -- so it equals the two
      // inbox headers. Each validation page counts one authority.
      { id: 'filing', label: 'Filing', route: '/filing', also: ['/my-work'], queues: ['acceptance_filing'], icon: 'edit', tile: '--uep-app-acceptance' },
      { id: 'ict-validation', label: 'ICT validation', route: '/validation/ict', need: F.VALIDATION, queues: ['ict_to_validate'], icon: 'task--approved', tile: '--uep-ict' },
      { id: 'cra-validation', label: 'CRA validation', route: '/validation/cra', need: F.VALIDATION, queues: ['cra_to_validate'], icon: 'task--approved', tile: '--uep-cra' },
    ],
  },
  {
    id: 'monthly-plan',
    name: 'Monthly plan',
    description: 'Internal and contractor PIP',
    icon: 'calendar',
    color: '--uep-app-monthly-plan',
    tint: '--uep-app-monthly-plan-tint',
    group: 'planning',
    need: canOpenMonthlyPlan,
    pages: [
      // Plans is the page's default (no ?tab=) and took over Approvals; a
      // contractor lands on their own filing page at the same address.
      { id: 'plans', label: 'Plans', route: '/monthly-plan', queues: ['plans_approve', 'plan_submit'], also: ['/monthly-plan?tab=plans', '/monthly-plan?tab=approvals'] },
      { id: 'history', label: 'History', route: '/monthly-plan?tab=history', need: F.INTERNAL_PIP },
      { id: 'internal', label: 'Internal PIP', route: '/monthly-plan?tab=internal', need: F.INTERNAL_PIP },
    ],
  },
  {
    id: 'insights',
    name: 'Insights',
    description: 'Dashboards, performance and gaps',
    icon: 'chart--column',
    color: '--uep-app-insights',
    group: 'insights',
    // No app-level list: each page names its roles, so a role with none of
    // them (Admin, the problem-category owners) has no Insights at all.
    pages: [
      { id: 'dashboards', label: 'Drive test dashboard', route: '/reports/drive-test', need: F.INSIGHTS_DASHBOARDS },
      { id: 'acceptance-dashboard', label: 'Acceptance dashboard', route: '/reports/acceptance', need: F.INSIGHTS_DASHBOARDS },
      {
        id: 'roles', label: 'Roles performance', route: '/reports/kpi', need: F.ROLES_PERFORMANCE,
        description: 'Delivery and acceptance against national',
      },
      {
        id: 'gaps', label: 'Lifecycle gaps', route: '/reports/gaps', need: F.LIFECYCLE_GAPS,
        description: 'Where approvals are still waiting',
      },
      // UEP-22: every acceptance basket against time in basket.
      {
        id: 'acceptance-baskets', label: 'Acceptance baskets', route: '/insights/acceptance-baskets', need: F.ACCEPTANCE_BASKETS,
        description: 'Who holds each acceptance case, and for how long',
        icon: 'inventory-management', tile: '--uep-app-monthly-plan',
      },
      { id: 'exports', label: 'Exports', route: '/reports/kpi/mapping', need: F.KPI_MAPPING },
    ],
  },
  {
    id: 'data',
    name: 'Data',
    description: 'Imports and reconciliation',
    icon: 'data--base',
    color: '--uep-app-data',
    group: 'platform',
    pages: [
      { id: 'cpm', label: 'CPM import', route: '/admin?tab=import', need: [F.CPM_IMPORT, 'edit'] },
      { id: 'cpm-validate', label: 'CPM changes', route: '/admin?tab=validate', need: [F.CPM_CHANGE_REQUESTS, 'edit'], queues: ['cpm_changes'] },
      { id: 'mojri', label: 'Mojri tracker', route: '/mojri-tracker', need: [F.MOJRI_UPLOAD, 'edit'] },
      { id: 'history', label: 'Import history', route: '/admin?tab=history', need: F.CPM_IMPORT },
      // PM's way in to Admin > SLA policies (UEP-15), without adding an app to
      // PM's Home. Viewer reads the same page at /admin/sla.
      { id: 'sla-policies', label: 'SLA policies', route: '/admin/sla', need: [F.SLA_POLICIES, 'edit'], adminDuplicate: true },
      // PM's way in to Admin > Province assignments (UEP-17), the same way.
      { id: 'province-assignments', label: 'Province assignments', route: '/admin/provinces', need: [F.PROVINCE_ASSIGNMENTS, 'edit'], adminDuplicate: true },
      // UEP-25: PM and Viewer read Access and System health from here; anyone
      // with the Admin app finds them there instead.
      { id: 'access', label: 'Access', route: '/admin?tab=access', need: F.ACCESS, adminDuplicate: true },
      { id: 'system-health', label: 'System health', route: '/admin?tab=health', need: F.SYSTEM_HEALTH, adminDuplicate: true },
    ],
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Users, reference data and settings',
    icon: 'settings',
    color: '--uep-app-admin',
    group: 'platform',
    // The Admin app is for whoever administers something; read-only Access
    // and System health alone (PM, Viewer) are listed under Data.
    need: { any: [F.ADMIN_OVERVIEW, F.USERS, [F.CPM_IMPORT, 'edit'], F.PROBLEM_CATEGORIES, F.AUDIT_LOG] },
    pages: [
      { id: 'overview', label: 'Overview', route: '/admin?tab=overview', need: F.ADMIN_OVERVIEW },
      {
        id: 'users', section: 'People', label: 'Users & roles', route: '/admin?tab=users', need: F.USERS,
        icon: 'user--multiple', tile: '--uep-app-admin',
      },
      {
        id: 'access', section: 'People', label: 'Access', route: '/admin?tab=access', need: F.ACCESS,
        icon: 'locked', tile: '--uep-app-admin',
      },
      {
        id: 'provinces', section: 'People', label: 'Province assignments', route: '/admin/provinces', need: F.PROVINCE_ASSIGNMENTS,
        icon: 'location', tile: '--uep-app-admin',
      },
      {
        id: 'sla', section: 'Workflow', label: 'SLA policies', route: '/admin/sla', need: F.SLA_POLICIES,
        icon: 'timer', tile: '--uep-app-admin',
      },
      // UEP-26: the sign-in page's support contact and planned-update notice.
      {
        id: 'sign-in-page', section: 'Workflow', label: 'Sign-in page', route: '/admin/sign-in-page', need: F.SIGNIN_SETTINGS,
        icon: 'login', tile: '--uep-app-admin',
      },
      {
        id: 'reference', section: 'Workflow', label: 'Problem categories', route: '/admin?tab=categories', need: F.PROBLEM_CATEGORIES,
        icon: 'list--checked', tile: '--uep-app-admin',
      },
      {
        id: 'cpm-import', section: 'Data', label: 'CPM import', route: '/admin?tab=import', need: [F.CPM_IMPORT, 'edit'],
        icon: 'data--base', tile: '--uep-app-admin',
      },
      {
        id: 'mojri-template', section: 'Data', label: 'Mojri template', route: '/admin?tab=mojri', need: F.MOJRI_UPLOAD,
        icon: 'download', tile: '--uep-app-admin',
      },
      {
        id: 'system-health', section: 'Data', label: 'System health', route: '/admin?tab=health', need: F.SYSTEM_HEALTH,
        icon: 'activity', tile: '--uep-app-admin',
      },
      {
        id: 'audit', section: 'Data', label: 'Audit log', route: '/admin?tab=audit', need: F.AUDIT_LOG,
        icon: 'document', tile: '--uep-app-admin',
      },
    ],
  },
])

const offered = (need, user) => meets(user, need, { offered: true })

/** The apps this user may open, each with only the pages they may open. Pass
 * the signed-in user (with `access` from GET /me/access). */
export function appsFor(user) {
  const apps = APPS.filter((app) => offered(app.need, user))
    .map((app) => ({ ...app, pages: app.pages.filter((p) => offered(p.need, user)) }))
    .filter((app) => app.pages.length > 0)
  // A page that is also in the Admin app (SLA policies, Province assignments)
  // is listed under Data only for someone who has no Admin app.
  const adminRoutes = new Set((apps.find((x) => x.id === 'admin')?.pages || []).map((p) => p.route))
  return apps
    .map((app) => (app.id === 'admin' ? app : {
      ...app, pages: app.pages.filter((p) => !(p.adminDuplicate && adminRoutes.has(p.route))),
    }))
    .filter((app) => app.pages.length > 0)
}

/** The user's apps by group, empty groups left out. */
export function appGroupsFor(user) {
  const apps = appsFor(user)
  return APP_GROUPS.map((g) => ({ ...g, apps: apps.filter((x) => x.group === g.id) })).filter(
    (g) => g.apps.length > 0,
  )
}

function splitRoute(route) {
  const [path, query = ''] = route.split('?')
  return { path, params: new URLSearchParams(query) }
}

/** How well a page's route matches a location: -1 for no match, otherwise
 * the number of its query params the location carries (more is closer). */
function matchScore(route, pathname, search) {
  const { path, params } = splitRoute(route)
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return -1
  const here = new URLSearchParams(search)
  let score = 0
  for (const [k, v] of params) {
    if (here.get(k) !== v) return -1
    score += 1
  }
  return score
}

/** An `also` route matches on its path and on exactly its `tab` (none when it
 * names none), scoring as a page route with a tab does. */
function aliasScore(route, pathname, search) {
  const { path, params } = splitRoute(route)
  if (pathname !== path) return -1
  return new URLSearchParams(search).get('tab') === params.get('tab') ? 1 : -1
}

/** The app and page a location belongs to, among this role's apps.
 *
 * Some pages live in more than one app (the dashboards are in their own app
 * and in Insights), so a URL alone cannot say which app is open. `preferAppId`
 * names the app the user opened; it wins a tie, so its rail stays. */
export function locate(apps, pathname, search = '', preferAppId = null) {
  let best = { app: null, page: null, score: -1 }
  for (const app of apps) {
    for (const page of app.pages) {
      const score = Math.max(
        matchScore(page.route, pathname, search),
        ...(page.also || []).map((r) => aliasScore(r, pathname, search)),
      )
      const preferred = score >= 0 && score === best.score && app.id === preferAppId && best.app?.id !== preferAppId
      if (score > best.score || preferred) best = { app, page, score }
    }
  }
  return { app: best.app, page: best.page }
}

/** Router `state` for a link that opens an app's page, so the shell keeps
 * that app when the page is shared with another. */
export const appState = (app) => ({ app: app.id })

const homeTickets = (home) => [
  ...(home?.groups || []).flatMap((group) => group.tickets),
  // Rail-only queues (UEP-16): a page's own number, on no Home card.
  ...(home?.rail_tickets || []),
]

/** Pending counts per Home queue key, from a GET /me/home response. */
export function queueCounts(home) {
  const counts = {}
  for (const t of homeTickets(home)) counts[t.queue_key] = t.count
  return counts
}

/** Late counts per Home queue key: a page header's "· N late". */
export function queueLate(home) {
  const late = {}
  for (const t of homeTickets(home)) late[t.queue_key] = t.late || 0
  return late
}

/** A page's pending count, or null when it has no count query. */
export function pageCount(page, counts) {
  if (!page.queues) return null
  if (page.queues === '*') return Object.values(counts).reduce((a, b) => a + b, 0)
  return page.queues.reduce((sum, key) => sum + (counts[key] || 0), 0)
}

/** An app's pending count: its all-work page's, or the sum of its pages'. */
export function appCount(app, counts) {
  const all = app.pages.find((p) => p.queues === '*')
  if (all) return pageCount(all, counts)
  return app.pages.reduce((sum, p) => sum + (pageCount(p, counts) || 0), 0)
}

/** Where an app opens: its first page. */
export const appRoute = (app) => app.route || app.pages[0].route
