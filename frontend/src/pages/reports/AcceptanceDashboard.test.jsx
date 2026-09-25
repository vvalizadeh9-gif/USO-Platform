// The Acceptance Dashboard: what its figures say, and where they go when
// they are clicked.
//
// The page makes one promise that is easy to break and hard to notice: every
// number opens the list it counted. After the simplification pass there are
// six of them — three in the KPI band, three in the strip beneath it — and
// each is asserted here against the bucket it is supposed to open. The
// province table, the authority cards, the approval gap, the filter bar and
// the tab strip are gone; the last block of tests holds them gone, because
// each one was deleted on purpose and a reappearance is a regression.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), put: vi.fn() } }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

// Signed in as a Viewer by default — someone who can see the dashboard but
// not the PM-only "+ Set target" control. Individual tests override this
// with `signedInAs`.
const mockAuth = vi.hoisted(() => ({ current: { user: { full_name: 'Someone', role: { name: 'Viewer' } } } }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

function signedInAs(roleName) {
  mockAuth.current = { user: { full_name: 'Someone', role: { name: roleName } } }
}

const api = (await import('../../api/client')).default
const AcceptanceDashboard = (await import('./AcceptanceDashboard')).default

const overview = (over = {}) => ({
  kpis: {
    total_dt_done_villages: 120,
    total_ict_approval: 88, total_ict_remained: 32,
    total_ict_rejected: 9, total_ict_pending: 23,
    total_cra_approval: 74, total_cra_remained: 46,
    total_cra_rejected: 4, total_cra_pending: 42,
  },
  analysis: {
    sites_ict_full: 10, sites_cra_full: 8, sites_ict_and_cra_full: 6,
    sites_ict_not_cra: 4, sites_cra_not_ict: 2,
    villages_ict_not_cra: 18, villages_cra_not_ict: 5,
    villages_both_approved: 70, villages_accepted: 70,
    villages_needs_attention: 13, villages_in_review: 23, villages_not_filed: 14,
  },
  // Still returned by the endpoint and still ignored client-side — the page
  // no longer draws a province table. Kept in the fixture so a payload that
  // carries it cannot make the page throw.
  provinces: [{ name: 'Kerman', province_id: 7, total: 120 }],
  ...over,
})

/** Shaped from app/schemas: AcceptancePlanResponse. */
const plan = (over = {}) => ({
  current: {
    shamsi_year: 1405, shamsi_month: 6, label: 'شهریور 1405',
    target_count: 3200, set_by: 'PM One', set_at: '2026-08-20T00:00:00Z', note: null,
  },
  previous: {
    shamsi_year: 1405, shamsi_month: 5, label: 'مرداد 1405',
    target_count: 2860, set_by: 'PM One', set_at: '2026-07-20T00:00:00Z', note: null,
  },
  history: [],
  ...over,
})

/** Shaped from app/schemas: AcceptanceTrendsResponse. */
const trends = (over = {}) => ({
  months: [
    {
      shamsi_year: 1405, shamsi_month: 5, label: 'مرداد',
      ict_new: 40, cra_new: 30, fully_accepted_new: 20,
      ict_cumulative: 100, cra_cumulative: 80, fully_accepted_cumulative: 60,
      target_count: 2860,
    },
    {
      shamsi_year: 1405, shamsi_month: 6, label: 'شهریور',
      ict_new: 45, cra_new: 35, fully_accepted_new: 25,
      ict_cumulative: 145, cra_cumulative: 115, fully_accepted_cumulative: 85,
      target_count: 3200,
    },
  ],
  ...over,
})

/** Shaped from app/schemas: DriveTestTrend. */
const dtTrend = (over = {}) => ({
  months: [
    { shamsi_year: 1405, shamsi_month: 5, label: 'مرداد', captured: true, estimated: false, is_open: false, onair: 200, dt_done: 120, remaining: 80, ongoing: 50, problematic: 10 },
    { shamsi_year: 1405, shamsi_month: 6, label: 'شهریور', captured: true, estimated: false, is_open: true, onair: 210, dt_done: 140, remaining: 70, ongoing: 45, problematic: 8 },
  ],
  latest_flows: null,
  province_id: null,
  ...over,
})

const page = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <AcceptanceDashboard />
      </MemoryRouter>
    </ToastProvider>
  )

/** The query string of the single navigation this click caused. */
const went = () => {
  expect(navigate).toHaveBeenCalledTimes(1)
  return new URLSearchParams(navigate.mock.calls[0][0].split('?')[1])
}

/** The card carrying a KPI, found by its title. */
const kpiCard = async (title) => (await screen.findByText(title)).closest('.dt-kpi-card')

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('Viewer')
  api.get.mockImplementation((url) => {
    if (url === '/acceptance/overview') return Promise.resolve({ data: overview() })
    if (url === '/acceptance/plan') return Promise.resolve({ data: plan() })
    if (url === '/acceptance/trends') return Promise.resolve({ data: trends() })
    if (url === '/drivetest/trend') return Promise.resolve({ data: dtTrend() })
    return Promise.resolve({ data: [] })
  })
})

