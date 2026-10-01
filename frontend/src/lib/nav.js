/**
 * The sidebar's contents, and the rule for who may see an item.
 *
 * In its own module rather than beside the sidebar because two things ask the
 * same question: the sidebar itself, and the lifecycle strip on the Health
 * Check and Drive Test pages, which must not offer a person a link to a screen
 * they cannot open. A second copy of these role lists is how the two would
 * drift apart, and a strip that disagrees with the sidebar is worse than one
 * that offers nothing.
 *
 * These lists shape what the interface offers. They decide nothing: every
 * endpoint re-checks the role server-side.
 */
import {
  Briefcase,
  ClipboardCheck,
  FileSpreadsheet,
  Inbox,
  LayoutDashboard,
  Link2Off,
  ListChecks,
  Users,
  Wrench,
} from 'lucide-react'
import { ACTION_CENTER_ROLES, CATEGORY_OWNER_ROLES, KPI_ROLES, MONTHLY_PLAN_ROLES } from './roles'

// The sidebar, grouped by project: each project's dashboard sits beside the
// screens where that project's work is done, so a person finds the numbers
// and the work in one place. The dashboards are still read-only -- only their
// place in the sidebar moved; nothing they show changes a record.
//
// hideRoles hides an item for the given roles, on top of any `roles`
// inclusion list -- used here to keep Work Items and My Work out of Admin's
// sidebar (Admin manages the platform from the Admin Console, not the
// day-to-day work queues) while everyone else keeps seeing them.
//
// `key` names the badge count Layout computes for an item: 'action' from the
// Action Center board's pending total, and 'hc' / 'dt' / 'mydt' from /hc/queues/counts and
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
      { to: '/my-fix-queue', label: 'My Fix Queue', icon: Wrench, roles: CATEGORY_OWNER_ROLES },
      // Not for Regional Manager or Viewer (their home is a dashboard), nor
      // Admin: ACTION_CENTER_ROLES is the list the server serves the board to.
      { to: '/action-center', label: 'Action Center', icon: Inbox, key: 'action', roles: ACTION_CENTER_ROLES },
    ],
  },
  {
    // One project, in the order the work happens: a target for the month, the
    // health check that confirms a site is Ready, and the drive test that
    // follows it. The rail says they are one process rather than unrelated
    // screens that happen to be next to each other.
    label: 'Drive Test',
    items: [
      { to: '/reports/drive-test', label: 'Dashboard', icon: LayoutDashboard },
      // Two shapes behind Monthly Plan: the contractor's own form, and the
      // month's queue for everyone with an oversight interest in it. Admin is
      // absent from MONTHLY_PLAN_ROLES, which is what keeps it out of their
      // sidebar.
      { to: '/monthly-plan', label: 'Monthly Plan', step: true, roles: MONTHLY_PLAN_ROLES },
      { to: '/health-check', label: 'Health Check', step: true, roles: ['PM', 'Coordinator'], key: 'hc' },
      { to: '/my-health-check', label: 'My Health Check', step: true, roles: ['Contractor'] },
      // Same two roles as Health Check: assigning a drive test and approving
      // one are the same authority as reviewing a health check.
      { to: '/drive-test', label: 'Drive Test', step: true, roles: ['PM', 'Coordinator'], key: 'dt' },
      // One place for a contractor to work instead of knowing which sites to
      // open on Work Items -- the same reason My Health Check exists.
      { to: '/my-drive-tests', label: 'My Drive Tests', step: true, roles: ['Contractor'], key: 'mydt' },
      { to: '/work-items', label: 'Work Items', icon: ListChecks, end: true, hideRoles: ['Admin'] },
    ],
  },
  {
    // My Work is the acceptance workspace -- the ICT and CRA letters per
    // village (pages/mywork/MyWork.jsx) -- so it sits with its dashboard.
    label: 'Acceptance',
    items: [
      { to: '/reports/acceptance', label: 'Dashboard', icon: ClipboardCheck },
      { to: '/my-work', label: 'My Work', icon: Briefcase, hideRoles: ['Admin'], key: 'mywork' },
    ],
  },
  {
    label: 'Performance',
    items: [
      // Admin is absent from KPI_ROLES, which keeps this out of their sidebar
      // -- and the server refuses them every endpoint behind it.
      { to: '/reports/kpi', label: 'Roles Performance', icon: Users, roles: KPI_ROLES },
      // Same roles, and for the same reason: it reads the same villages under
      // the same scope rule, and the server refuses Admin every endpoint
      // behind it.
      { to: '/reports/gaps', label: 'Lifecycle Gaps', icon: Link2Off, roles: KPI_ROLES },
    ],
  },
  {
    label: 'Month-end',
    items: [
      // The monthly Mojri reconciliation. Unlike the dashboards, this one
      // writes. PM only, as the server has it -- Admin takes the template
      // from the Admin Console.
      { to: '/mojri-tracker', label: 'Mojri Tracker', icon: FileSpreadsheet, roles: ['PM'] },
    ],
  },
]

/** Whether this user may see a nav item, from the item's own role lists. */
export function navItemVisible(item, roleName) {
  if (item.roles && !item.roles.includes(roleName)) return false
  if (item.hideRoles && item.hideRoles.includes(roleName)) return false
  return true
}

/** The nav items, by path, so another component can ask about one by name. */
export const NAV_BY_PATH = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items).map((item) => [item.to, item]),
)
