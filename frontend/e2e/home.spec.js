// UEP Home in a real browser: a PM signing in lands on it, and the document
// never scrolls at the three office resolutions (long cards scroll inside
// themselves at the smaller two). At 1440×900 every row of every card is in
// view, so the headline is never more than what the cards visibly show.
import { expect, test } from '@playwright/test'
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
      await expect(page.locator('.h-footer')).toBeInViewport()
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

test('the Overdue figure opens the Action Center on its Overdue tab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page)
  await page.goto('/home')
  await page.getByRole('region', { name: 'Your numbers' }).getByRole('link', { name: /Overdue/ }).click()
  await expect(page).toHaveURL(/\/action-center\?view=overdue$/)
})