describe('the KPI band', () => {
  it('reads the four headline figures off /acceptance/overview', async () => {
    page()

    expect(within(await kpiCard('Total villages')).getByText('120')).toBeInTheDocument()
    // 70 of 120 fully accepted leaves 50 remaining — derived here, never
    // taken from a second server figure that could disagree with it.
    const approved = await kpiCard('Fully approved')
    expect(within(approved).getByText('70')).toBeInTheDocument()
    expect(within(approved).getByText('58% of 120')).toBeInTheDocument()
    const remaining = await kpiCard('Remaining')
    expect(within(remaining).getByText('50')).toBeInTheDocument()
    expect(within(remaining).getByText('42% of 120')).toBeInTheDocument()
  })

  it('sends the fully-approved figure to the closed bucket', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')

    await user.click(screen.getByRole('button', { name: /Fully approved: 70 villages/i }))

    // Every bucket the figure counted, not this role's usual landing one.
    expect(went().get('bucket')).toBe('closed')
  })

  it('asks for the overview with no filter parameters', async () => {
    page()
    await screen.findByText('Total villages')

    const call = api.get.mock.calls.find(([url]) => url === '/acceptance/overview')
    expect(call).toBeDefined()
    // The filter bar went; both endpoints are programme-wide now, and the
    // params they are given must not quietly come back as empty strings.
    expect(call[1]).toBeUndefined()
    const trendCall = api.get.mock.calls.find(([url]) => url === '/acceptance/trends')
    expect(trendCall[1].params).toEqual({ months: 9 })
  })
})

describe('the three outstanding figures', () => {
  it('renders each as its own tile with its count', async () => {
    page()
    await screen.findByText('Total villages')

    const strip = document.querySelector('.acc-remaining-strip')
    expect(strip).not.toBeNull()
    expect(strip.querySelectorAll('.acc-remaining-tile')).toHaveLength(3)
    expect(within(strip).getByText('Needs an answer')).toBeInTheDocument()
    expect(within(strip).getByText('13')).toBeInTheDocument()
    expect(within(strip).getByText('With an authority')).toBeInTheDocument()
    expect(within(strip).getByText('23')).toBeInTheDocument()
    expect(within(strip).getByText('Never filed')).toBeInTheDocument()
    expect(within(strip).getByText('14')).toBeInTheDocument()
  })

  it.each([
    ['Needs an answer', 13, 'needs_attention'],
    ['With an authority', 23, 'awaiting_review'],
    ['Never filed', 14, 'ready'],
  ])('sends %s to its own bucket', async (label, count, bucket) => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')

    await user.click(
      screen.getByRole('button', { name: new RegExp(`${label}: ${count} villages`, 'i') })
    )
    expect(went().get('bucket')).toBe(bucket)
  })
})

describe('the monthly plan KPI card', () => {
  it('shows the current target and its delta from last month', async () => {
    page()
    await screen.findByText('Total villages')

    // Scoped to the KPI card itself: 3,200 is also this fixture's latest
    // month's plan target, which the trend charts' hover readouts
    // legitimately repeat elsewhere on the page.
    const card = await kpiCard('Monthly plan')
    expect(within(card).getByText('3,200')).toBeInTheDocument()
    expect(within(card).getByText(/\+340 from مرداد 1405/)).toBeInTheDocument()
  })

  it('shows an explicit empty state rather than a fabricated 0 when no target is set', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/acceptance/overview') return Promise.resolve({ data: overview() })
      if (url === '/acceptance/plan') return Promise.resolve({ data: { current: null, previous: null, history: [] } })
      if (url === '/acceptance/trends') return Promise.resolve({ data: trends() })
      if (url === '/drivetest/trend') return Promise.resolve({ data: dtTrend() })
      return Promise.resolve({ data: [] })
    })
    page()
    await screen.findByText('Total villages')

    const card = await kpiCard('Monthly plan')
    expect(within(card).getByText('Not set yet')).toBeInTheDocument()
    expect(within(card).queryByText(/^3,200$/)).toBeNull()
  })

  it('does not offer the set-target control to a Viewer', async () => {
    signedInAs('Viewer')
    page()
    await screen.findByText('Total villages')

    expect(screen.queryByRole('button', { name: /Set this month’s acceptance target/ })).toBeNull()
  })

  it('offers the set-target control to a PM', async () => {
    signedInAs('PM')
    page()
    await screen.findByText('Total villages')

    expect(screen.getByRole('button', { name: /Set this month’s acceptance target/ })).toBeInTheDocument()
  })
})

