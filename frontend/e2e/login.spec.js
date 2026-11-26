// The sign-in page (UEP-26) in a real browser: every step fits 1440x900 and
// 1366x768 with no page scroll, username first with no server call, the
// lockout box after five wrong passwords, the help panel with the contact an
// Admin saves, the old links, reduced motion, and an axe pass. The API is
// mocked in the page; no backend is needed.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { seededAccess } from './mockApi.js'

const PM = { id: 1, username: 'sara', full_name: 'Sara Ahmadi', role: { name: 'PM' }, must_change_password: false }
const ADMIN = { id: 2, username: 'admin', full_name: 'Mina Rahimi', role: { name: 'Admin' }, must_change_password: false }
const FORCED = { ...PM, must_change_password: true }

const SUPPORT = {
  support_name: 'UEP support desk',
  support_hours: 'Saturday to Wednesday, 8:00 to 16:00',
  support_email: 'support@uep.example',
  support_phone: 'Extension 2140',
}

/**
 * The API as these tests need it. `sara`/`right` signs in; anything else is a
 * 401 until the fifth failure, then 429 with Retry-After: 90. The sign-in
 * settings are shared state, so a save on the Admin page shows on sign-in.
 */
async function mockApi(page, { me = PM, notice = null } = {}) {
  const state = { failures: 0, calls: [], row: { ...SUPPORT, notice_enabled: false, notice_text: null, notice_from: null, notice_to: null, updated_by: 2, updated_by_name: 'Mina Rahimi', updated_at: '2026-11-20T09:00:00+00:00' } }
  await page.route('**/api/v1/**', (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace('/api/v1', '')
    state.calls.push(`${request.method()} ${path}`)
    if (path === '/auth/signin-settings') {
      const { row } = state
      return route.fulfill({ json: {
        support: { name: row.support_name, hours: row.support_hours, email: row.support_email, phone: row.support_phone },
        notice: notice ? { text: notice } : null,
      } })
    }
    if (path === '/auth/login') {
      const body = new URLSearchParams(request.postData() || '')
      if (state.failures >= 5) {
        return route.fulfill({ status: 429, headers: { 'Retry-After': '90' }, json: { detail: 'Too many attempts. Try again in 2 minutes.' } })
      }
      if (body.get('password') === 'right') return route.fulfill({ json: { user: me } })
      state.failures += 1
      return route.fulfill({ status: 401, json: { detail: 'Username or password is incorrect.' } })
    }
    if (path === '/auth/me') return route.fulfill({ json: me })
    if (path === '/me/access') return route.fulfill({ json: seededAccess(me.role.name) })
    if (path === '/admin/signin-settings') {
      if (request.method() === 'PUT') {
        state.row = { ...state.row, ...JSON.parse(request.postData()), updated_at: new Date().toISOString() }
      }
      return route.fulfill({ json: state.row })
    }
    return route.fulfill({ json: [] })
  })
  return state
}

async function signedInAs(page, user) {
  // Every navigation re-runs this, so signing out is remembered for the tab.
  await page.addInitScript((u) => {
    if (!sessionStorage.getItem('signed_out')) localStorage.setItem('uep_user', JSON.stringify(u))
  }, user)
}

const username = (page) => page.getByLabel('Username', { exact: true })
const password = (page) => page.getByLabel('Password', { exact: true })
const continueButton = (page) => page.getByRole('button', { name: 'Continue' })
const signInButton = (page) => page.locator('form .uep-signin-submit')

async function noPageScroll(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.uep-signin')
    const card = document.querySelector('.uep-signin-card').getBoundingClientRect()
    const footer = document.querySelector('.uep-signin-footer').getBoundingClientRect()
    return {
      document: [document.scrollingElement.scrollWidth - innerWidth, document.scrollingElement.scrollHeight - innerHeight],
      page: root.scrollHeight - root.clientHeight,
      cardAboveFooter: card.bottom <= footer.top + 1,
    }
  })
}

