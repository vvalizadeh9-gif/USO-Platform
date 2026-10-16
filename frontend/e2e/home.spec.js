// UEP Home in a real browser: a PM signing in lands on it, and the document
// never scrolls at the three office resolutions (long cards scroll inside
// themselves at the smaller two). At 1440×900 every row of every card is in
// view, so the headline is never more than what the cards visibly show.
import { expect, test } from '@playwright/test'
import { HOME_ROLES, serveHome } from './homeRoles.js'
import { signIn } from './mockApi.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
]

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('a PM lands on Home, and the page does not scroll', async ({ page }) => {
      await signIn(page)
      await page.goto('/')
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(300)

      const m = await page.evaluate(() => ({
        sh: document.scrollingElement.scrollHeight,
        sw: document.scrollingElement.scrollWidth,
        h: window.innerHeight,
        w: window.innerWidth,
      }))
      expect(m.sh).toBeLessThanOrEqual(m.h)
      expect(m.sw).toBeLessThanOrEqual(m.w)
      // Everything on the first screen: the figures, the cards' buttons, the
      // Apps panel and the footer.
      await expect(page.getByRole('region', { name: 'Your numbers' })).toBeInViewport()
      await expect(page.getByRole('complementary', { name: 'Apps' })).toBeInViewport()
      await expect(page.locator('.hf-footer')).toBeInViewport()
      for (const button of await page.locator('.h-cf .h-btn').all()) {
        await expect(button).toBeInViewport()
      }
    })
  })
}

test('at 1440×900 no row hides below a card’s fold', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
  await page.waitForTimeout(500)
  const clipped = await page.$$eval('.h-rows', (lists) =>
    lists.filter((el) => el.scrollHeight > el.clientHeight + 1).length,
  )
  expect(clipped).toBe(0)
})

test('the KPI figures are static, not links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await expect(page.getByRole('region', { name: 'Your numbers' }).getByRole('link')).toHaveCount(0)
})

test('the KPI strip keeps its standard size: a 32px figure and a 28px sparkline', async ({ page }) => {
  // The Drive Test dashboard's dense variant (UEP-04a) is scoped to that
  // page; Home's strip must not change with it.
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  const strip = page.getByRole('region', { name: 'Your numbers' })
  await expect(strip).toBeVisible()
  const figure = await strip.locator('.hk-value').first().evaluate((el) => getComputedStyle(el).fontSize)
  expect(figure).toBe('32px')
  const spark = strip.locator('.hk-spark').first()
  if (await spark.count()) {
    expect(await spark.evaluate((el) => el.getBoundingClientRect().height)).toBeCloseTo(28, 0)
  }
})

// UEP-12: the greeting spans the page; under it the Apps panel shares the KPI
// strip's top edge and the work cards' bottom edge, with its contents at top.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  for (const [name, who, summary] of HOME_ROLES.filter(([n]) => ['pm', 'coordinator', 'contractor'].includes(n))) {
    test(`${viewport.width}×${viewport.height} ${name}: the Apps panel lines up with the KPI strip and the work cards`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await signIn(page, who)
      await serveHome(page, summary)
      await page.goto('/home')
      await expect(page.locator('.hw-grid')).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      const box = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON())
      const [apps, strip, grid, greet, layout, title] = await Promise.all([
        box('.ha-panel'), box('.hk-strip'), box('.hw-grid'), box('.h-greet'), box('.h-layout'), box('.ha-panel h2'),
      ])
      expect(Math.abs(apps.top - strip.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(apps.bottom - grid.bottom)).toBeLessThanOrEqual(1)
      expect(Math.abs(greet.width - layout.width)).toBeLessThanOrEqual(1)
      // Contents stay at the top: the title sits one padding under the frame.
      expect(title.top - apps.top).toBeLessThan(24)

      const sh = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight)
      expect(sh).toBeLessThanOrEqual(0)
    })
  }
}

test('below 1100px the Apps panel drops under the work cards at natural height', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await expect(page.locator('.hw-grid')).toBeVisible()
  const [apps, grid] = await Promise.all(
    ['.ha-panel', '.hw-grid'].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON())),
  )
  expect(apps.top).toBeGreaterThan(grid.bottom)
  const inner = await page.locator('.ha-panel').evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(inner).toBeLessThanOrEqual(0)
})

test('every app description in the Apps panel fits on one line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await expect(page.locator('.ha-app-desc').first()).toBeVisible()
  const cut = await page.$$eval('.ha-app-desc', (els) =>
    els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
  )
  expect(cut).toEqual([])
})

