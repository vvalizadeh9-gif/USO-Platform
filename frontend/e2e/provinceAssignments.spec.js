// Admin > Province assignments (UEP-17 §7), against a small stateful fixture
// API: the PM gives Central to Zohreh, updates, sees it saved, reverts and
// finds both changes in History. Then the page fits the office screens with
// no page scroll, axe finds nothing serious, the Viewer reads only and a
// coordinator is turned away.
//
// That Zohreh's Acceptance Validation then shows Central's villages (and
// Hossein's no longer does) is covered by the backend tests against the real
// API: the fixture API does not scope by role.
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { PM } from './fixtures.js'
import { signIn } from './mockApi.js'

const VIEWER = { ...PM, id: 3, username: 'viewer', role: { name: 'Viewer' } }
const COORDINATOR = { ...PM, id: 4, username: 'coordinator', role: { name: 'Coordinator' } }

const PEOPLE = [[11, 'Hossein', 'HK'], [12, 'Amir', 'AR'], [13, 'Zohreh', 'ZM'], [14, 'Farid', 'FT']]
const P = (...names) => names.map((en) => ({ fa: en, en }))
const REGIONS = [
  ['Azar', P('Ardabil', 'East Azerbaijan', 'West Azerbaijan'), 11],
  ['Central', P('Chaharmahal & Bakhtiari', 'Isfahan', 'Markazi', 'Qom', 'Yazd'), 11],
  ['North', P('Alborz', 'Mazandaran', 'Semnan', 'Tehran'), 12],
  ['North East', P('Golestan', 'North Khorasan', 'Razavi Khorasan', 'South Khorasan'), 13],
  ['North West', P('Gilan', 'Qazvin', 'Zanjan'), 12],
  ['South', P('Bushehr', 'Fars', 'Kohgiluyeh & Boyer-Ahmad'), 13],
  ['South East', P('Hormozgan', 'Kerman', 'Sistan & Baluchestan'), 14],
  ['South West', P('Ilam', 'Khuzestan', 'Lorestan'), 13],
  ['West', P('Hamadan', 'Kermanshah', 'Kurdistan'), 11],
]
const nameOf = (id) => PEOPLE.find(([uid]) => uid === id)[1]

/** A fixture API that keeps the owners, the changes and a history. */
function server() {
  const owners = Object.fromEntries(REGIONS.map(([name, , owner]) => [name, owner]))
  const history = []
  let seq = 0

  const overview = (changeId) => {
    const regions = REGIONS.map(([name, provinces]) => ({
      name, provinces, coordinator_user_id: owners[name], coordinator_name: nameOf(owners[name]),
    }))
    const coordinators = PEOPLE.map(([user_id, name, initials], i) => {
      const mine = regions.filter((r) => r.coordinator_user_id === user_id)
      return { user_id, name, initials, colour_index: i, linked: true, regions: mine.length,
        provinces: mine.reduce((n, r) => n + r.provinces.length, 0) }
    })
    const last = history[0]
    return { regions, coordinators, total_provinces: 31, change_id: changeId,
      last_change: last ? { at: last.at, by: last.by } : { at: '2026-10-12T09:00:00Z', by: 'Vahid' } }
  }

  const apply = (pairs) => {
    const change = { change_id: `c${++seq}`, by: 'Programme', at: new Date().toISOString(), changes: [] }
    for (const [region, id] of pairs) {
      const size = REGIONS.find(([name]) => name === region)[1].length
      change.changes.push({ cra_region: region, provinces: size, old: nameOf(owners[region]), new: nameOf(id), oldId: owners[region] })
      owners[region] = id
    }
    history.unshift(change)
    return change.change_id
  }

  return {
    owners,
    async route(route) {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace('/api/v1/admin/province-assignments', '')
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (request.method() === 'GET' && path === '') return json(overview())
      if (request.method() === 'GET' && path === '/history') return json(history)
      if (request.method() === 'PUT') {
        const { changes } = request.postDataJSON()
        const id = apply(changes.map((c) => [c.cra_region, c.coordinator_user_id]))
        return json(overview(id))
      }
      if (request.method() === 'POST' && path.startsWith('/revert/')) {
        const change = history.find((h) => h.change_id === path.split('/').pop())
        const id = apply(change.changes.map((c) => [c.cra_region, c.oldId]))
        return json(overview(id))
      }
      return json({}, 404)
    },
  }
}

async function open(page, user = PM) {
  const api = server()
  await signIn(page, user)
  await page.route('**/api/v1/admin/province-assignments**', (route) => api.route(route))
  await page.goto('/admin/provinces')
  await expect(page.getByRole('heading', { level: 1, name: 'Province assignments' })).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Coordinator for Central' })).toBeVisible()
  return api
}

