// The sign-in screen in a real browser: reflow at 320px, the keyboard path,
// and an axe pass over every view.
//
// The axe pass needs @axe-core/playwright, which is not a dependency yet. It
// is skipped, and says so, until `npm i -D @axe-core/playwright` is run.
import { expect, test } from '@playwright/test'

let AxeBuilder = null
try {
  AxeBuilder = (await import('@axe-core/playwright')).default
} catch {
  // Not installed; the axe test below skips.
}

// The API, mocked: wrong credentials are refused with the server's 401, and a
// second refusal is what brings up the security check.
async function mockAuth(page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')
    if (path === '/auth/captcha') {
      return route.fulfill({ json: { token: 'tok', num1: 4, num2: 7 } })
    }
    if (path === '/auth/login') {
      return route.fulfill({ status: 401, json: { detail: 'Incorrect username or password' } })
    }
    return route.fulfill({ json: {} })
  })
}

async function failTwice(page) {
  for (let i = 0; i < 2; i += 1) {
    await page.getByLabel('Username', { exact: true }).fill('sara')
    await page.getByLabel('Password', { exact: true }).fill('wrong')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('The username or password is incorrect')
  }
  await expect(page.getByLabel('Security check')).toBeVisible()
  await expect(page.getByText('4 + 7 =')).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await mockAuth(page)
})

test('reflows at 320px without scrolling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/login')
  await failTwice(page)
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // The brand panel gives way to the small brand row.
  await expect(page.getByText('USO Enterprise Platform', { exact: true }).last()).toBeVisible()
})

test('the keyboard path: skip link, fields, Show, focus on the first problem', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/login')
  // The username has focus on load; the skip link is the one stop before it.
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const skip = page.getByRole('link', { name: 'Skip to sign-in form' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()

  // The help link sits beside the Password label, so it comes before the field.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Can’t sign in?' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('checkbox', { name: 'Remember my username' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text')

  // An empty submit puts focus on the first field with a problem.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByLabel('Username', { exact: true })).toBeFocused()
  await expect(page.getByLabel('Username', { exact: true })).toHaveAttribute('aria-invalid', 'true')
})

test('axe finds nothing on any view or error state', async ({ page }) => {
  test.skip(!AxeBuilder, 'needs @axe-core/playwright: npm i -D @axe-core/playwright')
  const scan = async (label) => {
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze()
    expect(violations, label).toEqual([])
  }
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login')
    await scan(`sign in @${width}`)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await scan(`empty submit @${width}`)
    await failTwice(page)
    await scan(`security check @${width}`)
    await page.getByRole('button', { name: 'Can’t sign in?' }).click()
    await scan(`forgot @${width}`)
    await page.getByLabel('Username or email address').fill('sara')
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByRole('heading', { name: 'Request sent' })).toBeFocused()
    await scan(`sent @${width}`)
  }
})
