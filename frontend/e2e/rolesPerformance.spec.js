// Roles Performance (UEP-09): Month and Area fit one screen at 1440x900 and at
// 1366x768 without the page scrolling (the owner columns, the ranking and, on
// short screens, the pipeline scroll inside themselves), and carry no serious
// axe violation. The month picker closes on Escape and gives focus back.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const TABS = [
  { name: 'Month', path: '/reports/kpi/month', ready: (page) => page.getByRole('region', { name: 'Coordinators' }) },
  { name: 'Area', path: '/reports/kpi/area', ready: (page) => page.getByRole('heading', { name: 'Fully approved by province' }) },
  { name: 'Area scoped', path: '/reports/kpi/area?lens=rm&key=Nobakht', ready: (page) => page.getByRole('heading', { name: 'Fully approved by province' }) },
]

async function open(page, tab) {
  await signIn(page)
  await page.goto(tab.path)
  // The first visit compiles the page on the dev server.
  await expect(tab.ready(page).first()).toBeVisible({ timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]) {
  test.describe(`Roles Performance ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const tab of TABS) {
      test(`${tab.name} does not scroll the page`, async ({ page }) => {
        await open(page, tab)
        const doc = await page.evaluate(() => ({
          sh: document.scrollingElement.scrollHeight,
          sw: document.scrollingElement.scrollWidth,
          ih: window.innerHeight,
          iw: window.innerWidth,
        }))
        expect(doc.sh).toBeLessThanOrEqual(doc.ih)
        expect(doc.sw).toBeLessThanOrEqual(doc.iw)
        const [sh, ch] = await page.locator('.rp-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
        expect(sh).toBeLessThanOrEqual(ch)

        if (process.env.SCREENSHOTS) {
          await page.screenshot({
            path: `${process.env.SCREENSHOTS}/rp-${tab.name.replace(/\W+/g, '-')}-${viewport.width}.png`,
          })
        }
      })
    }
  })
}

test.describe('Roles Performance behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the month picker closes on Escape and gives focus back to the title', async ({ page }) => {
    await open(page, TABS[0])
    const title = page.getByRole('button', { name: /Choose month/ })
    await title.click()
    const dialog = page.getByRole('dialog', { name: 'Choose month' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(title).toBeFocused()
  })

  test('the ranking scrolls inside its card, the national row pinned', async ({ page }) => {
    await open(page, TABS[1])
    const list = page.locator('.rp-rank-list')
    const [sh, ch] = await list.evaluate((el) => [el.scrollHeight, el.clientHeight])
    expect(sh).toBeGreaterThan(ch)
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await expect(page.locator('.rp-rank-national')).toBeInViewport()
  })

  for (const tab of TABS) {
    test(`${tab.name} has no serious axe violations`, async ({ page }) => {
      await open(page, tab)
      const { violations } = await new AxeBuilder({ page })
        .include('.rp')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
    })
  }
})