const row = (page, region) => page.getByRole('radiogroup', { name: `Coordinator for ${region}`, exact: true })

test('the PM gives Central to Zohreh, updates, then reverts', async ({ page }) => {
  const api = await open(page)
  const puts = []
  page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('province-assignments')) puts.push(r.postDataJSON()) })

  await row(page, 'Central').getByRole('radio', { name: 'Zohreh' }).click()
  await expect(row(page, 'Central')).toContainText('Hossein → Zohreh')
  await expect(page.getByRole('button', { name: 'Update 1' })).toBeEnabled()
  await page.getByRole('button', { name: 'Update 1' }).click()

  await expect(page.getByRole('status')).toContainText('1 region updated across UEP')
  expect(puts).toEqual([{ changes: [{ cra_region: 'Central', coordinator_user_id: 13, expected_coordinator_user_id: 11 }] }])
  expect(api.owners.Central).toBe(13)
  await expect(row(page, 'Central').getByRole('radio', { name: 'Zohreh' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('status').getByRole('button', { name: 'Revert' }).click()
  await expect(page.getByRole('status')).toContainText('Previous coordinators restored')
  expect(api.owners.Central).toBe(11)
  await expect(row(page, 'Central').getByRole('radio', { name: 'Hossein' })).toHaveAttribute('aria-checked', 'true')

  const history = page.getByRole('button', { name: 'History' })
  await history.click()
  const drawer = page.getByRole('dialog', { name: 'Assignment history' })
  await expect(drawer.getByText('Central (5 provinces): Zohreh → Hossein')).toBeVisible()
  await expect(drawer.getByText('Central (5 provinces): Hossein → Zohreh')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(history).toBeFocused()
})

test('arrow keys move the owner and the focus', async ({ page }) => {
  await open(page)
  await row(page, 'Central').getByRole('radio', { name: 'Hossein' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(row(page, 'Central').getByRole('radio', { name: 'Amir' })).toBeFocused()
  await expect(row(page, 'Central').getByRole('radio', { name: 'Amir' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(row(page, 'North').getByRole('radio', { name: 'Amir' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Update 1' })).toBeVisible()
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
  test(`one screen, no page scroll, no text under 12px at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open(page)
    await row(page, 'Central').getByRole('radio', { name: 'Zohreh' }).click()
    const scroll = await page.evaluate(() => ({
      page: document.scrollingElement.scrollHeight - window.innerHeight,
      width: document.scrollingElement.scrollWidth - window.innerWidth,
    }))
    expect(scroll.page).toBeLessThanOrEqual(0)
    expect(scroll.width).toBeLessThanOrEqual(0)
    // The header band is whole (not clipped by the page), and every region
    // is on screen without scrolling the grid.
    const header = await page.getByTestId('page-header').boundingBox()
    const update = await page.getByRole('button', { name: 'Update 1' }).boundingBox()
    expect(update.x + update.width).toBeLessThanOrEqual(viewport.width)
    expect(update.y).toBeGreaterThanOrEqual(header.y)
    const grid = await page.locator('.pa-scroll').evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(grid).toBeLessThanOrEqual(0)
    await expect(row(page, 'West')).toBeInViewport()
    const smallest = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.pa-page *')]
      .filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((el) => parseFloat(getComputedStyle(el).fontSize))))
    expect(smallest).toBeGreaterThanOrEqual(12)
    // Province tags are never truncated.
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.pa-tag')]
      .filter((t) => t.scrollWidth > t.clientWidth).map((t) => t.textContent))
    expect(clipped).toEqual([])
  })
}

test('no serious accessibility violations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await open(page)
  await row(page, 'Central').getByRole('radio', { name: 'Zohreh' }).click()
  const { violations } = await new AxeBuilder({ page })
    .include('.pa-page')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact))
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([])
})

test('the Viewer reads only', async ({ page }) => {
  await open(page, VIEWER)
  await expect(page.getByText('View only')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Update/ })).toHaveCount(0)
  await expect(page.locator('.pa-empty')).toHaveCount(0)
  await expect(page.getByText('You can view assignments. Only PM and Admin can change them.')).toBeVisible()
})

test('a coordinator is turned away and has no rail item', async ({ page }) => {
  await signIn(page, COORDINATOR)
  await page.goto('/admin/provinces')
  await expect(page).not.toHaveURL(/\/admin\/provinces/)
  await expect(page.getByRole('link', { name: 'Province assignments' })).toHaveCount(0)
})
