// The Drive Test dashboard (UEP-04): each of its three tabs fits one screen at
// 1440x900 without the page scrolling, still fits at 1366x768 (tightened,
// nothing hidden), and carries no serious accessibility violation.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const TABS = [
  { name: 'Overview', path: '/reports/drive-test', ready: 'On air vs DT done' },
  { name: 'Breakdowns', path: '/reports/drive-test?tab=breakdowns', ready: 'Ongoing breakdown' },
  {
    name: 'Contractors & provinces',
    path: '/reports/drive-test?tab=contractors-provinces',
    ready: 'Contractor scorecard',
  },
]

async function open(page, tab) {
  await signIn(page)
  await page.goto(tab.path)
  await expect(page.getByRole('heading', { name: tab.ready }).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]) {
  test.describe(`DT dashboard ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const tab of TABS) {
      test(`${tab.name} fits one screen`, async ({ page }) => {
        await open(page, tab)
        const doc = await page.evaluate(() => ({
          sh: document.scrollingElement.scrollHeight,
          sw: document.scrollingElement.scrollWidth,
          ih: window.innerHeight,
          iw: window.innerWidth,
        }))
        expect(doc.sh).toBeLessThanOrEqual(doc.ih)
        expect(doc.sw).toBeLessThanOrEqual(doc.iw)
        const [sh, ch] = await page.locator('.page-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
        expect(sh).toBeLessThanOrEqual(ch)

        if (process.env.SCREENSHOTS) {
          await page.screenshot({
            path: `${process.env.SCREENSHOTS}/dt-${tab.name.replace(/\W+/g, '-')}-${viewport.width}.png`,
          })
        }
      })
    }
  })
}

test.describe('DT dashboard accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const tab of TABS) {
    test(`${tab.name} has no serious axe violations`, async ({ page }) => {
      await open(page, tab)
      const { violations } = await new AxeBuilder({ page })
        .include('.dt-page')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
      const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
    })
  }
})
