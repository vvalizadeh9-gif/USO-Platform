// The Drive Test dashboard.
//
// What is worth testing here is what the page reports, not how it is laid
// out: the figures, the two places a number is deliberately absent rather
// than zero, the notes that keep a truncated view reconciling to its total,
// and — new here — the things the old dashboard got wrong or could not do at
// all. Three of those have their own describe blocks at the foot: delta
// polarity, drill-through, and a section that fails without taking the page
// with it.
//
// The suite runs with reduced motion on (see src/test/setup.js), so animated
// figures render at their final values and can be asserted directly.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const api = (await import('../../api/client')).default
const DriveTestProject = (await import('./DriveTestProject')).default
const { ToastProvider } = await import('../../context/ToastContext')

/** The dashboard opened on its Contractors & provinces tab, where the
 * contractor scorecard and the province table live. */
const TABLES = '/reports/drive-test?tab=contractors-provinces'
const BREAKDOWNS = '/reports/drive-test?tab=breakdowns'

const STAFF = { id: 1, username: 'pm', role: { name: 'PM' } }
const VIEWER = { id: 2, username: 'v', role: { name: 'Viewer' } }

function draw(initialPath = '/reports/drive-test', user = STAFF) {
  mockAuth.current = { user }
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <DriveTestProject />
      </ToastProvider>
    </MemoryRouter>,
  )
}

// ---------------------------------------------------------------------- data
// Shaped from app/schemas: DriveTestOverview, PlanAndDelivery, DriveTestTrend.
// The field names come from the backend, not from a guess.
const kpi = (value, delta = null, pct = null) => ({
  value,
  delta,
  percent_of_onair: pct,
})

const PROVINCES = [
  { id: 7, name: 'Kerman' },
  { id: 9, name: 'Yazd' },
]

const overview = {
  kpis: {
    total_onair: kpi(100),
    total_dt_done: kpi(40),
    total_remaining: kpi(60),
    total_ongoing: kpi(50),
    total_problematic: kpi(10),
    // The four states partition on-air: 40 + 50 + 10 = 100, so nothing is
    // left over here. A fixture with a non-zero not-started figure lives in
    // the backend tests, where the predicate that decides it is.
    total_not_started: kpi(0),
    current_month_dt_done: kpi(6),
  },
  ongoing_by_contractor: [],
  problematic_by_category: [],
  dt_done_by_contractor: [],
  dt_done_yearly: [],
  dt_done_monthly: [],
  progress_by_province: [],
  current_month_label: 'شهریور 1405',
  generated_at: new Date().toISOString(),
  provinces: PROVINCES,
  province_id: null,
  ongoing_breakdown: {
    total: 50,
    // Workflow order, zeros kept — the order and the empty buckets are both
    // part of what the pipeline says, so the fixture carries them.
    by_stage: [
      { name: 'New', value: 14 },
      { name: 'HC In Progress', value: 6 },
      { name: 'HC Review', value: 3 },
      { name: 'Ready for Assignment', value: 9 },
      { name: 'Assigned', value: 12 },
      { name: 'Returned by Contractor', value: 0 },
      { name: 'DT Submitted', value: 6 },
    ],
    by_contractor: [
      { name: 'Alfa Drive Tests', value: 12 },
      { name: 'Beta Surveys', value: 6 },
    ],
    without_contractor: 32,
    by_province: [
      { name: 'Kerman', value: 30 },
      { name: 'Yazd', value: 20 },
    ],
    // `key` is what a drill-through link travels with; the backend fills it
    // for age bands, stages and categories. See ChartPoint.
    by_age: [
      { name: 'Up to 1 week', value: 20, key: 'lte_1w' },
      { name: '1–2 weeks', value: 15, key: 'w1_2' },
      { name: '2–3 weeks', value: 8, key: 'w2_3' },
      { name: '3 weeks – 1 month', value: 4, key: 'w3_1m' },
      { name: '1–2 months', value: 3, key: 'm1_2' },
      { name: 'More than 2 months', value: 1, key: 'gt_2m' },
    ],
    without_assignment_date: 2,
  },
  problematic_breakdown: {
    total: 10,
    by_category: [
      { name: 'Power', value: 6, key: 'Power' },
      { name: 'Access', value: 4, key: 'Access' },
    ],
    by_province: [
      { name: 'Kerman', value: 7 },
      { name: 'Yazd', value: 3 },
    ],
    by_age: [
      { name: 'Up to 1 week', value: 2, key: 'lte_1w' },
      { name: '1–2 weeks', value: 1, key: 'w1_2' },
      { name: '2–3 weeks', value: 0, key: 'w2_3' },
      { name: '3 weeks – 1 month', value: 0, key: 'w3_1m' },
      { name: '1–2 months', value: 1, key: 'm1_2' },
      { name: 'More than 2 months', value: 2, key: 'gt_2m' },
    ],
    without_problem_date: 4,
  },
  province_breakdown: [
    { name: 'Kerman', onair: 60, done: 23, remaining: 37, ongoing: 30, problematic: 7, not_started: 0, done_percent: 38.3 },
    { name: 'Yazd', onair: 40, done: 17, remaining: 23, ongoing: 20, problematic: 3, not_started: 0, done_percent: 42.5 },
  ],
  // `assigned` is done + ongoing, and problematic is deliberately outside it
  // — see ContractorScorecard for why the denominator stops there.
  contractor_scorecard: [
    { contractor_id: 1, name: 'Alfa Drive Tests', assigned: 55, done: 40, ongoing: 15, problematic: 5, not_started: 0, done_percent: 72.7 },
    { contractor_id: 2, name: 'Beta Surveys', assigned: 27, done: 9, ongoing: 18, problematic: 3, not_started: 0, done_percent: 33.3 },
    { contractor_id: null, name: 'Unattributed', assigned: 8, done: 2, ongoing: 6, problematic: 2, not_started: 0, done_percent: 25.0 },
  ],
}

/** An overview with ``n`` provinces, for the collapse-and-show-all tests. */
const overviewWithProvinces = (n) => ({
  ...overview,
  province_breakdown: Array.from({ length: n }, (_, i) => ({
    name: `Province ${i + 1}`,
    onair: 100,
    // Descending remaining, which is also the table's default sort.
    done: i,
    remaining: 100 - i,
    ongoing: 100 - i,
    problematic: 0,
    not_started: 0,
    done_percent: i,
  })),
})

const month = (label, over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  label,
  captured: true,
  estimated: false,
  is_open: false,
  onair: 100,
  dt_done: 40,
  remaining: 60,
  ongoing: 50,
  problematic: 10,
  ...over,
})

const trend = (over = {}) => ({
  months: [
    month('مرداد', { shamsi_month: 5, remaining: 70, dt_done: 30 }),
    month('شهریور', { shamsi_month: 6, is_open: true }),
  ],
  latest_flows: {
    shamsi_year: 1405,
    shamsi_month: 6,
    label: 'شهریور',
    is_open: true,
    opening_remaining: 70,
    closing_remaining: 60,
    new_onair: 4,
    dt_completed: 14,
    newly_problematic: 3,
    problematic_resolved: 5,
  },
  province_id: null,
  ...over,
})

const planDelivery = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  month_label: 'شهریور 1405',
  pip: 16,
  assigned: 9,
  actual: 6,
  achievement_percent: 37.5,
  committed_contractors: 3,
  uncommitted_contractors: 1,
  programme_achievement_percent: null,
  rows: [
    { contractor_id: 2, name: 'Beta Surveys', pip: 2, actual: 2, achievement_percent: 100.0 },
    { contractor_id: 1, name: 'Alfa Drive Tests', pip: 4, actual: 3, achievement_percent: 75.0 },
    { contractor_id: 3, name: 'Gamma Networks', pip: 10, actual: 1, achievement_percent: 10.0 },
  ],
  ...over,
})

// Shaped from DriveTestFlow (app/schemas): `opening` and `not_placed` are
// balances, `months` is one entry per Shamsi month from Farvardin 1404 with
// that month's own on-aired and DT-done counts, not a running total.
const flowMonth = (year, month, over = {}) => ({
  year,
  month,
  on_aired: 0,
  dt_done: 0,
  is_open: false,
  ...over,
})

/** Eight months of flat 8-on-air / 8-DT-done activity.
 *
 * Long enough to clear the band's seven-point sparkline floor, and flat on
 * purpose: a series whose gap never moves is what proves the pending line is
 * built from on-air minus DT done rather than from either one alone. A
 * rising or falling fixture would pass whichever of the three it actually
 * drew.
 */
const longMonths = () =>
  Array.from({ length: 8 }, (_, i) =>
    flowMonth(1404, i + 1, { on_aired: 8, dt_done: 8, is_open: i === 7 }),
  )

const flow = (over = {}) => ({
  opening: { on_air: 50, dt_done: 20 },
  months: [
    flowMonth(1404, 1, { on_aired: 10, dt_done: 4 }),
    flowMonth(1404, 2, { on_aired: 8, dt_done: 6 }),
    flowMonth(1405, 1, { on_aired: 5, dt_done: 3 }),
    flowMonth(1405, 2, { on_aired: 4, dt_done: 2, is_open: true }),
  ],
  not_placed: { on_air: 3, dt_done: 0 },
  province_id: null,
  ...over,
})

/** What `/drive-test/sites` answers for each query the dashboard can send.
 *
 * Keyed by the exact query the panel is expected to ask, and the totals are
 * the very figures the overview fixture puts on screen. That is what makes
 * the parity tests mean something: if the panel sends a query that is not
 * in this table -- a wrong bucket, a dropped province, a contractor id that
 * never made it into the request -- the lookup misses and the panel reports
 * NO_SUCH_QUERY instead of quietly agreeing with whatever it was given.
 *
 * The real guarantee is the server's, and it is asserted there: `total` is
 * counted before pagination through the dashboard's own predicates (see
 * services/dt_site_list). What this side can prove is the other half --
 * that the panel asks for exactly the figure that was clicked, and shows
 * what came back.
 */
const SITE_TOTALS = {
  'bucket=remaining': 60,
  'bucket=ongoing': 50,
  'bucket=problematic': 10,
  'bucket=done': 40,
  'bucket=onair': 100,
  'bucket=not_started': 0,
  // Alfa Drive Tests: 40 done + 15 ongoing = 55 assigned.
  'bucket=assigned&contractor_id=1': 55,
  'bucket=ongoing&contractor_id=1': 15,
  // Kerman, province 7.
  'bucket=onair&province_id=7': 60,
  'bucket=remaining&province_id=7': 37,
  'bucket=problematic&province_id=7': 7,
}

const NO_SUCH_QUERY = -999

const siteRow = (i, over = {}) => ({
  work_item_id: i,
  site_code: `S-${i}`,
  villages: null,
  province: 'Kerman',
  contractor: 'Alfa Drive Tests',
  bucket: 'Ongoing',
  current_stage: 'DT In Progress',
  age_band: '2–3 weeks',
  problem_age_band: null,
  ...over,
})

function siteListFor(config) {
  const params = { ...(config?.params ?? {}) }
  delete params.limit
  const key = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const total = key in SITE_TOTALS ? SITE_TOTALS[key] : NO_SUCH_QUERY
  return {
    total,
    rows: Array.from({ length: Math.min(Math.max(total, 0), 3) }, (_, i) => siteRow(i + 1)),
    filters_applied: params,
    generated_at: '2026-09-22T10:00:00Z',
    age_bands: [],
    ongoing_stages: [],
  }
}

function serve(plan = planDelivery(), body = overview, series = trend(), flowData = flow()) {
  api.get.mockImplementation((url, config) => {
    if (url === '/drive-test/overview') return Promise.resolve({ data: body })
    if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: plan })
    if (url === '/drive-test/trend') return Promise.resolve({ data: series })
    if (url === '/drive-test/flow') return Promise.resolve({ data: flowData })
    if (url === '/drive-test/sites') return Promise.resolve({ data: siteListFor(config) })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}


