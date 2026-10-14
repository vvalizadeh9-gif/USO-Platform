// The Acceptance Dashboard (UEP-07): three tabs over one pair of reads, the
// KPI strip, one Shamsi year's chart against both plans, and the PIP card
// beside it.
//
// What these tests hold up:
//
// * the tabs (Fully accepted, ICT, CRA) and the year live in the address; a
//   tab switch never refetches, a year change does;
// * four equal tiles per tab, and every figure opens the list it counted --
//   Remaining's rejected and waiting too, with the authority on ICT and CRA;
// * the chart's twelve months, the readout following the keyboard, the
//   table showing the same figures, months to come never opening;
// * the PIP card's lines, its steps stopping at the running month;
// * a contractor sees "Your PIP" and never the Internal PIP;
// * one card failing leaves the others standing, and Retry refetches only it;
// * every widget the redesigns removed stays removed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

// The page defaults to the current Shamsi year; pin it.
vi.mock('../../lib/shamsi', async (importOriginal) => ({
  ...(await importOriginal()),
  currentShamsiPeriod: () => ({ year: 1405, month: 7 }),
}))

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
  analysis: { villages_both_approved: 2884, villages_accepted: 2884, villages_rejected: 1100, villages_remained: 453 },
  provinces: [],
}

const NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
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

/** 1405, today 7 Mehr. Village has plans from Mordad on; ICT and CRA none. */
function progress({ internalVisible = true, plansAvailable = true } = {}) {
  const hide = (p) => (internalVisible ? p : { ...p, internal_plan: null, internal_plan_cumulative: null })
  const village = {
    5: row(300, 2500, hide(plans(290, 2490, 320, 2520))),
    6: row(288, 2788, hide(plans(320, 2810, 280, 2800))),
    7: row(92, 2880, hide(plans(320, 3130, 300, 3100))),
    8: row(null, null, hide(plans(330, 3460, 310, 3410))),
  }
  const ict = { 6: row(222, 3722), 7: row(118, 3840) }
  return {
    today: { shamsi_year: 1405, shamsi_month: 7, day: 7, days_in_month: 30 },
    plans_available: plansAvailable,
    internal_visible: internalVisible,
    years: [1405, 1404],
    months: NAMES.map((label, i) => {
      const m = i + 1
      const isFuture = m > 7
      const empty = isFuture ? row(null, null) : row(0, 2200)
      return {
        shamsi_year: 1405, shamsi_month: m, label,
        is_current: m === 7, is_future: isFuture, days_in_month: m <= 6 ? 31 : 30,
        village: village[m] ?? empty,
        ict: ict[m] ?? empty,
        cra: m === 7 ? row(44, 3044) : empty,
      }
    }),
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

const calls = (url) => api.get.mock.calls.filter(([u]) => u === url)
const strip = () => screen.getByRole('region', { name: 'Acceptance totals' })
const tile = (key) => strip().querySelector(`[data-kpi="${key}"]`)
const loaded = () => screen.findByTestId('pip-approved')
const readoutValues = () => screen.getAllByTestId('acc-readout-value').map((b) => b.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('PM')
})

// -------------------------------------------------------------------- tabs
describe('the tabs', () => {
  it('are Fully accepted, ICT and CRA, and open on Fully accepted', async () => {
    serve()
    show()
    await loaded()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Fully accepted', 'ICT', 'CRA'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // ICT and CRA carry their authority's dot; Fully accepted none.
    expect(tabs.map((t) => t.querySelector('.acc-tab-dot') != null)).toEqual([false, true, true])
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
    expect(calls('/acceptance/overview')).toHaveLength(1)
    expect(calls('/acceptance/progress')).toHaveLength(1)
  })

  it('open on the tab the address names', async () => {
    serve()
    show('/reports/acceptance?tab=cra')
    expect(await screen.findByRole('heading', { name: 'CRA approvals against plan' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CRA' })).toHaveAttribute('aria-selected', 'true')
  })
})

// --------------------------------------------------------------------- year
describe('the year', () => {
  it('defaults to the current Shamsi year and asks for it', async () => {
    serve()
    show()
    await loaded()
    expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { year: 1405 } })
    const select = screen.getByRole('combobox', { name: 'Year' })
    expect(select).toHaveValue('1405')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['۱۴۰۵', '۱۴۰۴'])
  })

  it('goes in the address and refetches when it changes', async () => {
    serve()
    show('/reports/acceptance?month=1405-06')
    await loaded()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '1404')
    expect(screen.getByTestId('location')).toHaveTextContent('?year=1404')
    expect(screen.getByTestId('location')).not.toHaveTextContent('month=')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { year: 1404 } }))
  })
})

