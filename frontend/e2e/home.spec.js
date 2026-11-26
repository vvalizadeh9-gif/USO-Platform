// UEP Home in a real browser: a PM signing in lands on it, and the document
// never scrolls at the three office resolutions (long cards scroll inside
// themselves at the smaller two). At 1440×900 every row of every card is in
// view, so the headline is never more than what the cards visibly show.
import AxeBuilder from '@axe-core/playwright'
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
      for (const row of await page.locator('.hw-qrow').all()) {
        await expect(row).toBeInViewport()
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
  const clipped = await page.$$eval('.hw-rows', (lists) =>
    lists.filter((el) => el.scrollHeight > el.clientHeight + 1).length,
  )
  expect(clipped).toBe(0)
})

// UEP-27: every number on the overview is a button that names what it opens.
test('the overview figures are named buttons, not links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  const overview = page.getByRole('region', { name: 'Your numbers' })
  await expect(overview.getByRole('link')).toHaveCount(0)
  await expect(overview.getByRole('button', { name: /^To do: \d+, show list$/ })).toBeVisible()
  await expect(overview.getByRole('button', { name: /^Done this week: \d+, show list$/ })).toBeVisible()
})

for (const [viewport, size] of [[{ width: 1440, height: 900 }, '32px'], [{ width: 1366, height: 768 }, '24px']]) {
  test(`${viewport.width}×${viewport.height}: the To do figure is ${size}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await signIn(page)
    await page.goto('/home')
    const figure = page.getByTestId('todo-number')
    await expect(figure).toBeVisible()
    expect(await figure.evaluate((el) => getComputedStyle(el).fontSize)).toBe(size)
  })
}

// UEP-27 §7: only the UEP type scale on Home, nothing below 12px.
test('Home uses only the UEP font sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
  await page.waitForTimeout(1200)
  const sizes = await page.$$eval('.uep-home-page *', (els) => [...new Set(
    els.filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => getComputedStyle(el).fontSize),
  )])
  const allowed = ['12px', '13px', '14px', '16px', '18px', '20px', '24px', '26px', '32px']
  expect(sizes.filter((size) => !allowed.includes(size))).toEqual([])
})

// UEP-27 §9: the PM's journey from a part of the bar to the file.
test('a PM filters to Late, opens DT assignment, sees late sites first and exports them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  const overview = page.getByRole('region', { name: 'Your numbers' })
  await overview.locator('.ho-lg[data-status="late"]').click()
  await expect(page.getByTestId('filter-chip')).toHaveText(/Showing late/)
  await expect(page.getByTestId('count-dt_assign')).toHaveText(/^1/)
  await expect(page.getByTestId('count-ict_pending').locator('..')).toHaveClass(/is-dim/)

  await page.locator('[data-queue="dt_assign"]').click()
  const panel = page.getByRole('dialog')
  await expect(panel.getByRole('heading', { level: 2 })).toContainText('DT assignment')
  await expect(panel.getByRole('button', { name: /^Late/, pressed: true })).toBeVisible()
  const statuses = await panel.locator('.hd-item').evaluateAll((els) => els.map((el) => el.dataset.status))
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every((s) => s === 'late')).toBe(true)
  await expect(panel.locator('.hd-track u').first()).toBeVisible()

  const download = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export to Excel' }).click()
  expect((await download).suggestedFilename()).toMatch(/^UEP_.+\.xlsx$/)

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-queue="dt_assign"]')).toBeFocused()
})

test('the panel never makes the page scroll; its list scrolls inside', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await signIn(page)
  await page.goto('/home')
  await page.locator('[data-queue="ict_pending"]').click()
  await expect(page.locator('.hd-item').first()).toBeVisible()
  const sh = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight)
  expect(sh).toBeLessThanOrEqual(0)
  const inner = await page.locator('.hd-list').evaluate((el) => el.scrollHeight > el.clientHeight)
  expect(inner).toBe(true)
})

// UEP-12, kept by UEP-27: the greeting spans the page; under it the Apps
// panel shares the overview card's top edge and the work cards' bottom edge,
// with its contents at top, and never scrolls.
for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  for (const [name, who, summary] of HOME_ROLES.filter(([n]) => ['pm', 'coordinator', 'contractor'].includes(n))) {
    test(`${viewport.width}×${viewport.height} ${name}: the Apps panel lines up with the overview and the work cards`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await signIn(page, who)
      await serveHome(page, summary)
      await page.goto('/home')
      await expect(page.locator('.hw-grid')).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)

      const box = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().toJSON())
      const [apps, strip, grid, greet, layout, title] = await Promise.all([
        box('.ha-panel'), box('.ho-card'), box('.hw-grid'), box('.h-greet'), box('.h-layout'), box('.ha-panel h2'),
      ])
      expect(Math.abs(apps.top - strip.top)).toBeLessThanOrEqual(1)
      expect(Math.abs(apps.bottom - grid.bottom)).toBeLessThanOrEqual(1)
      expect(Math.abs(greet.width - layout.width)).toBeLessThanOrEqual(1)
      // Contents stay at the top: the title sits one padding under the frame.
      expect(title.top - apps.top).toBeLessThan(24)
      // The panel never scrolls: the bottom edge goes as low as the apps need.
      const inner = await page.locator('.ha-panel').evaluate((el) => el.scrollHeight - el.clientHeight)
      expect(inner).toBeLessThanOrEqual(0)

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

test('the Apps grid puts Planning and Insights on one row, descriptions as tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  const panel = page.getByRole('complementary', { name: 'Apps' })
  const top = (name) => panel.getByRole('region', { name }).evaluate((el) => el.getBoundingClientRect().top)
  expect(await top('Planning')).toBe(await top('Insights'))
  const tile = panel.locator('.ha-app').first()
  await expect(tile).toHaveAttribute('data-tip', /.+/)
})

// UEP-27 §8: axe, no serious issues -- the page, with a filter on, and the panel.
async function serious(page, include) {
  await page.waitForTimeout(1200) // entrance animations finished: axe reads final colours
  const { violations } = await new AxeBuilder({ page }).include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  return violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
}

test.describe('Home accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Home has no serious axe violations, with or without a filter', async ({ page }) => {
    await signIn(page)
    await page.goto('/home')
    await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
    expect(await serious(page, '.uep-home-page')).toEqual([])
    await page.locator('.ho-lg[data-status="late"]').click()
    expect(await serious(page, '.uep-home-page')).toEqual([])
  })

  test('the list panel has no serious axe violations', async ({ page }) => {
    await signIn(page)
    await page.goto('/home')
    await page.locator('[data-queue="dt_assign"]').click()
    await expect(page.locator('.hd-item').first()).toBeVisible()
    expect(await serious(page, '.hd-panel')).toEqual([])
  })
})