/** A section by its heading, once the page has loaded. */
async function section(title) {
  const heading = await screen.findByRole('heading', { name: title })
  const node = heading.closest('.dt-section')
  // The heading is not evidence that the data arrived. Section renders its
  // title immediately and the body as a skeleton until the fetch resolves, so
  // awaiting the heading alone awaits nothing, and every assertion after it
  // races the promise. It won on a quiet machine and lost on a loaded CI
  // runner, which is the worst way for a test to be wrong. Wait for the
  // skeleton to go instead — that is the thing "loaded" actually means.
  await waitFor(() => expect(node.querySelector('.dt-skeleton')).toBeNull())
  return node
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('breakdown chrome', () => {
  it('says when no problematic site has a category yet, rather than drawing it as a finding', async () => {
    // One bar reading "Uncategorized 100%" looks like a result. It is the
    // absence of one.
    serve(planDelivery(), {
      ...overview,
      problematic_breakdown: {
        ...overview.problematic_breakdown,
        by_category: [{ name: 'Uncategorized', value: 10, key: 'Uncategorized' }],
      },
    })
    draw(BREAKDOWNS)

    const card = await section('Problematic breakdown')
    expect(card).toHaveTextContent(
      'No site has a category yet — nothing to break down until they do.',
    )
  })

  it('says nothing of the kind once any site has a category', async () => {
    serve()
    draw(BREAKDOWNS)

    const card = await section('Problematic breakdown')
    expect(within(card).queryByText(/No site has a category yet/)).toBeNull()
  })

  it('keeps the chart/table switch in the card foot, below the bars', async () => {
    // It used to take a row of its own above them.
    serve()
    draw(BREAKDOWNS)

    const card = await section('Ongoing breakdown')
    const toggle = within(card).getByRole('group', { name: 'Chart or table' })
    expect(toggle.closest('.dt-breakdown-foot')).not.toBeNull()
    const bars = card.querySelector('.dt-bars')
    expect(bars.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('switches views with a segmented control on its own row under the header', async () => {
    serve()
    draw(BREAKDOWNS)

    const card = await section('Problematic breakdown')
    const head = card.querySelector('.dt-section-head')
    expect(within(head).queryByRole('tablist')).toBeNull()
    const tabs = within(card).getByRole('tablist', { name: 'Break down by' })
    expect(tabs).toHaveClass('ui-seg')
    // The first thing in the body, above the bars.
    expect(tabs.parentElement).toHaveClass('dt-section-body')
    expect(tabs.compareDocumentPosition(card.querySelector('.dt-bars')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('writes the total in ink, not in the state colour', async () => {
    serve()
    draw(BREAKDOWNS)

    for (const title of ['Ongoing breakdown', 'Problematic breakdown']) {
      const total = (await section(title)).querySelector('.dt-section-head .dt-section-total b')
      expect(total, title).not.toHaveAttribute('style')
    }
  })

  it('draws every bar in the accent, and a folded or uncategorized row in the neutral', async () => {
    serve(planDelivery(), {
      ...overview,
      problematic_breakdown: {
        ...overview.problematic_breakdown,
        by_category: [
          { name: 'Power', value: 6, key: 'Power' },
          { name: 'Uncategorized', value: 4, key: 'Uncategorized' },
        ],
      },
    })
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    for (const bar of within(ongoing).getAllByTestId('dt-bar')) {
      expect(bar).toHaveStyle({ background: 'var(--accent)' })
    }
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long' }))
    for (const bar of within(ongoing).getAllByTestId('dt-bar')) {
      expect(bar).toHaveStyle({ background: 'var(--accent)' })
    }

    const problematic = await section('Problematic breakdown')
    const uncategorized = within(problematic).getByText('Uncategorized').closest('.dt-bar-row')
    expect(uncategorized).toHaveClass('dt-muted')
    expect(within(uncategorized).getByTestId('dt-bar')).toHaveStyle({ background: 'var(--dt-pending-bar)' })
    // Still a link: there is a list of uncategorized sites behind it.
    expect(within(uncategorized).getByText('Uncategorized').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=problematic&category=Uncategorized',
    )
  })
})

describe('breakdown sections', () => {
  it('renders each section, opening on its chart view', async () => {
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    const problematic = await section('Problematic breakdown')

    // Chart first, table on request: bars are present, the table's own
    // Total row is not.
    expect(within(ongoing).getAllByTestId('dt-bar')).toHaveLength(2)
    expect(within(ongoing).queryByText('Total')).not.toBeInTheDocument()
    expect(within(problematic).getAllByTestId('dt-bar')).toHaveLength(2)

    // The province table is on the other tab.
    await userEvent.click(screen.getByRole('tab', { name: 'Contractors & provinces' }))
    const provinces = await section('Drive Test progress by province')
    expect(within(provinces).getByText('Kerman')).toBeInTheDocument()
  })

  it('shows the ongoing total on the section header', async () => {
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByText('50')).toBeInTheDocument()
    expect(within(ongoing).getByText('ongoing')).toBeInTheDocument()
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()
  })

  it('switches the ongoing section between its three tabs', async () => {
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()

    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Province' }))
    expect(within(ongoing).getByText('Kerman')).toBeInTheDocument()
    expect(within(ongoing).queryByText('Alfa Drive Tests')).not.toBeInTheDocument()

    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long' }))
    expect(within(ongoing).getByText('More than 2 months')).toBeInTheDocument()
    expect(within(ongoing).queryByText('Kerman')).not.toBeInTheDocument()

    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Contractor' }))
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()
  })

  it('marks the selected tab for a screen reader, not just visually', async () => {
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByRole('tab', { name: 'Contractor' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Province' }))
    expect(within(ongoing).getByRole('tab', { name: 'Province' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('states how many ongoing sites have no contractor, so the tab reconciles', async () => {
    // The contractor rows come to 18 of 50 on purpose. Without this note the
    // view looks like it has lost 32 sites.
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    expect(
      within(ongoing).getByText(
        '32 ongoing sites have no contractor and are not shown above.',
      ),
    ).toBeInTheDocument()
  })

  it('says so plainly when every ongoing site does have a contractor', async () => {
    serve(planDelivery(), {
      ...overview,
      ongoing_breakdown: {
        ...overview.ongoing_breakdown,
        total: 18,
        without_contractor: 0,
      },
    })
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByText('Every ongoing site has a contractor.')).toBeInTheDocument()
  })

  it('says how many ongoing sites cannot be aged, for the same reason', async () => {
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long' }))
    expect(
      within(ongoing).getByText(/2 ongoing sites are not assigned to anyone yet/),
    ).toBeInTheDocument()
  })

  it('ages the ongoing sites in weeks, from the day they were assigned', async () => {
    // The clock used to run from the launch date, which measured how long a
    // site had been on air rather than how long anybody had been holding it:
    // a brand-new assignment on a two-year-old site read as a year overdue.
    serve()
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long' }))

    const bands = within(ongoing)
      .getAllByTestId('dt-bar')
      .map((bar) => bar.closest('.dt-bar-row').querySelector('.dt-bar-label').textContent)
    expect(bands).toEqual([
      'Up to 1 week',
      '1–2 weeks',
      '2–3 weeks',
      '3 weeks – 1 month',
      '1–2 months',
      'More than 2 months',
    ])
  })

  it('ages the problematic sites too, on their own clock', async () => {
    // The card used to say what was wrong and could not say for how long, so
    // a bar reading 64 sites on temporary power could be this week's news or
    // last year's -- and only one of those is somebody's to answer for.
    serve()
    draw(BREAKDOWNS)

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('tab', { name: 'How long' }))

    const bands = within(problematic)
      .getAllByTestId('dt-bar')
      .map((bar) => bar.closest('.dt-bar-row').querySelector('.dt-bar-label').textContent)
    expect(bands).toEqual([
      'Up to 1 week',
      '1–2 weeks',
      '2–3 weeks',
      '3 weeks – 1 month',
      '1–2 months',
      'More than 2 months',
    ])
  })

  it('names the problematic sites it cannot age, rather than hiding them', async () => {
    // Four of the ten carry no date, so the bars sum to six. A reader who is
    // not told that reads the bars as the whole picture -- and the direction
    // of the error is the dangerous one: the backlog looks fresher than it is.
    serve()
    draw(BREAKDOWNS)

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('tab', { name: 'How long' }))

    expect(within(problematic).getByText(/4 sites were flagged by a CPM import/)).
      toBeInTheDocument()
  })

  it('opens each problematic age band on the sites in that band', async () => {
    serve()
    draw(BREAKDOWNS)

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('tab', { name: 'How long' }))

    const link = within(problematic)
      .getAllByRole('link')
      .find((a) => a.getAttribute('href')?.includes('age_band=gt_2m'))
    expect(link).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=problematic&age_band=gt_2m',
    )
  })

  it('toggles each section to a table and back, in the same card', async () => {
    serve()
    draw(BREAKDOWNS)

    for (const [title, unit] of [
      ['Ongoing breakdown', 'Contractor'],
      ['Problematic breakdown', 'Category'],
    ]) {
      const card = await section(title)
      await userEvent.click(within(card).getByRole('button', { name: /Table/ }))

      // A table with the total spelled out — the row a reader checks the
      // section against.
      expect(within(card).getByRole('columnheader', { name: unit })).toBeInTheDocument()
      expect(within(card).getByText('Total')).toBeInTheDocument()
      expect(within(card).queryAllByTestId('dt-bar')).toHaveLength(0)

      await userEvent.click(within(card).getByRole('button', { name: /Chart/ }))
      expect(within(card).queryByText('Total')).not.toBeInTheDocument()
      expect(within(card).getAllByTestId('dt-bar').length).toBeGreaterThan(0)
    }
  })

  it('adds the table up to the section total', async () => {
    serve()
    draw(BREAKDOWNS)

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('button', { name: /Table/ }))

    // 6 + 4 = 10, the problematic total, at 100% of it.
    const totalRow = within(problematic).getByText('Total').closest('tr')
    expect(within(totalRow).getByText('10')).toBeInTheDocument()
    expect(within(totalRow).getByText('100%')).toBeInTheDocument()
  })

  it('switches the problematic section between category and province', async () => {
    serve()
    draw(BREAKDOWNS)

    const problematic = await section('Problematic breakdown')
    expect(within(problematic).getByText('Power')).toBeInTheDocument()

    await userEvent.click(within(problematic).getByRole('tab', { name: 'Province' }))
    expect(within(problematic).getByText('Kerman')).toBeInTheDocument()
    expect(within(problematic).queryByText('Power')).not.toBeInTheDocument()
  })

  it('adds the named rows plus the remainder up to the card total', async () => {
    // The property the remainder row exists to give, asserted rather than
    // trusted. A truncated list that does not sum to its own card reads as a
    // complete one that has lost sites, which is the single worst thing a
    // breakdown can do -- and it is exactly what dropping the tail would
    // produce, silently and only for the provinces that fell off the end.
    //
    // Ten provinces summing to 55, which is the card total, so the fold has
    // to account for every site rather than most of them.
    serve(planDelivery(), {
      ...overview,
      ongoing_breakdown: {
        ...overview.ongoing_breakdown,
        total: 55,
        by_province: Array.from({ length: 10 }, (_, i) => ({
          name: `Province ${i + 1}`,
          value: 10 - i,
        })),
      },
    })
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Province' }))

    // Read off the rendered rows, the remainder among them, not off the
    // fixture: the sum has to survive the component, not just the data.
    const rows = within(ongoing).getAllByRole('listitem')
    const sum = rows.reduce(
      (total, row) => total + Number(within(row).getByText(/^\d+$/).textContent),
      0,
    )
    expect(sum).toBe(55)

    // And the header is still claiming that same total, so the two cannot
    // drift apart without this failing.
    expect(within(ongoing).getByText('55')).toBeInTheDocument()
  })

  it('folds the province tail of a breakdown tab into one remainder line', async () => {
    serve(planDelivery(), {
      ...overview,
      ongoing_breakdown: {
        ...overview.ongoing_breakdown,
        total: 55,
        by_province: Array.from({ length: 10 }, (_, i) => ({
          name: `Province ${i + 1}`,
          value: 10 - i,
        })),
      },
    })
    draw(BREAKDOWNS)

    const ongoing = await section('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Province' }))

    // 10+9+8+7+6+5 named, then 4+3+2+1 = 10 in the remainder.
    expect(within(ongoing).getAllByTestId('dt-bar')).toHaveLength(7)
    const remainder = within(ongoing).getByText('4 more provinces').closest('.dt-bar-row')
    expect(within(remainder).getByText('10')).toBeInTheDocument()
  })
})

describe('the province grid', () => {
  // The card grid became a sortable table -- see ProvinceList. Cards became
  // rows, sortable through the `.dt-sort-btn` in each column header rather
  // than a row of chips above the grid, and every province now loads at
  // once in `.dt-table-scroll` rather than folding past a fixed count.
  const cardNames = (scope) =>
    Array.from(scope.querySelectorAll('.dt-province-card')).map(
      (card) => card.querySelector('.dt-province-name').textContent,
    )

  // Four provinces, each with `done + remaining == onair`, built so every
  // one of the seven columns has a worked-out order -- a fixture where two
  // sorts agree cannot tell a working column from one wired to the wrong
  // key.
  const sortable = {
    ...overview,
    province_breakdown: [
      { name: 'Yazd', onair: 50, done: 45, remaining: 5, ongoing: 5, problematic: 0, not_started: 0, done_percent: 90 },
      { name: 'Kerman', onair: 400, done: 200, remaining: 200, ongoing: 200, problematic: 0, not_started: 0, done_percent: 50 },
      { name: 'Bushehr', onair: 300, done: 20, remaining: 280, ongoing: 270, problematic: 1, not_started: 0, done_percent: 7 },
      { name: 'Ardabil', onair: 20, done: 4, remaining: 16, ongoing: 3, problematic: 13, not_started: 0, done_percent: 40 },
    ],
  }

  it('opens sorted by remaining, most first, showing the eight with the most left', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(cardNames(provinces)).toEqual([
      'Province 1', 'Province 2', 'Province 3', 'Province 4',
      'Province 5', 'Province 6', 'Province 7', 'Province 8',
    ])
    expect(provinces).toHaveTextContent('Showing 8 of 10 provinces')
  })

  it('shows the rest on View all, and folds them again, with no scroll inside the table', async () => {
    // It used to show every province inside a 480px box with its own
    // scrollbar -- a scroll inside a scrolling page. The page scrolls now,
    // and the table folds past eight.
    serve(planDelivery(), overviewWithProvinces(20))
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(provinces.querySelector('.dt-table-scroll')).toBeNull()
    expect(cardNames(provinces)).toHaveLength(8)

    await userEvent.click(within(provinces).getByRole('button', { name: 'View all' }))
    expect(cardNames(provinces)).toHaveLength(20)
    expect(provinces).toHaveTextContent('Showing 20 of 20 provinces')

    await userEvent.click(within(provinces).getByRole('button', { name: 'Show fewer' }))
    expect(cardNames(provinces)).toHaveLength(8)
  })

  it('shows every match when searching, however far down the ranking it sits', async () => {
    // A reader who typed a name is looking for that row. "Province 1"
    // matches Province 1 and Province 10 to 19: eleven, past the fold.
    serve(planDelivery(), overviewWithProvinces(20))
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    await userEvent.type(within(provinces).getByRole('textbox', { name: 'Search provinces' }), 'Province 1')
    expect(cardNames(provinces)).toHaveLength(11)
    expect(provinces).toHaveTextContent('11 of 20 provinces match')
    expect(within(provinces).queryByRole('button', { name: 'View all' })).toBeNull()
  })

  it('offers no fold when every province already fits', async () => {
    serve()
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(within(provinces).queryByRole('button', { name: 'View all' })).toBeNull()
  })

  it('sorts on each of the sortable columns', async () => {
    serve(planDelivery(), sortable)
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    // Gap (was Remaining) is the default and needs no click.
    expect(cardNames(provinces)).toEqual(['Bushehr', 'Kerman', 'Ardabil', 'Yazd'])

    for (const [control, order] of [
      ['Province', ['Ardabil', 'Bushehr', 'Kerman', 'Yazd']],
      ['On air', ['Kerman', 'Bushehr', 'Yazd', 'Ardabil']],
      ['DT Done', ['Kerman', 'Yazd', 'Bushehr', 'Ardabil']],
      ['Ongoing', ['Bushehr', 'Kerman', 'Yazd', 'Ardabil']],
      ['Problematic', ['Ardabil', 'Bushehr', 'Yazd', 'Kerman']],
      ['DT completion', ['Yazd', 'Kerman', 'Ardabil', 'Bushehr']],
      ['Gap', ['Bushehr', 'Kerman', 'Ardabil', 'Yazd']],
    ]) {
      await userEvent.click(within(provinces).getByRole('button', { name: control }))
      expect(cardNames(provinces)).toEqual(order)
    }
  })

  it('reverses on a second click of the same control', async () => {
    serve(planDelivery(), sortable)
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    await userEvent.click(within(provinces).getByRole('button', { name: 'On air' }))
    expect(cardNames(provinces)).toEqual(['Kerman', 'Bushehr', 'Yazd', 'Ardabil'])
    await userEvent.click(within(provinces).getByRole('button', { name: 'On air' }))
    expect(cardNames(provinces)).toEqual(['Ardabil', 'Yazd', 'Bushehr', 'Kerman'])
  })

  it('has nine column headers with eight sort controls: #, Province, On air, DT Done, Gap, DT completion, Ongoing, Problematic, and an Action column', async () => {
    serve()
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    const labels = within(provinces)
      .getAllByRole('columnheader')
      .map((th) => th.textContent.trim())
    expect(labels).toEqual([
      '#', 'Province', 'On air', 'DT Done', 'Gap', 'DT completion', 'Ongoing', 'Problematic', '',
    ])
  })

  it('hides the action column for a Viewer, who cannot act on any row', async () => {
    serve()
    draw(TABLES, VIEWER)

    const provinces = await section('Drive Test progress by province')
    const labels = within(provinces)
      .getAllByRole('columnheader')
      .map((th) => th.textContent.trim())
    expect(labels).toEqual([
      '#', 'Province', 'On air', 'DT Done', 'Gap', 'DT completion', 'Ongoing', 'Problematic',
    ])
    expect(provinces.querySelectorAll('.dt-action-cell')).toHaveLength(0)
  })

  it('marks the programme average on each completion bar, and says which rows fall below it', async () => {
    // The rule is the programme average, not a fixed band: a province at 88%
    // is doing badly in a programme averaging 95% and well in one averaging
    // 60%. Below-average is no longer drawn in red. It is read off a 2px mark
    // at the average on every bar, and said in words to a screen reader.
    //
    // These four come to 269 done of 770 on air, so the average is 35%.
    serve(planDelivery(), sortable)
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    const cell = (name) =>
      within(provinces).getByText(name).closest('.dt-province-card')
        .querySelector('.dt-province-rate-cell')

    for (const name of ['Yazd', 'Kerman', 'Bushehr', 'Ardabil']) {
      const mark = within(cell(name)).getByTestId('dt-province-average-mark')
      expect(parseFloat(mark.style.left)).toBeCloseTo((269 / 770) * 100, 5)
      // The rate is ink on every row.
      expect(cell(name).querySelector('.dt-province-rate')).not.toHaveAttribute('style')
      expect(cell(name).querySelector('.dt-rate-fill')).not.toHaveAttribute(
        'style',
        expect.stringContaining('dt-problem'),
      )
    }

    // Below the average, and the only one that is.
    expect(cell('Bushehr')).toHaveTextContent('7%below the 35% average')
    expect(cell('Bushehr').querySelector('.dt-sr-only')).toHaveTextContent('below the 35% average')
    // Above it -- including Kerman at 50%, which the old fixed bands would
    // have drawn in the in-flight colour for being under 70.
    for (const name of ['Kerman', 'Yazd', 'Ardabil']) {
      expect(cell(name).querySelector('.dt-sr-only')).toBeNull()
    }

    // And the mark is keyed under the table, because a mark whose meaning is
    // not on screen is one a reader has to guess at.
    expect(provinces).toHaveTextContent('The mark on each bar is the 35% programme average')
  })

  it('draws no red rule down a row with problematic sites', async () => {
    serve(planDelivery(), sortable)
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    const row = within(provinces).getByText('Ardabil').closest('.dt-province-card')
    expect(row).not.toHaveClass('dt-row-problem')
    // The count itself still carries the state: the column names it.
    expect(within(row).getByText('13')).toHaveClass('dt-cell-link-bad')
  })

  it('shows no "Not started" anywhere in the grid, its key or its bars', async () => {
    serve()
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(within(provinces).queryByText('Not started')).not.toBeInTheDocument()
  })

  it('labels the column Gap -- On air minus DT Done', async () => {
    serve()
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(within(provinces).getByRole('button', { name: 'Gap' })).toBeInTheDocument()
  })

  it('explains under the table that Gap no longer adds up to Ongoing + Problematic', async () => {
    serve()
    draw(TABLES)

    const provinces = await section('Drive Test progress by province')
    expect(provinces).toHaveTextContent(
      'Gap = On air − DT Done. Ongoing + Problematic can be lower than Gap, because on-air sites with no DT status yet are counted in Gap only.',
    )
  })
})

// --------------------------------------------------------------------------
// The three things the old dashboard got wrong or could not do.
// --------------------------------------------------------------------------

describe('delta direction', () => {
  // The old DeltaChip painted every rise green and every fall red, with no
  // notion of which way good pointed. Three of the six KPIs count work you
  // want to see fall, so a month that cleared 12 sites rendered in alarm red
  // and a month that gained 4 problematic sites rendered reassuring green.
  //
  // The change is now drawn neutral (Cobalt: figures are ink), so the
  // direction is asserted where it still lives: `data-tone` on the number and
  // the visually hidden word a screen reader hears after it.
  const moving = {
    ...overview,
    kpis: {
      total_onair: kpi(100, 5),
      total_dt_done: kpi(40, 12),
      total_remaining: kpi(60, -12, 60),
      total_ongoing: kpi(50, -16, 50),
      total_problematic: kpi(10, 4, 10),
      total_not_started: kpi(0, 0, 0),
      current_month_dt_done: kpi(6, 2),
    },
  }

  // "Remaining", "Problematic" and "Drive tests done" each name the same
  // concept in more than one place — a band figure, a chart legend entry, a
  // table column — so every query below is scoped to the band.
  const band = () => screen.getByLabelText('Programme totals')

  it('reads a falling backlog as good news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/-12/)
    expect(chip).toHaveAttribute('data-tone', 'good')
    expect(chip.closest('.dt-delta')).toHaveTextContent('-12bettervs last month')
    expect(chip).not.toHaveAttribute('style')
  })

  it('reads a growing backlog as bad news', async () => {
    const growing = {
      ...overview,
      kpis: {
        ...overview.kpis,
        total_onair: kpi(100, 5),
        total_dt_done: kpi(40, 1),
        total_remaining: kpi(60, 4, 60),
        current_month_dt_done: kpi(6, 2),
      },
    }
    serve(planDelivery(), growing)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+4/)
    expect(chip).toHaveAttribute('data-tone', 'bad')
    expect(chip.nextElementSibling).toHaveClass('dt-sr-only')
    expect(chip.nextElementSibling).toHaveTextContent('worse')
  })

  it('still reads rising completions as good news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+12/)
    expect(chip).toHaveAttribute('data-tone', 'good')
    expect(chip.nextElementSibling).toHaveTextContent('better')
  })

  it('says nothing at all when there is no baseline to compare against', async () => {
    // It used to say "no baseline yet", once per tile and twice more in the
    // footer: five copies of one fact on the band a reader looks at most
    // often, which is how you teach somebody to skip a row. A month with no
    // snapshot behind it now simply has no delta on it.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(screen.queryByText(/no baseline/i)).not.toBeInTheDocument()
    expect(band.querySelectorAll('.dt-delta')).toHaveLength(0)
  })
})

describe('the KPI band', () => {
  /** A card by its title. */
  const card = (band, title) =>
    within(band).getByText(title, { selector: '.dt-kpi-title' }).closest('.dt-kpi-card')

  /** A part row of the pending card by its name. */
  const part = (band, name) =>
    within(band).getByText(name, { selector: '.dt-status-name' }).closest('.dt-status-row')

  it('leads with the three totals the programme is run on', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(card(band, 'On air')).getByText('100')).toBeInTheDocument()
    expect(within(card(band, 'DT done')).getByText('40')).toBeInTheDocument()
    expect(within(card(band, 'Pending')).getByText('60')).toBeInTheDocument()
    // DT done states its share beside the figure. The percentage is what is
    // drawn; what it is a share *of* stays in the accessible name, because a
    // bare percentage next to a count does not say which is its denominator.
    const pct = within(card(band, 'DT done')).getByText('40%')
    expect(pct).toHaveAttribute('aria-label', '40% of on-air')
  })

  it('names each card without repeating "Total" on three of them', async () => {
    // "Total" said three times across one row is three words a reader skips
    // on every visit. The figures are totals by position; the names say what
    // each one counts. Checked as whole labels, so "Pending" cannot be
    // satisfied by "Pending status".
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const titles = [...band.querySelectorAll('.dt-kpi-title')].map((t) => t.textContent)
    expect(titles).toEqual(['On air', 'DT done', 'Pending', 'Pending status'])
  })

  it('no longer leads with the overall progress rate or the four-state on-air bar', async () => {
    // Both were removed from this band and neither moved elsewhere on the
    // page. The rate moves a tenth of a point a month at the completion this
    // programme runs at, and the four-state bar drew three slivers against a
    // done segment that filled it. If either comes back it should come back
    // deliberately, not by a merge.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).queryByText('Overall Progress')).not.toBeInTheDocument()
    expect(band.querySelector('.dt-hero-denominator')).toBeNull()
    expect(within(band).queryAllByTestId('dt-hero-segment')).toHaveLength(0)
    expect(screen.queryByText('Overall Progress')).not.toBeInTheDocument()
  })

  it('breaks pending into three parts that sum to it', async () => {
    // The property this card exists to have. 50 ongoing + 10 problematic +
    // 0 not started = 60 pending, read back off the rendered rows rather
    // than off the fixture, so a card that stops reconciling fails here.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const values = ['Ongoing', 'Problematic', 'Not started'].map((name) =>
      Number(within(part(band, name)).getByText(/^\d+$/).textContent),
    )
    expect(values).toEqual([50, 10, 0])
    expect(values.reduce((a, b) => a + b, 0)).toBe(
      Number(within(card(band, 'Pending')).getByText('60').textContent),
    )
  })

  it('states each part as a share of pending, not of on-air', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(part(band, 'Ongoing').querySelector('.dt-status-pct')).toHaveTextContent('83%')
    expect(part(band, 'Problematic').querySelector('.dt-status-pct')).toHaveTextContent('17%')
    expect(part(band, 'Not started').querySelector('.dt-status-pct')).toHaveTextContent('0%')
  })

  it('gives the on-air card no bar, because it would always read full', async () => {
    // The bar this card used to carry measured on-air against on-air, so it
    // filled its track every time and moved for no input. A bar that cannot
    // report anything but 100% is decoration standing where information
    // should be.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(card(band, 'On air').querySelector('.dt-kpi-split')).toBeNull()
    // The three cards that do split something keep theirs.
    expect(card(band, 'DT done').querySelector('.dt-kpi-split')).not.toBeNull()
    expect(card(band, 'Pending').querySelector('.dt-kpi-split')).not.toBeNull()
  })

  it('mirrors the pending bar against the DT done bar', async () => {
    // The two are one split drawn across two cards, so their segments have
    // to be the same two ratios the other way round. Read off the rendered
    // widths rather than off the fixture: a card that starts computing its
    // own share instead of reusing the band's fails here.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const doneBar = card(band, 'DT done').querySelector('.dt-kpi-split')
    const pendingBar = card(band, 'Pending').querySelector('.dt-kpi-split')

    // One filled segment each, on the plain track: the rest of the bar is
    // the track itself, so the two widths are the same split both ways.
    expect(doneBar.querySelector('[data-seg="done"]')).toHaveStyle({ width: '40%' })
    expect(pendingBar.querySelector('[data-seg="pending"]')).toHaveStyle({ width: '60%' })
    expect(doneBar.querySelectorAll('[data-seg]')).toHaveLength(1)
    expect(pendingBar.querySelectorAll('[data-seg]')).toHaveLength(1)
    // The "done" series is the accent; pending is the darker neutral, not red.
    expect(doneBar.querySelector('[data-seg="done"]')).toHaveStyle({ background: 'var(--accent)' })
    expect(pendingBar.querySelector('[data-seg="pending"]')).toHaveStyle({
      background: 'var(--dt-pending-bar)',
    })
  })

  it('writes a month that did not move as a grey plus-or-minus zero', async () => {
    // The third state of the change chip. A flat month is neither good news
    // nor bad, so it takes the neutral rather than whichever colour the sign
    // would have implied -- see `format.deltaTone`, which returns null here
    // for exactly that reason.
    serve(planDelivery(), {
      ...overview,
      kpis: { ...overview.kpis, total_remaining: kpi(60, 0, 60) },
    })
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const chip = within(card(band, 'Pending')).getByText('\u00b10')
    expect(chip).toHaveAttribute('data-tone', 'flat')
    expect(chip.nextElementSibling).toHaveTextContent('no change')
  })

  it('stacks one segment per part that has sites', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const stack = within(band).getByRole('img', { name: /Pending status/ })
    expect(stack).toHaveAttribute(
      'aria-label',
      'Pending status: Ongoing 50, Problematic 10',
    )
    // Two segments. Not started is 0 in the fixture, so it is named in the
    // rows beneath but draws nothing — a zero-width segment is not drawn
    // rather than drawn at zero.
    expect(stack.querySelectorAll('[data-seg]')).toHaveLength(2)
  })

  it('stacks Not started as its own segment once it has sites', async () => {
    // The state this dashboard once folded into Ongoing. Unlike the band
    // this replaces — which left it to the neutral track because it was
    // splitting on-air — it is a first-class part of pending here, because
    // pending is exactly what it is part of.
    serve(planDelivery(), {
      ...overview,
      kpis: { ...overview.kpis, total_ongoing: kpi(38), total_not_started: kpi(12) },
    })
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const stack = within(band).getByRole('img', { name: /Pending status/ })
    expect(stack.querySelectorAll('[data-seg]')).toHaveLength(3)
    expect(within(part(band, 'Not started')).getByText('12')).toBeInTheDocument()
  })

  it('gives Not started no delta, because the snapshot has no baseline for it', async () => {
    // The donut legend items carry no delta chips of their own. Deltas
    // appear on the main KPI cards (on-air, DT done, pending) only.
    serve(planDelivery(), {
      ...overview,
      kpis: {
        ...overview.kpis,
        total_ongoing: kpi(38, -4),
        total_not_started: kpi(12),
      },
    })
    draw()

    const band = await screen.findByLabelText('Programme totals')
    // Neither donut legend part carries a delta chip.
    expect(part(band, 'Ongoing').querySelector('.dt-delta')).toBeNull()
    expect(part(band, 'Not started').querySelector('.dt-delta')).toBeNull()
  })

  it('shows 0% for every part when there is nothing pending', async () => {
    serve(planDelivery(), {
      ...overview,
      kpis: {
        ...overview.kpis,
        total_dt_done: kpi(100),
        total_remaining: kpi(0),
        total_ongoing: kpi(0),
        total_problematic: kpi(0),
      },
    })
    draw()

    const band = await screen.findByLabelText('Programme totals')
    for (const name of ['Ongoing', 'Problematic', 'Not started']) {
      expect(part(band, name).querySelector('.dt-status-pct')).toHaveTextContent('0%')
    }
  })

  it('draws no sparkline when the flow series is shorter than seven months', async () => {
    // Four months in the default fixture. A line drawn from four points is
    // mostly the accident of where the series starts, so the card draws
    // without one rather than drawing a shorter one.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).queryAllByTestId('dt-spark')).toHaveLength(0)
  })

  it('draws no sparklines even when the series is long enough, since the donut replaced them', async () => {
    // Sparklines were removed from the KPI band in the redesign: the flow
    // chart directly below draws the same series, larger, and the donut now
    // occupies the space the sparklines used.
    serve(planDelivery(), overview, trend(), flow({ months: longMonths() }))
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).queryAllByTestId('dt-spark')).toHaveLength(0)
  })

  it('has no sparklines in the band — the donut and flow chart replaced them', async () => {
    // The pending sparkline was removed with the rest of them. The flow
    // chart below draws the cumulative series and the donut shows the
    // pending split, so the band no longer needs its own trend line.
    serve(planDelivery(), overview, trend(), flow({ months: longMonths() }))
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).queryAllByTestId('dt-spark')).toHaveLength(0)
  })

  it('no longer repeats the monthly figure the plan section already carries', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).queryByText(/Done this month/i)).not.toBeInTheDocument()
  })

  it('makes a drillable part row reachable and visible by keyboard', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const row = part(band, 'Ongoing')
    // A real anchor, not a click handler on a div: it is in the tab order
    // without anything extra, and a screen reader announces it as a link.
    expect(row.tagName).toBe('A')
    row.focus()
    expect(row).toHaveFocus()
  })
})

