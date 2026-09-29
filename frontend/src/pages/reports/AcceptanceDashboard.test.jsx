// The Acceptance Dashboard: three tabs over one pair of reads, a KPI band per
// tab, a progress chart against both plans and the month panel beside it.
//
// What these tests hold up:
//
// * the tabs (Village, ICT, CRA) live in the address and never refetch;
// * each tab's band has the agreed cards, and every figure opens the list
//   it counted -- with the authority on ICT and CRA;
// * the chart's title, legend and month selection, and the panel following
//   the month in the address;
// * a contractor sees its own PIP and never the Internal PIP;
// * one card failing leaves the others standing, and Retry refetches only it;
// * every widget removed in the redesign stays removed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

function signedInAs(roleName, extra = {}) {
  mockAuth.current = { user: { full_name: 'Someone', role: { name: roleName }, ...extra } }
}

const api = (await import('../../api/client')).default
const AcceptanceDashboard = (await import('./AcceptanceDashboard')).default

// ------------------------------------------------------------------ fixtures
// Shaped from app/schemas: AcceptanceOverview and AcceptanceProgress.
const OVERVIEW = {
  kpis: {
    total_onair_villages: 5210, total_onair_permanent: 4100, total_onair_temporary: 1110,
    total_dt_done_villages: 4437,
    total_ict_approval: 3840, total_ict_remained: 597, total_ict_rejected: 404, total_ict_pending: 193,
    total_cra_approval: 3044, total_cra_remained: 1393, total_cra_rejected: 435, total_cra_pending: 958,
  },
  analysis: { villages_both_approved: 2884, villages_accepted: 2884 },
  provinces: [],
}

const row = (approved, cumulative, plans = {}) => ({
  approved, approved_cumulative: cumulative,
  internal_plan: null, internal_plan_cumulative: null,
  contractor_plan: null, contractor_plan_cumulative: null,
  ...plans,
})
const plans = (internal, internalCum, contractor, contractorCum) => ({
  internal_plan: internal, internal_plan_cumulative: internalCum,
  contractor_plan: contractor, contractor_plan_cumulative: contractorCum,
})

function progress({ internalVisible = true, plansAvailable = true } = {}) {
  const hide = (p) => (internalVisible ? p : { ...p, internal_plan: null, internal_plan_cumulative: null })
  return {
    today: { shamsi_year: 1405, shamsi_month: 7, day: 7, days_in_month: 30 },
    plans_available: plansAvailable,
    internal_visible: internalVisible,
    months: [
      {
        shamsi_year: 1405, shamsi_month: 5, label: 'مرداد', is_current: false, days_in_month: 31,
        village: row(300, 2500, hide(plans(290, 2490, 320, 2520))),
        ict: row(410, 3500), cra: row(260, 2700),
      },
      {
        shamsi_year: 1405, shamsi_month: 6, label: 'شهریور', is_current: false, days_in_month: 31,
        village: row(288, 2788, hide(plans(320, 2810, 280, 2800))),
        ict: row(222, 3722), cra: row(300, 3000),
      },
      {
        shamsi_year: 1405, shamsi_month: 7, label: 'مهر', is_current: true, days_in_month: 30,
        village: row(92, 2880, hide(plans(320, 3130, 300, 3100))),
        ict: row(118, 3840), cra: row(44, 3044),
      },
    ],
  }
}

/** Answer the page's reads. `fail` names an endpoint that rejects. */
function serve({ overview = OVERVIEW, prog = progress(), fail = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url === fail) return Promise.reject({ response: { data: { detail: 'The server is down.' } } })
    if (url === '/acceptance/overview') return Promise.resolve({ data: overview })
    if (url === '/acceptance/progress') return Promise.resolve({ data: prog })
    if (url === '/acceptance/sites') return Promise.resolve({ data: { total: 404, site_count: 0, rows: [], label: '' } })
    if (url === '/reference/contractors') return Promise.resolve({ data: [{ id: 7, name: 'پیشرو فن' }] })
    if (url === '/reference/provinces') return Promise.resolve({ data: [{ id: 3, name: 'تهران' }] })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.search}</output>
}

