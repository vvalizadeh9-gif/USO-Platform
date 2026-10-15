// Home as each role that has one sees it: the PM's summary, re-scoped to the
// role's groups, labels and totals. Shared by the Home layout tests and the
// PR screenshots (captureHome.spec.js).
import * as F from './fixtures.js'

const user = (username, fullName, role, extra = {}) => ({
  id: 9, username, full_name: fullName, first_name: fullName.split(' ')[0],
  role: { name: role }, must_change_password: false, ...extra,
})

/** The PM's summary, re-scoped: other groups, labels and totals summed again. */
function scoped(role, scope, keep, { done = true } = {}) {
  const groups = F.homeSummaryPm.groups
    .filter((g) => keep.includes(g.key))
    .map((g) => ({ ...g, scope_label: g.key === 'acceptance' ? scope : null }))
  const tickets = groups.flatMap((g) => g.tickets)
  const sum = (k) => tickets.reduce((n, t) => n + t[k], 0)
  const badges = {}
  for (const t of tickets.filter((x) => x.count)) {
    const path = t.url.split('?')[0]
    badges[path] = badges[path] || { count: 0, parts: [] }
    badges[path].count += t.count
    badges[path].parts.push({ label: t.short_label, count: t.count })
  }
  const base = F.homeSummaryPm
  return {
    ...base,
    role,
    scope_label: scope,
    groups,
    totals: {
      ...base.totals,
      pending: sum('count'), queues: tickets.length, overdue: sum('late'), due_soon: sum('due_soon'),
      ...(done ? {} : { done_today: null, done_yesterday: null }),
    },
    trends: { ...base.trends, done: done ? base.trends.done : null },
    app_badges: badges,
  }
}

/** [name, signed-in user, GET /me/home summary] */
export const HOME_ROLES = [
  ['pm', F.PM, F.homeSummaryPm],
  ['coordinator', user('coord', 'Sara Karimi', 'Coordinator'),
    scoped('Coordinator', 'Your regions', ['drive_test', 'acceptance'])],
  ['regional-manager', user('rm', 'Reza Ahmadi', 'RegionalManager'),
    scoped('Regional manager', 'Your regions', ['acceptance'], { done: false })],
  ['contractor', user('sc', 'Pishro Fan', 'Contractor', { contractor_id: 3 }),
    scoped('Contractor', 'Your sites', ['acceptance'])],
]

/** Answers GET /me/home with `summary`; register after signIn so it wins. */
export function serveHome(page, summary) {
  const body = JSON.stringify(summary)
  const fulfill = (route) => route.fulfill({ status: 200, contentType: 'application/json', body })
  return Promise.all([page.route('**/api/v1/me/home', fulfill), page.route('**/api/v1/home/summary', fulfill)])
}