describe('the order of the page', () => {
  it('asks its questions in order: where, which way, what was promised, what is left', async () => {
    // The Overview answers the first three -- the band, the trend, and the
    // month's two short answers beside it. What is left, the ongoing and
    // problematic detail, is the next tab along.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const headings = () =>
      screen
        .getAllByRole('heading')
        .map((h) => h.textContent)
        .filter((t) =>
          [
            'What moved',
            'PIP this month',
            'Ongoing breakdown',
            'Problematic breakdown',
            'Where this is going',
          ].includes(t),
        )

    const trend = await section('Where this is going')
    expect(band.compareDocumentPosition(trend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(headings()).toEqual(['Where this is going', 'PIP this month', 'What moved'])

    const tabs = screen.getAllByRole('tab', { name: /Overview|Breakdowns|Contractors/ })
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Overview',
      'Breakdowns',
      'Contractors & provinces',
    ])
    await userEvent.click(tabs[1])
    await section('Problematic breakdown')
    expect(headings()).toEqual(['Ongoing breakdown', 'Problematic breakdown'])
  })

  it('stacks PIP this month over What moved in the column beside the trend', async () => {
    serve()
    draw()

    const trend = await section('Where this is going')
    const moved = await section('What moved')
    const pip = await section('PIP this month')
    // One column, the two short cards together, PIP first, the trend in the
    // grid beside it -- not a full-width chart with a half-empty pair under it.
    expect(moved.parentElement).toBe(pip.parentElement)
    expect(moved.parentElement).toHaveClass('dt-stack')
    expect(pip.compareDocumentPosition(moved) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trend.parentElement).toBe(moved.parentElement.parentElement)
    expect(trend.parentElement).toHaveClass('dt-grid2')
  })
})

