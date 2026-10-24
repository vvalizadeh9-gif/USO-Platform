// The Monthly Plan staff page (UEP-18): each of its three pages fits one screen
// at 1440x900 and at 1366x768 without the page scrolling (the lists, bands and
// tables scroll inside themselves), carries no serious axe violation, and a
// decision changes the number, asks for a comment and keeps the focus ring.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const TABS = [
  { name: 'Plans', path: '/monthly-plan', ready: (page) => page.getByRole('group', { name: 'Needs your decision' }) },
  { name: 'History', path: '/monthly-plan?tab=history', ready: (page) => page.getByRole('group', { name: 'Worst first' }) },
  { name: 'Internal PIP', path: '/monthly-plan?tab=internal', ready: (page) => page.getByText('MTN Internal PIP').first() },
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

  test('Plans lists every waiting contractor, and a changed number asks for a comment', async ({ page }) => {
    await open(page, TABS[0])
    await expect(page.getByRole('group', { name: 'Needs your decision' }).getByRole('button')).toHaveCount(7)
    await expect(page.getByLabel('Comment')).toHaveCount(0)

    const dt = page.getByRole('region', { name: 'DT delivery' }).last()
    await dt.getByRole('button', { name: 'Increase' }).click()
    await expect(dt.getByLabel(/Comment/)).toBeVisible()
    await expect(dt.getByRole('button', { name: /^Increase to \d+$/ })).toBeDisabled()
    await dt.getByLabel(/Comment/).fill('Capacity allows more')
    await expect(dt.getByRole('button', { name: /^Increase to \d+$/ })).toBeEnabled()
    await dt.getByRole('button', { name: 'Decrease' }).click()
    await expect(dt.getByLabel(/Comment/)).toHaveCount(0)
  })

  test('the stepper buttons show the focus ring from the keyboard', async ({ page }) => {
    await open(page, TABS[0])
    const plus = page.getByRole('region', { name: 'DT delivery' }).last().getByRole('button', { name: 'Increase' })
    await plus.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(plus).toBeFocused()
    const outline = await plus.evaluate((el) => getComputedStyle(el).outlineStyle)
    expect(outline).not.toBe('none')
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
