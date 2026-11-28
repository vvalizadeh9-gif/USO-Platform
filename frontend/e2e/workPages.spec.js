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
import { CONTRACTOR } from './fixtures.js'

const STEPS = [
  { name: 'Step 1 Health check Assign', path: '/health-check?tab=assign', title: 'Health check · Assign', list: true, panel: true },
  { name: 'Step 2 Checks', path: '/health-check?tab=checks', title: 'Health check · Checks', list: true, inbox: true },
  { name: 'Step 3 Drive test Assign', path: '/drive-test?tab=assign', title: 'Drive test · Assign', list: true, panel: true },
  { name: 'Step 4 Tests', path: '/drive-test?tab=tests', title: 'Drive test · Tests', list: true },
  { name: 'DT done', path: '/drive-test?tab=done', title: 'DT done' },
  { name: 'Remediation', path: '/health-check?tab=remediation', title: 'Exceptions · Remediation', list: true },
  { name: 'Re-routes', path: '/health-check?tab=reroutes', title: 'Exceptions · Re-routes' },
  { name: 'History', path: '/drive-test?tab=history', title: 'History' },
]

/** UEP-31: the contractor's own page and Admin › Contractors. */
const OTHER_PAGES = [
  { name: 'Admin Contractors', path: '/admin/contractors', title: 'Contractors', scope: 'main' },
  { name: 'My health check', path: '/my-health-check', title: 'Health check', user: CONTRACTOR, scope: 'main' },
]

async function open(page, step) {
  await signIn(page, step.user)
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
          // The Checks inbox list has no header row; its batch table does.
          if (!step.inbox) await expect(body.locator('thead th').first()).toBeInViewport()
        }
        if (step.panel) await expect(page.locator('.uw-contractors-foot')).toBeInViewport()
        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/${step.name.replace(/\W+/g, '-')}-${viewport.width}.png` })
        }
      })
    }
  })
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })
    for (const p of OTHER_PAGES) {
      test(`${p.name} does not scroll the page`, async ({ page }) => {
        await open(page, p)
        const m = await pageScroll(page)
        expect(m.sh).toBeLessThanOrEqual(m.ih)
        expect(m.sw).toBeLessThanOrEqual(m.iw)
        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/${p.name.replace(/\W+/g, '-')}-${viewport.width}.png` })
        }
      })
    }
  })
}

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('turns every motion off', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, STEPS[1])
    const motion = await page.evaluate(() => {
      const one = (sel, pseudo) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const s = getComputedStyle(el, pseudo)
        return { transition: s.transitionDuration, animation: s.animationName }
      }
      return {
        line: one('.uw-flow-step.is-selected', '::after'),
        step: one('.uw-flow-step'),
        batch: one('.uw-batch-row'),
        bar: one('.uw-batch-bar i'),
        open: one('.uw-inbox-open'),
      }
    })
    for (const [, m] of Object.entries(motion)) {
      expect(m).not.toBeNull()
      expect(m.transition.split(',').every((d) => d.trim() === '0s')).toBe(true)
      expect(m.animation).toBe('none')
    }
  })
})

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
  for (const step of [...STEPS, ...OTHER_PAGES]) {
    test(`${step.name} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await open(page, step)
      const { violations } = await new AxeBuilder({ page })
        .include(step.scope || '.uw-page')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
    })
  }

  test('an assignment, its confirmation and History stay clean', async ({ page }) => {
    await open(page, STEPS[2])
    await page.getByRole('checkbox', { name: 'Select every site shown' }).check()
    await page.route('**/api/v1/work-items/assign', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assigned: 38, batch_id: 1, batch_code: 'DT-1' }) }),
    )
    await page.getByRole('radio').first().click()
    await page.getByRole('button', { name: /^Assign to / }).click()
    await expect(page.locator('.uw-notice-text')).toContainText('Batch DT-1 sent to')
    // Rows slide out and the reloaded list fades in; measure once it settles.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    const { violations } = await new AxeBuilder({ page }).include('.uw-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(violations.map((v) => v.id)).toEqual([])
  })
})