describe('drill-through', () => {
  // Table-driven, and the table mirrors the backend's parity test: every
  // figure the dashboard makes clickable appears here with the URL it must
  // produce. The two lists are the same list — one asserts that the count is
  // right, this one that the link asks for the right count.
  //
  // These used to point at `/work-items`, whose stage filter is not what this
  // dashboard counts: a CPM-flagged problematic site keeps its own stage and
  // was missing from the queue the number linked to, and the queue has no
  // on-air filter so an ongoing link opened sites the dashboard never
  // counted. Every figure now opens `/drive-test/sites`.
  const CASES = [
    {
      name: 'the on-air denominator',
      open: async () => await screen.findByLabelText('Programme totals'),
      // By its accessible name: the label sits beside the figure and only the
      // figure is the link.
      label: 'Total on-air: 100 sites',
      href: '/drive-test/sites?bucket=onair',
    },
    {
      name: 'the DT done card',
      open: async () => await screen.findByLabelText('Programme totals'),
      label: 'Total DT done: 40 sites',
      href: '/drive-test/sites?bucket=done',
    },
    {
      name: 'the pending card',
      open: async () => await screen.findByLabelText('Programme totals'),
      label: 'Total pending: 60 sites',
      href: '/drive-test/sites?bucket=remaining',
    },
    {
      name: 'the ongoing part of pending',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Ongoing',
      // The part rows are the band's other links, so a name is picked out by
      // its own class rather than matched by text alone.
      selector: '.dt-status-name',
      href: '/drive-test/sites?bucket=ongoing',
    },
    {
      name: 'the problematic part of pending',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Problematic',
      selector: '.dt-status-name',
      href: '/drive-test/sites?bucket=problematic',
    },
    {
      name: 'the not-started part of pending',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Not started',
      selector: '.dt-status-name',
      href: '/drive-test/sites?bucket=not_started',
    },
    {
      name: 'a problematic category',
      path: BREAKDOWNS,
      open: () => section('Problematic breakdown'),
      text: 'Power',
      href: '/drive-test/sites?bucket=problematic&category=Power',
    },
    {
      name: 'a problematic province',
      path: BREAKDOWNS,
      open: async () => {
        const card = await section('Problematic breakdown')
        await userEvent.click(within(card).getByRole('tab', { name: 'Province' }))
        return card
      },
      text: 'Kerman',
      href: '/drive-test/sites?bucket=problematic&province_id=7',
    },
    {
      name: 'an ongoing contractor',
      path: BREAKDOWNS,
      open: () => section('Ongoing breakdown'),
      text: 'Alfa Drive Tests',
      href: '/drive-test/sites?bucket=ongoing&contractor_id=1',
    },
    {
      name: 'an ongoing province',
      path: BREAKDOWNS,
      open: async () => {
        const card = await section('Ongoing breakdown')
        await userEvent.click(within(card).getByRole('tab', { name: 'Province' }))
        return card
      },
      text: 'Yazd',
      href: '/drive-test/sites?bucket=ongoing&province_id=9',
    },
    {
      name: 'an age band, by its key rather than its label',
      path: BREAKDOWNS,
      open: async () => {
        const card = await section('Ongoing breakdown')
        await userEvent.click(within(card).getByRole('tab', { name: 'How long' }))
        return card
      },
      text: '2–3 weeks',
      href: '/drive-test/sites?bucket=ongoing&age_band=w2_3',
    },
    {
      name: "a contractor's delivered count",
      // The scorecard is on the Contractors & provinces tab.
      path: TABLES,
      // The scorecard's Achieved cell, where the old card's contractor list
      // now lives. Beta delivered 2 of its 2.
      open: async () =>
        within(await section('Contractor scorecard'))
          .getByText('Beta Surveys')
          .closest('.dt-contractor-row')
          .querySelector('.dt-pip-achieved'),
      text: '2',
      href: '/drive-test/sites?bucket=delivered&contractor_id=2&year=1405&month=6',
    },
  ]

  it.each(CASES)('links $name to the sites behind it', async ({ open, text, label, href, selector, path }) => {
    serve()
    draw(path)

    const scope = await open()
    const link = label
      ? within(scope).getByRole('link', { name: label })
      : within(scope).getByText(text, selector ? { selector } : undefined).closest('a')
    expect(link).toHaveAttribute('href', href)
  })

  it('carries the province filter into the links it builds', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    const hero = await screen.findByLabelText('Programme totals')
    expect(
      within(hero).getByText('Problematic', { selector: '.dt-status-name' }).closest('a'),
    ).toHaveAttribute('href', '/drive-test/sites?bucket=problematic&province_id=7')
  })

  it('links every figure of a contractor row, the denominator included', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    for (const [text, href] of [
      // The assignment is what the rate divides by, so it is the figure a
      // contractor will want to check.
      ['55', '/drive-test/sites?bucket=assigned&contractor_id=1'],
      ['40', '/drive-test/sites?bucket=done&contractor_id=1'],
      ['15', '/drive-test/sites?bucket=ongoing&contractor_id=1'],
    ]) {
      expect(within(row).getByText(text).closest('a')).toHaveAttribute('href', href)
    }
  })

  it('links the unattributed row through contractor_id=none', async () => {
    // There is no contractor to name, and there is still a list: the sites
    // nobody holds are the ones most worth reading.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Unattributed').closest('.dt-contractor-row')
    expect(within(row).getByText('6').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=ongoing&contractor_id=none',
    )
  })

  it('links every figure of a province card', async () => {
    serve()
    draw(TABLES)

    const grid = await section('Drive Test progress by province')
    const card = within(grid).getByText('Kerman').closest('.dt-province-card')
    for (const [text, href] of [
      ['60', '/drive-test/sites?bucket=onair&province_id=7'],
      ['23', '/drive-test/sites?bucket=done&province_id=7'],
      ['37', '/drive-test/sites?bucket=remaining&province_id=7'],
      ['30', '/drive-test/sites?bucket=ongoing&province_id=7'],
      ['7', '/drive-test/sites?bucket=problematic&province_id=7'],
    ]) {
      expect(within(card).getByText(text).closest('a')).toHaveAttribute('href', href)
    }
  })

  it('leaves the flow chart and the flow ledger unlinked', async () => {
    // Both are aggregate figures over a month or a running total, not a
    // filtered list. There is no list of sites behind either one, and a link
    // that opened one would be answering a different question with the same
    // number.
    serve()
    draw()

    const flowCard = await section('Where this is going')
    const ledgerCard = await section('What moved')
    expect(within(flowCard).queryAllByRole('link')).toHaveLength(0)
    expect(within(ledgerCard).queryAllByRole('link')).toHaveLength(0)
  })

  it('gives a contractor no link out of the "Other contractors" bar', async () => {
    // That bar is several companies folded into one unnamed aggregate, so a
    // contractor's own figures still reconcile without naming a competitor.
    // There is no list behind it they are allowed to open.
    const contractorView = {
      ...overview,
      ongoing_breakdown: {
        ...overview.ongoing_breakdown,
        by_contractor: [
          { name: 'Alfa Drive Tests', value: 12 },
          { name: 'Other contractors', value: 6 },
        ],
      },
      contractor_scorecard: [
        {
          contractor_id: 1,
          name: 'Alfa Drive Tests',
          assigned: 55,
          done: 40,
          ongoing: 15,
          problematic: 5,
          not_started: 0,
          done_percent: 72.7,
        },
      ],
    }
    serve(planDelivery(), contractorView)
    draw(BREAKDOWNS)

    const card = await section('Ongoing breakdown')
    expect(within(card).getByText('Alfa Drive Tests').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=ongoing&contractor_id=1',
    )
    expect(within(card).getByText('Other contractors').closest('a')).toBeNull()
  })
})

describe('the toolbar', () => {
  it('offers no control that does nothing', async () => {
    // Saved Views, Vendor and Date range were buttons with no handler: they
    // looked like filters and did nothing. If one comes back it should come
    // back working, not as decoration that teaches a reader to distrust the
    // controls beside it.
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    for (const name of [/saved views/i, /vendor/i, /date range/i]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    // The ones that do work are still there.
    expect(screen.getByRole('button', { name: /^refresh$/i })).toHaveAttribute(
      'title',
      'Refresh the dashboard',
    )
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument()
  })
})

describe('the export button', () => {
  // A deliberate behaviour change: it used to download `/work-items/export`,
  // which is every work item in scope whether on-air or not. A reader pressed
  // Export on this dashboard and got a file whose row count matched no figure
  // on the page.
  it('downloads the DT delivery workbook for the current scope', async () => {
    // jsdom implements neither, and the download path calls both. Without the
    // stubs the handler throws on the first line after the request and the
    // assertion below would pass on a click that visibly failed.
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: planDelivery() })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      if (url === '/drive-test/export') {
        return Promise.resolve({
          data: new Blob(['x']),
          headers: { 'content-disposition': 'attachment; filename="dt-delivery-1405-06-25.xlsx"' },
        })
      }
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    draw('/reports/drive-test?province=7')

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByRole('button', { name: /^Export$/ }))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/export', {
        params: { province_id: 7 },
        responseType: 'blob',
      }),
    )
    // Never the old endpoint.
    expect(api.get).not.toHaveBeenCalledWith('/work-items/export', expect.anything())
    // And the file is saved under the name the server gave it.
    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(screen.queryByText('Export failed')).not.toBeInTheDocument()
  })

  it('says so instead of failing silently when the file cannot be built', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: planDelivery() })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      return Promise.reject(new Error('too big'))
    })
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByRole('button', { name: /^Export$/ }))

    expect(await screen.findByText('Export failed')).toBeInTheDocument()
  })
})

describe('failure and freshness', () => {
  it('says a section failed instead of quietly removing it', async () => {
    // The old page set the section's data to null and returned null from the
    // component, so a reader saw a shorter page and no reason to think
    // anything was missing.
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      return Promise.reject(new Error('boom'))
    })
    draw()

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    const card = await section('PIP this month')
    expect(await within(card).findByText(/Couldn’t load PIP this month/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('retries just the failed section without a page reload', async () => {
    let attempt = 0
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      if (url === '/drive-test/flow') return Promise.resolve({ data: flow() })
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: planDelivery() })
    })
    draw()

    const card = await section('PIP this month')
    await userEvent.click(await within(card).findByRole('button', { name: /Retry/ }))
    expect(
      await within(card).findByText(/3 of 4 contractors have an approved PIP/),
    ).toBeInTheDocument()
  })

  it('says how old the figures are instead of calling them live', async () => {
    serve()
    draw()

    expect(await screen.findByText(/Updated just now/)).toBeInTheDocument()
  })

  it('keeps the page standing when the whole overview fails', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.reject(new Error('boom'))
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      if (url === '/drive-test/flow') return Promise.resolve({ data: flow() })
      return Promise.resolve({ data: planDelivery() })
    })
    draw()

    expect(await screen.findByText(/Could not load the Drive Test figures/)).toBeInTheDocument()
    // PIP this month comes from a different request and is unaffected.
    expect(await screen.findByText(/3 of 4 contractors have an approved PIP/)).toBeInTheDocument()
  })

  it('leaves the rest of the dashboard standing when a breakdown is absent', async () => {
    // An older backend, or a payload that lost these fields: the sections
    // that cannot be drawn are simply not drawn.
    const older = { ...overview }
    delete older.ongoing_breakdown
    delete older.problematic_breakdown
    delete older.province_breakdown
    delete older.contractor_scorecard
    serve(planDelivery(), older)
    draw()

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Ongoing breakdown')).not.toBeInTheDocument())
    expect(screen.queryByText('Province breakdown')).not.toBeInTheDocument()
    // The band above them is untouched by their absence.
    expect(screen.getByLabelText('Programme totals')).toBeInTheDocument()
  })
})

