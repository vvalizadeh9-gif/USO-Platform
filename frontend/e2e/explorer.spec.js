// UEP-11 / UEP-11a: Explorer's list and site record page in a real browser.
//
// The list (UEP-11a): at 1440×900 and 1366×768 the page never scrolls; only
// the list body does, and the title row, tool bar, header row and footer keep
// their height (the Part A regression: a fixed row once shrank to 8px). axe
// finds nothing on it either.
//
// The record page:
// * 1440×900: no page scroll with 3 and with 6 villages (boards B4, B5); with
//   10 (board B6) only the village table's body scrolls, under its header;
// * 1366×768: still no page scroll; only the village lists scroll;
// * axe (WCAG 2.2 AA, contrast included) finds nothing, once the page has
//   faded in.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

// The site id picks the village count (e2e/explorerFixtures.js).
const SITES = [
  { villages: 3, id: 3 },
  { villages: 6, id: 6 },
  { villages: 10, id: 10, table: true },
]

async function open(page, id, query = '') {
  await signIn(page)
  await page.goto(`/explorer/sites/${id}${query}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Journey' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400) // the 240ms fade, then settle
}

const pageScroll = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement
    return { sh: el.scrollHeight, sw: el.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }
  })

const lastRow = (page, table) =>
  table ? page.locator('.ex-table tbody tr').last() : page.locator('.ex-panel').first().locator('.ex-row').last()

test.describe('1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const site of SITES) {
    test(`${site.villages} villages: the page does not scroll`, async ({ page }) => {
      await open(page, site.id)
      const m = await pageScroll(page)
      expect(m.sh).toBeLessThanOrEqual(m.ih)
      expect(m.sw).toBeLessThanOrEqual(m.iw)
      await expect(page.getByRole('region', { name: 'General information' })).toBeInViewport({ ratio: 1 })
      if (!site.table) {
        // Every village is on screen, nothing scrolls inside either.
        await expect(lastRow(page, false)).toBeInViewport({ ratio: 1 })
        const rows = await page.locator('.ex-rows').first().evaluate((el) => el.scrollHeight - el.clientHeight)
        expect(rows).toBeLessThanOrEqual(1)
      }
      if (process.env.SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/explorer-${site.villages}-1440.png` })
      }
    })
  }

  test('10 villages: only the table body scrolls, under a header that stays', async ({ page }) => {
    await open(page, 10)
    const scroller = page.getByRole('region', { name: /Villages, ICT and CRA status/ })
    const inner = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
    expect(inner.sh).toBeGreaterThan(inner.ch)
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight))
    await expect(scroller.locator('thead th').first()).toBeInViewport()
    await expect(lastRow(page, true)).toBeInViewport()
  })

  test('the cards end where their content ends', async ({ page }) => {
    await open(page, 3)
    const { info, journey, cards } = await page.evaluate(() => ({
      info: document.querySelector('.ex-info').getBoundingClientRect().bottom,
      journey: document.querySelector('.ex-journey').getBoundingClientRect().bottom,
      cards: document.querySelector('.ex-cards').getBoundingClientRect().bottom,
    }))
    expect(info).toBeLessThan(cards - 1)
    expect(journey).toBeLessThan(cards - 1)
  })

  test('the ?village= row is highlighted and focused', async ({ page }) => {
    await open(page, 6, '?village=V10004')
    const row = page.locator('.ex-panel').first().locator('[data-village="V10004"]')
    await expect(row).toHaveClass(/is-highlight/)
    await expect(row).toBeFocused()
  })
})

test.describe('1366×768', () => {
  test.use({ viewport: { width: 1366, height: 768 } })

  for (const site of SITES) {
    test(`${site.villages} villages: no page scroll, only the village list may scroll`, async ({ page }) => {
      await open(page, site.id)
      const m = await pageScroll(page)
      expect(m.sh).toBeLessThanOrEqual(m.ih)
      expect(m.sw).toBeLessThanOrEqual(m.iw)
      await expect(page.getByRole('list', { name: 'Journey' })).toBeInViewport({ ratio: 1 })
      await expect(page.getByRole('list', { name: 'Aging' })).toBeInViewport({ ratio: 1 })
      // Whatever does not fit is inside the village list, reachable by scrolling it.
      const list = site.table ? page.locator('.ex-table-scroll') : page.locator('.ex-rows').first()
      await list.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await expect(lastRow(page, site.table)).toBeInViewport()
      if (process.env.SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/explorer-${site.villages}-1366.png` })
      }
    })
  }
})

test.describe('accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  for (const site of SITES) {
    test(`${site.villages} villages: no WCAG 2.2 AA violations`, async ({ page }) => {
      await open(page, site.id, '?village=V10002')
      const { violations } = await new AxeBuilder({ page })
        .include('.ex-page')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
    })
  }
})

// --------------------------------------------------------------------------
// The list (UEP-11a)
// --------------------------------------------------------------------------
async function openList(page) {
  await signIn(page)
  await page.goto('/explorer')
  await expect(page.getByRole('table', { name: 'Sites' })).toBeVisible()
  await expect(page.locator('.exl-site-row').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(900) // the fade, then twenty staggered rows
}

const heights = (page) =>
  page.evaluate(() => {
    const h = (sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0
    return {
      title: h('.uw-heading'), toolbar: h('.exl-toolbar'), head: h('.exl-head'), footer: h('.exl-footer'),
    }
  })

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test.describe(`list at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('the page does not scroll; only the list body does, and no fixed row shrinks', async ({ page }) => {
      await openList(page)
      const m = await pageScroll(page)
      expect(m.sh).toBeLessThanOrEqual(m.ih)
      expect(m.sw).toBeLessThanOrEqual(m.iw)
      const body = page.locator('.exl-body')
      const inner = await body.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
      expect(inner.sh).toBeGreaterThan(inner.ch)

      const h = await heights(page)
      expect(h.toolbar).toBeGreaterThanOrEqual(56)
      expect(h.head).toBeGreaterThanOrEqual(40)
      expect(h.footer).toBeGreaterThanOrEqual(44)
      expect(h.title).toBeGreaterThanOrEqual(28)

      await body.evaluate((el) => el.scrollTo(0, el.scrollHeight))
      await expect(page.locator('.exl-head')).toBeInViewport()
      await expect(page.locator('.exl-footer')).toBeInViewport()
      if (process.env.SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/explorer-list-${viewport.width}.png` })
      }
    })
  })
}

test.describe('list accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('no WCAG 2.2 AA violations, with a row focused and villages open', async ({ page }) => {
    await openList(page)
    await page.locator('.exl-site-row').nth(1).getByRole('button', { name: /villages of/ }).click()
    await page.locator('.exl-site').first().focus()
    const { violations } = await new AxeBuilder({ page })
      .include('.exl-page')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
  })
})
