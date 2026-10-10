// Screenshots of UEP Home for each role that has one, at 1440×900, from the
// mocked API (e2e/fixtures.js), for PR descriptions. Skipped in a normal run;
// to take them:
//   HOME_CAPTURE_DIR=<out-dir> npx playwright test e2e/captureHome.spec.js
import { expect, test } from '@playwright/test'
import * as F from './fixtures.js'
import { signIn } from './mockApi.js'

const out = process.env.HOME_CAPTURE_DIR

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

const ROLES = [
  ['pm', F.PM, F.homeSummaryPm],
  ['coordinator', user('coord', 'Sara Karimi', 'Coordinator'),
    scoped('Coordinator', 'Your regions', ['drive_test', 'acceptance'])],
  ['regional-manager', user('rm', 'Reza Ahmadi', 'RegionalManager'),
    scoped('Regional manager', 'Your regions', ['acceptance'], { done: false })],
  ['contractor', user('sc', 'Pishro Fan', 'Contractor', { contractor_id: 3 }),
    scoped('Contractor', 'Your sites', ['acceptance'])],
]

test.describe('Home screenshots', () => {
  test.skip(!out, 'set HOME_CAPTURE_DIR to take them')
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const [name, who, summary] of ROLES) {
    test(name, async ({ page }) => {
      await signIn(page, who)
      // Registered after signIn's catch-all, so it answers first.
      await page.route('**/api/v1/home/summary', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) }),
      )
      await page.goto('/home')
      await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
      await page.waitForTimeout(1500)
      const scrolls = await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight)
      expect(scrolls).toBe(false)
      await page.screenshot({ path: `${out}/home-${name}.png` })
    })
  }
})
