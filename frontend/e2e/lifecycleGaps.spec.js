// Lifecycle Gaps at the two office resolutions: the browser page never
// scrolls -- on either tab, with the drawer open or closed, with a map shape
// selected -- no text in a tile is clipped, and a clicked number downloads a
// file with that many villages.
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'
import { countVillageRows } from './xlsx.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

async function expectNoPageScroll(page) {
  // A frame for layout to settle after the last read or animation.
  await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const el = document.scrollingElement
    const body = document.querySelector('.page-body')
    return {
      scrollHeight: el.scrollHeight,
      scrollWidth: el.scrollWidth,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      bodyScroll: body ? body.scrollHeight - body.clientHeight : 0,
    }
  })
  expect(m.scrollHeight).toBeLessThanOrEqual(m.innerHeight)
  expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth)
  // One-screen design: the body fits whole rather than scrolling in the frame.
  expect(m.bodyScroll).toBeLessThanOrEqual(0)
}

async function open(page, tab = 'gaps') {
  await signIn(page)
  await page.goto('/reports/lifecycle-gaps')
  await expect(page.getByRole('heading', { name: 'Pending approval' })).toBeVisible()
  if (tab === 'map') {
    await page.getByRole('tab', { name: 'Coverage map' }).click()
    await expect(page.getByTestId('cov-map-ict')).toBeVisible()
  }
  await page.waitForLoadState('networkidle')
}

async function shoot(page, name, viewport) {
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/lifecycle-gaps-${name}-${viewport.width}.png` })
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`Lifecycle Gaps ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })

    test('the Gaps tab fits, with no clipped text in a tile', async ({ page }) => {
      await open(page)
      await expect(page.getByTestId('waffle-tile')).toHaveCount(6)
      await expectNoPageScroll(page)

      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll('.waffle-tile *')]
          .filter((el) => el.children.length === 0 && el.textContent.trim())
          .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          .map((el) => el.textContent.trim())
      )
      expect(clipped).toEqual([])
      await shoot(page, 'gaps', viewport)
    })

    test('the drawer opens over the page without moving it', async ({ page }) => {
      await open(page)
      const tile = page.getByTestId('waffle-tile').first()
      const before = await tile.boundingBox()
      await page.getByRole('button', { name: /ICT Pending: 1,391 villages/ }).click()
      const drawer = page.getByRole('dialog', { name: 'ICT Pending ICT approval' })
      await expect(drawer).toBeVisible()
      await expect(drawer.getByTestId('gap-checksum')).toHaveText('Adds up to 1,391 ✓')
      expect(await tile.boundingBox()).toEqual(before)
      await expectNoPageScroll(page)

      // Only the list scrolls, inside the drawer.
      const list = drawer.locator('.gap-drawer-scroll')
      const inner = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
      expect(inner.sh).toBeGreaterThanOrEqual(inner.ch)
      await shoot(page, 'drawer', viewport)

      await page.keyboard.press('Escape')
      await expect(drawer).toHaveCount(0)
      await expectNoPageScroll(page)
    })

    test('the coverage map fits, empty and with a shape selected', async ({ page }) => {
      await open(page, 'map')
      await expect(page.getByText('Select a province on the map')).toBeVisible()
      await expectNoPageScroll(page)

      await page.locator('[data-shape="تهران"]').click({ force: true })
      await expect(page.getByRole('region', { name: 'Tehran detail' })).toBeVisible()
      await expectNoPageScroll(page)
      await shoot(page, 'map-province', viewport)

      await page.getByRole('button', { name: 'CRA approval · by region' }).click()
      await expect(page.getByText('Select a CRA region on the map')).toBeVisible()
      await page.locator('[data-shape="North"]').click({ force: true })
      await expect(page.getByRole('region', { name: 'North detail' })).toBeVisible()
      await expectNoPageScroll(page)
      await shoot(page, 'map-region', viewport)
    })
  })
}

test.describe('export behind every number', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  async function download(page, button) {
    const text = (await button.locator('.tnum').textContent()).replace(/,/g, '')
    const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
    const rows = countVillageRows(await readFile(await file.path()))
    return { clicked: Number(text), rows }
  }

  test('a tile figure downloads its villages', async ({ page }) => {
    await open(page)
    const { clicked, rows } = await download(
      page,
      page.getByRole('button', { name: 'Export 575 villages (CRA pending) to Excel' })
    )
    expect(rows).toBe(clicked)
    await expect(page.getByText('Exported 575 villages')).toBeVisible()
    await expectNoPageScroll(page)
  })

  test('a drawer row downloads its owner’s villages', async ({ page }) => {
    await open(page)
    await page.getByRole('button', { name: /ICT Pending: 1,391 villages/ }).click()
    const row = page.getByRole('dialog').getByRole('button', { name: /Coordinator V\. Hashemi\) to Excel$/ })
    const { clicked, rows } = await download(page, row)
    expect(rows).toBe(clicked)
  })

  test('a map panel row downloads its villages in that province', async ({ page }) => {
    await open(page, 'map')
    await page.locator('[data-shape="تهران"]').click({ force: true })
    const panel = page.getByRole('region', { name: 'Tehran detail' })
    const button = panel.getByRole('button', { name: /^Export .* \(ICT pending · Tehran · Coordinator/ }).first()
    const { clicked, rows } = await download(page, button)
    expect(rows).toBe(clicked)
  })
})
