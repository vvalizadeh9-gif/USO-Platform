// ICT validation (UEP-16 §8), against the fixture API: a coordinator works a
// whole site in one sitting -- By site, the CRA email, two ICT and one CRA
// confirmed (one request per authority), one returned with its own reason,
// and one Undo. Then the page fits the three office screens with no scroll.
//
// The contractor's side of a return (Filing › Returned with the reason) is
// covered by the backend tests: the fixture API does not keep state.
import { expect, test } from '@playwright/test'
import { PM } from './fixtures.js'
import { signIn } from './mockApi.js'

const COORDINATOR = { ...PM, username: 'coordinator', role: { ...PM.role, name: 'Coordinator' } }

async function open(page) {
  await signIn(page, COORDINATOR)
  await page.goto('/validation/ict')
  await expect(page.getByRole('heading', { level: 1, name: 'ICT validation' })).toBeVisible()
  await expect(page.getByRole('table', { name: 'ICT filings' })).toBeVisible()
}

function reviews(page) {
  const bodies = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/acceptance/letters/review')) {
      bodies.push(request.postDataJSON())
    }
  })
  return bodies
}

test('a coordinator finishes a site across ICT and CRA', async ({ page }) => {
  await page.clock.install()
  const sent = reviews(page)
  await open(page)

  await page.getByRole('button', { name: /By site/ }).click()
  await expect(page.getByRole('table', { name: 'CRA filings' })).toBeVisible()
  await expect(page.getByText('also waiting on this site')).toBeVisible()

  // The CRA letter's email, as plain text.
  const craStrip = page.locator('.vl-strip[data-authority="CRA"]')
  await craStrip.getByRole('button', { name: 'View' }).click()
  const viewer = page.getByRole('region', { name: /Evidence for CRA letter/ })
  await expect(viewer.getByText('CRA acceptance — TB-4471')).toBeVisible()
  await expect(viewer.getByText(/accepted for 3G and 4G/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()

  // Two ICT and one CRA: one request each.
  // The village cell: in By site the Letter cell is a link that opens the viewer.
  const ict = page.getByRole('table', { name: 'ICT filings' }).locator('tbody tr.vl-tr td.vl-village')
  const cra = page.getByRole('table', { name: 'CRA filings' }).locator('tbody tr.vl-tr td.vl-village')
  await ict.nth(0).click()
  await ict.nth(1).click()
  await cra.nth(0).click()
  await expect(page.getByRole('region', { name: 'Selection' })).toContainText('3 selected · 2 ICT · 1 CRA')
  await page.keyboard.press('c')
  await page.clock.runFor(6500)
  await expect.poll(() => sent.map((b) => b.authority).sort()).toEqual(['CRA', 'ICT'])
  expect(sent.find((b) => b.authority === 'ICT').items).toHaveLength(2)

  // Return one with its own reason; then a second one, undone.
  await ict.nth(2).click()
  await page.keyboard.press('r')
  await page.getByRole('textbox', { name: /Own reason for/ }).fill('Wrong village on the letter')
  await page.getByRole('button', { name: /^Return 1 to/ }).click()
  await page.clock.runFor(6500)
  await expect.poll(() => sent.length).toBe(3)
  expect(sent[2]).toMatchObject({ decision: 'return', items: [expect.objectContaining({ reason: 'Wrong village on the letter' })] })

  await ict.nth(3).click()
  await page.keyboard.press('c')
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.clock.runFor(6500)
  expect(sent).toHaveLength(3)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]) {
  test(`no page scroll at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open(page)
    for (const view of ['By letter', 'By site']) {
      await page.getByRole('button', { name: new RegExp(view) }).click()
      await page.getByRole('table', { name: 'ICT filings' }).locator('tbody tr.vl-tr td.vl-village').first().click()
      await page.getByRole('button', { name: 'View' }).first().click()
      const scroll = await page.evaluate(() => ({
        page: document.scrollingElement.scrollHeight - window.innerHeight,
        width: document.scrollingElement.scrollWidth - window.innerWidth,
      }))
      expect(scroll.page).toBeLessThanOrEqual(0)
      expect(scroll.width).toBeLessThanOrEqual(0)
      await page.keyboard.press('Escape')
    }
  })
}
