// The header search in a real browser (UEP-12): the field rests at 480px and
// widens to 640px on focus, the results panel animates in, Escape clears the
// text and then leaves the field, and Home with the panel open has no
// WCAG 2.2 AA violations.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'

test.use({ viewport: { width: 1440, height: 900 } })

const fieldWidth = (page) => page.locator('.uep-search').evaluate((el) => el.getBoundingClientRect().width)

test('the field widens on focus, shows results, and Escape twice puts it back', async ({ page }) => {
  await signIn(page)
  await page.goto('/home')
  const input = page.getByRole('combobox', { name: 'Search sites, villages, provinces and pages' })
  await expect(input).toBeVisible()
  expect(await fieldWidth(page)).toBeCloseTo(480, 0)

  await input.focus()
  await page.waitForTimeout(300)
  expect(Math.abs((await fieldWidth(page)) - 640)).toBeLessThanOrEqual(1)

  await input.fill('w4')
  const panel = page.locator('.uep-search-panel')
  await expect(panel).toHaveAttribute('data-state', 'showing')
  await expect(page.getByRole('option', { name: /^W4-1021/ })).toBeVisible()
  // The Persian province is isolated and set in Vazirmatn.
  const fa = page.getByRole('option', { name: /^W4-1021/ }).locator('bdi[lang="fa"]')
  await expect(fa).toHaveText('کرمان')
  expect(await fa.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Vazirmatn')

  await input.press('Escape')
  await expect(input).toHaveValue('')
  await expect(input).toBeFocused()
  await expect(panel).toHaveAttribute('data-state', 'hidden')

  await input.press('Escape')
  await expect(input).not.toBeFocused()
  await page.waitForTimeout(300)
  expect(Math.abs((await fieldWidth(page)) - 480)).toBeLessThanOrEqual(1)
})

test('the active-row highlight follows the arrow keys', async ({ page }) => {
  await signIn(page)
  await page.goto('/home')
  const input = page.getByRole('combobox', { name: 'Search sites, villages, provinces and pages' })
  await input.fill('w4')
  await expect(page.getByRole('option', { name: /^W4-1021/ })).toBeVisible()
  await page.waitForTimeout(300)

  const hiTop = () => page.locator('.uep-search-hi').evaluate((el) => el.getBoundingClientRect().top)
  const rowTop = (i) => page.getByRole('option').nth(i).evaluate((el) => el.getBoundingClientRect().top)
  expect(Math.abs((await hiTop()) - (await rowTop(0)))).toBeLessThanOrEqual(1)
  await input.press('ArrowDown')
  await page.waitForTimeout(250)
  expect(Math.abs((await hiTop()) - (await rowTop(1)))).toBeLessThanOrEqual(1)
})

test('under reduced motion the field changes width at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIn(page)
  await page.goto('/home')
  const input = page.getByRole('combobox', { name: 'Search sites, villages, provinces and pages' })
  await input.focus()
  await page.waitForTimeout(50)
  expect(Math.abs((await fieldWidth(page)) - 640)).toBeLessThanOrEqual(1)
})

test('Home with the search panel open has no WCAG 2.2 AA violations', async ({ page }) => {
  await signIn(page)
  await page.goto('/home')
  await expect(page.getByRole('heading', { name: 'Your work' })).toBeVisible()
  const input = page.getByRole('combobox', { name: 'Search sites, villages, provinces and pages' })
  await input.fill('w4')
  await expect(page.getByRole('option', { name: /^W4-1021/ })).toBeVisible()
  await page.waitForTimeout(800)

  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})
