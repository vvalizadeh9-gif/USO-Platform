// The Monthly Plan staff page (UEP-08): each of its four tabs fits one screen
// at 1440x900 and at 1366x768 without the page scrolling (the Approvals grid
// and the History table scroll inside themselves), carries no serious axe
// violation, and the Return dialog keeps focus and gives it back.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const TABS = [
  { name: 'Approvals', path: '/monthly-plan', ready: (page) => page.getByRole('list', { name: 'Contractors waiting' }) },
  { name: 'Plans', path: '/monthly-plan?tab=plans', ready: (page) => page.getByRole('heading', { name: /plans$/ }) },
  { name: 'History', path: '/monthly-plan?tab=history', ready: (page) => page.getByRole('table') },
  { name: 'Internal PIP', path: '/monthly-plan?tab=internal', ready: (page) => page.getByText('Coverage by contractors') },
]

async function open(page, tab) {
  await signIn(page)
  await page.goto(tab.path)
  // The first visit compiles the page on the dev server.
  await expect(tab.ready(page).first()).toBeVisible({ timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]) {
  test.describe(`Monthly Plan ${viewport.width}×${viewport.height}`, () => {
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
        const [sh, ch] = await page.locator('.page-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
        expect(sh).toBeLessThanOrEqual(ch)

        if (process.env.SCREENSHOTS) {
          await page.screenshot({
            path: `${process.env.SCREENSHOTS}/mp-${tab.name.replace(/\W+/g, '-')}-${viewport.width}.png`,
          })
        }
      })
    }
  })
}

test.describe('Monthly Plan behaviour', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Approvals shows every waiting card at once, the grid scrolling inside itself', async ({ page }) => {
    await open(page, TABS[0])
    // Seven planning-month cards and one revision card.
    await expect(page.locator('.mp-card')).toHaveCount(8)
    const grid = await page.locator('.mp-grid-wrap').evaluate((el) => [el.scrollHeight, el.clientHeight])
    expect(grid[0]).toBeGreaterThan(grid[1])
  })

  test('the Return dialog traps focus, closes on Escape and gives focus back', async ({ page }) => {
    await open(page, TABS[0])
    const opener = page.getByRole('button', { name: /^Return / }).first()
    await opener.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('What should they change?')).toBeFocused()
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  for (const tab of TABS) {
    test(`${tab.name} has no serious axe violations`, async ({ page }) => {
      await open(page, tab)
      const { violations } = await new AxeBuilder({ page })
        .include('.mp-page')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
    })
  }
})
