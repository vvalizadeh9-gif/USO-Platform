// The Acceptance Dashboard: what its figures say, and what they open.
//
// The page makes one promise that is easy to break and hard to notice: every
// quantity opens the sites behind it. There are four of them — the KPI cards —
// and each is asserted here against the metric it is supposed to ask the
// server for, because a figure wired to the wrong metric opens a list that
// looks right and is not.
//
// The band is also a funnel, read left to right: on air → DT done → approved
// → remaining. The order is asserted, because a card inserted into the middle
// of it (the monthly plan target used to be the second one) breaks the only
// argument the band makes.
//
// The province table, the authority cards, the approval gap, the filter bar,
// the tab strip and the outstanding strip are gone; the last block of tests
// holds them gone, because each one was deleted on purpose and a reappearance
// is a regression.
import { render, screen, waitFor, within } from '@testing-library/react'
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
    total_onair_villages: 300,
    total_onair_permanent: 260, total_onair_temporary: 40,
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
    // The two halves of the 50 remaining, as the server partitions them.
    villages_rejected: 18, villages_remained: 32,
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

/** Shaped from app/schemas: AcceptanceSiteList. One row per site. */
const sites = (over = {}) => ({
  metric: 'approved',
  label: 'approved villages',
  total: 70,
  site_count: 2,
  rows: [
    { site_id: 1, site_code: 'KRM-0001', province_id: 7, province: 'Kerman', villages: 40, dt_done: 40, approved: 40, rejected: 0, pending: 0 },
    { site_id: 2, site_code: 'KRM-0002', province_id: 7, province: 'Kerman', villages: 30, dt_done: 30, approved: 30, rejected: 0, pending: 0 },
  ],
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

/** The card carrying a KPI, found by its title.
 *
 * Scoped to `.dt-kpi-title` because the words on these cards are not unique
 * on the page — "Approved" is also a bar label in the ICT/CRA comparison —
 * and a helper that matched either would find whichever rendered first.
 */
const kpiCard = async (title) =>
  (await screen.findByText(title, { selector: '.dt-kpi-title' })).closest('.dt-kpi-card')

/** A card's foot row, as its two halves' text. */
const foot = (card) =>
  [...card.querySelector('.acc-kpi-foot').children].map((n) => n.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('Viewer')
  api.get.mockImplementation((url) => {
    if (url === '/acceptance/overview') return Promise.resolve({ data: overview() })
    if (url === '/acceptance/plan') return Promise.resolve({ data: plan() })
    if (url === '/acceptance/trends') return Promise.resolve({ data: trends() })
    if (url === '/drivetest/trend') return Promise.resolve({ data: dtTrend() })
    if (url === '/acceptance/sites') return Promise.resolve({ data: sites() })
    return Promise.resolve({ data: [] })
  })
})

/** The params of the single /acceptance/sites call this click caused. */
const asked = () => {
  const call = api.get.mock.calls.find(([url]) => url === '/acceptance/sites')
  expect(call).toBeDefined()
  return call[1].params
}

/** The drill panel, once its request has resolved. */
const panel = async () => {
  const node = await screen.findByTestId('acc-drill')
  await waitFor(() => expect(node.querySelector('.dt-skeleton')).toBeNull())
  return node
}

describe('the KPI band', () => {
  it('reads the four headline figures off /acceptance/overview', async () => {
    page()

    // 300 on air: 260 launched permanently, 40 temporarily.
    const onair = await kpiCard('Total on-air villages')
    expect(onair.querySelector('.dt-kpi-figure')).toHaveTextContent('300')
    expect(within(onair).getByText('هدف · راه اندازی دائم + موقت')).toBeInTheDocument()
    expect(foot(onair)).toEqual(['دائم 260', 'موقت 40'])
    // 120 of 300 on-air villages are drive-tested, 180 are not — the only
    // percentage on the page whose denominator is not the DT-done universe.
    const done = await kpiCard('Total DT done villages')
    expect(done.querySelector('.dt-kpi-figure')).toHaveTextContent('120')
    expect(within(done).getByText('Drive test complete')).toBeInTheDocument()
    expect(foot(done)).toEqual(['40% of on-air', '180 not tested'])
    // 70 of 120 fully accepted leaves 50 remaining — derived here, never
    // taken from a second server figure that could disagree with it.
    const accepted = await kpiCard('Fully accepted')
    expect(accepted.querySelector('.dt-kpi-figure')).toHaveTextContent('70')
    expect(within(accepted).getByText('ICT and CRA both approved')).toBeInTheDocument()
    expect(foot(accepted)).toEqual(['58% of DT done', '70 of 120'])
    const remaining = await kpiCard('Remaining')
    expect(remaining.querySelector('.dt-kpi-figure')).toHaveTextContent('50')
    expect(within(remaining).getByText('Missing ICT, CRA or both')).toBeInTheDocument()
    expect(foot(remaining)).toEqual(['42% of DT done', '50 of 120'])
  })

  it('splits the on-air bar into its permanent and temporary shares', async () => {
    page()

    const onair = await kpiCard('Total on-air villages')
    const segments = [...onair.querySelectorAll('.dt-kpi-split > i')].map((n) => n.style.width)
    expect(segments).toEqual(['87%', '13%'])
  })

  it('never shows a negative not-tested count', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/acceptance/overview') {
        const data = overview()
        return Promise.resolve({ data: { ...data, kpis: { ...data.kpis, total_onair_villages: 100 } } })
      }
      return Promise.resolve({ data: url === '/acceptance/plan' ? plan() : { months: [] } })
    })
    page()

    expect(foot(await kpiCard('Total DT done villages'))[1]).toBe('0 not tested')
  })

  it('is a funnel read left to right, with nothing wedged into it', async () => {
    page()
    await screen.findByText('Total on-air villages')

    const band = screen.getByLabelText('Acceptance totals')
    expect([...band.querySelectorAll('.dt-kpi-title')].map((n) => n.textContent)).toEqual([
      'Total on-air villages', 'Total DT done villages', 'Fully accepted', 'Remaining',
    ])
    // The monthly plan target used to be the second card. It is a promise,
    // not a step of the funnel.
    expect(within(band).queryByText('Monthly plan')).toBeNull()
  })

  it('builds every card the same way: dot, title, figure, context, bar, foot', async () => {
    page()
    await screen.findByText('Total on-air villages')

    for (const card of screen.getByLabelText('Acceptance totals').querySelectorAll('.dt-kpi-card')) {
      expect(card.querySelector('.dt-kpi-dot')).not.toBeNull()
      expect(card.querySelector('.dt-kpi-ic')).toBeNull()
      expect(card.querySelector('.dt-kpi-figure')).not.toBeNull()
      expect(card.querySelector('.dt-kpi-sub')).not.toBeNull()
      expect(card.querySelector('.dt-kpi-split')).not.toBeNull()
      expect(card.querySelector('.acc-kpi-foot').children).toHaveLength(2)
    }
    // The Remaining card no longer splits itself into rejected and waiting.
    expect(document.querySelector('.dt-status-list')).toBeNull()
  })

  it('explains each card in a note, in the agreed wording', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')

    await user.click(screen.getByRole('button', { name: 'About Remaining' }))
    expect(
      screen.getByText('DT-done villages still missing ICT approval, CRA approval, or both.')
    ).toBeVisible()
  })

  it('asks for the overview with no filter parameters', async () => {
    page()
    await screen.findByText('Total on-air villages')

    const call = api.get.mock.calls.find(([url]) => url === '/acceptance/overview')
    expect(call).toBeDefined()
    // The filter bar went; both endpoints are programme-wide now, and the
    // params they are given must not quietly come back as empty strings.
    expect(call[1]).toBeUndefined()
    const trendCall = api.get.mock.calls.find(([url]) => url === '/acceptance/trends')
    expect(trendCall[1].params).toEqual({ months: 9 })
  })

  it('navigates nowhere when a figure is clicked — the panel opens in place', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')

    await user.click(screen.getByRole('button', { name: /Fully accepted villages: 70 villages/i }))

    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('the sites behind a figure', () => {
  // THE ASSERTION THE PANEL EXISTS FOR. Each figure has to ask for its own
  // metric: a figure wired to the wrong one opens a list that looks right,
  // has a plausible length and answers a different question.
  it.each([
    ['On-air villages', 300, 'onair'],
    ['DT done villages', 120, 'dt_done'],
    ['Fully accepted villages', 70, 'approved'],
    ['Remaining villages', 50, 'remaining'],
  ])('opens %s with its own metric', async (label, count, metric) => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')

    expect(screen.queryByTestId('acc-drill')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: new RegExp(`${label}: ${count} villages`, 'i') })
    )

    expect(await panel()).toBeInTheDocument()
    expect(asked().metric).toBe(metric)
  })

  it('lists the site ids, with the server’s count and an export', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')

    await user.click(screen.getByRole('button', { name: /Fully accepted villages: 70 villages/i }))
    const node = await panel()

    // The count is the server's `total` — the figure that opened the panel —
    // never the number of rows that happened to fit on the page.
    expect(node.querySelector('.dt-drill-count').textContent).toBe('70')
    expect(within(node).getByText('KRM-0001')).toBeInTheDocument()
    expect(within(node).getByText('KRM-0002')).toBeInTheDocument()
    expect(within(node).getByText(/Export site list/i)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')

    await user.click(screen.getByRole('button', { name: /Fully accepted villages: 70 villages/i }))
    await panel()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByTestId('acc-drill')).not.toBeInTheDocument())
  })

  it('says what the server said when the list cannot be loaded', async () => {
    const user = userEvent.setup()
    api.get.mockImplementation((url) => {
      if (url === '/acceptance/overview') return Promise.resolve({ data: overview() })
      if (url === '/acceptance/plan') return Promise.resolve({ data: plan() })
      if (url === '/acceptance/trends') return Promise.resolve({ data: trends() })
      if (url === '/drivetest/trend') return Promise.resolve({ data: dtTrend() })
      if (url === '/acceptance/sites') {
        return Promise.reject({ response: { data: { detail: 'metric must be one of: onair' } } })
      }
      return Promise.resolve({ data: [] })
    })
    page()
    await screen.findByText('Total on-air villages')

    await user.click(screen.getByRole('button', { name: /Fully accepted villages: 70 villages/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('metric must be one of: onair')
  })
})

describe('the monthly plan target, now heading the plan section', () => {
  it('shows the current target and its delta from last month', async () => {
    page()
    await screen.findByText('Total on-air villages')

    // Scoped to the card itself: 3,200 is also this fixture's latest
    // month's plan target, which the trend charts' hover readouts
    // legitimately repeat elsewhere on the page.
    const card = await kpiCard('Monthly plan')
    // Out of the funnel, into the section whose chart it sets the line for.
    expect(card.closest('.acc-plan-row')).not.toBeNull()
    expect(card.closest('[aria-label="Acceptance totals"]')).toBeNull()
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
    await screen.findByText('Total on-air villages')

    const card = await kpiCard('Monthly plan')
    expect(within(card).getByText('Not set yet')).toBeInTheDocument()
    expect(within(card).queryByText(/^3,200$/)).toBeNull()
  })

  it('does not offer the set-target control to a Viewer', async () => {
    signedInAs('Viewer')
    page()
    await screen.findByText('Total on-air villages')

    expect(screen.queryByRole('button', { name: /Set this month’s acceptance target/ })).toBeNull()
  })

  it('offers the set-target control to a PM', async () => {
    signedInAs('PM')
    page()
    await screen.findByText('Total on-air villages')

    expect(screen.getByRole('button', { name: /Set this month’s acceptance target/ })).toBeInTheDocument()
  })
})

describe('the plan-and-trend widgets', () => {
  it('renders all six, and nothing else', async () => {
    page()
    await screen.findByText('Total on-air villages')

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
    await screen.findByText('Total on-air villages')

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

    await screen.findByText('Total on-air villages')
    expect(await screen.findByText('Plan vs actual progress')).toBeInTheDocument()
    expect(await screen.findByText(/Could not load the plan\/actual trend\./)).toBeInTheDocument()
  })

  it('toggles the velocity chart between monthly and cumulative figures', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total on-air villages')
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
    await screen.findByText('Total on-air villages')

    expect(screen.queryByLabelText(/Regional manager/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    const urls = api.get.mock.calls.map(([url]) => url)
    expect(urls).not.toContain('/reference/regional-managers')
    expect(urls).not.toContain('/reference/coordinators')
    expect(urls).not.toContain('/reference/contractors')
  })

  it('has no tab strip, because Overview is the only thing left', async () => {
    page()
    await screen.findByText('Total on-air villages')

    expect(document.querySelector('.tabs')).toBeNull()
    expect(screen.queryByRole('button', { name: /Province Status/ })).toBeNull()
  })

  it('has no province table, authority cards, approval gap or outstanding list', async () => {
    page()
    await screen.findByText('Total on-air villages')

    expect(document.querySelector('table.grouped')).toBeNull()
    expect(screen.queryByText('Authority performance')).toBeNull()
    expect(screen.queryByText('Approval gap')).toBeNull()
    expect(screen.queryByText('Top outstanding provinces')).toBeNull()
  })

  it('has no strip of outstanding tiles under the band', async () => {
    page()
    await screen.findByText('Total on-air villages')

    // It split Remaining three ways (needs an answer / with an authority /
    // never filed). My Work still holds the four queue buckets, which is
    // where that split is acted on.
    expect(document.querySelector('.acc-remaining-strip')).toBeNull()
    expect(screen.queryByText('Needs an answer')).toBeNull()
    expect(screen.queryByText('With an authority')).toBeNull()
    expect(screen.queryByText('Never filed')).toBeNull()
  })

  it('no longer explains itself in a subtitle under the title', async () => {
    page()
    await screen.findByText('Total on-air villages')

    // "ICT and CRA approval across your provinces, village by village" —
    // removed on purpose. The band says what the page counts.
    expect(screen.queryByText(/ICT and CRA approval across your provinces/i)).toBeNull()
    expect(document.querySelector('.page-head p')).toBeNull()
  })
})
