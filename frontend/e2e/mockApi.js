// Serves the API from fixtures, so the layout tests need no backend. Any
// endpoint not listed answers an empty list: a page that reads something new
// still renders, and a test that cares about it adds it here. A route may be
// a function of the request URL, for an answer that depends on its query.
import * as F from './fixtures.js'
import * as W from './workFixtures.js'
import { villagesXlsx } from './xlsx.js'
import { myWorkList, myWorkSuggestions, myWorkVillage } from './myWorkFixtures.js'
import { validationEmail, validationGroup, validationList } from './validationFixtures.js'
import { rpArea, rpMonth } from './rolesFixtures.js'
import { explorerSite, explorerSites } from './explorerFixtures.js'
import * as SB from './submissionsFixtures.js'
import { basketsCell, basketsGrid, casesCase, casesCategories, casesHistory, casesInbox } from './casesFixtures.js'
import { FILTER_OPTIONS, siteVillages } from '../src/pages/explorer/fixtures.js'
import { readFileSync } from 'node:fs'

// UEP-25: what the signed-in user may use, as GET /me/access answers it --
// the role's day-one grants from the seed fixture, unless the test user
// carries its own `access` (a role made in Admin › Access, an exception).
const MATRIX = JSON.parse(readFileSync(new URL('../src/lib/accessMatrix.json', import.meta.url), 'utf8'))

export function seededAccess(roleName) {
  const features = {}
  const hidden = []
  for (const [key, area] of Object.entries(MATRIX.areas)) {
    if (area.offered.includes(roleName)) features[key] = 'view'
    else if (area.direct.includes(roleName)) { features[key] = 'view'; hidden.push(key) }
  }
  for (const [key, f] of Object.entries(MATRIX.features)) {
    if (f.edit.includes(roleName)) features[key] = 'edit'
    else if (f.view.includes(roleName)) features[key] = 'view'
    else continue
    if (f.hidden.includes(roleName)) hidden.push(key)
  }
  return {
    features, hidden_in_menus: hidden, exceptions: [],
    landing: MATRIX.landings[roleName] || 'standard', role: roleName,
    data_scope_type: MATRIX.data_scope[roleName] || 'none',
  }
}

const ROUTES = {
  '/auth/me': F.PM,
  '/home/summary': F.homeSummaryPm,
  '/me/home': F.homeSummaryPm,
  '/drive-test/overview': F.dtOverview,
  '/drive-test/plan-delivery': F.dtPlan,
  '/drive-test/trend': F.dtTrend,
  '/drive-test/flow': F.dtFlow,
  '/pip/overview': F.pipOverview,
  '/pip/queue': F.pipQueue,
  '/pip/internal-target': F.pipInternalTarget,
  '/pip/scorecard': F.pipScorecard,
  '/hc/basket': W.hcBasket,
  '/hc/queues/in-progress': W.hcInProgress,
  '/hc/queues/dt-assignment': W.dtAssignment,
  '/hc/queues/dt-in-progress': W.dtInProgress,
  '/reference/contractors': F.contractors,
  '/kpi/lenses': F.kpiLenses,
  '/kpi/month': rpMonth,
  '/kpi/area': rpArea,
  '/gaps/overview': F.gapsOverview,
  '/gaps/map': F.gapsMap,
  '/acceptance/overview': F.accOverview,
  '/acceptance/progress': F.accProgress,
  '/reference/provinces': [],
  '/drive-test/pipeline/summary': W.pipelineSummary,
  '/hc/contractors/load': W.contractorLoad,
  '/drive-test/contractors/load': W.contractorLoad,
  '/hc/results': W.hcResults,
  '/hc/queues/dt-review': W.dtReview,
  '/hc/queues/remediations': W.remediations,
  '/hc/queues/reroutes': W.reroutes,
  '/hc/batches': W.hcBatches,
  '/drive-test/tests': W.dtTests,
  '/work-items': W.workItems,
  '/work-items/counts': W.workItemCounts,
  '/explorer/sites': explorerSites,
  '/explorer/sites/filters': FILTER_OPTIONS,
  '/search': F.searchResults,
  '/submissions/summary': SB.summary(),
  '/submissions/ready': SB.ready(),
  '/submissions/batches': SB.batches(),
  '/submissions/follow-up': SB.followUp(),
  '/submissions/villages': SB.yourVillages(),
  '/acceptance/inbox': casesInbox,
  '/acceptance/categories': casesCategories,
  '/insights/acceptance-baskets': basketsGrid(),
  '/insights/acceptance-baskets/cell': basketsCell(),
}

// Endpoints answered late, on purpose: the dashboard's side cards arriving
// after the trend chart is the order that exposed the chart fitting itself
// only once. Every page must lay out right whatever order its reads land in.
const LATE = { '/drive-test/overview': 400, '/drive-test/plan-delivery': 250, '/drive-test/trend': 250 }

// Paths with an id in them, answered by a function of the URL and the
// signed-in user's view.
const PATTERNS = [
  [/^\/acceptance\/villages\/\d+\/suggestions$/, myWorkSuggestions],
  [/^\/acceptance\/villages\/\d+$/, myWorkVillage],
  [/^\/acceptance\/cases\/\d+\/history$/, casesHistory],
  [/^\/acceptance\/cases\/\d+$/, casesCase],
  [/^\/acceptance\/my-work$/, myWorkList],
  [/^\/acceptance\/my-work\/validation$/, validationList],
  [/^\/acceptance\/my-work\/validation\/(letter|site)\/.+$/, validationGroup],
  [/^\/acceptance\/my-work\/evidence\/\d+\/email$/, validationEmail],
  [/^\/explorer\/sites\/\d+\/villages$/, () => siteVillages(3)],
  [/^\/explorer\/sites\/\d+$/, explorerSite],
  [/^\/submissions\/batches\/\d+$/, (url) => SB.batch(Number(url.split('/').pop()))],
  [/^\/me\/queues\/[^/]+\/items$/, (url) => F.queueItems(url)],
]

const viewOf = (user) => (user.role.name === 'Contractor' ? 'contractor' : 'staff')

export async function signIn(page, user = F.PM) {
  await page.addInitScript((u) => {
    localStorage.setItem('uep_user', JSON.stringify(u))
  }, user)
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    // UEP-27: a Home list's export (a real .xlsx, so the download completes).
    if (/^\/me\/(queues\/[^/]+\/export|home\/export)\.xlsx$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'content-disposition': 'attachment; filename="UEP_DT-assignment_26-Nov-2026.xlsx"' },
        body: villagesXlsx(3),
      })
    }
    if (path === '/gaps/villages.xlsx') {
      const count = F.exportCount(route.request().url())
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: { 'content-disposition': `attachment; filename="uep-export-${count}.xlsx"` },
        body: villagesXlsx(count),
      })
    }
    const url = route.request().url()
    const pattern = PATTERNS.find(([re]) => re.test(path))
    if (pattern) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pattern[1](url, viewOf(user))) })
    }
    if (path === '/me/access') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user.access || seededAccess(user.role.name)) })
    }
    if (path === '/auth/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
    }
    if (path === '/acceptance/scans') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ scan_id: 'scan-token', filename: 'letter.pdf', content_type: 'application/pdf', size_bytes: 10, expires_at: '2030-01-01T00:00:00Z' }) })
    }
    const entry = path in ROUTES ? ROUTES[path] : []
    const body = typeof entry === 'function' ? entry(route.request().url()) : entry
    if (LATE[path]) await new Promise((r) => setTimeout(r, LATE[path]))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}
