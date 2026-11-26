/**
 * The lifecycle pages and the rule for who may see one. The navigation itself
 * is shell/appRegistry.js (UEP-02); this list now serves the lifecycle strip.
 *
 * In its own module rather than beside the sidebar because two things ask the
 * same question: the sidebar itself, and the lifecycle strip on the Health
 * Check and Drive Test pages, which must not offer a person a link to a screen
 * they cannot open. A second copy of these role lists is how the two would
 * drift apart, and a strip that disagrees with the sidebar is worse than one
 * that offers nothing.
 *
 * Each item's `need` is a feature (lib/access.js, from GET /me/access): it
 * shapes what the interface offers and decides nothing -- every endpoint
 * re-checks the feature server-side.
 */
import {
  Briefcase,
  ClipboardCheck,
  FileSpreadsheet,
  House,
  LayoutDashboard,
  Link2Off,
  ListChecks,
  Users,
  Wrench,
} from '../components/carbon'
import { FEATURE as F, meets } from './access'
import { canOpenMonthlyPlan, hasHome } from './roles'

// The sidebar, grouped by project: each project's dashboard sits beside the
// screens where that project's work is done, so a person finds the numbers
// and the work in one place. The dashboards are still read-only -- only their
// place in the sidebar moved; nothing they show changes a record.
//
// `need` is what the item needs, read as menus read it (a feature granted
// URL-only is not offered).
//
// `key` names the badge count Layout computes for an item: 'hc' / 'dt' / 'mydt' from /hc/queues/counts and
// /drive-tests/my/counts -- see D2-D4 -- and 'mywork' from My Work's own
// list with limit=0 (its first tab: Your move, or To check).
//
// `step: true` marks the drive test lifecycle, drawn as a numbered rail
// instead of icons. The numbers count the steps this person can see, so they
// always run 1, 2, 3 without gaps.
export const NAV_SECTIONS = [
  {
    // What needs me, whatever the work is. My Fix Queue comes first: a
    // category owner has exactly one screen, and burying it under a project
    // heading would put their whole job behind a label about someone else's
    // process.
    label: 'Today',
    items: [
      { to: '/my-fix-queue', label: 'My Fix Queue', icon: Wrench, need: F.FIX_QUEUE },
      // UEP Home, the landing page. It is its own full-width shell, so this
      // is the way back to it from every other page.
      { to: '/home', label: 'Home', icon: House, need: (user) => hasHome(user?.role?.name) },
    ],
  },
  {
    // One project, in the order the work happens: a target for the month, the
    // health check that confirms a site is Ready, and the drive test that
    // follows it. The rail says they are one process rather than unrelated
    // screens that happen to be next to each other.
    label: 'Drive test',
    items: [
      { to: '/reports/drive-test', label: 'Dashboard', icon: LayoutDashboard, need: F.INSIGHTS_DASHBOARDS },
      // Two shapes behind Monthly Plan: the contractor's own form, and the
      // month's queue for everyone with an oversight interest in it. Admin is
      // not offered the queue (URL-only), which is what keeps it out of their
      // sidebar.
      { to: '/monthly-plan', label: 'Monthly Plan', step: true, need: canOpenMonthlyPlan },
      { to: '/health-check', label: 'Health check', step: true, need: [F.HC_WORK, 'edit'], key: 'hc' },
      { to: '/my-health-check', label: 'My Health Check', step: true, need: F.CONTRACTOR_WORK },
      // Same two roles as Health Check: assigning a drive test and approving
      // one are the same authority as reviewing a health check.
      { to: '/drive-test', label: 'Drive test', step: true, need: [F.DT_ASSIGNMENT, 'edit'], key: 'dt' },
      // One place for a contractor to work instead of knowing which sites to
      // open on Work Items -- the same reason My Health Check exists.
      { to: '/my-drive-tests', label: 'My Drive Tests', step: true, need: F.CONTRACTOR_WORK, key: 'mydt' },
      { to: '/explorer', label: 'Explorer', icon: ListChecks, end: true, need: F.EXPLORER },
    ],
  },
  {
    // My Work is the acceptance workspace -- the ICT and CRA letters per
    // village (pages/mywork/MyWork.jsx) -- so it sits with its dashboard.
    label: 'Acceptance',
    items: [
      { to: '/reports/acceptance', label: 'Dashboard', icon: ClipboardCheck, need: F.INSIGHTS_DASHBOARDS },
      { to: '/my-work', label: 'My Work', icon: Briefcase, need: F.ACCEPTANCE_WORKSPACE, key: 'mywork' },
    ],
  },
  {
    label: 'Performance',
    items: [
      // Admin has no roles_performance grant, which keeps this out of their sidebar
      // -- and the server refuses them every endpoint behind it.
      { to: '/reports/kpi', label: 'Roles Performance', icon: Users, need: F.ROLES_PERFORMANCE },
      // Same roles, and for the same reason: it reads the same villages under
      // the same scope rule, and the server refuses Admin every endpoint
      // behind it.
      { to: '/reports/gaps', label: 'Lifecycle Gaps', icon: Link2Off, need: F.LIFECYCLE_GAPS },
    ],
  },
  {
    label: 'Month-end',
    items: [
      // The monthly Mojri reconciliation. Unlike the dashboards, this one
      // writes. PM only, as the server has it -- Admin takes the template
      // from the Admin Console.
      { to: '/mojri-tracker', label: 'Mojri Tracker', icon: FileSpreadsheet, need: [F.MOJRI_UPLOAD, 'edit'] },
    ],
  },
]

/** Whether this user (with `access` from GET /me/access) may see a nav item. */
export function navItemVisible(item, user) {
  if (!item) return false
  return meets(user, item.need, { offered: true })
}

/** The nav items, by path, so another component can ask about one by name. */
export const NAV_BY_PATH = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.to, item]),
)
