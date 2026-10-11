// The sign-in page in a real browser: layout at the reviewed sizes, the brand
// panel giving way below 960px, the keyboard path, reduced motion, the
// redirects, and an axe pass. The API is mocked; no backend is needed.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const USER = { id: 1, username: 'sara', role: { name: 'PM' }, must_change_password: false }

// Wrong credentials are refused with the server's 401 until `sara`/`right`.
async function mockAuth(page) {
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    if (path === '/auth/captcha') return route.fulfill({ json: { token: 'tok', num1: 4, num2: 7 } })
    if (path === '/auth/login') {
      const body = new URLSearchParams(request.postData() || '')
      if (body.get('password') === 'right') return route.fulfill({ json: { user: USER } })
      return route.fulfill({ status: 401, json: { detail: 'Username or password is incorrect.' } })
    }
    if (path === '/auth/me') return route.fulfill({ json: USER })
    return route.fulfill({ json: [] })
  })
}

test.beforeEach(async ({ page }) => {
  await mockAuth(page)
})

for (const [width, height] of [[1440, 900], [1366, 768]]) {
  test(`two equal halves and no page scroll at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.goto('/login')
    const form = await page.locator('.uep-signin-side').boundingBox()
    const brand = await page.locator('.uep-signin-brand').boundingBox()
    expect(Math.abs(form.width - brand.width)).toBeLessThanOrEqual(1)
    expect(brand.x + brand.width).toBeCloseTo(width, 0)
    const column = await page.locator('.uep-signin-column').boundingBox()
    expect(column.width).toBeLessThanOrEqual(380)
    const scroll = await page.evaluate(() => [
      document.scrollingElement.scrollWidth - innerWidth,
      document.scrollingElement.scrollHeight - innerHeight,
    ])
    expect(scroll).toEqual([0, 0])
    await expect(page.locator('.uep-signin-statement')).toHaveText('USOEnterprisePlatform')
  })
}

test('below 960px the brand panel is hidden and the form stands alone', async ({ page }) => {
  await page.setViewportSize({ width: 959, height: 800 })
  await page.goto('/login')
  await expect(page.locator('.uep-signin-brand')).toBeHidden()
  await expect(page.locator('.uep-auth-logo')).toBeVisible()
  await expect(page.locator('.uep-auth-footer')).toBeVisible()
})

test('reflows at 320px without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/login')
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('tab order follows the visual order, and Enter submits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()
  const order = [
    page.getByRole('link', { name: 'Forgot password?' }),
    page.getByLabel('Password', { exact: true }),
    page.getByRole('button', { name: 'Show password' }),
    page.getByRole('checkbox', { name: 'Remember my username' }),
    page.getByRole('button', { name: 'Sign in', exact: true }),
    page.getByRole('link', { name: 'Contact your UEP administrator' }),
  ]
  for (const target of order) {
    await page.keyboard.press('Tab')
    await expect(target).toBeFocused()
  }
  await page.getByLabel('Username', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText('Enter your username and password.')
})

test('the waves are stopped and hidden under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('data-uep-motion', 'reduce')
  await expect(page.locator('.uep-signin-waves')).toBeHidden()
})

test('the review flag forces reduced motion', async ({ page }) => {
  await page.goto('/login?motion=reduce')
  await expect(page.locator('html')).toHaveAttribute('data-uep-motion', 'reduce')
})

test('a protected page sends you to sign in and back again', async ({ page }) => {
  await page.goto('/my-work?village=12')
  await expect(page).toHaveURL(/\/login\?next=%2Fmy-work%3Fvillage%3D12$/)
  await page.getByLabel('Username', { exact: true }).fill('sara')
  await page.getByLabel('Password', { exact: true }).fill('right')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/my-work\?village=12$/)
})

test('an expired session shows the neutral notice', async ({ page }) => {
  await page.goto('/login?next=%2Fmy-work&reason=expired')
  await expect(page.getByText('Your session expired. Sign in again.')).toBeVisible()
})

test('wrong credentials get the generic message', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username', { exact: true }).fill('sara')
  await page.getByLabel('Password', { exact: true }).fill('wrong')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Username or password is incorrect.')
})

test('axe finds no serious or critical violations', async ({ page }) => {
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login?motion=reduce')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    expect(serious, `@${width}`).toEqual([])
  }
})
