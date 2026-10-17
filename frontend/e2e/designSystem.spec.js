// One design system (UEP-13 §3.16): every page renders in IBM Plex (Vazirmatn
// for Persian data), never Inter; no element is painted in the retired Cobalt
// blues; every icon is Carbon. Then a committed screenshot of each page at
// 1440×900, for PM and Contractor, so a drift shows up as a diff.
import { expect, test } from '@playwright/test'
import * as F from './fixtures.js'
import { signIn } from './mockApi.js'

const OLD_BLUES = ['rgb(47, 95, 208)', 'rgb(36, 81, 192)', 'rgb(29, 63, 153)']

const PM_PAGES = [
  { name: 'home', path: '/home' },
  { name: 'dt-dashboard', path: '/reports/drive-test' },
  { name: 'acceptance-dashboard', path: '/reports/acceptance' },
  { name: 'roles-performance-month', path: '/reports/kpi/month' },
  { name: 'roles-performance-area', path: '/reports/kpi/area' },
  { name: 'roles-performance-map', path: '/reports/kpi/map' },
  { name: 'lifecycle-gaps', path: '/reports/gaps' },
  { name: 'explorer', path: '/explorer' },
  { name: 'health-check', path: '/health-check' },
  { name: 'drive-test', path: '/drive-test' },
  { name: 'filing', path: '/my-work' },
  { name: 'monthly-plan', path: '/monthly-plan' },
  { name: 'mojri-tracker', path: '/mojri-tracker' },
  { name: 'cpm-changes', path: '/admin?tab=validate-cpm' },
]

const CONTRACTOR_PAGES = [
  { name: 'home', path: '/home' },
  { name: 'hc-check', path: '/my-health-check' },
  { name: 'in-progress', path: '/my-drive-tests' },
  { name: 'filing', path: '/my-work' },
  { name: 'monthly-plan', path: '/monthly-plan' },
]

/** Every rendered element's computed font and colours, in one pass. */
async function audit(page) {
  return page.evaluate((oldBlues) => {
    const out = { inter: [], oldBlue: [], lucide: document.querySelectorAll('svg.lucide').length }
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none') continue
      if (/\bInter\b/.test(cs.fontFamily)) out.inter.push(el.tagName)
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'fill', 'stroke']) {
        if (oldBlues.includes(cs[prop])) out.oldBlue.push(`${el.tagName}.${el.className}:${prop}`)
      }
    }
    return out
  }, OLD_BLUES)
}

for (const [role, user, pages] of [
  ['PM', F.PM, PM_PAGES],
  ['Contractor', F.CONTRACTOR, CONTRACTOR_PAGES],
]) {
  test.describe(`${role} pages`, () => {
    test.use({ viewport: { width: 1440, height: 900 } })

    for (const p of pages) {
      test(`${p.name} is on the UEP design system`, async ({ page }) => {
        await signIn(page, user)
        await page.goto(p.path)
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(300)

        const found = await audit(page)
        expect(found.inter, 'elements in Inter').toEqual([])
        expect(found.oldBlue.slice(0, 5), 'elements in the old blue').toEqual([])
        expect(found.lucide, 'Lucide icons').toBe(0)

        // Screenshot baselines are opt-in until they are committed: they must
        // be made on CI's Ubuntu Chromium, so run once with
        // `VISUAL=1 npx playwright test designSystem --update-snapshots`.
        if (process.env.VISUAL === '1') {
          await expect(page).toHaveScreenshot(`${role.toLowerCase()}-${p.name}.png`, {
            fullPage: false,
            animations: 'disabled',
            maxDiffPixelRatio: 0.01,
          })
        }
      })
    }
  })
}
