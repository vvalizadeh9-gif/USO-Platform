// Roles Performance: what each role is offered, and the promises that fail
// quietly -- a Viewer offered an action, a sign flipped by bidi next to a
// Persian name, a view switch that does not switch, an animation that hides
// the number from someone who asked for less motion.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../CoverageMap', () => ({ default: () => <div>coverage map</div> }))

const authUser = vi.hoisted(() => ({ current: { role: { name: 'PM' }, full_name: 'Pat PM' } }))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current }),
}))

const api = (await import('../../../api/client')).default
const RolesPerformance = (await import('./RolesPerformance')).default

const month = (m, label) => ({ year: 1405, month: m, label_fa: label })
const compared = (now, ref, over = {}) => ({
  now, ref, delta: now - ref, lower_is_better: false, recorded: true, ref_recorded: true, ...over,
})

const monthPayload = (by = 'all') => ({
  month: month(7, 'مهر ۱۴۰۵'),
  ref_month: month(6, 'شهریور ۱۴۰۵'),
  running: true,
  day: 10,
  days_in_month: 30,
  ref_day: 10,
  by,
  recorded_from: month(7, 'مهر ۱۴۰۵'),
  undated_on_air: 0,
  last_cpm_import: null,
  sections: [
    {
      key: 'delivery', title: 'Project delivery', block: { value: 5, unit: 'sites' },
      rows: [{
        key: 'dt_done', label: 'DT done', unit: 'sites', ...compared(12, 10),
        villages: compared(40, 30),
        owners: by === 'all' ? null : [
          { name: 'حسین', ...compared(8, 9) },
          { name: 'Amir', ...compared(4, 1) },
        ],
      }],
    },
    {
      key: 'acceptance', title: 'Acceptance', block: { value: 10, unit: 'villages' },
      rows: [{
        key: 'ict_approved', label: 'ICT approved', unit: 'villages',
        ...compared(3, 0, { ref: null, delta: null, ref_recorded: false }),
        villages: null, owners: by === 'all' ? null : [],
      }],
    },
  ],
})

const areaPayload = (over = {}) => ({
  scope: { lens: 'country', key: 'Whole country', label: 'Whole country', chip: '31 provinces',
    selectable: true, past: false, provinces: 0, cra_regions: 0 },
  as_of: '2026-10-01T08:00:00Z',
  read_only: false,
  cards: [
    { key: 'on_air', label: 'On air', count: 30, rate: 75, base: 40, base_label: 'villages', national_rate: 70 },
  ],
  breakdown: 'region',
  breakdowns: ['province', 'region', 'contractor'],
  rows: [],
  open_work: [{ key: 'not_on_air', label: 'Not on air', count: 10 }],
  low_sample_threshold: 10,
  ...over,
})

function respond(routes) {
  api.get.mockImplementation((path, config) => {
    const handler = routes[path]
    if (!handler) return Promise.resolve({ data: { options: {}, past: {}, labels: {} } })
    return Promise.resolve({ data: typeof handler === 'function' ? handler(config?.params ?? {}) : handler })
  })
}

function renderAt(path, role, name = 'Pat Person') {
  authUser.current = { role: { name: role }, full_name: name }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/kpi" element={<RolesPerformance />} />
        <Route path="/reports/kpi/:tab" element={<RolesPerformance />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const tabNames = () =>
  within(screen.getByRole('navigation', { name: 'Roles Performance views' }))
    .getAllByRole('link').map((a) => a.textContent)

beforeEach(() => {
  api.get.mockReset()
  respond({ '/kpi/month': (p) => monthPayload(p.by), '/kpi/area': areaPayload() })
})

describe('tabs and landing per role', () => {
  it.each([
    ['PM', ['Month', 'Area', 'Performance', 'Compare', 'Map'], 'Month'],
    ['Viewer', ['Month', 'Area', 'Performance', 'Compare', 'Map'], 'Month'],
  ])('%s lands on %s', async (role, tabs, landing) => {
    renderAt('/reports/kpi', role)
    await waitFor(() => expect(tabNames()).toEqual(tabs))
    expect(screen.getByRole('link', { name: landing })).toHaveAttribute('aria-current', 'page')
  })

  it.each(['RegionalManager', 'Coordinator', 'Contractor'])('%s lands on My area', async (role) => {
    renderAt('/reports/kpi', role)
    await waitFor(() => expect(tabNames()).toEqual(['My area', 'My performance', 'Map']))
    expect(screen.getByRole('link', { name: 'My area' })).toHaveAttribute('aria-current', 'page')
  })

  it('sends a confined role asking for Month to their own landing', async () => {
    renderAt('/reports/kpi/month', 'Coordinator')
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'My area' })).toHaveAttribute('aria-current', 'page'))
    expect(api.get).not.toHaveBeenCalledWith('/kpi/month', expect.anything())
  })

  it('shows a confined role their name and scope chip, not a picker', async () => {
    respond({ '/kpi/area': areaPayload({ scope: { ...areaPayload().scope, lens: 'rm', key: 'Nobakht',
      label: 'Nobakht', chip: '6 provinces · 2 CRA regions', selectable: false } }) })
    renderAt('/reports/kpi/area', 'RegionalManager', 'Reza Nobakht')
    expect(await screen.findByRole('heading', { name: 'Reza Nobakht' })).toBeInTheDocument()
    expect(await screen.findByText('6 provinces · 2 CRA regions')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Whose figures' })).toBeNull()
    expect(screen.getByText(/Roles Performance · Regional manager/)).toBeInTheDocument()
  })

  it('sends Admin home', async () => {
    renderAt('/reports/kpi', 'Admin')
    expect(await screen.findByText('home')).toBeInTheDocument()
  })
})