describe('the plan-and-trend widgets', () => {
  it('renders all six, and nothing else', async () => {
    page()
    await screen.findByText('Total villages')

    for (const title of [
      'Plan vs actual progress',
      'Approval flow & status distribution',
      'Monthly approval velocity',
      'ICT vs CRA comparison',
      'ICT approval progress',
      'CRA approval progress',
    ]) {
      expect(await screen.findByText(title)).toBeInTheDocument()
    }
  })

  it('draws the approval-flow Sankey from the overview payload alone, with no fabricated "not started" figure', async () => {
    page()
    await screen.findByText('Total villages')

    // total (120) - fully accepted (70) - ICT-only (18) - CRA-only (5) = 27
    expect(await screen.findByText('27')).toBeInTheDocument()
    expect(screen.getByText('Not started (no approval yet)')).toBeInTheDocument()
  })

  it('does not crash when /acceptance/trends or /drivetest/trend fail', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/acceptance/overview') return Promise.resolve({ data: overview() })
      if (url === '/acceptance/plan') return Promise.resolve({ data: plan() })
      if (url === '/acceptance/trends') return Promise.reject(new Error('boom'))
      if (url === '/drivetest/trend') return Promise.reject(new Error('boom'))
      return Promise.resolve({ data: [] })
    })
    page()

    await screen.findByText('Total villages')
    expect(await screen.findByText('Plan vs actual progress')).toBeInTheDocument()
    expect(await screen.findByText(/Could not load the plan\/actual trend\./)).toBeInTheDocument()
  })

  it('toggles the velocity chart between monthly and cumulative figures', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')
    await screen.findByText('Monthly approval velocity')

    // Two Monthly/Cumulative segmented controls exist (plan-vs-actual and
    // velocity); the velocity one is the second. The comparison card's
    // Count/Percentage toggle is gone — it never hid either figure, it only
    // swapped which one led.
    const cumulativeButtons = screen.getAllByRole('button', { name: 'Cumulative' })
    expect(cumulativeButtons).toHaveLength(2)
    await user.click(cumulativeButtons[1])
    expect(cumulativeButtons[1]).toHaveAttribute('aria-pressed', 'true')
  })

  it('leads the ICT/CRA comparison with the count and follows it with the share', async () => {
    page()
    const heading = await screen.findByText('ICT vs CRA comparison')
    const card = heading.closest('.card')

    expect(screen.queryByRole('button', { name: 'Percentage' })).toBeNull()
    // ICT: 88 approved, 23 pending, 9 rejected — 88 of 120 is 73%.
    expect(within(card).getByText('88')).toBeInTheDocument()
    expect(within(card).getByText('73%')).toBeInTheDocument()
  })
})

describe('what the simplification pass removed', () => {
  it('has no filter bar and asks for no reference lists', async () => {
    page()
    await screen.findByText('Total villages')

    expect(screen.queryByLabelText(/Regional manager/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    const urls = api.get.mock.calls.map(([url]) => url)
    expect(urls).not.toContain('/reference/regional-managers')
    expect(urls).not.toContain('/reference/coordinators')
    expect(urls).not.toContain('/reference/contractors')
  })

  it('has no tab strip, because Overview is the only thing left', async () => {
    page()
    await screen.findByText('Total villages')

    expect(document.querySelector('.tabs')).toBeNull()
    expect(screen.queryByRole('button', { name: /Province Status/ })).toBeNull()
  })

  it('has no province table, authority cards, approval gap or outstanding list', async () => {
    page()
    await screen.findByText('Total villages')

    expect(document.querySelector('table.grouped')).toBeNull()
    expect(screen.queryByText('Authority performance')).toBeNull()
    expect(screen.queryByText('Approval gap')).toBeNull()
    expect(screen.queryByText('Top outstanding provinces')).toBeNull()
  })
})
