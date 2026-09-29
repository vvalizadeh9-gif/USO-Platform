// Serves the API from fixtures, so the layout tests need no backend. Any
// endpoint not listed answers an empty list: a page that reads something new
// still renders, and a test that cares about it adds it here. A route may be
// a function of the request URL, for an answer that depends on its query.
import * as F from './fixtures.js'

const ROUTES = {
  '/auth/me': F.PM,
  '/action-center/summary': { counters: [], items: [] },
  '/drive-test/overview': F.dtOverview,
  '/drive-test/plan-delivery': F.dtPlan,
  '/drive-test/trend': F.dtTrend,
  '/drive-test/flow': F.dtFlow,
  '/pip/overview': F.pipOverview,
  '/pip/queue': F.pipQueue,
  '/hc/basket': F.hcBasket,
  '/hc/queues/counts': F.hcCounts,
  '/hc/queues/in-progress': F.hcInProgress,
  '/hc/queues/dt-assignment': F.dtAssignment,
  '/hc/queues/dt-in-progress': F.dtInProgress,
  '/reference/contractors': F.contractors,
  '/kpi/lenses': F.kpiLenses,
  '/gaps/overview': F.gapsOverview,
}

// Endpoints answered late, on purpose: the dashboard's side cards arriving
// after the trend chart is the order that exposed the chart fitting itself
// only once. Every page must lay out right whatever order its reads land in.
const LATE = { '/drive-test/overview': 400, '/drive-test/plan-delivery': 250, '/drive-test/trend': 250 }

export async function signIn(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('uep_token', 'e2e-token')
    localStorage.setItem('uep_user', JSON.stringify(user))
  }, F.PM)
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const entry = path in ROUTES ? ROUTES[path] : []
    const body = typeof entry === 'function' ? entry(route.request().url()) : entry
    if (LATE[path]) await new Promise((r) => setTimeout(r, LATE[path]))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}
