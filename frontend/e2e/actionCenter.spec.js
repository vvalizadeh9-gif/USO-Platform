// The Action Center task board, measured in a real browser: the rail and the
// columns share one grid, the rail stays pinned while the board scrolls in
// the page body (never the document), no column scrolls by itself, and every
// card is a full-size target. noPageScroll.spec.js covers the document at
// both office resolutions.
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, reducedMotion: 'reduce' })

    test('each step heading sits over its own column', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      await expect(page.getByTestId('ac-card').first()).toBeVisible()
      for (const key of ['hc', 'dt', 'ict', 'cra', 'plans']) {
        const step = await page.locator(`.ac-step[data-stage="${key}"]`).boundingBox()
        const col = await page.locator(`.ac-col[data-stage="${key}"]`).boundingBox()
        expect(Math.abs(step.x - col.x)).toBeLessThanOrEqual(1)
        expect(Math.abs(step.width - col.width)).toBeLessThanOrEqual(1)
      }
    })

    test('the board scrolls in the page body under a pinned rail', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      await expect(page.getByTestId('ac-card').first()).toBeVisible()
      const overflow = await page.locator('.ac-col').evaluateAll((els) =>
        els.map((el) => getComputedStyle(el).overflowY))
      expect(new Set(overflow)).toEqual(new Set(['visible']))

      const body = page.locator('.page-body')
      const railTop = await page.locator('.ac-rail').evaluate((el) => el.getBoundingClientRect().top)
      await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      const after = await page.locator('.ac-rail').evaluate((el) => el.getBoundingClientRect().top)
      expect(after).toBe(railTop)

      const doc = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight)
      expect(doc).toBeLessThanOrEqual(0)
    })

    test('every card is a target of at least 44px', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      await expect(page.getByTestId('ac-card').first()).toBeVisible()
      const heights = await page.getByTestId('ac-card').evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height))
      expect(heights).toHaveLength(10)
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)
    })
  })
}
