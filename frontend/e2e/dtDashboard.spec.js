// The Drive Test dashboard (UEP-04, 04a): each of its three tabs fits one
// screen at 1440x900 without the page scrolling, still fits at 1366x768
// (tightened, nothing hidden), and carries no serious accessibility violation.
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

test.describe('DT dashboard Overview layout (UEP-04a)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the four KPI tiles are equal in width, and Pending by status is no taller', async ({ page }) => {
    await open(page, TABS[0])
    const boxes = await page
      .locator('.dt-kpi-band > .dt-kpi-card')
      .evaluateAll((tiles) => tiles.map((t) => t.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))
    expect(boxes).toHaveLength(4)
    for (const b of boxes) expect(Math.abs(b.w - boxes[0].w)).toBeLessThanOrEqual(1)
    const tallest = Math.max(...boxes.slice(0, 3).map((b) => b.h))
    expect(boxes[3].h).toBeLessThanOrEqual(tallest + 1)
    // The dense variant: a 28px figure.
    const figure = await page
      .locator('.dt-kpi-band .dt-kpi-figure')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize)
    expect(figure).toBe('28px')
  })

  test('the month in both card headers is set in 600 weight', async ({ page }) => {
    await open(page, TABS[0])
    const weights = await page
      .locator('.dt-section-head [data-testid="dt-month-label"]')
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).fontWeight))
    expect(weights.length).toBeGreaterThanOrEqual(2)
    for (const w of weights) expect(w).toBe('600')
  })

  test('the readout sits in the key row, never over the plot', async ({ page }) => {
    await open(page, TABS[0])
    const readout = await page.getByTestId('dt-flow-readout').boundingBox()
    const plot = await page.locator('.dt-flow-plot').boundingBox()
    expect(readout.y + readout.height).toBeLessThanOrEqual(plot.y)
  })
})