function show(path = '/reports/acceptance') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <AcceptanceDashboard />
        <Location />
      </ToastProvider>
    </MemoryRouter>,
  )
}

const calls = (url) => api.get.mock.calls.filter(([u]) => u === url).length
const band = () => screen.getByRole('region', { name: 'Acceptance totals' })
const card = (title) => within(band()).getByRole('region', { name: title })
const loaded = () => screen.findByRole('img', { name: /last 3 months/ })

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('PM')
})

// -------------------------------------------------------------------- tabs
describe('the tabs', () => {
  it('are Village, ICT and CRA, in that order, and open on Village', async () => {
    serve()
    show()
    await loaded()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Village', 'ICT', 'CRA'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('live in the address, and switching never refetches', async () => {
    serve()
    show()
    await loaded()
    await userEvent.click(screen.getByRole('tab', { name: 'ICT' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?tab=ict')
    expect(await screen.findByRole('heading', { name: 'ICT approvals against plan' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'CRA' }))
    expect(screen.getByRole('heading', { name: 'CRA approvals against plan' })).toBeInTheDocument()
    expect(calls('/acceptance/overview')).toBe(1)
    expect(calls('/acceptance/progress')).toBe(1)
  })

  it('open on the tab the address names', async () => {
    serve()
    show('/reports/acceptance?tab=cra')
    expect(await screen.findByRole('heading', { name: 'CRA approvals against plan' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CRA' })).toHaveAttribute('aria-selected', 'true')
  })

  it('set the stream colour once, on the page', async () => {
    serve()
    const { container } = show('/reports/acceptance?tab=ict')
    await loaded()
    expect(container.querySelector('.acc-page')).toHaveClass('acc-stream-ict')
  })
})

// --------------------------------------------------------------------- band
describe('the KPI band', () => {
  it('is on air, drive test done, fully accepted and remaining on Village, with no breakdown', async () => {
    serve()
    show()
    await loaded()
    await waitFor(() => expect(within(band()).getAllByRole('region')).toHaveLength(4))
    expect(within(card('Villages on air')).getByText('5,210')).toBeInTheDocument()
    expect(within(card('Drive test done')).getByText('85.2% of on air')).toBeInTheDocument()
    expect(within(card('Fully accepted')).getByText('2,884')).toBeInTheDocument()
    expect(within(card('Fully accepted')).getByText('65.0% of DT done')).toBeInTheDocument()
    expect(within(card('Remaining')).getByText('1,553')).toBeInTheDocument()
    expect(screen.queryByText('Rejected')).toBeNull()
    expect(screen.queryByText('Waiting for feedback')).toBeNull()
  })

  it.each([
    ['ict', 'ICT', '3,840', 597, 404, 193],
    ['cra', 'CRA', '3,044', 1393, 435, 958],
  ])('splits Remaining on %s into Rejected and Waiting for feedback, which add up to it', async (tab, authority, approved, remaining, rejected, waiting) => {
    serve()
    show(`/reports/acceptance?tab=${tab}`)
    await loaded()
    await waitFor(() => expect(card(`${authority} approved`)).toBeInTheDocument())
    expect(within(card(`${authority} approved`)).getByText(approved)).toBeInTheDocument()
    const figure = (name) => Number(screen.getByRole('button', { name: new RegExp(`^${name}:`) }).textContent.replace(/,/g, ''))
    expect(figure(`${authority} remaining villages`)).toBe(remaining)
    expect(figure(`${authority} rejected villages`)).toBe(rejected)
    expect(figure(`villages waiting for ${authority}`)).toBe(waiting)
    expect(rejected + waiting).toBe(remaining)
  })

  it('opens the villages behind a figure, with its authority and the page’s scope', async () => {
    serve()
    show('/reports/acceptance?tab=ict')
    await loaded()
    await userEvent.click(await screen.findByRole('button', { name: /^ICT rejected villages:/ }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/sites', {
        params: { metric: 'rejected', authority: 'ICT', limit: 50 },
      }),
    )
  })
})

// -------------------------------------------------------------------- chart
describe('the progress chart', () => {
  it('names the tab’s stream, and says what to do with it', async () => {
    serve()
    show()
    expect(await screen.findByRole('heading', { name: 'Villages fully accepted against plan' })).toBeInTheDocument()
    expect(screen.getByText('Last 12 months. Click a month to see it on the right.')).toBeInTheDocument()
  })

  it('changes its legend with Monthly and Cumulative, and keeps the choice across tabs', async () => {
    serve()
    show()
    await loaded()
    const legend = () => within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(legend()).toEqual(['Approved', 'Internal PIP', 'Contractor PIP', 'Month in progress'])
    await userEvent.click(screen.getByRole('button', { name: 'Cumulative' }))
    expect(legend()).toEqual(['Approved to date', 'Internal PIP', 'Contractor PIP'])
    expect(screen.getByTestId('callout')).toHaveTextContent('22 behind internal PIP')
    await userEvent.click(screen.getByRole('tab', { name: 'ICT' }))
    expect(screen.getByRole('button', { name: 'Cumulative' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says a stream has no plan yet, and draws approvals only', async () => {
    serve()
    show('/reports/acceptance?tab=ict')
    await loaded()
    expect(screen.getByText('No ICT plan set yet. A PM sets it on Monthly Plan.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('target-bar')).toHaveLength(0)
    expect(screen.queryAllByTestId('pip-tick')).toHaveLength(0)
  })

  it('says plans are programme-wide when the page is narrowed to a province', async () => {
    serve({ prog: progress({ plansAvailable: false }) })
    show()
    await loaded()
    expect(screen.getByText('Plans are set for the whole programme, not per province.')).toBeInTheDocument()
  })

  it('opens a month in the panel when it is clicked, and puts it in the address', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByTestId('panel-approved')).toHaveTextContent('92')
    const column = screen.getByRole('button', { name: 'Show شهریور ۱۴۰۵' })
    await userEvent.click(column)
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-06')
    expect(column).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('panel-approved')).toHaveTextContent('288')
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText('Month result')).toBeInTheDocument()
  })
})

// -------------------------------------------------------------------- panel
describe('the month panel', () => {
  it('opens on the running month, with its day and its two rings', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByText('Day 7 of 30')).toBeInTheDocument()
    expect(screen.getByText('To date 2,880')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Internal PIP: 92 of 320 delivered' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Contractor PIP: 92 of 300 delivered' })).toBeInTheDocument()
    expect(screen.getByText('+17 vs due today')).toBeInTheDocument()
    expect(screen.getByText('To finish on plan (23 days left)')).toBeInTheDocument()
    expect(screen.getByText('228 more')).toBeInTheDocument()
    expect(screen.getAllByTestId('ring-tick')).toHaveLength(2)
  })

  it('steps through the window, and stops at the running month', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-05')
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled()
    // The chooser lists the window newest first.
    const options = within(screen.getByRole('combobox', { name: 'Month' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['مهر 1405', 'شهریور 1405', 'مرداد 1405'])
  })

  it('opens the month the address names', async () => {
    serve()
    show('/reports/acceptance?month=1405-05')
    await loaded()
    expect(screen.getByTestId('panel-approved')).toHaveTextContent('300')
  })
})

// --------------------------------------------------------------- contractor
describe('for a contractor', () => {
  it('has no scope picker, one ring called Your PIP, and no Internal PIP anywhere', async () => {
    signedInAs('Contractor', { contractor_id: 7 })
    serve({ prog: progress({ internalVisible: false }) })
    show()
    await loaded()
    expect(screen.queryByRole('button', { name: /^Scope:/ })).toBeNull()
    expect(screen.getAllByRole('figure')).toHaveLength(1)
    expect(screen.getByRole('figure', { name: /^Your PIP/ })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Internal PIP/i)
    await userEvent.click(screen.getByRole('button', { name: 'Cumulative' }))
    expect(document.body.textContent).not.toMatch(/Internal PIP/i)
    // Both reads are its own company's, so the band and the chart agree.
    expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7 } })
    expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { contractor_id: 7 } })
  })
})