describe('Viewer is read-only', () => {
  it('offers no Action Center button and no mapping', async () => {
    renderAt('/reports/kpi/area', 'Viewer')
    await screen.findByText('Not on air')
    expect(screen.queryByRole('link', { name: /Action Center/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Mapping/ })).toBeNull()
    // Export is a read, and the general manager may download it.
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it('offers a regional manager no Action Center button either (they have none)', async () => {
    renderAt('/reports/kpi/area', 'RegionalManager')
    await screen.findByText('Not on air')
    expect(screen.queryByRole('link', { name: /Action Center/ })).toBeNull()
  })

  it('gives a working role the Action Center button', async () => {
    renderAt('/reports/kpi/area', 'Coordinator')
    expect(await screen.findByRole('link', { name: 'Open my Action Center' })).toBeInTheDocument()
  })
})

describe('Month', () => {
  it('shows the month, the same-day subtitle and the end values at once', async () => {
    renderAt('/reports/kpi/month', 'PM')
    expect(await screen.findByText('مهر ۱۴۰۵')).toBeInTheDocument()
    // Awaited, not read at once: on a slow runner the month's name can paint
    // a render before the rest of it, and this failed CI on that race alone.
    expect(await screen.findByText(/Day 10 of 30 · compared with/)).toBeInTheDocument()
    // Reduced motion (the test setup's matchMedia): the final figure, not 0.
    const row = document.querySelector('[data-row="dt_done"]')
    expect(within(row).getByText('12')).toBeInTheDocument()
    expect(within(row).getByText('+2')).toHaveClass('rp-delta-good')
    // ICT's reference month is not recorded: no chip, never a fake 0.
    const ict = document.querySelector('[data-row="ict_approved"]')
    expect(ict.querySelector('.rp-delta')).toBeNull()
  })

  it('switches from blocks to a ranked line of owners', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month', 'PM')
    await screen.findByText('مهر ۱۴۰۵')
    expect(document.querySelector('.rp-blocks')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Coordinators' }))
    // A full parallel suite can be slow to settle; the switch itself is instant.
    await waitFor(() => expect(document.querySelector('.rp-owners')).not.toBeNull(), { timeout: 4000 })
    expect(document.querySelector('.rp-blocks')).toBeNull()
    expect(api.get).toHaveBeenLastCalledWith('/kpi/month', { params: { by: 'coordinator' } })
    expect(screen.getByText(/Highest first/)).toBeInTheDocument()
  })

  it('keeps numbers in their own LTR span, apart from RTL names', async () => {
    const user = userEvent.setup()
    renderAt('/reports/kpi/month', 'PM')
    await screen.findByText('مهر ۱۴۰۵')
    await user.click(screen.getByRole('button', { name: 'Coordinators' }))
    const name = await screen.findByText('حسین', {}, { timeout: 4000 })
    expect(name).toHaveAttribute('dir', 'auto')
    const owner = name.closest('li')
    const value = within(owner).getByText('8')
    const delta = within(owner).getByText('−1')
    for (const node of [value, delta]) {
      expect(node).toHaveAttribute('dir', 'ltr')
      expect(node.contains(name)).toBe(false)
      expect(name.contains(node)).toBe(false)
    }
  })
})

describe('Map', () => {
  it('embeds the coverage map unchanged', async () => {
    renderAt('/reports/kpi/map', 'Contractor')
    expect(await screen.findByText('coverage map')).toBeInTheDocument()
  })
})