// -------------------------------------------------------------------- strip
describe('the KPI strip', () => {
  it('is four equal tiles, each figure, one line and its visual', async () => {
    serve()
    show()
    await loaded()
    await waitFor(() => expect(strip().querySelectorAll('.dt-kpi-card')).toHaveLength(4))
    expect(within(tile('onair')).getByText('5,210')).toBeInTheDocument()
    expect(within(tile('onair')).getByText('773 awaiting drive test')).toBeInTheDocument()
    expect(within(tile('dt_done')).getByText('85.2% of on air')).toBeInTheDocument()
    expect(within(tile('approved')).getByText('Fully accepted')).toBeInTheDocument()
    expect(within(tile('approved')).getByText('2,884')).toBeInTheDocument()
    // This month's approvals come from /progress.
    expect(within(tile('approved')).getByText('+92 this month · 65.0% of DT done')).toBeInTheDocument()
    expect(within(tile('remaining')).getByText('1,553')).toBeInTheDocument()
    expect(tile('onair').querySelector('.acc-meter')).toBeNull()
    expect(tile('dt_done').querySelector('.acc-meter')).not.toBeNull()
    expect(within(tile('remaining')).getByRole('img', { name: '1,100 rejected, 453 waiting for feedback' })).toBeInTheDocument()
    expect(document.querySelector('.hk-spark')).toBeNull()
  })

  it('reads Fully accepted Remaining from the village split, each half its own list', async () => {
    serve()
    show()
    await loaded()
    await userEvent.click(await screen.findByRole('button', { name: /^Rejected villages: 1,100/ }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/sites', { params: { metric: 'rejected', limit: 50 } }),
    )
    expect(screen.getByRole('button', { name: /^Villages waiting for feedback: 453/ })).toBeInTheDocument()
  })

  it.each([
    ['ict', 'ICT', '3,840', 597, 404, 193],
    ['cra', 'CRA', '3,044', 1393, 435, 958],
  ])('splits Remaining on %s into rejected and waiting, which add up to it', async (tab, authority, approved, remaining, rejected, waiting) => {
    serve()
    show(`/reports/acceptance?tab=${tab}`)
    await loaded()
    await waitFor(() => expect(within(tile('approved')).getByText(`${authority} approved`)).toBeInTheDocument())
    expect(within(tile('approved')).getByText(approved)).toBeInTheDocument()
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
describe('the year chart', () => {
  it('names the stream and draws twelve months, Farvardin to Esfand', async () => {
    serve()
    const { container } = show()
    await loaded()
    expect(screen.getByRole('heading', { name: 'Fully accepted against plan' })).toBeInTheDocument()
    expect([...container.querySelectorAll('.acc-month-name')].map((n) => n.textContent)).toEqual(NAMES)
    expect(screen.getByTestId('today-line')).toBeInTheDocument()
    const legend = within(screen.getByRole('list', { name: 'Chart key' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(legend).toEqual(['Approved', 'Internal PIP', 'Contractor PIP', 'In progress', 'Planned'])
  })

  it('reads the year against the plan due by today', async () => {
    serve()
    show()
    await loaded()
    // Plan: 290 + 320 + 320 + 330; due: 290 + 320 + 75 (Mehr pro rata).
    const track = screen.getByTestId('year-track')
    expect(track).toHaveTextContent('Due by today 685')
    expect(track).toHaveTextContent('680 of 1,260 · 99% of due')
  })

  it('opens a month when it is clicked, never one to come', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByTestId('pip-approved')).toHaveTextContent('92')
    await userEvent.click(screen.getByRole('button', { name: 'Show شهریور ۱۴۰۵' }))
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-06')
    expect(screen.getByRole('button', { name: 'Show شهریور ۱۴۰۵' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('pip-approved')).toHaveTextContent('288')
    expect(screen.getByTestId('pip-status')).toHaveTextContent('Closed')
    expect(screen.getByRole('button', { name: 'Show آبان ۱۴۰۵' })).toBeDisabled()
  })

  it('moves the readout with the arrow keys and opens a month with Enter', async () => {
    serve()
    show()
    await loaded()
    const plot = screen.getByRole('group', { name: /Months of the year/ })
    expect(screen.getByTestId('acc-readout-month')).toHaveTextContent('مهر ۱۴۰۵')
    expect(readoutValues()).toEqual(['92', '320', '300'])
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(screen.getByTestId('acc-readout-month')).toHaveTextContent('شهریور ۱۴۰۵')
    expect(readoutValues()).toEqual(['288', '320', '280'])
    expect(screen.getByTestId('acc-readout-pct')).toHaveTextContent('90% of Internal PIP')
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    expect(screen.getByTestId('acc-readout-month')).toHaveTextContent('آبان ۱۴۰۵')
    expect(screen.getByTestId('acc-readout')).toHaveTextContent('Upcoming')
    expect(readoutValues()).toEqual(['330', '310'])
    fireEvent.keyDown(plot, { key: 'Enter' })
    expect(screen.getByTestId('location')).not.toHaveTextContent('month=')
    fireEvent.keyDown(plot, { key: 'Home' })
    fireEvent.keyDown(plot, { key: 'ArrowRight' })
    fireEvent.keyDown(plot, { key: 'Enter' })
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-02')
  })

  it('shows the same figures as a table', async () => {
    serve()
    show()
    await loaded()
    const toggle = screen.getByRole('button', { name: 'Table' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Chart' })).toHaveAttribute('aria-pressed', 'true')
    const table = screen.getByTestId('acc-table')
    const cells = (key) => [...table.querySelector(`[data-month="${key}"]`).children].map((c) => c.textContent)
    expect(cells('1405-06')).toEqual(['شهریور', '288', '320', '280', '90%'])
    expect(cells('1405-07')).toEqual(['مهر', '92', '320', '300', 'so far'])
    expect(cells('1405-08')).toEqual(['آبان', 'Upcoming', '330', '310', '—'])
  })

  it('says a stream has no plan, and draws approvals only', async () => {
    serve()
    show('/reports/acceptance?tab=ict')
    await loaded()
    expect(screen.getByText('No ICT plan set for this year.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('target-bar')).toHaveLength(0)
    expect(screen.queryAllByTestId('pip-tick')).toHaveLength(0)
    expect(screen.queryByTestId('year-track')).toBeNull()
  })

  it('says plans are programme-wide when the page is narrowed to a province', async () => {
    serve({ prog: progress({ plansAvailable: false }) })
    show()
    await loaded()
    expect(screen.getByText('Plans are set for the whole programme, not per province.')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------- PIP card
describe('the PIP card', () => {
  it('opens on the running month: day, both plans, pace and to date', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByTestId('pip-status')).toHaveTextContent('Day 7 of 30')
    expect(screen.getByText('· in progress')).toBeInTheDocument()
    const lines = screen.getAllByTestId('pip-line').map((l) => l.textContent)
    // Internal: due 75, approved 92 -- ahead, 228 to go over 23 days.
    expect(lines).toEqual(['228 to go, about 10 a day', '208 to go, about 10 a day'])
    expect(screen.getAllByTestId('pip-today')).toHaveLength(2)
    expect(screen.getByTestId('pip-to-date')).toHaveTextContent('Approved to date2,880')
    expect(screen.getByTestId('pip-to-date')).toHaveTextContent('Internal PIP to date3,130')
    expect(screen.getByTestId('pip-to-date')).toHaveTextContent('250 behind')
  })

  it('reads a closed month: short of plan and above plan', async () => {
    serve()
    show('/reports/acceptance?month=1405-06')
    await loaded()
    expect(screen.getAllByTestId('pip-line').map((l) => l.textContent)).toEqual([
      '−32 short of plan',
      '+8 above plan',
    ])
    expect(screen.queryAllByTestId('pip-today')).toHaveLength(0)
  })

  it('says "No plan set" for a month without one', async () => {
    serve()
    show('/reports/acceptance?month=1405-04')
    await loaded()
    expect(screen.getAllByTestId('pip-line').map((l) => l.textContent)).toEqual(['No plan set', 'No plan set'])
  })

  it('steps inside the year, and Next stops at the running month', async () => {
    serve()
    show()
    await loaded()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-06')
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByTestId('location')).toHaveTextContent('month=1405-07')
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })
})

// --------------------------------------------------------------- contractor
describe('for a contractor', () => {
  it('has no scope buttons, one plan called Your PIP, and no Internal PIP anywhere', async () => {
    signedInAs('Contractor', { contractor_id: 7 })
    serve({ prog: progress({ internalVisible: false }) })
    show()
    await loaded()
    expect(screen.queryByRole('button', { name: /scope:/ })).toBeNull()
    expect(document.querySelectorAll('.acc-plan')).toHaveLength(1)
    expect(document.querySelector('.acc-plan')).toHaveTextContent('Your PIP')
    expect(document.body.textContent).not.toMatch(/Internal PIP/i)
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(document.body.textContent).not.toMatch(/Internal PIP/i)
    // Both reads are its own company's, so the strip and the chart agree.
    expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7 } })
    expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { contractor_id: 7, year: 1405 } })
  })
})

// ------------------------------------------------------------------- scope
describe('the scope buttons', () => {
  it('narrow every card on the page to a province and a contractor', async () => {
    serve()
    show()
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Contractor scope: All contractors' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'پیشرو فن' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/progress', { params: { contractor_id: 7, year: 1405 } }),
    )
    expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7 } })
    await userEvent.click(screen.getByRole('button', { name: 'Province scope: All provinces' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'تهران' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/acceptance/overview', { params: { contractor_id: 7, province_id: 3 } }),
    )
  })
})

// ---------------------------------------------------------------- failures
describe('when a read fails', () => {
  it('leaves the chart and the PIP card standing if the overview fails, and retries only it', async () => {
    serve({ fail: '/acceptance/overview' })
    show()
    await loaded()
    expect(within(strip()).getByText('Couldn’t load the totals.')).toBeInTheDocument()

    serve()
    await userEvent.click(within(strip()).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('5,210')).toBeInTheDocument())
    expect(calls('/acceptance/overview')).toHaveLength(2)
    expect(calls('/acceptance/progress')).toHaveLength(1)
  })

  it('keeps the strip if progress fails, leaves out "+n this month", and retries only progress', async () => {
    serve({ fail: '/acceptance/progress' })
    show()
    await waitFor(() => expect(screen.getByText('5,210')).toBeInTheDocument())
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual([
      expect.stringContaining('Couldn’t load fully accepted against plan.'),
      expect.stringContaining('Couldn’t load PIP.'),
    ])
    expect(within(tile('approved')).getByText('65.0% of DT done')).toBeInTheDocument()

    serve()
    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await loaded()
    expect(calls('/acceptance/progress')).toHaveLength(2)
    expect(calls('/acceptance/overview')).toHaveLength(1)
  })

  it('draws a skeleton for each part while it loads', async () => {
    api.get.mockImplementation(() => new Promise(() => {}))
    const { container } = show()
    await act(async () => {})
    expect(screen.getByTestId('kpi-skeleton')).toBeInTheDocument()
    expect(container.querySelectorAll('.dt-section .dt-skeleton')).toHaveLength(2)
  })
})

// ---------------------------------------------------------- what is gone
describe('what the redesigns removed', () => {
  it('stays removed', async () => {
    serve()
    const { container } = show()
    await loaded()
    const text = document.body.textContent
    for (const gone of [
      /Approval flow/i, /Velocity/i, /ICT vs CRA/i, /Not tested/i, /both approved/i,
      /دائم/, /موقت/, /Needs attention/i, /By contractor/i,
      /Cumulative/, /Month result/, /To finish on plan/, /vs due today/,
    ]) {
      expect(text).not.toMatch(gone)
    }
    // No rings, no month chooser, no stream colours, no pass/fail pills.
    expect(screen.queryByRole('figure')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Month' })).toBeNull()
    expect(container.querySelector('[class*="acc-stream-"], [class*="accd-"]')).toBeNull()
  })

  it('keeps green, legacy tokens and hard-coded colours out of the page', () => {
    // Vitest runs from the frontend directory.
    // The rules only: the comments are free to say "no green".
    const css = readFileSync(resolve('src/styles/acceptance-dashboard.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/--(text-dim|text-muted|blue|violet|green|red|amber)\b/)
    expect(css).not.toMatch(/success|green/i)
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i)

    const dir = resolve('src/pages/reports/acceptance') + '/'
    for (const file of ['KpiBand.jsx', 'ProgressChart.jsx', 'PipCard.jsx', 'ScopePicker.jsx', 'model.js']) {
      const source = readFileSync(`${dir}${file}`, 'utf8')
      expect(source, file).not.toMatch(/#[0-9a-f]{3,6}\b/i)
      expect(source, file).not.toMatch(/--(text-dim|text-muted|blue|violet)\b|success/)
    }
  })
})