describe('the province filter', () => {
  it('asks the backend for the province in the URL', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', {
        params: { province_id: 7 },
      }),
    )
  })

  it('names the province it has been narrowed to', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    // By the scope chip on the title row: the page has no subtitle.
    const chip = (await screen.findByRole('button', { name: /not just Kerman/ })).closest(
      '.dt-scope-chip',
    )
    expect(chip).toHaveTextContent('Kerman')
  })

  it('narrows from a province row, which is where a reader knows which one', async () => {
    // The dropdown this replaces asked for a province before the reader had
    // seen anything to pick one by. This is the same scope, entered from the
    // row they just read.
    serve()
    draw(TABLES)

    const card = await section('Drive Test progress by province')
    await userEvent.click(
      within(card).getByRole('button', { name: /Narrow the whole dashboard to Kerman/ }),
    )

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', {
        params: { province_id: 7 },
      }),
    )
  })

  it('says which province it is showing, and offers a way out of it', async () => {
    // Load-bearing. Without the chip a reader who narrowed from a table row
    // would be in a scoped dashboard with no control anywhere on the page to
    // leave it -- a filter you can enter and not exit.
    serve()
    draw('/reports/drive-test?province=7')

    const chip = await screen.findByRole('button', {
      name: /Show every province again, not just Kerman/,
    })
    await userEvent.click(chip)

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', { params: {} }),
    )
  })

  it('keeps the way out when the province list never arrives', async () => {
    // The chip is keyed on the scope, not on the province's name. The name is
    // looked up in the overview payload; if that request fails, the list is
    // empty and the name is undefined while the URL is still narrowed. Hiding
    // the chip then strands the reader in a scoped dashboard whose every retry
    // stays scoped — the exact trap the chip exists to close.
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.reject(new Error('down'))
      if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: planDelivery() })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    draw('/reports/drive-test?province=7')

    const out = await screen.findByRole('button', { name: /Show every province again/ })
    // Named by id, since the name is exactly what could not be fetched.
    expect(screen.getByText('Province 7')).toBeInTheDocument()

    await userEvent.click(out)
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', { params: {} }),
    )
  })

  it('warns that the PIP card is unnarrowed even when the province is unnamed', async () => {
    // The warning matters most when things are going wrong, so it cannot
    // depend on the same payload that is failing.
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.reject(new Error('down'))
      if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: planDelivery() })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    draw('/reports/drive-test?province=7')

    const card = await section('PIP this month')
    expect(
      within(card).getByText(/committed per contractor for the whole programme/),
    ).toBeInTheDocument()
  })

  it('shows no scope chip when nothing is narrowed', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    // Un-narrowed, the header says nothing about scope: the old "All
    // provinces" label did nothing and is gone.
    expect(screen.queryByText('All provinces')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Show every province again/ }),
    ).not.toBeInTheDocument()
  })

  it('says the PIP card is not narrowed, because it cannot be', async () => {
    // A PIP is a commitment a contractor makes for a month and carries no
    // province, so scoping the delivery half alone would divide one
    // province's actual by the whole programme's commitment.
    serve()
    draw('/reports/drive-test?province=7')

    const card = await section('PIP this month')
    expect(
      within(card).getByText(/committed per contractor for the whole programme/),
    ).toBeInTheDocument()
  })

  it('does not carry that warning when the whole programme is on screen', async () => {
    serve()
    draw()

    const card = await section('PIP this month')
    expect(
      within(card).queryByText(/committed per contractor for the whole programme/),
    ).not.toBeInTheDocument()
  })
})

/** The running totals the chart ends on, as its accessible label states
 * them. The card no longer carries a figures row: the chart's label is the
 * one place it states them. */
function chartTotals(card) {
  const label = card.querySelector('.dt-flowchart').getAttribute('aria-label')
  const [, onAir, dtDone, gap] = label.match(/On air (\d+), DT done (\d+), gap (\d+)/)
  return { onAir: Number(onAir), dtDone: Number(dtDone), gap: Number(gap) }
}

/** The month table's Gap change cells, as they read (the sign and the
 * figure, without the words for a screen reader). */
const gapChanges = (card) =>
  within(card)
    .getAllByTestId('dt-flow-net')
    .map((td) => td.firstChild.textContent)

/** A figure as a number: a real minus sign or a hyphen, commas dropped. */
const num = (t) => Number(String(t).replace('−', '-').replace(/,/g, ''))

/** The month names under the plot, as they read. */
const monthLabels = (card) => within(card).getAllByTestId('dt-flow-month').map((m) => m.textContent)

/** Hover month `j` of the chart and read its hover card: each row's
 * [this month, cumulative], as the figures read. */
async function hoverMonth(card, j) {
  await userEvent.hover(card.querySelectorAll('.dt-flow-hit')[j])
  return readTip(card)
}

function readTip(card) {
  const tip = within(card).getByTestId('dt-flow-tip')
  const row = (name) =>
    [...within(tip).getByRole('rowheader', { name }).closest('tr').querySelectorAll('td')].map(
      (td) => td.firstChild.textContent,
    )
  return { tip, onAir: row('On air'), dtDone: row('DT done'), gap: row('Gap') }
}

