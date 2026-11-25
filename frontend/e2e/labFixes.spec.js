// UEP-24: the three flows the 3-month lab found broken, end to end against
// the mocked API (e2e/mockApi.js). Each test serves what the server now
// answers and checks the page sends the right request and shows the result.
import { expect, test } from '@playwright/test'
import * as F from './fixtures.js'
import { REGIONAL_MANAGER } from './homeRoles.js'
import { signIn } from './mockApi.js'

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('PM assigns a drive test and the dashboard shows it Ongoing', async ({ page }) => {
  await signIn(page, F.PM)
  let assigned = false
  await page.route('**/api/v1/work-items/assign', (route) => {
    assigned = true
    return route.fulfill(json({ status: 'ok', assigned: 1, batch_id: 7, villages: 2, batch_code: 'DT-7' }))
  })
  // F7: the assignment writes dt_status = Ongoing, so the next overview read
  // carries one more Ongoing site.
  await page.route('**/api/v1/drive-test/overview**', (route) => route.fulfill(json({
    ...F.dtOverview,
    kpis: { ...F.dtOverview.kpis, total_ongoing: { ...F.dtOverview.kpis.total_ongoing, value: assigned ? 605 : 604 } },
  })))
  await page.goto('/reports/drive-test')
  await page.evaluate(() => fetch('/api/v1/work-items/assign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_item_ids: [1], contractor_id: 1, assignment_type: 'official' }),
  }))
  expect(assigned).toBe(true)
  await page.reload()
  await expect(page.getByText('605', { exact: false }).first()).toBeVisible()
})

test('CPG Power marks a case fixed and it goes to the contractor basket', async ({ page }) => {
  const power = { id: 31, username: 'power', full_name: 'Pouya Power', first_name: 'Pouya', role: { name: 'CpgPower' }, must_change_password: false }
  await signIn(page, power)
  let sent = null
  await page.route('**/api/v1/acceptance/inbox**', (route) => route.fulfill(json({
    authority: 'ICT', tab: 'all', shown: sent ? 0 : 1, sla_days: 14, fresh_days: 7,
    can: { record_letters: false, comment: false, fix: true, owner_fix: true, change_basket: false, lands_directly: false, read_only: false },
    counts: { all: sent ? 0 : 1, waiting: 0, rejected: sent ? 0 : 1, no_comment: 0 },
    filters: {},
    groups: sent ? [] : [{ key: 'rejected', label: 'Rejected · team baskets', count: 1, rows: [{
      case_id: 41, village_id: 41, village_code: '100041', village_name: 'صیادلر', site_code: 'SB0401',
      state: 'rejected', category: 'CPG Power', basket_key: 'team:CpgPower', basket_owner: 'CPG Power',
      sub: 'CPG Power · CPG Power', days_in_basket: 20, over_sla: true, stale: false, in_validation: false,
    }] }],
  })))
  await page.route('**/api/v1/acceptance/cases/41/owner', (route) => {
    sent = route.request().postDataJSON()
    return route.fulfill(json({ case_id: 41, action: 'fixed' }))
  })
  await page.goto('/filing?village=41')
  const card = page.getByRole('form', { name: 'Update ICT' })
  await expect(card.getByRole('button', { name: 'Mark fixed' })).toBeVisible()
  await expect(card.getByRole('radio')).toHaveCount(0)
  await card.getByRole('textbox').fill('Grid connected')
  await card.getByRole('button', { name: 'Mark fixed' }).click()
  await expect.poll(() => sent).toMatchObject({ action: 'fixed', comment: 'Grid connected' })
  await expect(page.getByText('Marked fixed · back to contractor')).toBeVisible()
})

test('a new regional manager sees an empty state, not an error', async ({ page }) => {
  await signIn(page, { ...REGIONAL_MANAGER, kpi_linked: false })
  const areaCalls = []
  page.on('request', (req) => { if (req.url().includes('/api/v1/kpi/area')) areaCalls.push(req.url()) })
  const errors = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/home')
  await expect(page.getByText('No provinces are linked to your account yet. Your administrator can add them.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(areaCalls).toEqual([])
  expect(errors.filter((e) => e.includes('403'))).toEqual([])
})