for (const [width, height] of [[1440, 900], [1366, 768]]) {
  test(`every step fits ${width}x${height} with no page scroll`, async ({ page }) => {
    const api = await mockApi(page, { notice: 'UEP is offline on Friday 28 November, 22:00 to 23:00 for an update.' })
    await page.setViewportSize({ width, height })
    const fits = async (step) => expect(await noPageScroll(page), step).toEqual({ document: [0, 0], page: 0, cardAboveFooter: true })

    await page.goto('/login?motion=reduce&reason=expired')
    await expect(page.locator('.uep-signin-title .sr-only')).toHaveText('USO Enterprise Platform')
    await expect(page.getByText('UEP is offline on Friday')).toBeVisible()
    await fits('username')

    await username(page).fill('name.surname')
    await continueButton(page).click()
    await fits('password')

    for (let i = 0; i < 5; i += 1) {
      await password(page).fill('wrong')
      await signInButton(page).click()
      await expect(page.locator('#login-password-error')).toHaveText(/incorrect/)
    }
    await password(page).fill('wrong')
    await signInButton(page).click()
    await expect(page.getByText('Too many attempts', { exact: true })).toBeVisible()
    await fits('lockout')

    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('heading', { name: 'Ask your UEP administrator' })).toBeVisible()
    await fits('help')
    expect(api.calls.filter((c) => c.endsWith('/auth/login'))).toHaveLength(6)
  })

  test(`change password fits ${width}x${height} with no page scroll`, async ({ page }) => {
    await mockApi(page, { me: FORCED })
    await signedInAs(page, FORCED)
    await page.setViewportSize({ width, height })
    await page.goto('/change-password?motion=reduce')
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.getByLabel('Password you were given').fill('Temp-Pass-1234')
    await page.getByLabel('New password', { exact: true }).fill('a-long-passphrase')
    // A mismatch, so the tallest state (checklist and an error) is measured
    // and the page stays put.
    await page.getByLabel('Repeat new password').fill('a-different-one')
    await page.getByRole('button', { name: 'Save and continue' }).click()
    await expect(page.getByRole('alert')).toHaveText(/do not match/)
    expect(await noPageScroll(page)).toEqual({ document: [0, 0], page: 0, cardAboveFooter: true })
  })
}

test('Continue never calls the server; the same screen appears for any username', async ({ page }) => {
  const api = await mockApi(page)
  await page.goto('/login')
  await username(page).fill('nobody.here')
  await continueButton(page).click()
  await expect(password(page)).toBeFocused()
  await expect(page.locator('.uep-signin-account')).toContainText('nobody.here')
  expect(api.calls.filter((c) => !c.endsWith('/auth/signin-settings'))).toEqual([])
})

test('a PM signs in: username, password, then lands on Home', async ({ page }) => {
  await mockApi(page)
  await page.goto('/login')
  await username(page).fill('sara')
  await continueButton(page).click()
  await password(page).fill('right')
  await signInButton(page).click()
  await expect(page).toHaveURL(/\/home$/)
})

test('a sign-in sent from a page still lands on the landing page', async ({ page }) => {
  await mockApi(page)
  await page.goto('/my-work?village=12')
  await expect(page).toHaveURL(/\/login\?next=/)
  await username(page).fill('sara')
  await continueButton(page).click()
  await password(page).fill('right')
  await signInButton(page).click()
  await expect(page).toHaveURL(/\/home$/)
})

test('five wrong passwords show the lockout box with an m:ss countdown, in no red', async ({ page }) => {
  await mockApi(page)
  await page.goto('/login?motion=reduce')
  await username(page).fill('sara')
  await continueButton(page).click()
  for (let i = 0; i < 6; i += 1) {
    await password(page).fill('wrong')
    await signInButton(page).click()
  }
  const box = page.locator('.uep-signin-lock')
  await expect(box).toContainText(/Try again in 1:(30|29)/)
  await expect(signInButton(page)).toHaveText(/Try again in 1:\d\d/)
  await expect(password(page)).toBeDisabled()
  const colours = await box.evaluate((el) => [el, ...el.querySelectorAll('*')].map((n) => getComputedStyle(n).color))
  expect(colours.some((c) => c === 'rgb(180, 35, 24)')).toBe(false)
})

