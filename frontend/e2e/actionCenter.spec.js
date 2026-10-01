// The Action Center ticket board, measured in a real browser: equal-size
// tickets, a crowded column that scrolls inside itself rather than the page,
// and Persian digits in its dates. noPageScroll.spec.js covers the page
// itself at both office resolutions.
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, reducedMotion: 'reduce' })

    test('every ticket is 172px high and every column the same width', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      await expect(page.getByTestId('ac-ticket').first()).toBeVisible()

      const heights = await page.getByTestId('ac-ticket').evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().height)))
      expect(heights.length).toBe(10)
      expect(new Set(heights)).toEqual(new Set([172]))

      const widths = await page.locator('.ac-col').evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().width)))
      expect(widths).toHaveLength(5)
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    })

    test('a crowded column scrolls inside itself', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      const hc = page.locator('.ac-col[data-stage="hc"] .ac-col-scroll')
      await expect(hc.getByTestId('ac-ticket').first()).toBeVisible()
      const m = await hc.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
      expect(m.sh).toBeGreaterThan(m.ch)
      const doc = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight)
      expect(doc).toBeLessThanOrEqual(0)
    })

    test('dates read in Shamsi with Persian digits', async ({ page }) => {
      await signIn(page)
      await page.goto('/action-center')
      await expect(page.locator('.ac-ticket-date').first()).toHaveText('since ۱۴۰۵/۰۷/۰۱')
      await expect(page.locator('.ac-today')).toHaveText(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/)
    })
  })
}