describe('the flow chart', () => {
  // Replaces the old trailing-month trend chart in "Where this is going",
  // which used to read `/trend` and carried a 6m/12m window picker. Neither
  // applies any more: this card now reads its own endpoint, `/drive-test/flow`,
  // and reads two ways -- cumulative or one year -- rather than over a
  // sliding window.
  it('draws the chart from the cumulative totals by default', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    // Opening 50/20, plus the 3 not-placed on-air sites that belong to no
    // month and so open with the chart, plus four months of on-aired/dt_done:
    // 53 + 27 on-aired, 20 + 15 done. The chart has to end where the KPI
    // cards above it read, and the cards count not-placed sites too.
    expect(chartTotals(card)).toEqual({ onAir: 80, dtDone: 35, gap: 45 })

    // No window picker -- gone with the chart it belonged to.
    expect(screen.queryByRole('button', { name: '6m' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '12m' })).not.toBeInTheDocument()
    expect(within(card).queryAllByRole('link')).toHaveLength(0)
  })

  it('the latest year draws the real running totals, not a restarted count', async () => {
    // The view this replaces once restarted both counts at zero for a year,
    // which drew a year that tested more than it put on air as coverage over
    // 100%. The lines carry the running total from 1404 instead.
    serve()
    draw()

    const card = await section('Where this is going')
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))

    // Real totals at the end of 1405: 80 on air, 35 done, a gap of 45.
    expect(chartTotals(card)).toEqual({ onAir: 80, dtDone: 35, gap: 45 })
    // One column per month of 1405, not 1404's too.
    expect(gapChanges(card)).toEqual(['+2', '+2'])
    expect(
      within(card).getByText(/Showing 1405, month by month\. The lines are the programme’s running totals/),
    ).toBeInTheDocument()
  })

  it('shows a past year on its own months, ending on that year, not today', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    await userEvent.click(within(card).getByRole('button', { name: '1404' }))

    // End of 1404: 53 + 10 + 8 on air, 20 + 4 + 6 done. 1404 is the payload's
    // first year, so this is also everything from the opening balance --
    // there is nothing before it to keep.
    expect(chartTotals(card)).toEqual({ onAir: 71, dtDone: 30, gap: 41 })
    // 1404's own months: two columns, not four.
    expect(gapChanges(card)).toEqual(['+6', '+2'])
  })

  it('puts one period switch in the card header: Cumulative, then each year', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    const header = card.querySelector('.dt-section-head')
    const period = within(header).getByRole('group', { name: 'Chart period' })
    const options = within(period).getAllByRole('button')
    // The years come from the payload, oldest first, after Cumulative.
    expect(options.map((b) => b.textContent)).toEqual(['Cumulative', '1404', '1405'])
    const pressed = () => options.filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(pressed().map((b) => b.textContent)).toEqual(['Cumulative'])

    // One click per view, one option pressed at a time, and each year
    // redraws on that year's months only.
    await userEvent.click(options[1])
    expect(pressed().map((b) => b.textContent)).toEqual(['1404'])
    expect(gapChanges(card)).toHaveLength(2)
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))
    expect(
      within(card)
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent),
    ).toEqual(['1405'])
    expect(gapChanges(card)).toEqual(['+2', '+2'])
    await userEvent.click(within(card).getByRole('button', { name: 'Cumulative' }))
    expect(gapChanges(card)).toHaveLength(4)
  })

  it('offers a year that arrives in the data without a code change', async () => {
    serve(planDelivery(), overview, trend(), flow({
      months: [...flow().months, flowMonth(1406, 1, { on_aired: 1, dt_done: 1, is_open: true })],
    }))
    draw()

    const card = await section('Where this is going')
    const period = within(card).getByRole('group', { name: 'Chart period' })
    expect(within(period).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Cumulative',
      '1404',
      '1405',
      '1406',
    ])
  })

  it('carries no figures row and no readout, and its key sits on a row of its own', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    expect(card.querySelector('.dt-flowtiles')).toBeNull()
    expect(within(card).queryByTestId('dt-flow-readout')).toBeNull()
    expect(within(card).queryByText(/Running:/)).toBeNull()
    // The key is directly under the title row, not in it.
    const header = card.querySelector('.dt-section-head')
    const key = within(card).getByRole('list', { name: 'Chart key' })
    expect(header.contains(key)).toBe(false)
    expect(header.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(key.compareDocumentPosition(card.querySelector('.dt-flowchart')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(key).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'On air',
      'DT done',
      'Gap',
      'Month in progress',
      '−Gap shrank',
      '+Gap grew',
    ])
    // The title row: the info button, then the period switch on the right.
    const info = within(header).getByRole('button', { name: 'How this chart is drawn' })
    const period = within(header).getByRole('group', { name: 'Chart period' })
    expect(info.compareDocumentPosition(period) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps every DT done point inside the plot when DT done is above On air', async () => {
    // The scale is fitted to both lines: a year that cleared more than it
    // brought on air must not push DT done off the top of the plot.
    serve(planDelivery(), overview, trend(), flow({
      opening: { on_air: 100, dt_done: 90 },
      months: [
        flowMonth(1404, 1, { on_aired: 5, dt_done: 40 }),
        flowMonth(1404, 2, { on_aired: 5, dt_done: 60 }),
        flowMonth(1405, 1, { on_aired: 2, dt_done: 30, is_open: true }),
      ],
      not_placed: { on_air: 0, dt_done: 0 },
    }))
    draw()

    const card = await section('Where this is going')
    for (const view of ['1404', '1405', 'Cumulative']) {
      await userEvent.click(within(card).getByRole('button', { name: view }))
      const dots = [
        ...within(card).queryAllByTestId('dt-flow-dot'),
        ...within(card).queryAllByTestId('dt-flow-open-dot'),
      ]
      expect(dots.length).toBeGreaterThan(0)
      for (const dot of dots) {
        const top = parseFloat(dot.style.top)
        expect(top, view).toBeGreaterThanOrEqual(0)
        expect(top, view).toBeLessThanOrEqual(100)
      }
    }
  })

  it('draws a dot at every month, hollow for the month in progress', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    // Cumulative draws all four months, the last still open: three filled
    // dots per series, one hollow.
    expect(within(card).getAllByTestId('dt-flow-dot')).toHaveLength(6)
    expect(within(card).getAllByTestId('dt-flow-open-dot')).toHaveLength(2)
  })

  it('names every month under the plot, with the year and the month in progress', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    // Cumulative: every month, the open one marked.
    expect(monthLabels(card)).toEqual(['فروردین', 'اردیبهشت', 'فروردین', 'اردیبهشت'])
    expect(within(card).getAllByTestId('dt-flow-month')[3]).toHaveClass('is-open')
    expect(gapChanges(card)).toEqual(['+6', '+2', '+2', '+2'])
    // No per-month figures under the plot: they are in the hover card.
    expect(within(card).queryByTestId('dt-flow-table')).toBeNull()
    expect(within(card).queryByText('New on air')).toBeNull()
  })

  it("matches the KPI cards and What moved in the last column, for both years", async () => {
    // One programme, told three ways. The fixture is consistent across the
    // three endpoints -- as the backend's own parity tests require -- so a
    // column that drifted from the cards would be a bug on this side.
    //
    // 60 on air and 10 done before 1404; 1404 adds 36 and 16; 1405 is quiet
    // until Shahrivar, which is still open with 4 on air and 14 done. Totals:
    // 100 on air, 40 done, 60 pending -- the overview's cards -- and Shahrivar
    // opened on a gap of 70 and closes on 60 -- What moved's ledger.
    const months = [
      flowMonth(1404, 1, { on_aired: 20, dt_done: 10 }),
      flowMonth(1404, 2, { on_aired: 16, dt_done: 6 }),
      ...[1, 2, 3, 4, 5].map((m) => flowMonth(1405, m)),
      flowMonth(1405, 6, { on_aired: 4, dt_done: 14, is_open: true }),
    ]
    const withDeltas = {
      ...overview,
      kpis: {
        ...overview.kpis,
        total_onair: { ...overview.kpis.total_onair, delta: 4 },
        total_dt_done: { ...overview.kpis.total_dt_done, delta: 14 },
        total_remaining: { ...overview.kpis.total_remaining, delta: -10 },
      },
    }
    serve(
      planDelivery(),
      withDeltas,
      trend(),
      flow({ opening: { on_air: 60, dt_done: 10 }, months, not_placed: { on_air: 0, dt_done: 0 } }),
    )
    draw()

    const card = await section('Where this is going')
    const moved = await section('What moved')
    const band = await screen.findByLabelText('Programme totals')
    const cardFigure = (kpi) => band.querySelector(`[data-kpi="${kpi}"] .dt-kpi-figure`).textContent
    const cardDelta = (kpi) => band.querySelector(`[data-kpi="${kpi}"] .dt-delta-pill b`).textContent

    // 1405: the lines end on the cards' totals, and the last column is the
    // month the cards' deltas and What moved describe.
    expect(chartTotals(card)).toEqual({
      onAir: Number(cardFigure('onair')),
      dtDone: Number(cardFigure('done')),
      gap: Number(cardFigure('pending')),
    })
    expect(monthLabels(card).at(-1)).toBe(trend().latest_flows.label)
    const n = monthLabels(card).length
    let tip = await hoverMonth(card, n - 1)
    // This month's figures are the cards' deltas; the running ones, the
    // cards' totals.
    expect(num(tip.onAir[0])).toBe(num(cardDelta('onair')))
    expect(num(tip.dtDone[0])).toBe(num(cardDelta('done')))
    expect(num(tip.gap[0])).toBe(num(cardDelta('pending')))
    expect(num(tip.onAir[1])).toBe(num(cardFigure('onair')))
    expect(num(tip.dtDone[1])).toBe(num(cardFigure('done')))
    expect(num(tip.gap[1])).toBe(num(cardFigure('pending')))
    expect(within(moved).getByText(`+${tip.onAir[0]}`)).toBeInTheDocument()
    expect(within(moved).getByText(`−${tip.dtDone[0]}`)).toBeInTheDocument()
    // The last closed month's running gap is the gap the band showed before
    // this month's change: pending minus its month delta -- the 70 What
    // moved opens on.
    tip = await hoverMonth(card, n - 2)
    expect(num(tip.gap[1])).toBe(num(cardFigure('pending')) - num(cardDelta('pending')))
    expect(num(tip.gap[1])).toBe(70)

    // 1404: its last column is Esfand's own movement, and where the year
    // closed is where 1405 picked up -- the lines carry, they do not reset.
    // Its closing totals plus every 1405 column are the cards' totals.
    await userEvent.click(within(card).getByRole('button', { name: '1404' }))
    const closed1404 = chartTotals(card)
    tip = await hoverMonth(card, 1)
    expect(tip.onAir[0]).toBe('16')
    expect(tip.dtDone[0]).toBe('6')
    expect(tip.gap[0]).toBe('+10')
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))
    const sums = { onAir: 0, dtDone: 0, gap: 0 }
    for (let j = 0; j < monthLabels(card).length; j += 1) {
      tip = await hoverMonth(card, j)
      for (const k of Object.keys(sums)) sums[k] += num(tip[k][0])
    }
    expect(closed1404.onAir + sums.onAir).toBe(Number(cardFigure('onair')))
    expect(closed1404.dtDone + sums.dtDone).toBe(Number(cardFigure('done')))
    expect(closed1404.gap + sums.gap).toBe(Number(cardFigure('pending')))
  })

  it('shows a month\'s figures in a card pinned to the plot when the month is hovered', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    const tipEl = within(card).getByTestId('dt-flow-tip')
    expect(tipEl).not.toHaveClass('is-on')
    expect(tipEl).toBeEmptyDOMElement()

    // Cumulative, Ordibehesht 1404: 8 on air and 6 done that month; running
    // 53 + 10 + 8 = 71 on air, 20 + 4 + 6 = 30 done, a gap of 41, +2.
    const tip = await hoverMonth(card, 1)
    expect(tip.tip).toHaveClass('is-on')
    expect(tip.tip.querySelector('.dt-flow-tip-month')).toHaveTextContent('اردیبهشت')
    expect(tip.tip.querySelector('.dt-flow-tip-year')).toHaveTextContent('1404')
    expect(within(tip.tip).queryByText('In progress')).toBeNull()
    expect(
      within(tip.tip).getAllByRole('columnheader').map((th) => th.textContent),
    ).toEqual(['This month', 'Cumulative'])
    expect(tip).toMatchObject({ onAir: ['8', '71'], dtDone: ['6', '30'], gap: ['+2', '41'] })

    // The hovered month is marked: its column, its two dots, its label.
    expect(within(card).getByTestId('dt-flow-hovercol')).toBeInTheDocument()
    expect(card.querySelectorAll('.dt-flow-dot.is-active')).toHaveLength(2)
    expect(within(card).getAllByTestId('dt-flow-month')[1]).toHaveClass('is-active')

    // The open month says so.
    const open = await hoverMonth(card, 3)
    expect(within(open.tip).getByText('In progress')).toBeInTheDocument()
    expect(open).toMatchObject({ onAir: ['4', '80'], dtDone: ['2', '35'], gap: ['+2', '45'] })

    // Leaving the chart puts everything back.
    await userEvent.unhover(card.querySelectorAll('.dt-flow-hit')[3])
    await userEvent.unhover(card.querySelector('.dt-flow-frame'))
    expect(within(card).getByTestId('dt-flow-tip')).not.toHaveClass('is-on')
    expect(within(card).queryByTestId('dt-flow-hovercol')).toBeNull()
    expect(card.querySelectorAll('.dt-flow-dot.is-active')).toHaveLength(0)
  })

  it('shows the same card when a month takes the keyboard focus', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    const hits = card.querySelectorAll('.dt-flow-hit')
    expect(hits[0]).toHaveAccessibleName('فروردین 1404')
    act(() => hits[2].focus())
    const tip = readTip(card)
    expect(tip.tip).toHaveClass('is-on')
    expect(tip).toMatchObject({ onAir: ['5', '76'], dtDone: ['3', '33'], gap: ['+2', '43'] })
    // Still "Cumulative" in a year view: the lines carry the running total.
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))
    act(() => card.querySelectorAll('.dt-flow-hit')[0].focus())
    expect(
      within(readTip(card).tip).getAllByRole('columnheader').map((th) => th.textContent),
    ).toEqual(['This month', 'Cumulative'])
    expect(readTip(card)).toMatchObject({ onAir: ['5', '76'], gap: ['+2', '43'] })
  })

  it('colours the hover card\'s gap change by its direction, with a real minus sign', async () => {
    serve(planDelivery(), overview, trend(), flow({
      months: [
        flowMonth(1404, 1, { on_aired: 10, dt_done: 4 }),   // +6, grew
        flowMonth(1404, 2, { on_aired: 3, dt_done: 20 }),   // -17, shrank
        flowMonth(1404, 3, { on_aired: 5, dt_done: 5 }),    // 0, flat
      ],
      not_placed: { on_air: 0, dt_done: 0 },
    }))
    draw()

    const card = await section('Where this is going')
    const gapCell = (tip) => within(tip.tip).getByRole('rowheader', { name: 'Gap' }).nextElementSibling
    let tip = await hoverMonth(card, 0)
    expect(tip.gap[0]).toBe('+6')
    expect(gapCell(tip)).toHaveAttribute('data-tone', 'bad')
    tip = await hoverMonth(card, 1)
    expect(tip.gap[0]).toBe('−17')
    expect(gapCell(tip)).toHaveAttribute('data-tone', 'good')
    tip = await hoverMonth(card, 2)
    expect(tip.gap[0]).toBe('0')
    expect(gapCell(tip)).toHaveAttribute('data-tone', 'flat')
  })

  it('writes a negative running gap with a real minus sign', async () => {
    serve(planDelivery(), overview, trend(), flow({
      opening: { on_air: 10, dt_done: 30 },
      months: [flowMonth(1404, 1, { on_aired: 1, dt_done: 1 })],
      not_placed: { on_air: 0, dt_done: 0 },
    }))
    draw()

    const card = await section('Where this is going')
    const tip = await hoverMonth(card, 0)
    expect(tip.gap[1]).toBe('−20')
  })

  it("keeps the chart's notes behind the header's info icon, not under the chart", async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    expect(card.querySelector('.dt-flowcard .dt-note')).toBeNull()
    expect(within(card).getByText(/^Showing every month since Farvardin 1404\./)).not.toBeVisible()
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))
    const note = within(card).getByText(
      /Showing 1405, month by month/,
    )
    // 1405's lines run 30..80, fitted on steps of 20 from 20: the axis does
    // not start at zero, and the note says so.
    expect(note).toHaveTextContent('The scale starts at 20, not zero.')
    expect(note).not.toBeVisible()

    await userEvent.click(within(card).getByRole('button', { name: 'How this chart is drawn' }))
    expect(note).toBeVisible()
  })

  it('foots each month with what it did to the backlog', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    // One per month drawn: all four in the cumulative view. 10 on air
    // against 4 done is +6 pending; 8 against 6, 5 against 3 and 4 against
    // 2 are +2 each.
    expect(gapChanges(card)).toEqual(['+6', '+2', '+2', '+2'])
    // All grew the backlog, so all are the bad tone.
    expect(
      within(card)
        .getAllByTestId('dt-flow-net')
        .map((p) => p.getAttribute('data-tone')),
    ).toEqual(['bad', 'bad', 'bad', 'bad'])
  })

  it('colours a month green when the backlog shrank and brick when it grew', async () => {
    serve(planDelivery(), overview, trend(), flow({
      months: [
        flowMonth(1404, 1, { on_aired: 10, dt_done: 4 }),   // +6, grew
        flowMonth(1404, 2, { on_aired: 3, dt_done: 20 }),   // -17, shrank
        flowMonth(1404, 3, { on_aired: 5, dt_done: 5 }),    // 0, flat
      ],
    }))
    draw()

    const card = await section('Where this is going')
    const cells = within(card).getAllByTestId('dt-flow-net')
    expect(cells.map((p) => p.getAttribute('data-tone'))).toEqual(['bad', 'good', 'flat'])
    expect(gapChanges(card)).toEqual(['+6', '-17', '0'])
  })

  it('adds the month table up to the movement in the gap across the year', async () => {
    // The parity that makes the table trustworthy: read the rendered Gap
    // change cells, sum them, and check the total against the gap the chart
    // itself ends on. A table that stops summing to its own chart is worse
    // than no table.
    serve()
    draw()

    const card = await section('Where this is going')
    const sum = gapChanges(card).reduce((total, v) => total + Number(v), 0)

    // Cumulative opens on the opening balance plus the undated sites: 53 on
    // air, 20 done, a gap of 33. The chart ends on 45, so the columns must
    // add up to 12.
    expect(sum).toBe(chartTotals(card).gap - 33)
    expect(sum).toBe(12)

    // And a year on its own: 1405 opened on the gap 1404 closed on (71 on
    // air, 30 done, 41), so its columns add up to 4.
    await userEvent.click(within(card).getByRole('button', { name: '1405' }))
    expect(gapChanges(card).reduce((total, v) => total + Number(v), 0)).toBe(4)
  })

  it('marks the open month as still in progress', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    // Both series end on the month `flow()` marks `is_open`, so both get the
    // hollow open-end treatment rather than a solid closed dot.
    expect(within(card).getAllByTestId('dt-flow-open-dot')).toHaveLength(2)
  })

  it('asks the backend for the province in scope', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/flow', {
        params: { province_id: 7 },
      }),
    )
  })

  it('says there is nothing to show rather than drawing an empty chart', async () => {
    serve(planDelivery(), overview, trend(), {
      opening: { on_air: 0, dt_done: 0 },
      months: [flowMonth(1404, 1)],
      not_placed: { on_air: 0, dt_done: 0 },
      province_id: null,
    })
    draw()

    const card = await section('Where this is going')
    expect(
      within(card).getByText(/No on-air or drive-test activity has been recorded yet/),
    ).toBeInTheDocument()
  })

  it('foots the count of sites with no date to place them', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    expect(
      within(card).getByText(
        /3 sites have no date to place them on the timeline, so they sit in the opening balance/,
      ),
    ).toBeInTheDocument()
  })

  it('counts sites whose drive test has no date, not just their on-air date', async () => {
    // The bug this guards: the chart built its running totals from opening +
    // months only, so the backend's not-placed bucket fell out of all four
    // figures, and the footnote that should have disclosed it was driven by the
    // on-air side alone -- silent in exactly the case that reached production,
    // where the undated sites were on the DT-done side. Its DT done and Gap
    // therefore disagreed with the KPI cards directly above it.
    serve(planDelivery(), overview, trend(), flow({ not_placed: { on_air: 0, dt_done: 7 } }))
    draw()

    const card = await section('Where this is going')
    // Opening 50/20 and four months of 27/15, with the 7 undated drive tests
    // on the done side: 77 on air, 20 + 15 + 7 done, so the gap is 7 smaller
    // than the 42 it would be with them dropped.
    expect(chartTotals(card)).toEqual({ onAir: 77, dtDone: 42, gap: 35 })
    expect(
      within(card).getByText(
        /7 sites have no date to place them on the timeline, so they sit in the opening balance/,
      ),
    ).toBeInTheDocument()
  })
})

