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
  { name: 'DT dashboard', path: '/reports/drive-test', ready: 'On air vs DT done', fits: true },
  // The Monthly Plan tabs: monthlyPlan.spec.js.
  // The Health check, Drive test and All sites work pages: workPages.spec.js.
  { name: 'Acceptance Fully accepted', path: '/reports/acceptance', ready: 'Fully accepted against plan', fits: true },
  { name: 'Acceptance ICT', path: '/reports/acceptance?tab=ict', ready: 'ICT approvals against plan', fits: true },
  { name: 'Acceptance CRA', path: '/reports/acceptance?tab=cra', ready: 'CRA approvals against plan', fits: true },
  {
    name: 'Acceptance ICT table',
    path: '/reports/acceptance?tab=ict',
    ready: 'ICT approvals against plan',
    fits: true,
    before: (page) => page.getByRole('button', { name: 'Table' }).click(),
  },
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
        if (p.before) await p.before(page)
        // Measure the settled page: every read answered (some deliberately
        // late -- see mockApi.js) and a frame for layout to follow.
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(300)

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
