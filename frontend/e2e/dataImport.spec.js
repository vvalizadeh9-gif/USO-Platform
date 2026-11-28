// Admin > Data import (UEP-29), against a small stateful fixture API: the PM
// downloads the template, uploads a filled file, resolves the conflict,
// applies, finds the batch in History and undoes it. Then the page fits the
// office screens with no page scroll, axe finds nothing serious, and a
// coordinator is turned away.
//
// That an applied file really makes a site DT Done (HC passed, official
// assignment, approved drive test) and a village ICT Approved -- and that Undo
// reverses it -- is covered by backend/tests/test_data_import.py against the
// real API: the fixture API only keeps the batch's state.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { PM } from './fixtures.js'
import { signIn } from './mockApi.js'

const COORDINATOR = { ...PM, id: 4, username: 'coordinator', role: { name: 'Coordinator' } }
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function server() {
  const state = { status: 'previewed', decision: null, applied: false }
  const counts = () => ({
    dt: { new: 1, same: 0, conflicts: 1, errors: 0 },
    ict: { new: 2, same: 0, conflicts: 0, errors: 1 },
    cra: { new: 0, same: 0, conflicts: 0, errors: 0 },
    rows: 4, row_errors: 1, warnings: [], already_imported_as: null,
    applied_changes: 4, records: 9, sites: 2, villages: 2,
  })
  const decisions = () => ({
    new: 3, conflicts: 1, undecided: state.decision ? 0 : 1,
    use_file: state.decision === 'file' ? 1 : 0, to_apply: state.decision === 'file' ? 4 : 3,
  })
  const batch = () => ({
    id: 5, number: 5, filename: 'filled.xlsx', status: state.status, uploaded_by: 'Programme',
    uploaded_at: '2026-11-28T08:00:00Z', applied_at: state.applied ? '2026-11-28T08:05:00Z' : null,
    counts: counts(), decisions: decisions(),
  })
  const conflict = () => ({
    id: 77, row: 2, site_id: 'S5', site_type: 'New Site', village_code: null, scope: 'site',
    field: 'dt_contractor', field_label: 'DT contractor', uep_value: 'Contractor B',
    uep_source: 'CPM import', file_value: 'Contractor A', kind: 'conflict', decision: state.decision,
  })
  const preview = (tab) => {
    if (tab === 'conflicts') return { tab, total: 1, page: 1, page_size: 50, items: [conflict()], fields: [{ field: 'dt_contractor', label: 'DT contractor', count: 1 }] }
    if (tab === 'errors') return { tab, total: 1, page: 1, page_size: 50, fields: [], items: [{ row: 4, site_id: 'S7', site_type: 'New Site', village_code: '7001', status: 'error', messages: ['Drive test not done for this site'] }] }
    return { tab, total: 1, page: 1, page_size: 50, fields: [], items: [{ id: 78, row: 3, site_id: 'S1', site_type: 'New Site', village_code: '1001', scope: 'village', field: 'ict_result', field_label: 'ICT result', uep_value: null, uep_source: null, file_value: 'Approved', kind: 'new', decision: null }] }
  }

  return {
    state,
    async route(route) {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.replace('/api/v1/data-import', '')
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      const file = (name) => route.fulfill({ status: 200, contentType: XLSX, headers: { 'content-disposition': `attachment; filename="${name}"` }, body: 'PK' })
      if (path === '/template') return file('UEP_import_template_2026-11-28.xlsx')
      if (request.method() === 'POST' && path === '/batches') return json(batch())
      if (request.method() === 'GET' && path === '/batches') return json(state.applied ? [batch()] : [])
      if (path === '/batches/5/preview') return json(preview(url.searchParams.get('tab')))
      if (path === '/batches/5/decisions') {
        state.decision = request.postDataJSON().decision
        return json({ updated: 1, decisions: decisions() })
      }
      if (path === '/batches/5/apply') {
        state.status = 'applied'
        state.applied = true
        return json({ ...batch(), result: { applied_changes: 4, records: 9 } })
      }
      if (path === '/batches/5/undo') {
        state.status = 'undone'
        return json({ ...batch(), result: { reverted: 9, kept_rows: 0, kept: [] } })
      }
      if (path.endsWith('.xlsx') || path.endsWith('/file')) return file('x.xlsx')
      return json({}, 404)
    },
  }
}

async function open(page, user = PM) {
  const api = server()
  await signIn(page, user)
  await page.route('**/api/v1/data-import/**', (route) => api.route(route))
  await page.goto('/admin?tab=data-import')
  return api
}

async function upload(page) {
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  await page.getByTestId('di-file').setInputFiles({ name: 'filled.xlsx', mimeType: XLSX, buffer: Buffer.from('PK') })
  await page.getByRole('button', { name: 'Check file' }).click()
  await expect(page.getByRole('region', { name: 'Summary' })).toBeVisible()
}

test('download, upload, resolve the conflict, apply, then undo from History', async ({ page }) => {
  const api = await open(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Data import' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download template' }).click()
  expect((await download).suggestedFilename()).toBe('UEP_import_template_2026-11-28.xlsx')

  await upload(page)
  const apply = page.getByRole('button', { name: 'Apply 3 changes' })
  await expect(apply).toBeDisabled()
  const row = page.getByRole('row').filter({ hasText: 'Contractor A' })
  await expect(row).toContainText('CPM import')
  await row.getByRole('button', { name: 'Use file' }).click()
  await expect(page.getByRole('button', { name: 'Apply 4 changes' })).toBeEnabled()
  expect(api.state.decision).toBe('file')

  await page.getByRole('tab', { name: /Errors/ }).click()
  await expect(page.getByText('Drive test not done for this site')).toBeVisible()

  await page.getByRole('button', { name: 'Apply 4 changes' }).click()
  await expect(page.getByRole('heading', { name: 'Batch #5 applied' })).toBeVisible()
  await page.getByRole('button', { name: 'View in History' }).click()

  const batchRow = page.getByRole('row').filter({ hasText: 'filled.xlsx' })
  await expect(batchRow).toContainText('Applied')
  await batchRow.getByRole('button', { name: 'Undo batch 5' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Undo batch' }).click()
  await expect(batchRow).toContainText('Undone')
  expect(api.state.status).toBe('undone')
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test(`the review step fits ${viewport.width}x${viewport.height} with no page scroll`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open(page)
    await upload(page)
    await expect(page.getByRole('button', { name: /Apply/ })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
    expect(overflow).toBeLessThanOrEqual(0)
    const footer = await page.getByRole('button', { name: /Apply/ }).boundingBox()
    expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height)
  })
}

test('axe finds no serious problem on the review step', async ({ page }) => {
  await open(page)
  await upload(page)
  const results = await new AxeBuilder({ page }).include('main').analyze()
  const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  expect(serious).toEqual([])
})

test('a coordinator is turned away', async ({ page }) => {
  await open(page, COORDINATOR)
  await expect(page.getByRole('heading', { level: 1, name: 'Data import' })).toHaveCount(0)
})