describe('the trend section', () => {
  it('shows the month ledger, and that it closes', async () => {
    serve()
    draw()

    const card = await section('What moved')
    // 70 opened + 4 arrived - 14 completed = 60 closed.
    expect(within(card).getByText('70')).toBeInTheDocument()
    expect(within(card).getByText('+4')).toBeInTheDocument()
    expect(within(card).getByText('−14')).toBeInTheDocument()
    expect(within(card).getByText('60')).toBeInTheDocument()
  })

  it('closes: opening plus new on air minus drive tests done is the closing bar', async () => {
    // The property the waterfall exists to make visible, read back off the
    // rendered bars rather than off the fixture. `opening + arrivals -
    // completions == closing` holds by construction in
    // services/snapshots.reconcile, so a chart that stops showing it is the
    // chart being wrong, not the ledger.
    serve()
    draw()

    const card = await section('What moved')
    // Magnitudes: the direction of each step is carried by which step it is
    // ("New on air" rises, "Drive tests done" falls), and the +/− on the
    // label is there to say so to a reader. Signing the numbers here too
    // would subtract a negative and pass on a ledger that does not close.
    const figureOf = (step) =>
      Number(
        card
          .querySelector(`[data-step="${step}"] .dt-flow-figure-text`)
          .textContent.replace(/[^0-9]/g, ''),
      )

    const opening = figureOf('opening')
    const arrived = figureOf('arrived')
    const completed = figureOf('completed')
    const closing = figureOf('closing')

    expect(opening + arrived - completed).toBe(closing)
    expect([opening, arrived, completed, closing]).toEqual([70, 4, 14, 60])
  })

  it('names each step under its own bar, and chains them with connectors', async () => {
    serve()
    draw()

    const card = await section('What moved')
    expect(
      within(card)
        .getAllByTestId('dt-flow-bar')
        .map((g) => g.querySelector('.dt-flow-step-label').textContent),
    ).toEqual(['Opened at', 'New on air', 'Drive tests done', 'Closed at'])

    // One connector between each adjacent pair: a break in the chain is a
    // break in the ledger.
    expect(within(card).getAllByTestId('dt-flow-connector')).toHaveLength(3)
  })

  it('carries the month\'s net movement in the card header', async () => {
    serve()
    draw()

    const card = await section('What moved')
    const header = card.querySelector('.dt-section-total')
    // 60 closed against 70 opened: the backlog fell by 10, which is the good
    // direction. The figure is ink; the direction is in data-tone and words.
    expect(header).toHaveTextContent('-10')
    expect(header.querySelector('b')).toHaveAttribute('data-tone', 'good')
    expect(header.querySelector('b')).not.toHaveAttribute('style')
    expect(header.querySelector('.dt-sr-only')).toHaveTextContent('better')
  })

  it('says which flows are measured and which are derived, behind its info icon', async () => {
    // Moved off the card into the icon, which is a toggletip rather than a
    // hover tooltip: hover does not exist on a tablet, and this note is the
    // only place the chart says which of its four numbers are estimates.
    serve()
    draw()

    const card = await section('What moved')
    const note = within(card).getByText(/Arrivals are derived from the/)
    expect(note).not.toBeVisible()

    await userEvent.click(within(card).getByRole('button', { name: /how what moved is counted/i }))
    expect(note).toBeVisible()

    await userEvent.keyboard('{Escape}')
    expect(note).not.toBeVisible()
  })

  it('closes the note on a press anywhere else', async () => {
    serve()
    draw()

    const card = await section('What moved')
    const button = within(card).getByRole('button', { name: /how what moved is counted/i })
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')

    // Moving off it does not close a note that was opened on purpose -- only
    // hover-opened ones follow the pointer. (The unhover is explicit because
    // user-event sends no pointer-out when moving to the button's own
    // ancestor, which a real pointer leaving the icon always does.)
    await userEvent.unhover(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(document.body)
    expect(button).toHaveAttribute('aria-expanded', 'false')
  })

  it('states the floor the bars are drawn from, since it is not zero', async () => {
    // The footer that used to carry this is gone with the stat row, which
    // repeated figures the bars already print. The floor is the one thing
    // from it that the bars cannot say for themselves, so it moved into the
    // note -- computed by the same `flowScale` the bars are drawn with.
    // 70 -> 74 -> 60: padded by 35% of the 14 span and rounded, 55.
    serve()
    draw()

    const card = await section('What moved')
    expect(card.querySelector('.dt-flow-foot')).toBeNull()
    expect(within(card).getByText(/The scale starts at 55, not zero/)).toBeInTheDocument()
  })

  it('hides the ledger when no month has one', async () => {
    serve(planDelivery(), overview, trend({ latest_flows: null }))
    draw()

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    await waitFor(() => expect(screen.queryByText('What moved')).not.toBeInTheDocument())
  })
})

describe('PIP this month', () => {
  const tile = (card, label) =>
    within(card).getByText(label, { selector: 'dt' }).closest('.dt-pip-tile')

  it('states plan, assigned, remaining and achieved, in that order, from the payload', async () => {
    // 16 planned, 9 assigned, 6 delivered. Remaining is the old card's
    // "Short by", arithmetic unchanged: 16 - 6 = 10.
    serve()
    draw()

    const card = await section('PIP this month')
    const labels = [...card.querySelectorAll('.dt-pip-tile dt')].map((d) => d.textContent)
    expect(labels).toEqual(['Plan', 'Assigned', 'Remaining', 'Achieved'])
    expect(within(tile(card, 'Plan')).getByText('16')).toBeInTheDocument()
    expect(within(tile(card, 'Assigned')).getByText('9')).toBeInTheDocument()
    expect(within(tile(card, 'Remaining')).getByText('10')).toBeInTheDocument()
    expect(within(tile(card, 'Achieved')).getByText('6')).toBeInTheDocument()
  })

  it('is short by nothing, not by a negative, when delivery overshot the plan', async () => {
    serve(planDelivery({ pip: 4, actual: 6, achievement_percent: 150 }))
    draw()

    const card = await section('PIP this month')
    expect(within(tile(card, 'Remaining')).getByText('0')).toBeInTheDocument()
  })

  it('reads a month with nothing committed as nothing committed, not as a failure', async () => {
    // No approved PIP: the figures go to the softest ink, Remaining is a
    // dash because there is nothing to be short of, there is no rate to pace,
    // and the sentence says which of the two a zero here means.
    serve(
      planDelivery({
        pip: 0,
        assigned: 0,
        actual: 0,
        achievement_percent: null,
        committed_contractors: 0,
        uncommitted_contractors: 3,
        rows: [],
      }),
    )
    draw()

    const card = await section('PIP this month')
    expect(card.querySelector('.dt-pip-tiles')).toHaveClass('is-uncommitted')
    expect(within(tile(card, 'Remaining')).getByText('—')).toBeInTheDocument()
    expect(within(card).queryByTestId('dt-pip-progress-fill')).toBeNull()
    expect(card).toHaveTextContent(
      '0 of 3 contractors have an approved PIP, so nothing is committed and nothing is scored.',
    )
  })

  it('paces the rate against the month only when something is committed', async () => {
    serve()
    draw()

    const card = await section('PIP this month')
    expect(card.querySelector('.dt-pip-tiles')).not.toHaveClass('is-uncommitted')
    expect(within(card).getByTestId('dt-pip-progress-fill')).toHaveStyle({ width: '37.5%' })
    expect(card).toHaveTextContent('3 of 4 contractors have an approved PIP.')
  })

  it('opens the drive tests delivered this month from Achieved', async () => {
    serve()
    draw()

    const card = await section('PIP this month')
    expect(within(card).getByRole('link', { name: 'Achieved: 6' })).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=delivered&year=1405&month=6',
    )
  })

  it('says it is not narrowed when a province filter is applied', async () => {
    // A PIP carries no province. Narrowing the delivered half alone would
    // divide one province's delivery by the whole programme's commitment.
    serve()
    draw('/reports/drive-test?province=7')

    const card = await section('PIP this month')
    expect(card.querySelector('.dt-scope-note')).toHaveTextContent(
      /Not narrowed to .*a PIP is committed per contractor for the whole programme/,
    )
  })

  it("gives a contractor the programme average, their only benchmark past their own row", async () => {
    serve(planDelivery({ programme_achievement_percent: 62.5 }))
    draw()

    const card = await section('PIP this month')
    expect(card).toHaveTextContent('Programme average 62.5% across all contractors.')
  })

  it('offers the monthly plan only to a role that can open it', async () => {
    // The same list the sidebar gates its Monthly Plan entry on. Admin is a
    // systems role and is not offered the page anywhere in the interface.
    serve()
    const { unmount } = draw()
    let card = await section('PIP this month')
    expect(within(card).getByRole('link', { name: 'Monthly plan' })).toHaveAttribute(
      'href',
      '/monthly-plan',
    )
    unmount()

    serve()
    draw('/reports/drive-test', { id: 9, username: 'admin', role: { name: 'Admin' } })
    card = await section('PIP this month')
    expect(within(card).queryByRole('link', { name: 'Monthly plan' })).toBeNull()
  })
})

describe('the contractor scorecard', () => {
  // The card grid became a sortable table -- see ContractorScorecard. Each
  // row is `.dt-contractor-row` (a `<tr>` now), sortable through the
  // `.dt-sort-btn` in each column header rather than a row of chips above
  // the table.
  const rowNames = (card) =>
    Array.from(card.querySelectorAll('.dt-contractor-row')).map(
      (row) => row.querySelector('.dt-contractor-name').textContent,
    )

  it('scores each contractor against their assignment, not every site they are named on', async () => {
    // Alfa is named on 60 on-air sites, 5 of them problematic. Problematic
    // work was never committed to them, so the book is 40 done + 15 ongoing
    // = 55, and the rate is 40/55, not 40/60.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    expect(within(row).getByText('55')).toBeInTheDocument()
    expect(within(row).getByText('73%')).toBeInTheDocument()
  })

  it('still shows the assignment when the payload does not carry it', async () => {
    // Assignment is DT done plus ongoing -- that is its definition, and the
    // backend computes that very sum. Deriving it here means a payload
    // without the field renders the figure instead of a dash, and a dash is
    // the worst failure this column has: it is the denominator every rate on
    // the row divides by, so losing it costs the reader the whole row.
    // The overview is serve()'s second argument. This test used to pass it
    // first, in the plan slot, so the page kept the unmodified overview and
    // the fallback below was never exercised.
    serve(planDelivery(), {
      ...overview,
      contractor_scorecard: overview.contractor_scorecard.map(
        ({ assigned: _assigned, ...rest }) => rest,
      ),
    })
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    expect(within(row).getByText('55')).toBeInTheDocument()
    expect(within(row).queryByText('\u2014')).not.toBeInTheDocument()
  })

  it('sorts on any column, and keeps the unattributed bucket out of the ranking', async () => {
    // "Who is holding the most" and "who has the most problems" are the next
    // two questions asked of this table and both are a column already on it.
    // The unattributed row is not a company, so it cannot out-rank one or be
    // out-ranked by one, whichever column is chosen. Served without Gamma's
    // plan row, so every company here has a book -- plan-only companies have
    // their own test below.
    serve(planDelivery({ rows: planDelivery().rows.filter((r) => r.contractor_id !== 3) }))
    draw(TABLES)

    const card = await section('Contractor scorecard')

    expect(rowNames(card)).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    // Ongoing ascending: Alfa holds 15, Beta 18. Unattributed holds 6 and
    // would sort first on the figures alone; it stays last.
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    expect(rowNames(card)).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    await userEvent.click(within(card).getByRole('button', { name: /Completion/ }))
    expect(rowNames(card)).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    // Assignment ascending puts the smaller book first, and still not the
    // unattributed one.
    await userEvent.click(within(card).getByRole('button', { name: /Assignment/ }))
    await userEvent.click(within(card).getByRole('button', { name: /Assignment/ }))
    expect(rowNames(card)).toEqual(['Beta Surveys', 'Alfa Drive Tests', 'Unattributed'])
  })

  it('tells a screen reader which control the list is sorted on', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const header = () => within(card).getByRole('button', { name: /Ongoing/ }).closest('th')

    expect(header()).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })

  it('has seven sort controls, ending with this month\'s PIP plan and what was achieved', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    // "Completion", not "Achieved": Achieved is delivered against this
    // month's PIP, and Completion is how far a company is through its own
    // book. The old single "This month PIP" pill is two columns now -- the
    // commitment and the delivery against it -- because the Plan and
    // delivery card that carried the counts is gone.
    const labels = within(card)
      .getAllByRole('columnheader')
      .filter((th) => th.querySelector('.dt-sort-btn'))
      .map((th) => th.textContent.trim())
    expect(labels).toEqual([
      'Contractor',
      'Assignment',
      'DT done',
      'Ongoing',
      'Completion',
      'PIP plan',
      'Achieved',
    ])
  })

  it('shows no Problematic or Not started figure anywhere in the list', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    expect(within(card).queryByText('Problematic')).not.toBeInTheDocument()
    expect(within(card).queryByText('Not started')).not.toBeInTheDocument()
  })

  it('rates Completion as DT done over Assignment, and the Assignment cell as DT done plus Ongoing', async () => {
    // Alfa: 40 done, 15 ongoing -> assignment 55, completion 40/55 = 72.7%.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    expect(within(row).getByText('55')).toBeInTheDocument()
    expect(within(row).getByText('73%')).toBeInTheDocument()
  })

  it("names Problematic as outside the assignment, behind the card's info icon", async () => {
    // A standing definition, so it moved off the card into the icon; the
    // notes that depend on what is on screen stay under the table.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const note = within(card).getByText(
      /Assignment = DT done \+ Ongoing\. Problematic sites are not part of a contractor’s assignment/,
    )
    expect(note).not.toBeVisible()
    await userEvent.click(within(card).getByRole('button', { name: 'What the scorecard counts' }))
    expect(note).toBeVisible()
  })

  it('carries this month\'s PIP achievement on the same row, from the Plan and delivery rows', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    // Same payload the Plan and delivery card reads: Alfa 3 of 4 (75%),
    // Beta 2 of 2 (100%).
    const rowFor = (name) => within(card).getByText(name).closest('.dt-contractor-row')
    expect(within(rowFor('Alfa Drive Tests')).getByText('75%')).toBeInTheDocument()
    expect(within(rowFor('Beta Surveys')).getByText('100%')).toBeInTheDocument()
  })

  it('ranks every row in the same neutral circle and draws completion as an accent bar', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const badges = [...card.querySelectorAll('.dt-rank-badge:not(.dt-rank-badge-empty)')]
    expect(badges.map((b) => b.textContent)).toEqual(['1', '2'])
    expect(badges.every((b) => b.className === 'dt-rank-badge')).toBe(true)

    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    const completion = row.querySelector('.dt-completion')
    expect(completion.querySelector('.dt-rate-fill')).toHaveStyle({ width: '72.7%' })
    expect(completion.querySelector('.dt-rate-value')).toHaveTextContent('73%')
    expect(card.querySelector('.dt-pill')).toBeNull()
  })

  it('reads a dash for plan and achieved where a contractor has no approved PIP', async () => {
    serve(planDelivery({ rows: [], achievement_percent: null }))
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    const cells = row.querySelectorAll('td')
    // PIP plan and Achieved are the two columns before the action cell.
    expect(cells[cells.length - 3]).toHaveTextContent('—')
    expect(cells[cells.length - 2]).toHaveTextContent('—')
    expect(card).toHaveTextContent('No PIP is approved this month, so PIP plan and Achieved are empty.')
  })

  it("states each contractor's PIP plan and what they achieved against it", async () => {
    // Alfa: 4 planned, 3 delivered, 75%. The count opens the drive tests
    // behind it, as the old card's contractor bar did.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    const cells = row.querySelectorAll('td')
    expect(cells[cells.length - 3]).toHaveTextContent('4')
    const achieved = row.querySelector('.dt-pip-achieved')
    // Plain text, not a coloured pill: the count, then its rate.
    expect(achieved.querySelector('.dt-pill')).toBeNull()
    expect(achieved).toHaveTextContent('375%')
    expect(achieved.querySelector('.dt-pip-rate-text')).toHaveTextContent('75%')
    expect(within(achieved).getByText('3').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=delivered&contractor_id=1&year=1405&month=6',
    )
  })

  it('lists a contractor with a PIP and no work yet, unranked, rather than dropping them', async () => {
    // Gamma has an approved PIP (10) and no drive tests done or ongoing, so
    // the scorecard's own rows do not include it. The old card listed it;
    // deleting that card must not make its PIP disappear.
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    expect(rowNames(card)).toEqual([
      'Alfa Drive Tests',
      'Beta Surveys',
      'Gamma Networks',
      'Unattributed',
    ])
    const row = within(card).getByText('Gamma Networks').closest('.dt-contractor-row')
    // No book, so no completion to rank by: no number, and nobody else's moves.
    expect(row.querySelector('.dt-rank-badge-empty')).not.toBeNull()
    // Its PIP is there in full: 10 planned, 1 delivered, 10%.
    const cells = row.querySelectorAll('td')
    expect(cells[cells.length - 3]).toHaveTextContent('10')
    const achieved = row.querySelector('.dt-pip-achieved')
    expect(within(achieved).getByText('1')).toBeInTheDocument()
    expect(achieved.querySelector('.dt-pip-rate-text')).toHaveTextContent('10%')
  })

  it('keeps a delivered count with no rate where nothing was approved to score it against', async () => {
    serve(
      planDelivery({
        rows: [{ contractor_id: 1, name: 'Alfa Drive Tests', pip: 0, actual: 2, achievement_percent: null }],
      }),
    )
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    const achieved = row.querySelector('.dt-pip-achieved')
    expect(achieved).toHaveTextContent(/^2$/)
    expect(achieved.querySelector('.dt-pip-rate-text')).toBeNull()
  })

  it('says the PIP columns are programme-wide when narrowed, and adds no plan-only rows', async () => {
    serve()
    draw(`${TABLES}&province=7`)

    const card = await section('Contractor scorecard')
    expect(card).toHaveTextContent(
      'PIP plan and Achieved cover every province: a PIP is committed per contractor for the whole programme.',
    )
    expect(within(card).queryByText('Gamma Networks')).toBeNull()
  })

  it('gives the unattributed row an Assign action, and no other row one', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const links = within(card).getAllByText('Assign')
    expect(links).toHaveLength(1)
    expect(links[0].closest('.dt-contractor-row')).toHaveClass('dt-row-unattributed')
  })

  it('keeps the unattributed row last under every sortable control', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')

    for (const column of ['Contractor', 'Assignment', 'DT done', 'Ongoing', 'Completion']) {
      await userEvent.click(within(card).getByRole('button', { name: column }))
      const names = rowNames(card)
      expect(names[names.length - 1]).toBe('Unattributed')
    }
  })
})

