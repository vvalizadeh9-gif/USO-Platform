// The layout contract: at the two office resolutions, the browser page never
// scrolls on the one-screen pages. Long lists scroll inside their card, and
// the assignment dock stays on screen.
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

const PAGES = [
  { name: 'DT dashboard', path: '/reports/drive-test', ready: 'Where this is going', fits: true },
  { name: 'Monthly Plan', path: '/monthly-plan', ready: 'By contractor', fits: true },
  { name: 'HC Pool', path: '/health-check', ready: /^Health Check Pool/, table: true, dock: true },
  { name: 'HC In Progress', path: '/health-check?tab=running', ready: 'Health checks in progress', table: true },
  { name: 'DT Assignment', path: '/drive-test', ready: 'Assignment', table: true, dock: true },
]

async function pageScroll(page) {
  return page.evaluate(() => {
    const el = document.scrollingElement
    return {
      scrollHeight: el.scrollHeight,
      scrollWidth: el.scrollWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    }
  })
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const p of PAGES) {
      test(`${p.name} does not scroll the page`, async ({ page }) => {
        await signIn(page)
        await page.goto(p.path)
        await expect(page.getByRole('heading', { name: p.ready }).first()).toBeVisible()

        const m = await pageScroll(page)
        expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight)
        expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth)

        // The one-screen designs fit whole: their body does not fall back to
        // scrolling inside the frame either.
        if (p.fits) {
          const body = await page.locator('.page-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
          expect(body[0]).toBeLessThanOrEqual(body[1])
        }

        if (p.table) {
          const scroller = page.locator('.table-scroll').first()
          const inner = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
          expect(inner.sh).toBeGreaterThan(inner.ch)
          await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))
          await expect(scroller.locator('thead th').first()).toBeInViewport()
        }
        if (p.dock) {
          await expect(page.locator('.assign-dock')).toBeInViewport()
        }

        if (process.env.SCREENSHOTS) {
          await page.screenshot({
            path: `${process.env.SCREENSHOTS}/${p.name.replace(/\W+/g, '-')}-${viewport.width}.png`,
          })
        }
      })
    }
  })
}
