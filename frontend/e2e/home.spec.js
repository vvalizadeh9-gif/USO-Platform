// UEP Home in a real browser: a PM signing in lands on it, the document never
// scrolls at the two office resolutions (long cards scroll inside
// themselves), and "Start with ..." opens the Up-next queue.
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
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
      // Everything on the first screen: the cards, the Apps panel, the footer.
      await expect(page.getByRole('complementary', { name: 'Apps' })).toBeInViewport()
      await expect(page.locator('.h-footer')).toBeInViewport()
      await expect(page.locator('.h-pill.primary')).toBeInViewport()
    })
  })
}

test('"Start with ..." opens the Up-next queue', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  const primary = page.locator('.h-pill.primary')
  await expect(primary).toHaveCount(1)
  await expect(primary).toHaveText(/Start with HC assignment/)
  await primary.click()
  await expect(page).toHaveURL(/\/health-check\?tab=pool&state=ready$/)
})
