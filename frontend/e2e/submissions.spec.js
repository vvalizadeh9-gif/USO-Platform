// Acceptance › Submissions (UEP-21): the owner's two-week routine, the
// follow-up actions, the coordinator's read-only view, and the one-screen
// contract at both office resolutions.
import { expect, test } from '@playwright/test'
import { signIn } from './mockApi.js'
import { PM } from './fixtures.js'
import { COORDINATOR, VIEWER, mockSubmissions } from './submissionsFixtures.js'

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
]

const PAGES = [
  { name: 'Ready', path: '/submissions', ready: 'Ready to submit' },
  { name: 'Batches', path: '/submissions?view=batches', ready: 'All batches' },
  { name: 'Follow up', path: '/submissions?view=follow-up', ready: 'Sent, not in Mojri after 30 days' },
  { name: 'Batch sent', path: '/submissions/batches/40', ready: 'Batch #40' },
  { name: 'Batch draft', path: '/submissions/batches/41', ready: 'Batch #41' },
]

async function expectNoPageScroll(page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  const m = await page.evaluate(() => {
    const el = document.scrollingElement
    return { sh: el.scrollHeight, sw: el.scrollWidth, ih: window.innerHeight, iw: window.innerWidth }
  })
  expect(m.sh).toBeLessThanOrEqual(m.ih)
  expect(m.sw).toBeLessThanOrEqual(m.iw)
  const body = await page.locator('.page-body').evaluate((el) => [el.scrollHeight, el.clientHeight])
  expect(body[0]).toBeLessThanOrEqual(body[1])
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })
    for (const p of PAGES) {
      test(`${p.name} does not scroll the page`, async ({ page }) => {
        await signIn(page, PM)
        await mockSubmissions(page, { role: 'pm' })
        await page.goto(p.path)
        await expect(page.getByRole('heading', { name: p.ready }).first()).toBeVisible()
        await expectNoPageScroll(page)
        if (process.env.SCREENSHOTS) {
          await page.screenshot({ path: `${process.env.SCREENSHOTS}/submissions-${p.name.replace(/\W+/g, '-')}-${viewport.width}.png` })
        }
      })
    }
    test('Coordinator view does not scroll the page', async ({ page }) => {
      await signIn(page, COORDINATOR)
      await mockSubmissions(page, { role: 'coordinator' })
      await page.goto('/submissions')
      await expect(page.getByRole('heading', { name: 'Your villages' })).toBeVisible()
      await expectNoPageScroll(page)
    })
  })
}

test('owner: filter by reason, create a draft, then mark it sent', async ({ page }) => {
  const calls = []
  await signIn(page, PM)
  await mockSubmissions(page, { role: 'owner', calls })
  await page.goto('/submissions')
  await expect(page.getByRole('link', { name: /Ready to submit/ })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: /New DT site/ }).click()
  await expect(page.getByRole('button', { name: /New DT site/ })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => calls.some((c) => c.startsWith('GET /ready'))).toBe(true)
  await page.getByRole('button', { name: /Create draft batch #41/ }).click()
  await expect(page).toHaveURL(/\/submissions\/batches\/41$/)
  await expect(page.getByRole('button', { name: 'Mark as sent' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /MTN_Irancell_Drive_Test_41\.xlsx/ })).toBeVisible()
  expect(calls).toContain('POST /batches')
})

test('sent batch: three equal letter cards, optional ones offer Add letter', async ({ page }) => {
  await signIn(page, PM)
  await mockSubmissions(page, { role: 'pm' })
  await page.goto('/submissions/batches/40')
  const cards = page.locator('.sb-letter')
  await expect(cards).toHaveCount(3)
  const boxes = await cards.evaluateAll((els) => els.map((e) => [Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]))
  expect(new Set(boxes.map((b) => b.join('x'))).size).toBe(1)
  await expect(page.getByRole('button', { name: 'Add letter' })).toHaveCount(1)
  await expect(page.locator('.sb-letter').filter({ hasText: 'MTN → ICT HQ' }).getByText('Recorded', { exact: true })).toBeVisible()
})

test('follow up: mark raised, then send again', async ({ page }) => {
  const calls = []
  await signIn(page, PM)
  await mockSubmissions(page, { role: 'owner', calls })
  await page.goto('/submissions?view=follow-up')
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Mark raised with ICT' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Mark raised' }).click()
  await expect.poll(() => calls).toContain('POST /follow-up/raise')
  await page.getByRole('checkbox', { name: 'Select all' }).check()
  await page.getByRole('button', { name: 'Send again' }).click()
  await expect.poll(() => calls).toContain('POST /follow-up/resend')
})

test('coordinator: own regions, view only, no buttons', async ({ page }) => {
  await signIn(page, COORDINATOR)
  await mockSubmissions(page, { role: 'coordinator' })
  await page.goto('/submissions')
  await expect(page.getByText('View only')).toBeVisible()
  await expect(page.getByText('South · South East')).toBeVisible()
  await expect(page.locator('main').getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})

test('viewer: the owner layout, read-only', async ({ page }) => {
  await signIn(page, VIEWER)
  await mockSubmissions(page, { role: 'viewer' })
  await page.goto('/submissions')
  await expect(page.getByRole('heading', { name: 'Ready to submit' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Create draft/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Change owner' })).toHaveCount(0)
})

test('PM: Change owner lists every coordinator with their regions, nothing clipped', async ({ page }) => {
  const calls = []
  await signIn(page, PM)
  await mockSubmissions(page, { role: 'pm', calls })
  await page.goto('/submissions')
  await page.getByRole('button', { name: 'Change owner' }).click()
  const dialog = page.getByRole('dialog', { name: 'Change owner' })
  const options = dialog.getByRole('radio')
  await expect(options).toHaveCount(3)
  for (const name of ['Amir Rahimi', 'Zohreh Abouzari', 'Hossein Zanganeh']) {
    await expect(dialog.getByText(name)).toBeInViewport()
  }
  await expect(dialog.getByText('Current owner')).toBeVisible()
  await expect(dialog.getByText('North East · South · South West')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Make owner' })).toBeDisabled()
  await dialog.getByText('Zohreh Abouzari').click()
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/submissions-change-owner.png` })
  await dialog.getByRole('button', { name: 'Make owner' }).click()
  await expect.poll(() => calls).toContain('PUT /owner')
})

test('the Submissions rail item sits in the Drive test app', async ({ page }) => {
  await signIn(page, PM)
  await mockSubmissions(page, { role: 'pm' })
  await page.goto('/submissions')
  const rail = page.getByRole('complementary', { name: 'Drive test pages' })
  await expect(rail.getByRole('link', { name: /Submissions/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Drive test')
})