test('a remembered username opens on the password step; "Not you?" goes back', async ({ page }) => {
  await mockApi(page)
  await page.addInitScript(() => localStorage.setItem('uep_remembered_username', 'name.surname'))
  await page.goto('/login')
  await expect(password(page)).toBeFocused()
  await page.getByRole('button', { name: /Not you\?/ }).click()
  await expect(username(page)).toBeFocused()
  await expect(username(page)).toHaveValue('name.surname')
})

test('an Admin changes the support phone, and it appears under Need access', async ({ page }) => {
  await mockApi(page, { me: ADMIN })
  await signedInAs(page, ADMIN)
  await page.goto('/admin/sign-in-page')
  const phone = page.getByLabel('Phone or extension')
  await phone.fill('Extension 7788')
  await expect(page.getByRole('region', { name: 'Preview' })).toContainText('Extension 7788')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Saved. The sign-in page shows the new details now.')).toBeVisible()

  await page.evaluate(() => {
    sessionStorage.setItem('signed_out', '1')
    localStorage.removeItem('uep_user')
  })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Ask your UEP administrator' }).click()
  await expect(page.locator('.uep-signin-contact')).toContainText('Extension 7788')
})

test('Admin › Sign-in page fits 1366x768 with no page scroll', async ({ page }) => {
  await mockApi(page, { me: ADMIN })
  await signedInAs(page, ADMIN)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/admin/sign-in-page?motion=reduce')
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
  const overflow = await page.evaluate(() => {
    const outlet = document.querySelector('.page-outlet')
    return [document.scrollingElement.scrollHeight - innerHeight, outlet.scrollHeight - outlet.clientHeight]
  })
  expect(overflow).toEqual([0, 0])
  // The shell's header band is whole, not clipped.
  const title = await page.getByRole('heading', { level: 1, name: 'Sign-in page' }).boundingBox()
  expect(title.y).toBeGreaterThanOrEqual(56)
})

test('old links: forgot-password and request-access open help; legal pages go to sign in', async ({ page }) => {
  await mockApi(page)
  for (const path of ['/forgot-password', '/request-access']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Ask your UEP administrator' })).toBeVisible()
  }
  for (const path of ['/privacy', '/terms', '/help']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
  }
  await expect(page.locator('a[href="/privacy"], a[href="/terms"], a[href="/help"]')).toHaveCount(0)
})

test('reduced motion: the waves are hidden and nothing animates', async ({ page }) => {
  await mockApi(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/login')
  await expect(page.locator('html')).toHaveAttribute('data-uep-motion', 'reduce')
  await expect(page.locator('.uep-signin-waves')).toBeHidden()
  const running = await page.evaluate(() => document.getAnimations().length)
  expect(running).toBe(0)
})

test('reflows at 320px without scrolling sideways', async ({ page }) => {
  await mockApi(page)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/login')
  const overflow = await page.evaluate(() => document.querySelector('.uep-signin').scrollWidth - innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('axe finds no serious or critical violations on any step', async ({ page }) => {
  await mockApi(page, { notice: 'Planned update on Friday.' })
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/login?motion=reduce&reason=expired')
    await continueButton(page).click()
    const steps = [
      async () => {},
      async () => { await username(page).fill('sara'); await continueButton(page).click() },
      async () => { await page.getByRole('button', { name: 'Forgot password?' }).click() },
    ]
    for (const [i, step] of steps.entries()) {
      await step()
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
      expect(serious, `@${width} step ${i}`).toEqual([])
    }
  }
})
