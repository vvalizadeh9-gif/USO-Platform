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
  Activity,
  BadgeCheck,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  ListChecks,
  Radio,
  Wrench,
} from 'lucide-react'
import { CATEGORY_OWNER_ROLES, KPI_ROLES, MONTHLY_PLAN_ROLES } from './roles'

// hideRoles hides an item for the given roles, on top of any `roles`
// inclusion list — used here to keep these four operational screens out of
// Admin's sidebar (Admin manages the platform from the Admin Console, not
// the day-to-day work queues) while everyone else keeps seeing them.
//
// The ungrouped items at the top are the ones that answer "what needs me",
// whatever the work is. My Fix Queue belongs here rather than in the section
// below: a category owner has exactly one screen, and burying it under a
// project heading would put their whole job behind a label about someone
// else's process.
export const NAV = [
  { to: '/work-items', label: 'Work Items', icon: ListChecks, end: true, hideRoles: ['Admin'] },
  { to: '/my-fix-queue', label: 'My Fix Queue', icon: Wrench, roles: CATEGORY_OWNER_ROLES },
  { to: '/action-center', label: 'Action Center', icon: Radio, key: 'action' },
  { to: '/my-work', label: 'My Work', icon: BadgeCheck, hideRoles: ['Admin'] },
]

// One project, in the order the work happens: a target for the month, the
// health check that confirms a site is Ready, and the drive test that follows
// it. Grouping them says they are one process rather than four unrelated
// screens that happen to be next to each other.
//
// Two shapes behind Monthly Plan: the contractor's own form, and the month's
// queue for everyone with an oversight interest in it. Admin is absent from
// MONTHLY_PLAN_ROLES, which is what keeps it out of their sidebar.
export const DRIVE_TEST_PROJECT = [
  { to: '/monthly-plan', label: 'Monthly Plan', icon: CalendarRange, roles: MONTHLY_PLAN_ROLES },
  // key: 'hc' / 'dt' / 'mydt' name the badge counts Layout computes from
  // /hc/queues/counts and /drive-tests/my/counts -- see D2-D4.
  { to: '/health-check', label: 'Health Check', icon: ClipboardList, roles: ['PM', 'Coordinator'], key: 'hc' },
  { to: '/my-health-check', label: 'My Health Check', icon: ClipboardCheck, roles: ['Contractor'] },
  // Same two roles as Health Check: assigning a drive test and approving one
  // are the same authority as reviewing a health check.
  { to: '/drive-test', label: 'Drive Test', icon: Radio, roles: ['PM', 'Coordinator'], key: 'dt' },
  // One place for a contractor to work instead of knowing which sites to
  // open on Work Items -- the same reason My Health Check exists above it.
  { to: '/my-drive-tests', label: 'My Drive Tests', icon: Radio, roles: ['Contractor'], key: 'mydt' },
]

// Reporting is separated from the work itself, because they are read at
// different times by different people. Everything under here is read-only:
// nothing in Reports changes a record.
export const REPORTS = [
  { to: '/reports/drive-test', label: 'DT Dashboard', icon: Activity },
  { to: '/reports/acceptance', label: 'Acceptance Dashboard', icon: BadgeCheck },
  // Admin is absent from KPI_ROLES, which keeps this out of their sidebar --
  // and the server refuses them every endpoint behind it.
  { to: '/reports/kpi', label: 'KPI & Performance', icon: Gauge, roles: KPI_ROLES },
]

/** Whether this user may see a nav item, from the item's own role lists. */
export function navItemVisible(item, roleName) {
  if (item.roles && !item.roles.includes(roleName)) return false
  if (item.hideRoles && item.hideRoles.includes(roleName)) return false
  return true
}

/** The nav items, by path, so another component can ask about one by name. */
export const NAV_BY_PATH = Object.fromEntries(
  [...NAV, ...DRIVE_TEST_PROJECT, ...REPORTS].map((item) => [item.to, item]),
)
