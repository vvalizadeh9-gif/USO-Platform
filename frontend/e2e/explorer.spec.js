// UEP-28: Explorer's list and site record in a real browser.
//
// * No page scroll at 1440×900 and 1366×768: on the list, and on records
//   with 1, 3, 10 and 25 villages. Only the list body, the village table and
//   the history panel scroll.
// * Long Persian village names wrap; missing dates show "—".
// * Every computed font size on both pages is on the type scale.
// * axe (WCAG 2.2 AA, contrast included) finds nothing on the list, the
//   record, or the open history panel.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]
const SITES = [1, 3, 5, 10, 15, 25, 98]
const SCALE = [12, 13, 14, 16, 20, 24, 32]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

async function open(page, id, query = '') {
  await signIn(page)
  await page.goto(`/explorer/sites/${id}${query}`)
  await expect(page.getByRole('heading', { level: 2, name: 'Journey' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1800) // the ribbon reveal and the table rows, once
}

async function openList(page) {
  await signIn(page)
  await page.goto('/explorer')
  await expect(page.locator('.exl-site-row').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(900)
}

const pageScroll = (page) =>
  page.evaluate(() => {
    const el = document.scrollingElement
    return { sh: el.scrollHeight, sw: el.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }
  })

const expectNoPageScroll = async (page) => {
  const m = await pageScroll(page)
  expect(m.sh).toBeLessThanOrEqual(m.ih)
  expect(m.sw).toBeLessThanOrEqual(m.iw)
}

/** Every font size used by visible text under `root`, off the scale. */
const offScale = (page, root) =>
  page.evaluate(([sel, scale]) => {
    const out = new Set()
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      const box = el.getBoundingClientRect()
      if (!own || box.width <= 1 || box.height <= 1) continue // hidden, or screen-reader-only text
      const px = Number.parseFloat(getComputedStyle(el).fontSize)
      if (!scale.includes(px)) out.add(`${px}px ${el.className || el.tagName}`)
    }
    return [...out]
  }, [root, SCALE])

const axe = (page, include) =>
  new AxeBuilder({ page }).include(include).withTags(TAGS).analyze()
    .then(({ violations }) => violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`))

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    for (const id of SITES) {
      test(`record with ${id} villages: no page scroll, only the table body scrolls`, async ({ page }) => {
        await open(page, id)
        await expectNoPageScroll(page)
        await expect(page.getByRole('region', { name: 'Site passport' })).toBeInViewport({ ratio: 1 })
        await expect(page.locator('.exr')).toBeInViewport({ ratio: 1 })
        const table = page.locator('.exa-scroll')
        await table.evaluate((el) => el.scrollTo(0, el.scrollHeight))
        await expect(table.locator('thead th').first()).toBeInViewport()
        await expect(table.locator('tbody tr').last()).toBeInViewport()
        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/explorer-${id}-${viewport.width}.png` })
        }
      })
    }

    for (const id of [1, 5, 15, 25, 98]) {
      test(`the passport with ${id === 98 ? '25 long-named' : id} villages: at most two chip lines, then "+n more", about 150px tall`, async ({ page }) => {
        await open(page, id)
        const measure = () => page.locator('.exp').evaluate((card) => ({
          height: card.getBoundingClientRect().height,
          lines: new Set([...card.querySelectorAll('.exp-chips > li')].map((li) => li.offsetTop)).size,
          more: !!card.querySelector('.exp-chips .is-more'),
        }))
        // A resize (late fonts) shows every chip for a frame, then cuts again.
        await expect.poll(async () => (await measure()).lines).toBeLessThanOrEqual(2)
        const m = await measure()
        expect(m.height).toBeLessThanOrEqual(156)
        if (id >= 15) expect(m.more).toBe(true)
      })
    }

    test('the list: no page scroll, only its body scrolls, no footer', async ({ page }) => {
      await openList(page)
      await expectNoPageScroll(page)
      const inner = await page.locator('.exl-body').evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
      expect(inner.sh).toBeGreaterThan(inner.ch)
      expect(await page.locator('.exl-footer').count()).toBe(0)
      const h = await page.evaluate(() => ({
        toolbar: document.querySelector('.exl-toolbar').getBoundingClientRect().height,
        row: document.querySelector('.exl-site-row').getBoundingClientRect().height,
      }))
      expect(h.toolbar).toBeGreaterThanOrEqual(56)
      expect(Math.round(h.row)).toBe(44)
      if (process.env.SCREENSHOTS) {
        await page.screenshot({ path: `${process.env.SCREENSHOTS}/explorer-list-${viewport.width}.png` })
      }
    })

    test('the list title row lines up with the card edges', async ({ page }) => {
      await openList(page)
      const { title, card } = await page.evaluate(() => ({
        title: document.querySelector('.exl-title-row').getBoundingClientRect(),
        card: document.querySelector('.exl-card').getBoundingClientRect(),
      }))
      expect(Math.abs(title.left - card.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(title.right - card.right)).toBeLessThanOrEqual(1)
    })
  })
}

test.describe('content at 1440×900', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('long Persian village names wrap, and missing dates show "—"', async ({ page }) => {
    await open(page, 99)
    await expectNoPageScroll(page)
    const name = page.locator('.exa-village-name').first()
    const { height, line } = await name.evaluate((el) => ({ height: el.getBoundingClientRect().height, line: Number.parseFloat(getComputedStyle(el).lineHeight) }))
    expect(height).toBeGreaterThan(line * 1.5)
    await expect(page.locator('.exr-ms').first()).toContainText('—')
    await expect(page.locator('.exj-stats')).toContainText('—')
  })

  test('every font size on the record and the list is on the scale', async ({ page }) => {
    await open(page, 3)
    expect(await offScale(page, '.ex-page')).toEqual([])
    await openList(page)
    expect(await offScale(page, '.exl-page')).toEqual([])
  })
})

test.describe('accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('the record has no WCAG 2.2 AA violations', async ({ page }) => {
    await open(page, 3, '?village=V10002')
    expect(await axe(page, '.ex-page')).toEqual([])
  })

  test('the open history panel has no violations', async ({ page }) => {
    await open(page, 3)
    await page.getByRole('button', { name: /History/ }).click()
    await expect(page.getByRole('dialog', { name: 'Villages' })).toBeVisible()
    await page.waitForTimeout(600)
    expect(await axe(page, '.exh')).toEqual([])
  })

  test('the list has none, with a row focused, villages open and a filter menu open', async ({ page }) => {
    await openList(page)
    await page.locator('.exl-site-row').nth(1).getByRole('button', { name: /villages of/ }).click()
    await page.locator('.exl-site').first().focus()
    expect(await axe(page, '.exl-page')).toEqual([])
    await page.getByRole('group', { name: 'Filters' }).getByRole('button', { name: 'Province' }).click()
    expect(await axe(page, '.exl-page')).toEqual([])
  })
})