// ------------------------------------------------------------------- scope
describe('the scope picker', () => {
  it('narrows every card on the page to a contractor and a province', async () => {
    serve()
    show()
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Scope: All contractors, all provinces' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'پیشرو فن' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { contractor_id: 7 } }),
    )
    expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7 } })
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'تهران' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7, province_id: 3 } }),
    )
  })
})

// ---------------------------------------------------------------- failures
describe('when a read fails', () => {
  it('leaves the chart and the panel standing if the overview fails, and retries only it', async () => {
    serve({ fail: '/acceptance/overview' })
    show()
    await loaded()
    expect(within(band()).getByText('Couldn’t load the totals.')).toBeInTheDocument()
    expect(screen.getByTestId('panel-approved')).toHaveTextContent('92')

    serve()
    await userEvent.click(within(band()).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(within(band()).getByText('5,210')).toBeInTheDocument())
    expect(calls('/acceptance/overview')).toBe(2)
    expect(calls('/acceptance/progress')).toBe(1)
  })

  it('keeps the band if progress fails, and retries only progress', async () => {
    serve({ fail: '/acceptance/progress' })
    show()
    await waitFor(() => expect(within(band()).getByText('5,210')).toBeInTheDocument())
    expect(screen.getByText('Couldn’t load the chart.')).toBeInTheDocument()
    expect(screen.getByText('Couldn’t load this month.')).toBeInTheDocument()

    serve()
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await loaded()
    expect(calls('/acceptance/progress')).toBe(2)
    expect(calls('/acceptance/overview')).toBe(1)
  })

  it('draws a skeleton for each card while it loads', async () => {
    api.get.mockImplementation(() => new Promise(() => {}))
    show()
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4)
    expect(screen.getByTestId('chart-skeleton')).toBeInTheDocument()
    expect(screen.getByTestId('panel-skeleton')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------- what is gone
describe('what the redesign removed', () => {
  it('stays removed', async () => {
    serve()
    show()
    await loaded()
    const text = document.body.textContent
    for (const gone of [
      /Approval flow/i, /Velocity/i, /ICT vs CRA/i, /Not tested/i, /both approved/i,
      /دائم/, /موقت/, /Needs attention/i, /By contractor/i,
    ]) {
      expect(text).not.toMatch(gone)
    }
    // No per-chart contractor filter: the scope picker is the page's only one.
    expect(screen.queryByRole('combobox', { name: /contractor/i })).toBeNull()
  })

  it('keeps legacy colour tokens and hard-coded colours out of the page', () => {
    // Vitest runs from the frontend directory.
    const css = readFileSync(resolve('src/styles/app.css'), 'utf8')
    const page = css.slice(css.indexOf('Acceptance → Dashboard (pages/reports/AcceptanceDashboard.jsx'))
    expect(page.length).toBeGreaterThan(1000)
    expect(page).not.toMatch(/--(text-dim|text-muted|blue|violet|green|red|amber)\b/)
    expect(page).not.toMatch(/#[0-9a-f]{3,6}\b/i)

    const dir = resolve('src/pages/reports/acceptance') + '/'
    for (const file of ['KpiBand.jsx', 'ProgressChart.jsx', 'MonthPanel.jsx', 'PlanRing.jsx', 'ScopePicker.jsx']) {
      const source = readFileSync(`${dir}${file}`, 'utf8')
      expect(source, file).not.toMatch(/#[0-9a-f]{3,6}\b/i)
      expect(source, file).not.toMatch(/--(text-dim|text-muted|blue|violet)\b/)
    }
  })
})
