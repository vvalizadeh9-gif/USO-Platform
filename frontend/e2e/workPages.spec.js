// UEP-06: the Health check → Drive test work pages. Explorer's list and
// record page are explorer.spec.js (UEP-11, UEP-11a).
//
// * no page scroll at 1440×900 on any step, and everything still reachable at
//   1366×768 (Home's max-height: 820px tightening);
// * the site lists fill their card at 1366, 1440 and 1840 wide, with no
//   horizontal scroll;
// * axe (WCAG 2.2 AA) finds nothing, once animations have settled.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const STEPS = [
  { name: 'Step 1 Assign health check', path: '/health-check?tab=pool', title: 'Assign health check', list: true, panel: true },
  { name: 'Step 2 In health check', path: '/health-check?tab=running', title: 'In health check', list: true },
  { name: 'Step 3 Review results', path: '/health-check?tab=review', title: 'Review results', list: true },
  { name: 'Step 4 Assign drive test', path: '/drive-test?tab=assignment', title: 'Assign drive test', list: true, panel: true },
  { name: 'Step 5 With contractor', path: '/drive-test?tab=in-progress', title: 'With contractor', list: true },
  { name: 'Step 6 Review drive test', path: '/drive-test?tab=review', title: 'Review drive test', list: true },
  { name: 'DT done', path: '/drive-test?tab=done', title: 'DT done' },
  { name: 'Remediation', path: '/health-check?tab=remediation', title: 'Remediation', list: true },
  { name: 'Re-routes', path: '/health-check?tab=reroutes', title: 'Re-routes' },
  { name: 'Sent back', path: '/drive-test?tab=sent-back', title: 'Sent back' },
  { name: 'History', path: '/drive-test?tab=history', title: 'History' },
]

async function open(page, step) {
  await signIn(page)
  await page.goto(step.path)
  await expect(page.getByRole('heading', { level: 1, name: step.title })).toBeVisible()
  await page.waitForLoadState('networkidle')
  // Page entry is 320ms; measure after it.
  await page.waitForTimeout(500)
}

const pageScroll = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement
    return { sh: el.scrollHeight, sw: el.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }
  })

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })
    for (const step of STEPS) {
      test(`${step.name} does not scroll the page`, async ({ page }) => {
        await open(page, step)
        const m = await pageScroll(page)
        expect(m.sh).toBeLessThanOrEqual(m.ih)
        expect(m.sw).toBeLessThanOrEqual(m.iw)
        await expect(page.locator('.hf-footer')).toBeInViewport()
        await expect(page.getByRole('tablist').first()).toBeInViewport()
        if (step.list) {
          // The list scrolls inside its card, under a header that stays.
          const body = page.locator('.uw-card-body').first()
          const inner = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
          expect(inner.sh).toBeGreaterThan(inner.ch)
          await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
          await expect(body.locator('thead th').first()).toBeInViewport()
        }
        if (step.panel) await expect(page.locator('.uw-assign')).toBeInViewport()
        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/${step.name.replace(/\W+/g, '-')}-${viewport.width}.png` })
        }
      })
    }
  })
}

for (const width of [1366, 1440, 1840]) {
  test(`the site lists fill their card at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const step of STEPS.filter((s) => s.panel)) {
      await open(page, step)
      const m = await page.locator('.uw-card-body').first().evaluate((el) => {
        const table = el.querySelector('table')
        return { body: el.clientWidth, table: table.getBoundingClientRect().width, sw: el.scrollWidth }
      })
      expect(Math.abs(m.table - m.body)).toBeLessThanOrEqual(1)
      expect(m.sw).toBeLessThanOrEqual(m.body)
    }
  })
}

test.describe('accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  for (const step of STEPS) {
    test(`${step.name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await open(page, step)
      const { violations } = await new AxeBuilder({ page })
        .include('.uw-page')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
    })
  }

  test('an assignment, its confirmation and History stay clean', async ({ page }) => {
    await open(page, STEPS[3])
    await page.getByRole('checkbox', { name: 'Select every site shown' }).check()
    await page.route('**/api/v1/work-items/assign', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assigned: 38, batch_id: 1 }) }),
    )
    await page.locator('.uw-assign-card').first().click()
    await expect(page.locator('.uw-notice-text')).toContainText('assigned to')
    const { violations } = await new AxeBuilder({ page }).include('.uw-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(violations.map((v) => v.id)).toEqual([])
  })
})
