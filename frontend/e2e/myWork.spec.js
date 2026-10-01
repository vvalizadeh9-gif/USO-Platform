// My Work at the two office resolutions: in every state the page can be in,
// the browser page never scrolls. Only the village list and the multi-village
// table scroll, inside their own cards.
import { expect, test } from '@playwright/test'
import { CONTRACTOR, PM } from './fixtures.js'
import { signIn } from './mockApi.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

async function open(page, user) {
  await signIn(page, user)
  await page.goto('/my-work')
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Requested' })).toBeVisible()
}

async function tickRows(page, count) {
  const boxes = page.locator('.mw-row .mw-check')
  for (let i = 0; i < count; i += 1) await boxes.nth(i).check()
}

const STATES = [
  { name: 'contractor, one village', user: CONTRACTOR, act: async () => {} },
  {
    name: 'contractor, many villages',
    user: CONTRACTOR,
    act: async (page) => {
      await tickRows(page, 6)
      await expect(page.getByRole('table', { name: 'Ticked villages' })).toBeVisible()
    },
  },
  {
    name: 'contractor, errors in the fields',
    user: CONTRACTOR,
    act: async (page) => {
      await page.getByRole('button', { name: /^Send (ICT|CRA)$/ }).first().click()
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible()
    },
  },
  {
    name: 'contractor, after send',
    user: CONTRACTOR,
    act: async (page) => {
      const card = page.locator('.mw-auth-card').filter({ has: page.getByRole('button', { name: /^Send / }) }).first()
      await card.locator('.mw-outlined input').nth(0).fill('1405/ص/2210')
      await card.locator('.mw-outlined input').nth(1).fill('۱۴۰۵/۰۷/۰۸')
      await card.locator('input[type=file]').setInputFiles({ name: 'letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
      await expect(card.getByText('letter.pdf')).toBeVisible()
      await card.getByRole('button', { name: /^Send / }).click()
      await expect(page.getByRole('status').filter({ hasText: /^Sent / })).toBeVisible()
    },
  },
  {
    name: 'coordinator, review',
    user: { ...PM, role: { name: 'Coordinator' } },
    act: async (page) => {
      await expect(page.getByRole('button', { name: 'Confirm', exact: true }).first()).toBeVisible()
    },
  },
  {
    name: 'PM, many villages',
    user: PM,
    act: async (page) => {
      await page.getByRole('tab', { name: /Not filed/ }).click()
      await tickRows(page, 4)
      await expect(page.getByRole('button', { name: /^Save ICT · \d+$/ })).toBeVisible()
    },
  },
]

for (const viewport of VIEWPORTS) {
  test.describe(`My Work ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })
    for (const state of STATES) {
      test(`${state.name}: the page does not scroll`, async ({ page }) => {
        await open(page, state.user)
        await state.act(page)
        await page.waitForTimeout(250)

        const m = await page.evaluate(() => {
          const el = document.scrollingElement
          return { sh: el.scrollHeight, sw: el.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }
        })
        expect(m.sh).toBeLessThanOrEqual(m.ih)
        expect(m.sw).toBeLessThanOrEqual(m.iw)
        const body = await page.locator('.page-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
        expect(body[0]).toBeLessThanOrEqual(body[1])

        // The village list is long enough to scroll, and scrolls in its card.
        const list = page.locator('.mw-list-scroll')
        const inner = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        expect(inner.sh).toBeGreaterThan(inner.ch)

        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/mywork-${state.name.replace(/\W+/g, '-')}-${viewport.width}.png` })
        }
      })
    }
  })
}
