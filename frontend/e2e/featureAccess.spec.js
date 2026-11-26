// UEP-25 in a real browser: feature access read from GET /me/access, a new
// role signing in, and System health without Kubernetes access.
//
//   npx playwright test e2e/featureAccess.spec.js
import { expect, test } from '@playwright/test'
import { CONTRACTOR } from './fixtures.js'
import { seededAccess, signIn } from './mockApi.js'

const ADMIN = { id: 9, username: 'admin', full_name: 'Platform Admin', role: { name: 'Admin' }, must_change_password: false }

async function launcherNames(page) {
  await page.getByRole('button', { name: 'App launcher' }).click()
  const names = await page.getByRole('dialog', { name: 'Apps' }).locator('.uep-launcher-tile > span:last-child').allTextContents()
  await page.keyboard.press('Escape')
  return names
}

async function expectNoPageScroll(page) {
  const m = await page.evaluate(() => ({
    sh: document.scrollingElement.scrollHeight, h: window.innerHeight,
    sw: document.scrollingElement.scrollWidth, w: window.innerWidth,
  }))
  expect(m.sh).toBeLessThanOrEqual(m.h)
  expect(m.sw).toBeLessThanOrEqual(m.w)
}

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

test('Admin grants Explorer to a contractor: it appears after a reload', async ({ page }) => {
  const base = seededAccess('Contractor')
  const without = { ...base, features: { ...base.features } }
  delete without.features.explorer
  let current = without
  await signIn(page, CONTRACTOR)
  await page.route('**/api/v1/me/access', (route) => route.fulfill(json(current)))

  await page.goto('/home')
  expect(await launcherNames(page)).not.toContain('Explorer')
  await page.goto('/explorer')
  await expect(page.getByText("It isn't part of your role in UEP.")).toBeVisible()

  // The Admin saves an exception: Explorer (View), with a reason.
  current = { ...base, features: { ...base.features, explorer: 'view' }, exceptions: ['explorer'] }
  await page.goto('/home')
  await page.reload()
  await expect.poll(() => launcherNames(page)).toContain('Explorer')
  await page.goto('/explorer')
  await expect(page.getByText("It isn't part of your role in UEP.")).toHaveCount(0)
})

test('a CPO made from Viewer signs in to its landing with exactly its features', async ({ page }) => {
  const viewer = seededAccess('Viewer')
  const cpo = {
    id: 21, username: 'cpo', full_name: 'Chief Product Officer', role: { name: 'CPO' }, must_change_password: false,
    access: {
      ...viewer, role: 'CPO', landing: '/explorer',
      features: { explorer: 'view', roles_performance: 'view', lifecycle_gaps: 'view' },
      hidden_in_menus: [],
    },
  }
  await page.setViewportSize({ width: 1366, height: 768 })
  await signIn(page, cpo)
  await page.goto('/')
  await expect(page).toHaveURL(/\/explorer$/)
  expect(await launcherNames(page)).toEqual(['Home', 'Explorer', 'Insights'])
  await page.goto('/reports/drive-test')
  await expect(page.getByText("It isn't part of your role in UEP.")).toBeVisible()
})

test('System health with Kubernetes not connected still loads, fits one screen, uses no green', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await signIn(page, ADMIN)
  const today = new Date()
  const day = (n) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10)
  await page.route('**/api/v1/admin/system-health', (route) => route.fulfill(json({
    db_status: 'ok', alembic_current_revision: 'e3b7c1d9f425', alembic_head_revision: 'e3b7c1d9f425',
    alembic_mismatch: false, last_cpm_import: null, pending_change_requests_count: 0,
    summary: { status: 'attention', headline: 'Last backup confirmed 9 days ago', problems: ['Last backup confirmed 9 days ago'] },
    kubernetes_connected: false,
    kubernetes_message: 'Not connected — needs read access from DevOps',
    app: null, resources: null,
    database: {
      bytes: 3.2 * 1024 ** 3, files_bytes: 410 * 1024 ** 2, growth_90d_bytes: 420 * 1024 ** 2,
      largest_tables: [
        { table: 'stored_files', bytes: 410 * 1024 ** 2 }, { table: 'audit_logs', bytes: 300 * 1024 ** 2 },
        { table: 'villages', bytes: 120 * 1024 ** 2 }, { table: 'work_items', bytes: 80 * 1024 ** 2 },
        { table: 'acceptance_cases', bytes: 40 * 1024 ** 2 },
      ],
      series: Array.from({ length: 90 }, (_, i) => ({ day: day(89 - i), db_bytes: (2.8 + i * 0.005) * 1024 ** 3, files_bytes: 0 })),
    },
    backups: { confirmed_on: day(9), note: 'DB team ticket 4411', entered_by: 'Platform Admin', entered_at: day(9), state: 'red', age_days: 9 },
    freshness: {
      cpm: { at: today.toISOString(), by: 'Platform Admin', rows: 3083, filename: 'cpm.xlsx' },
      mojri: { at: today.toISOString(), by: 'Programme Manager', rows: 900, filename: 'mojri.xlsx' },
      mojri_state: 'ok',
      migrations: { current: 'e3b7c1d9f425', head: 'e3b7c1d9f425', mismatch: false, state: 'ok' },
    },
    usage: {
      active_today: 37, failed_logins_24h: 2, errors_24h: 0,
      series_14d: Array.from({ length: 14 }, (_, i) => ({ day: day(13 - i), active_users: 20 + (i % 5) * 3 })),
    },
  })))

  await page.goto('/admin?tab=health')
  await expect(page.getByRole('heading', { name: 'System health', level: 1 })).toBeVisible({ timeout: 20000 })
  for (const block of ['App', 'Resources']) {
    await expect(page.getByRole('region', { name: block }).getByText('Not connected — needs read access from DevOps')).toBeVisible()
  }
  await expect(page.getByRole('region', { name: 'Backups' }).getByText('Problem')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Database' }).getByRole('img')).toBeVisible()
  await expectNoPageScroll(page)

  // No green anywhere on the page: no element's text, fill or background is
  // the approved-green family.
  const greens = await page.evaluate(() => {
    const isGreen = (c) => {
      const m = c && c.match(/rgba?\((\d+), (\d+), (\d+)/)
      if (!m) return false
      const [r, g, b] = m.slice(1).map(Number)
      return g > 90 && g > r * 1.4 && g > b * 1.3
    }
    return [...document.querySelectorAll('.sh-page *')].filter((el) => {
      const s = getComputedStyle(el)
      return isGreen(s.color) || isGreen(s.backgroundColor) || isGreen(s.fill)
    }).length
  })
  expect(greens).toBe(0)
})
