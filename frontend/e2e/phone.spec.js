// Contractor pages on a phone (UEP-13 §3.15): at 390×844 nothing scrolls
// sideways, the bottom bar is there with 44px tap targets, and the
// lifecycle strip's chips never overlap.
import { expect, test } from '@playwright/test'
import * as F from './fixtures.js'
import { signIn } from './mockApi.js'

const PAGES = [
  { name: 'Home', path: '/home' },
  { name: 'HC check', path: '/my-health-check' },
  { name: 'In progress', path: '/my-drive-tests' },
  { name: 'Filing', path: '/my-work' },
  { name: 'Monthly plan', path: '/monthly-plan' },
]

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

for (const p of PAGES) {
  test(`${p.name} fits a phone`, async ({ page }) => {
    await signIn(page, F.CONTRACTOR)
    await page.goto(p.path)
    await page.waitForLoadState('networkidle')

    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll('.page-outlet *')].filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1
        && getComputedStyle(el).position !== 'fixed' && !el.closest('.lifecycle, .uep-page-header-tabs')).length,
    )
    expect(wide).toBe(0)

    const bar = page.getByRole('navigation', { name: 'Main' })
    await expect(bar).toBeVisible()
    for (const item of await bar.locator('a, button').all()) {
      expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44)
    }

    const cells = await page.locator('.lifecycle-cell').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))
    for (let i = 1; i < cells.length; i += 1) expect(cells[i].left).toBeGreaterThanOrEqual(cells[i - 1].right - 0.5)
  })
}
