// Serves the API from fixtures, so the layout tests need no backend. Any
// endpoint not listed answers an empty list: a page that reads something new
// still renders, and a test that cares about it adds it here.
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
}

export async function signIn(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('uep_token', 'e2e-token')
    localStorage.setItem('uep_user', JSON.stringify(user))
  }, F.PM)
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    const body = path in ROUTES ? ROUTES[path] : []
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}
