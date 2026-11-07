// UEP role access in a real browser (one test user per role): signing in lands
// on the role's landing page, the launcher and Apps panel offer exactly the
// allowed apps, a blocked URL shows the no-access screen, and both new
// landings fit one screen with no page scroll.
//
// Screenshots of the two new landings for the PR are taken when
// ROLE_CAPTURE_DIR is set:
//   ROLE_CAPTURE_DIR=<out-dir> npx playwright test e2e/roleAccess.spec.js
import { expect, test } from '@playwright/test'
import { HOME_ROLES, PROBLEM_OWNERS, REGIONAL_MANAGER, problemOwnerHome, serveHome } from './homeRoles.js'
import { rpArea } from './rolesFixtures.js'
import { signIn } from './mockApi.js'

const out = process.env.ROLE_CAPTURE_DIR

/** GET /kpi/area as the server answers a Regional manager: their own scope. */
async function serveRegion(page) {
  await page.route('**/api/v1/kpi/area**', (route) => {
    const body = rpArea(route.request().url())
    body.scope = {
      lens: 'rm', key: 'Reza Ahmadi', label: 'Reza Ahmadi', chip: '3 provinces · 1 CRA regions',
      selectable: false, past: false, provinces: 3, cra_regions: 1,
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function signInAsRm(page) {
  await signIn(page, REGIONAL_MANAGER)
  await serveHome(page, HOME_ROLES.find(([n]) => n === 'regional-manager')[2])
  await serveRegion(page)
}

async function signInAsOwner(page, who, fixes = 7) {
  await signIn(page, who)
  await serveHome(page, problemOwnerHome(who.role.name, { fixes }))
}

const appsPanelNames = (page) =>
  page.getByRole('complementary', { name: 'Apps' }).locator('.ha-app-name').allTextContents()

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

test.describe('Regional manager', () => {
  test('signs in to the region landing: summary, scope line, three apps, no work', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInAsRm(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('heading', { name: 'Your region' })).toBeVisible()
    await expect(page.getByTestId('home-scope')).toHaveText('Your provinces: 3')
    await expect(page.getByRole('region', { name: 'Your numbers' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Your work' })).toHaveCount(0)
    expect(await appsPanelNames(page)).toEqual(['Explorer', 'Roles performance', 'Lifecycle gaps'])
    expect(await launcherNames(page)).toEqual(['Home', 'Explorer', 'Insights'])
  })

  test('each region number opens Roles performance › My area on its measure', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInAsRm(page)
    await page.goto('/home')
    await page.locator('.hw-row[data-measure="ict"]').click()
    await expect(page).toHaveURL(/\/reports\/kpi\/area\?measure=ict$/)
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    test(`${viewport.width}×${viewport.height}: the region landing fits one screen`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await signInAsRm(page)
      await page.goto('/home')
      await expect(page.getByRole('heading', { name: 'Your region' })).toBeVisible()
      await page.waitForTimeout(out ? 1500 : 400)
      await expectNoPageScroll(page)
      await expect(page.locator('.hf-footer')).toBeInViewport()
      if (out && viewport.width === 1440) await page.screenshot({ path: `${out}/home-regional-manager-after.png` })
    })
  }

  for (const path of ['/reports/drive-test', '/reports/acceptance', '/my-work', '/monthly-plan', '/drive-test']) {
    test(`a direct URL to ${path} shows the no-access screen`, async ({ page }) => {
      await signInAsRm(page)
      await page.goto(path)
      await expect(page.getByRole('heading', { name: "You don't have access to this page" }).or(
        page.getByText("You don't have access to this page"),
      )).toBeVisible()
      await expect(page.getByRole('link', { name: 'Go to your start page' })).toHaveAttribute('href', '/home')
    })
  }
})

test.describe('problem-category owners', () => {
  for (const [role, who] of PROBLEM_OWNERS) {
    test(`${role} signs in to the work landing: own fixes, no Insights, Explorer`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await signInAsOwner(page, who)
      await page.goto('/')
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByRole('region', { name: 'Your numbers' })).toBeVisible()
      await expect(page.locator('.hw-card[data-card="drive_test"]')).toBeVisible()
      expect(await appsPanelNames(page)).toEqual(['Explorer', 'Drive test'])
      expect(await launcherNames(page)).toEqual(['Home', 'Explorer', 'Drive test'])
      for (const path of ['/reports/kpi', '/reports/gaps', '/reports/drive-test']) {
        await page.goto(path)
        await expect(page.getByText("You don't have access to this page")).toBeVisible()
      }
    })
  }

  test('with nothing waiting: the KPI strip at zero and one quiet line', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signInAsOwner(page, PROBLEM_OWNERS[0][1], 0)
    await page.goto('/home')
    await expect(page.getByTestId('work-empty')).toHaveText('Nothing is waiting on you.')
    await expect(page.locator('.hk-value').first()).toHaveText('0')
    await expect(page.getByText("You're all caught up")).toHaveCount(0)
  })

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    test(`${viewport.width}×${viewport.height}: the work landing fits one screen`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await signInAsOwner(page, PROBLEM_OWNERS[0][1])
      await page.goto('/home')
      await expect(page.locator('.hw-grid')).toBeVisible()
      await page.waitForTimeout(out ? 1500 : 400)
      await expectNoPageScroll(page)
      if (out && viewport.width === 1440) await page.screenshot({ path: `${out}/home-nwg-planning-after.png` })
    })
  }

  test('Explorer opens any site read-only: no Take action, no Open in My Work', async ({ page }) => {
    await signInAsOwner(page, PROBLEM_OWNERS[3][1])
    await page.goto('/explorer/sites/7')
    await expect(page.locator('.ex-header h1')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Take action' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Open in My Work' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'File letter' })).toHaveCount(0)
  })
})

test.describe('no change for the core roles', () => {
  for (const [name, who, summary] of HOME_ROLES.filter(([n]) => ['pm', 'coordinator', 'contractor'].includes(n))) {
    test(`${name} keeps Insights in the Apps panel and Home as it was`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await signIn(page, who)
      await serveHome(page, summary)
      await page.goto('/')
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByRole('region', { name: 'Your numbers' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Apps' }).getByRole('region', { name: 'Insights' })).toBeVisible()
      await expect(page.getByTestId('home-scope')).toHaveCount(0)
    })
  }
})
