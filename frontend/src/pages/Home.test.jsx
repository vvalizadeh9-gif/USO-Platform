// UEP Home's role variants (UEP role access §5): the region landing for a
// Regional Manager, the work landing for the five problem-category owners,
// and the standard Home, unchanged, for everyone else.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))

const auth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.current }))

const home = vi.hoisted(() => ({ current: null }))
vi.mock('../shell/HomeData', () => ({ useHomeData: () => home.current }))

const api = (await import('../api/client')).default
const Home = (await import('./Home')).default

const ZERO = { pending: 0, overdue: 0, due_soon: 0, done_today: 0 }
const homeData = (groups = []) => ({
  groups,
  totals: ZERO,
  trends: { pending: [], overdue: [], due_soon: [], done: [] },
  sla_uniform_days: null,
})

const AREA = {
  scope: { lens: 'rm', key: 'Allahyar', label: 'Allahyar', chip: '3 provinces · 1 CRA regions', selectable: false, past: false, provinces: 3, cra_regions: 1 },
  as_of: '2026-11-01T08:00:00Z',
  read_only: false,
  totals: {
    villages: 1200,
    onair: { count: 1000, rate: 83.3 },
    dt: { count: 800, rate: 66.7 },
    full: { count: 300, rate: 37.5 },
    ict: { count: 500, rate: 62.5 },
    cra: { count: 400, rate: 50 },
  },
  national: { onair: 80, dt: 60, full: 30, ict: 55, cra: 45 },
  breakdown: 'province',
  breakdowns: ['province'],
  rows: [],
  low_sample_threshold: 10,
}

function as(role, data = homeData()) {
  auth.current = { user: { first_name: 'Sara', role: { name: role } } }
  home.current = { data, error: null, counts: {}, reload: vi.fn() }
}

const draw = () => render(<MemoryRouter><Home /></MemoryRouter>)
const appNames = () => within(screen.getByRole('complementary', { name: 'Apps' }))
  .getAllByRole('link').map((link) => link.querySelector('.ha-app-name').textContent)

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => (url === '/kpi/area'
    ? Promise.resolve({ data: AREA })
    : Promise.reject(new Error(`unexpected ${url}`))))
})

describe('the region landing (Regional Manager)', () => {
  it('shows the region today, each count opening Roles performance › My area on its measure', async () => {
    as('RegionalManager')
    draw()
    const card = (await screen.findByRole('heading', { name: 'Your region' })).closest('section')
    const rows = within(card).getAllByRole('link')
    expect(rows.map((r) => r.querySelector('.hw-row-label').textContent)).toEqual(['On air', 'DT done', 'ICT approved', 'CRA approved'])
    expect(rows.map((r) => r.querySelector('.hw-row-count').textContent)).toEqual(['1,000', '800', '500', '400'])
    expect(rows.map((r) => r.getAttribute('href'))).toEqual([
      '/reports/kpi/area?measure=onair', '/reports/kpi/area?measure=dt',
      '/reports/kpi/area?measure=ict', '/reports/kpi/area?measure=cra',
    ])
    expect(api.get).toHaveBeenCalledWith('/kpi/area', { params: {} })
  })

  it('says the scope in the greeting, and has no KPI strip and no work cards', async () => {
    as('RegionalManager')
    draw()
    expect(await screen.findByTestId('home-scope')).toHaveTextContent('Your provinces: 3')
    expect(screen.queryByRole('region', { name: 'Your numbers' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your work' })).not.toBeInTheDocument()
  })

  it('offers exactly Explorer, Roles performance and Lifecycle gaps', async () => {
    as('RegionalManager')
    draw()
    await screen.findByRole('heading', { name: 'Your region' })
    expect(appNames()).toEqual(['Explorer', 'Roles performance', 'Lifecycle gaps'])
  })

  it('says what went wrong when the region does not load', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'This account is not linked to a name in the province mapping.' } } })
    as('RegionalManager')
    draw()
    expect(await screen.findByRole('alert')).toHaveTextContent('not linked to a name')
  })
})

describe('the work landing (problem-category owners)', () => {
  it.each(['NwgPlanning', 'ManagedService', 'HuaweiCleanup', 'CpgPower', 'CpgRolloutPM'])(
    'gives %s the KPI strip at zero, one quiet line, and no Insights',
    (role) => {
      as(role)
      draw()
      expect(screen.getByRole('region', { name: 'Your numbers' })).toBeInTheDocument()
      expect(screen.getByTestId('work-empty')).toHaveTextContent('Nothing is waiting on you.')
      expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Insights' })).not.toBeInTheDocument()
      expect(appNames()).toEqual(['Explorer', 'Drive test'])
    },
  )

  it('shows only the cards with something in them', () => {
    as('CpgPower', homeData([
      { key: 'drive_test', label: 'Drive test', tickets: [{ queue_key: 'hc_fixes', short_label: 'Fixes', count: 3, url: '/my-fix-queue' }] },
      { key: 'acceptance', label: 'Acceptance', tickets: [{ queue_key: 'x', short_label: 'X', count: 0, url: '/' }] },
    ]))
    draw()
    expect(screen.getByRole('heading', { name: 'Drive test' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Acceptance' })).not.toBeInTheDocument()
  })
})

describe('the standard Home', () => {
  it.each(['PM', 'Coordinator', 'Contractor'])('keeps %s on the caught-up card, with Insights', (role) => {
    as(role)
    draw()
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
    expect(screen.queryByTestId('work-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-scope')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Insights' })).toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })
})