describe('the drill-through panel', () => {
  /** The panel, once its request has resolved. */
  const panel = async () => {
    const node = await screen.findByTestId('dt-drill')
    await waitFor(() => expect(node.querySelector('.dt-skeleton')).toBeNull())
    return node
  }

  const countIn = (node) => Number(node.querySelector('.dt-drill-count').textContent)

  it('opens on a figure and is not there before one is clicked', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    expect(screen.queryByTestId('dt-drill')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Total pending: 60 sites'))
    expect(await panel()).toBeInTheDocument()
  })

  // THE ASSERTION THE PANEL EXISTS FOR. The count in the panel has to be the
  // figure that opened it. Server-side that is guaranteed by counting before
  // pagination through the dashboard's own predicates; this side proves the
  // other half -- that the panel asks for exactly the figure clicked. A
  // wrong or dropped filter misses SITE_TOTALS and reports -999.
  it.each([
    ['pending', () => screen.getByLabelText('Total pending: 60 sites'), 60],
    [
      'ongoing',
      () => screen.getByText('Ongoing', { selector: '.dt-status-name' }),
      50,
    ],
    [
      'problematic',
      () => screen.getByText('Problematic', { selector: '.dt-status-name' }),
      10,
    ],
  ])('shows the same count as the %s figure that opened it', async (_name, target, expected) => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(target())
    expect(countIn(await panel())).toBe(expected)
  })

  it('shows the same count as a contractor row that opened it', async () => {
    serve()
    draw(TABLES)

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-contractor-row')
    // The assignment figure -- the denominator every rate on the row divides
    // by, and the one a reader is most likely to want to check.
    await userEvent.click(within(row).getByText('55'))
    expect(countIn(await panel())).toBe(55)
  })

  it('shows the same count as a province row that opened it', async () => {
    serve()
    draw(TABLES)

    const grid = await section('Drive Test progress by province')
    const card = within(grid).getByText('Kerman').closest('.dt-province-card')
    await userEvent.click(within(card).getByText('60'))
    expect(countIn(await panel())).toBe(60)
  })

  it('carries the province scope into the request rather than resolving it here', async () => {
    // The client never widens scope and never resolves a province: it sends
    // the query the link already carried and the endpoint decides what the
    // caller may see. See api/drive_test._resolve_province and
    // DriveTestAnalytics._load, where the province WHERE is applied after
    // apply_work_item_scope.
    serve()
    draw('/reports/drive-test?province=7')

    await screen.findByLabelText('Programme totals')
    await userEvent.click(
      screen.getByText('Problematic', { selector: '.dt-status-name' }),
    )
    await panel()

    expect(api.get).toHaveBeenCalledWith('/drive-test/sites', {
      params: { bucket: 'problematic', province_id: '7', limit: 25 },
    })
  })

  it('names what was clicked in the words the dashboard used', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByText('Ongoing', { selector: '.dt-status-name' }))
    const node = await panel()
    // "ongoing sites", not "bucket: ongoing" -- see BUCKET_LABEL.
    expect(node).toHaveTextContent('ongoing sites')
  })

  it('lists the sites with their code, province, contractor, state and age', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByText('Ongoing', { selector: '.dt-status-name' }))
    const node = await panel()

    expect(
      within(node).getAllByRole('columnheader').map((h) => h.textContent),
    ).toEqual(['Site', 'Province', 'Contractor', 'State', 'Age'])
    const first = within(node).getAllByRole('row')[1]
    expect(within(first).getByText('S-1')).toBeInTheDocument()
    expect(within(first).getByText('Kerman')).toBeInTheDocument()
    expect(within(first).getByText('2–3 weeks')).toBeInTheDocument()
  })

  it('exports through the existing site-list endpoint, with the same filters', async () => {
    // Not a second export path and not a file built in the browser: the
    // server's export knows the column set, the row cap and the scope, and
    // a spreadsheet assembled here from the loaded rows would be a
    // different, silently shorter answer.
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByText('Problematic', { selector: '.dt-status-name' }))
    const node = await panel()

    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: new Blob(['x']), headers: {} }),
    )
    await userEvent.click(within(node).getByRole('button', { name: /Export this list/ }))

    expect(api.get).toHaveBeenCalledWith('/drive-test/sites/export', {
      params: { bucket: 'problematic' },
      responseType: 'blob',
    })
  })

  it('offers a way through to the full list at the same address', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByText('Ongoing', { selector: '.dt-status-name' }))
    const node = await panel()

    expect(within(node).getByRole('link', { name: /Open in site list/ })).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=ongoing',
    )
  })

  it('clears the focus when closed, by the button and by Escape', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByLabelText('Total pending: 60 sites'))
    await panel()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByTestId('dt-drill')).not.toBeInTheDocument())

    await userEvent.click(screen.getByLabelText('Total pending: 60 sites'))
    await panel()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('dt-drill')).not.toBeInTheDocument())
  })

  it('leaves a modified click to the browser, so the href still opens a tab', async () => {
    // Every figure is still a real link to a real URL. Intercepting only the
    // plain left click is what keeps middle-click and cmd-click working --
    // and what keeps the drill-through URL assertions above meaningful.
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    // fireEvent rather than userEvent: the modifier has to be on the click
    // event itself, which is what DrillLink reads, and userEvent's keyboard
    // state is not shared across separate top-level calls.
    fireEvent.click(screen.getByText('Ongoing', { selector: '.dt-status-name' }), {
      metaKey: true,
    })

    expect(screen.queryByTestId('dt-drill')).not.toBeInTheDocument()
  })

  it('says what the server said when a filter is refused', async () => {
    serve()
    draw()
    await screen.findByLabelText('Programme totals')

    api.get.mockImplementationOnce(() =>
      Promise.reject({ response: { data: { detail: 'age_band applies to the ongoing bucket only' } } }),
    )
    await userEvent.click(screen.getByText('Ongoing', { selector: '.dt-status-name' }))

    const node = await screen.findByTestId('dt-drill')
    expect(await within(node).findByText(/age_band applies to the ongoing bucket only/)).toBeInTheDocument()
  })
})

describe('Cobalt chrome', () => {
  // The page's look moved onto the shared Cobalt components. What is worth
  // pinning is that the messages kept their meaning when they changed shape:
  // a failure is still announced, a growing gap is still news, and the new
  // icon chips are decoration a screen reader does not have to wade through.

  it('announces a whole-page failure as an error banner with a way to retry', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.reject(new Error('boom'))
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      if (url === '/drive-test/flow') return Promise.resolve({ data: flow() })
      return Promise.resolve({ data: planDelivery() })
    })
    draw()

    const text = await screen.findByText(/Could not load the Drive Test figures/)
    const banner = text.closest('.banner')
    expect(banner).toHaveClass('banner-error')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(within(banner).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('draws a failed section as an error banner that still announces itself', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      return Promise.reject(new Error('boom'))
    })
    draw()

    const card = await section('PIP this month')
    const failed = await within(card).findByRole('alert')
    expect(failed).toHaveClass('banner', 'banner-error')
    expect(within(failed).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('raises a growing gap as a warning banner, still announced on arrival', async () => {
    const grew = {
      ...overview,
      kpis: { ...overview.kpis, total_remaining: kpi(60, 7) },
    }
    serve(planDelivery(), grew)
    draw()

    const text = await screen.findByText('Gap increased by 7 sites this month')
    const banner = text.closest('.banner')
    expect(banner).toHaveClass('banner-warning')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(within(banner).getByRole('button', { name: /View province details/ })).toBeInTheDocument()
  })

  it('shows no gap banner when the gap shrank', async () => {
    serve(planDelivery(), {
      ...overview,
      kpis: { ...overview.kpis, total_remaining: kpi(60, -3) },
    })
    draw()

    await screen.findByLabelText('Programme totals')
    expect(screen.queryByText(/Gap increased/)).not.toBeInTheDocument()
  })

  it('gives every card an icon chip that is hidden from assistive technology', async () => {
    serve()
    draw()

    const expectChip = async (title) => {
      const card = await section(title)
      const chip = card.querySelector('.dt-section-head .ui-card-chip')
      expect(chip, title).not.toBeNull()
      expect(chip).toHaveAttribute('aria-hidden', 'true')
    }
    for (const title of [
      'Where this is going',
      'What moved',
      'PIP this month',
    ]) {
      await expectChip(title)
    }
    await userEvent.click(screen.getByRole('tab', { name: 'Breakdowns' }))
    for (const title of ['Ongoing breakdown', 'Problematic breakdown']) {
      await expectChip(title)
    }
    await userEvent.click(screen.getByRole('tab', { name: 'Contractors & provinces' }))
    for (const title of ['Contractor scorecard', 'Drive Test progress by province']) {
      await expectChip(title)
    }
  })

  it('marks the selected breakdown view with aria-selected on a segmented tab', async () => {
    serve()
    draw(BREAKDOWNS)

    const card = await section('Ongoing breakdown')
    const tabs = within(card.querySelector('.dt-breakdown-views')).getAllByRole('tab')
    expect(tabs.every((t) => t.classList.contains('ui-seg-option'))).toBe(true)
    await userEvent.click(within(card).getByRole('tab', { name: 'Province' }))
    expect(within(card).getByRole('tab', { name: 'Province' })).toHaveAttribute('aria-selected', 'true')
    expect(within(card).getByRole('tab', { name: 'Contractor' })).toHaveAttribute('aria-selected', 'false')
  })
})

describe('the three views', () => {
  // Overview, Breakdowns, and Contractors & provinces, as tabs directly under
  // the title row. The KPI band is part of the Overview; the scope and the gap
  // alert sit above all three.

  const TAB = 'Contractors & provinces'
  const viewTabs = () => screen.getAllByRole('tab', { name: /^(Overview|Breakdowns|Contractors & provinces)$/ })

  it('offers three tabs, in order, in the title row', async () => {
    serve()
    draw()

    await screen.findByRole('tab', { name: 'Overview' })
    expect(viewTabs().map((t) => t.textContent)).toEqual(['Overview', 'Breakdowns', TAB])
    // The tabs share the header row with the title, so switching views never moves them.
    const tablist = screen.getByRole('tablist', { name: 'Dashboard view' })
    const head = screen.getByRole('heading', { level: 1, name: 'Dashboard' }).closest('.dt-head')
    expect(head).toContainElement(tablist)
    const band = await screen.findByLabelText('Programme totals')
    expect(tablist.compareDocumentPosition(band) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens on Overview, with the KPI band inside it', async () => {
    serve()
    draw()

    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: TAB })).toHaveAttribute('aria-selected', 'false')
    const band = await screen.findByLabelText('Programme totals')
    expect(band.closest('[role="tabpanel"]')).toHaveAttribute('aria-label', 'Overview')
    await section('Where this is going')
    expect(screen.queryByRole('heading', { name: 'Ongoing breakdown' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contractor scorecard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Drive Test progress by province' })).not.toBeInTheDocument()
  })

  it('shows the KPI band on Overview only', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    await userEvent.click(screen.getByRole('tab', { name: 'Breakdowns' }))
    await section('Ongoing breakdown')
    expect(screen.queryByLabelText('Programme totals')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: TAB }))
    await section('Contractor scorecard')
    expect(screen.queryByLabelText('Programme totals')).not.toBeInTheDocument()
  })

  it('opens the breakdowns straight from the address', async () => {
    serve()
    draw(BREAKDOWNS)

    expect(await screen.findByRole('tab', { name: 'Breakdowns' })).toHaveAttribute('aria-selected', 'true')
    await section('Ongoing breakdown')
    await section('Problematic breakdown')
    expect(screen.queryByRole('heading', { name: 'Where this is going' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contractor scorecard' })).not.toBeInTheDocument()
  })

  it('switches to the contractor and province tables and back', async () => {
    serve()
    draw()

    await userEvent.click(await screen.findByRole('tab', { name: TAB }))

    expect(screen.getByRole('tab', { name: TAB })).toHaveAttribute('aria-selected', 'true')
    await section('Contractor scorecard')
    await section('Drive Test progress by province')
    expect(screen.queryByRole('heading', { name: 'Where this is going' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    await section('Where this is going')
    expect(screen.queryByRole('heading', { name: 'Contractor scorecard' })).not.toBeInTheDocument()
  })

  it('opens the tables straight from the address, so a link or bookmark lands there', async () => {
    serve()
    draw(TABLES)

    expect(await screen.findByRole('tab', { name: TAB })).toHaveAttribute('aria-selected', 'true')
    await section('Contractor scorecard')
  })

  it('reads an unknown tab in the address as Overview', async () => {
    serve()
    draw('/reports/drive-test?tab=nonsense')

    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByLabelText('Programme totals')).toBeInTheDocument()
  })

  it('keeps the reader on the tables when a province row narrows the dashboard', async () => {
    serve()
    draw(TABLES)

    const card = await section('Drive Test progress by province')
    await userEvent.click(
      within(card).getByRole('button', { name: /Narrow the whole dashboard to Kerman/ }),
    )

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', { params: { province_id: 7 } }),
    )
    expect(screen.getByRole('tab', { name: TAB })).toHaveAttribute('aria-selected', 'true')
    // The scope chip on the title row says what the page is narrowed to.
    expect(
      await screen.findByRole('button', { name: /Show every province again, not just Kerman/ }),
    ).toBeInTheDocument()
  })

  it('keeps the province scope when switching views', async () => {
    serve()
    draw(`${TABLES}&province=7`)

    await section('Contractor scorecard')
    await userEvent.click(screen.getByRole('tab', { name: 'Breakdowns' }))
    await section('Ongoing breakdown')
    await userEvent.click(screen.getByRole('tab', { name: 'Overview' }))

    await section('Where this is going')
    expect(
      screen.getByRole('button', { name: /Show every province again, not just Kerman/ }),
    ).toBeInTheDocument()
  })

  it('keeps the view when the scope is cleared', async () => {
    serve()
    draw(`${BREAKDOWNS}&province=7`)

    await userEvent.click(
      await screen.findByRole('button', { name: /Show every province again, not just Kerman/ }),
    )
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', { params: {} }),
    )
    expect(screen.getByRole('tab', { name: 'Breakdowns' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the gap alert on every tab', async () => {
    serve(planDelivery(), {
      ...overview,
      kpis: { ...overview.kpis, total_remaining: kpi(60, 7) },
    })
    draw(BREAKDOWNS)

    expect(await screen.findByText('Gap increased by 7 sites this month')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: TAB }))
    expect(screen.getByText('Gap increased by 7 sites this month')).toBeInTheDocument()
  })

  it('opens the tables from the gap alert\'s "View province details"', async () => {
    serve(planDelivery(), {
      ...overview,
      kpis: { ...overview.kpis, total_remaining: kpi(60, 7) },
    })
    draw()

    await userEvent.click(await screen.findByRole('button', { name: /View province details/ }))

    expect(screen.getByRole('tab', { name: TAB })).toHaveAttribute('aria-selected', 'true')
    await section('Drive Test progress by province')
  })
})
