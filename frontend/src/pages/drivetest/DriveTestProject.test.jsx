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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

const api = (await import('../../api/client')).default
const DriveTestProject = (await import('./DriveTestProject')).default
const { ToastProvider } = await import('../../context/ToastContext')

function draw(initialPath = '/reports/drive-test') {
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
    { name: 'Kerman', onair: 60, done: 23, remaining: 37, ongoing: 30, problematic: 7, done_percent: 38.3 },
    { name: 'Yazd', onair: 40, done: 17, remaining: 23, ongoing: 20, problematic: 3, done_percent: 42.5 },
  ],
  // `assigned` is done + ongoing, and problematic is deliberately outside it
  // — see ContractorScorecard for why the denominator stops there.
  contractor_scorecard: [
    { contractor_id: 1, name: 'Alfa Drive Tests', assigned: 55, done: 40, ongoing: 15, problematic: 5, done_percent: 72.7 },
    { contractor_id: 2, name: 'Beta Surveys', assigned: 27, done: 9, ongoing: 18, problematic: 3, done_percent: 33.3 },
    { contractor_id: null, name: 'Unattributed', assigned: 8, done: 2, ongoing: 6, problematic: 2, done_percent: 25.0 },
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

function serve(plan = planDelivery(), body = overview, series = trend()) {
  api.get.mockImplementation((url) => {
    if (url === '/drive-test/overview') return Promise.resolve({ data: body })
    if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: plan })
    if (url === '/drive-test/trend') return Promise.resolve({ data: series })
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

describe('plan and delivery', () => {
  it('renders the four figures for the month', async () => {
    serve()
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getByText('شهریور 1405')).toBeInTheDocument()

    for (const [label, value] of [
      ['PIP', '16'],
      ['Assigned', '9'],
      ['Actual', '6'],
      ['Achievement', '37.5%'],
    ]) {
      // Scoped to the tiles: "PIP" is also the word the bullet key below uses,
      // deliberately, because it is the same figure.
      const tile = within(card)
        .getAllByText(label)
        .map((node) => node.closest('.dt-figure-tile'))
        .find(Boolean)
      expect(within(tile).getByText(value)).toBeInTheDocument()
    }
  })

  it('says how many contractors have not committed, so a short PIP explains itself', async () => {
    serve()
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getByText('1 not committed')).toBeInTheDocument()
  })

  it('draws one achievement bar per contractor, in the order it was given', async () => {
    serve()
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getAllByTestId('achievement-bar')).toHaveLength(3)
    // A target marker on every row: the bar is meaningless without the 100%
    // line it is being read against.
    expect(within(card).getAllByTestId('target-marker')).toHaveLength(3)

    for (const [name, percent, detail] of [
      ['Beta Surveys', '100%', '2 of 2'],
      ['Alfa Drive Tests', '75%', '3 of 4'],
      ['Gamma Networks', '10%', '1 of 10'],
    ]) {
      const row = within(card).getByText(name).closest('.dt-bullet')
      expect(within(row).getByText(percent)).toBeInTheDocument()
      expect(within(row).getByText(detail)).toBeInTheDocument()
    }
  })

  it('says on screen what the two bars mean, rather than in a tooltip', async () => {
    // The old dashboard's only explanation of the marker was a title
    // attribute, which a touch screen can never reveal. The bullet now names
    // both marks and the scale they are drawn on.
    serve()
    draw()

    const card = await section('Plan and delivery')
    // PIP, not "plan": the tile above these bars says PIP and it is the same
    // commitment. Two words forty pixels apart make a reader go looking for
    // the difference between them.
    const key = card.querySelector('.dt-bullet-key')
    expect(within(key).getByText('PIP')).toBeInTheDocument()
    expect(within(key).getByText('delivered')).toBeInTheDocument()
    // PIP tops out at 10 in the fixture, so the scale rounds to a readable 15.
    expect(within(card).getByText(/drive tests$/)).toBeInTheDocument()
  })

  it('draws the plan as a ghost bar behind what was delivered', async () => {
    // The bar used to encode the ratio alone, so a contractor who committed
    // to 48 and one who committed to 4 drew identical marks at the same rate.
    serve()
    draw()

    const card = await section('Plan and delivery')
    const row = within(card).getByText('Gamma Networks').closest('.dt-bullet')
    // Gamma delivered 1 of 10 on a scale that tops out at 15.
    expect(row.querySelector('.dt-bullet-plan')).toHaveStyle({ width: `${(10 / 15) * 100}%` })
    expect(within(row).getByTestId('achievement-bar')).toHaveStyle({
      width: `${(1 / 15) * 100}%`,
    })
  })

  it('gives a contractor with no plan no ghost bar and no target', async () => {
    serve(
      planDelivery({
        rows: [
          { contractor_id: 1, name: 'Alfa Drive Tests', pip: 0, actual: 5, achievement_percent: null },
        ],
      }),
    )
    draw()

    const card = await section('Plan and delivery')
    const row = within(card).getByText('Alfa Drive Tests').closest('.dt-bullet')
    expect(row.querySelector('.dt-bullet-plan')).toBeNull()
    expect(within(row).queryByTestId('target-marker')).not.toBeInTheDocument()
    // The work still draws, because it happened.
    expect(within(row).getByTestId('achievement-bar')).toBeInTheDocument()
  })

  it('colours each bar by band: at target, close to it, short of it', async () => {
    // One contractor in each band, including the middle one — 80-99 is the
    // band a two-colour "met it or did not" reading would lose. The middle
    // band used to be amber, which against this red is 3.4 ΔE apart for a
    // red-green reader: "nearly there" and "badly short" were the same bar.
    serve(
      planDelivery({
        rows: [
          { contractor_id: 2, name: 'Beta Surveys', pip: 2, actual: 2, achievement_percent: 100.0 },
          { contractor_id: 4, name: 'Delta Field', pip: 20, actual: 17, achievement_percent: 85.0 },
          { contractor_id: 3, name: 'Gamma Networks', pip: 10, actual: 1, achievement_percent: 10.0 },
        ],
      }),
    )
    draw()

    const card = await section('Plan and delivery')
    const barFor = (name) =>
      within(within(card).getByText(name).closest('.dt-bullet')).getByTestId('achievement-bar')

    expect(barFor('Beta Surveys')).toHaveStyle({ background: 'var(--dt-done)' })
    expect(barFor('Delta Field')).toHaveStyle({ background: 'var(--dt-ongoing)' })
    expect(barFor('Gamma Networks')).toHaveStyle({ background: 'var(--dt-problem)' })
  })

  it('shows a month with no approved plan as no achievement, not as zero', async () => {
    serve(
      planDelivery({
        pip: 0,
        actual: 2,
        achievement_percent: null,
        committed_contractors: 0,
        uncommitted_contractors: 3,
        rows: [
          { contractor_id: 1, name: 'Alfa Drive Tests', pip: 0, actual: 2, achievement_percent: null },
        ],
      }),
    )
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getByText('no approved PIP')).toBeInTheDocument()
    expect(within(card).queryByText('0%')).not.toBeInTheDocument()
    expect(within(card).getByText('no PIP')).toBeInTheDocument()
  })

  it('renders an empty month without breaking the page', async () => {
    serve(
      planDelivery({
        pip: 0,
        assigned: 0,
        actual: 0,
        achievement_percent: null,
        committed_contractors: 0,
        uncommitted_contractors: 0,
        rows: [],
      }),
    )
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getByText('No contractor PIP for this month.')).toBeInTheDocument()
    // The rest of the dashboard is still there.
    expect(screen.getByText('Drive Test Overview')).toBeInTheDocument()
  })

  it('gives a contractor their own row and an unnamed programme line', async () => {
    serve(
      planDelivery({
        pip: 10,
        assigned: 4,
        actual: 1,
        achievement_percent: 10.0,
        committed_contractors: 1,
        uncommitted_contractors: 0,
        programme_achievement_percent: 15.0,
        rows: [
          { contractor_id: 1, name: 'Alfa Drive Tests', pip: 10, actual: 1, achievement_percent: 10.0 },
        ],
      }),
    )
    draw()

    const card = await section('Plan and delivery')
    expect(within(card).getByText('Alfa Drive Tests')).toBeInTheDocument()
    expect(within(card).getByText('Programme average')).toBeInTheDocument()
    expect(within(card).getByText('all contractors')).toBeInTheDocument()
    // The benchmark carries no company name with it.
    expect(within(card).getAllByTestId('achievement-bar')).toHaveLength(2)
    expect(within(card).queryByText('Beta Surveys')).not.toBeInTheDocument()
    expect(within(card).queryByText('Gamma Networks')).not.toBeInTheDocument()
  })
})

describe('breakdown sections', () => {
  it('renders each section, opening on its chart view', async () => {
    serve()
    draw()

    const ongoing = await section('Ongoing breakdown')
    const problematic = await section('Problematic breakdown')
    const provinces = await section('Province breakdown')

    // Chart first, table on request: bars are present, the table's own
    // Total row is not.
    expect(within(ongoing).getAllByTestId('dt-bar')).toHaveLength(2)
    expect(within(ongoing).queryByText('Total')).not.toBeInTheDocument()
    expect(within(problematic).getAllByTestId('dt-bar')).toHaveLength(2)
    expect(within(provinces).getByText('Kerman')).toBeInTheDocument()
  })

  it('shows the ongoing total on the section header', async () => {
    serve()
    draw()

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByText('50')).toBeInTheDocument()
    expect(within(ongoing).getByText('ongoing')).toBeInTheDocument()
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()
  })

  it('switches the ongoing section between its three tabs', async () => {
    serve()
    draw()

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
    draw()

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
    draw()

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
    draw()

    const ongoing = await section('Ongoing breakdown')
    expect(within(ongoing).getByText('Every ongoing site has a contractor.')).toBeInTheDocument()
  })

  it('says how many ongoing sites cannot be aged, for the same reason', async () => {
    serve()
    draw()

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
    draw()

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
    draw()

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
    draw()

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('tab', { name: 'How long' }))

    expect(within(problematic).getByText(/4 sites were flagged by a CPM import/)).
      toBeInTheDocument()
  })

  it('opens each problematic age band on the sites in that band', async () => {
    serve()
    draw()

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
    draw()

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
    draw()

    const problematic = await section('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('button', { name: /Table/ }))

    // 6 + 4 = 10, the problematic total, at 100% of it.
    const totalRow = within(problematic).getByText('Total').closest('tr')
    expect(within(totalRow).getByText('10')).toBeInTheDocument()
    expect(within(totalRow).getByText('100%')).toBeInTheDocument()
  })

  it('switches the problematic section between category and province', async () => {
    serve()
    draw()

    const problematic = await section('Problematic breakdown')
    expect(within(problematic).getByText('Power')).toBeInTheDocument()

    await userEvent.click(within(problematic).getByRole('tab', { name: 'Province' }))
    expect(within(problematic).getByText('Kerman')).toBeInTheDocument()
    expect(within(problematic).queryByText('Power')).not.toBeInTheDocument()
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
    draw()

    const ongoing = await section('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'Province' }))

    // 10+9+8+7+6+5 named, then 4+3+2+1 = 10 in the remainder.
    expect(within(ongoing).getAllByTestId('dt-bar')).toHaveLength(7)
    const remainder = within(ongoing).getByText('4 more provinces').closest('.dt-bar-row')
    expect(within(remainder).getByText('10')).toBeInTheDocument()
  })
})

describe('the province table', () => {
  it('opens sorted by remaining, most first', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    draw()

    const provinces = await section('Province breakdown')
    const names = within(provinces)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.firstChild.textContent)

    expect(names).toEqual([
      'Province 1', 'Province 2', 'Province 3', 'Province 4', 'Province 5', 'Province 6',
    ])
  })

  it('re-sorts on a column header, and reverses on a second click', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    draw()

    const provinces = await section('Province breakdown')
    await userEvent.click(within(provinces).getByRole('button', { name: /Done/ }))

    const namesOf = () =>
      within(provinces).getAllByRole('row').slice(1).map((r) => r.firstChild.textContent)

    // done ascends with the index, so descending puts the last province first.
    expect(namesOf()[0]).toBe('Province 10')
    await userEvent.click(within(provinces).getByRole('button', { name: /Done/ }))
    expect(namesOf()[0]).toBe('Province 1')
  })

  it('collapses to six rows and expands on Show all', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    draw()

    const provinces = await section('Province breakdown')
    expect(within(provinces).getAllByRole('row')).toHaveLength(7) // header + 6
    expect(within(provinces).getByText('4 more not shown')).toBeInTheDocument()

    await userEvent.click(within(provinces).getByRole('button', { name: /Show all 10 provinces/ }))
    expect(within(provinces).getAllByRole('row')).toHaveLength(11)
    expect(within(provinces).queryByText('4 more not shown')).not.toBeInTheDocument()

    await userEvent.click(within(provinces).getByRole('button', { name: /Show top 6/ }))
    expect(within(provinces).getAllByRole('row')).toHaveLength(7)
  })

  it('offers no Show all control when every province already fits', async () => {
    serve()
    draw()

    const provinces = await section('Province breakdown')
    expect(within(provinces).queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
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
  const moving = {
    ...overview,
    kpis: {
      total_onair: kpi(100, 5),
      total_dt_done: kpi(40, 12),
      total_remaining: kpi(60, -12, 60),
      total_ongoing: kpi(50, -16, 50),
      total_problematic: kpi(10, 4, 10),
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
    expect(chip).toHaveStyle({ color: 'var(--dt-done)' })
  })

  it('reads rising problems as bad news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+4/)
    expect(chip).toHaveStyle({ color: 'var(--dt-problem)' })
  })

  it('still reads rising completions as good news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+12/)
    expect(chip).toHaveStyle({ color: 'var(--dt-done)' })
  })

  it('says there is no baseline rather than showing a change of zero', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    expect(screen.getAllByText('no baseline yet').length).toBeGreaterThan(0)
  })
})

describe('the hero', () => {
  it('shows every on-air site in exactly one arc of the ring', async () => {
    serve()
    draw()

    const hero = await screen.findByLabelText('Programme totals')
    // 40 done + 50 ongoing + 10 problematic = 100 on-air, and the ring says
    // so because the arcs are the total rather than a picture of it.
    const ring = within(hero).getByRole('img')
    expect(ring).toHaveAttribute(
      'aria-label',
      '100 sites on air. Drive tests done: 40, 40 per cent. Ongoing: 50, 50 per cent. ' +
        'Problematic: 10, 10 per cent',
    )
    expect(within(hero).getAllByTestId('dt-ring-arc')).toHaveLength(3)
  })

  it('puts each state in a tile whose size does not depend on its share', async () => {
    // The point of moving the figures out of the geometry. Problematic is ten
    // per cent of the programme; in the split bar this replaces its segment
    // collapsed to a sliver and its figure was suppressed as unfittable —
    // and it is the one figure a reader scans this band for.
    serve()
    draw()

    const hero = await screen.findByLabelText('Programme totals')
    const tile = within(hero).getByText('Problematic').closest('.dt-state-tile')
    expect(within(tile).getByText('10')).toBeInTheDocument()
    expect(within(tile).getByText('10% of on-air')).toBeInTheDocument()
  })

  it('states Remaining as the sum of the two tiles it is made of', async () => {
    // Remaining is not a fourth state. It used to be asserted with a drawn
    // bracket spanning two segments of a bar — chart furniture invented for
    // this one page — and it is arithmetic, so it is now a line of it.
    serve()
    draw()

    const hero = await screen.findByLabelText('Programme totals')
    const foot = within(hero).getByText('Remaining').closest('.dt-foot-item')
    expect(within(foot).getByText('60')).toBeInTheDocument()
    expect(within(foot).getByText('60%')).toBeInTheDocument()
  })
})

describe('the order of the page', () => {
  it('puts the PIP summary above the ongoing and problematic detail', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    const headings = screen
      .getAllByRole('heading')
      .map((h) => h.textContent)
      .filter((t) =>
        [
          'Plan and delivery',
          'Ongoing breakdown',
          'Problematic breakdown',
          'Where this is going',
        ].includes(t),
      )

    expect(headings).toEqual([
      'Plan and delivery',
      'Ongoing breakdown',
      'Problematic breakdown',
      'Where this is going',
    ])
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
      name: 'the on-air total in the ring',
      open: async () => await screen.findByLabelText('Programme totals'),
      // By its accessible name: the label sits beside the figure and only the
      // figure is the link.
      label: 'Total on-air: 100 sites',
      href: '/drive-test/sites?bucket=onair',
    },
    {
      name: 'the done tile',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Drive tests done',
      href: '/drive-test/sites?bucket=done',
    },
    {
      name: 'the ongoing tile',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Ongoing',
      href: '/drive-test/sites?bucket=ongoing',
    },
    {
      name: 'the problematic tile',
      open: async () => await screen.findByLabelText('Programme totals'),
      text: 'Problematic',
      href: '/drive-test/sites?bucket=problematic',
    },
    {
      name: 'the remaining line',
      open: async () => await screen.findByLabelText('Programme totals'),
      label: 'Remaining: 60 sites',
      href: '/drive-test/sites?bucket=remaining',
    },
    {
      name: 'a problematic category',
      open: () => section('Problematic breakdown'),
      text: 'Power',
      href: '/drive-test/sites?bucket=problematic&category=Power',
    },
    {
      name: 'a problematic province',
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
      open: () => section('Ongoing breakdown'),
      text: 'Alfa Drive Tests',
      href: '/drive-test/sites?bucket=ongoing&contractor_id=1',
    },
    {
      name: 'an ongoing province',
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
      open: () => section('Plan and delivery'),
      text: '2 of 2',
      href: '/drive-test/sites?bucket=delivered&contractor_id=2&year=1405&month=6',
    },
  ]

  it.each(CASES)('links $name to the sites behind it', async ({ open, text, label, href }) => {
    serve()
    draw()

    const scope = await open()
    const link = label
      ? within(scope).getByRole('link', { name: label })
      : within(scope).getByText(text).closest('a')
    expect(link).toHaveAttribute('href', href)
  })

  it('carries the province filter into the links it builds', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    const hero = await screen.findByLabelText('Programme totals')
    expect(within(hero).getByText('Problematic').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=problematic&province_id=7',
    )
  })

  it('links every cell of a contractor row, the denominator included', async () => {
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('tr')
    for (const [value, href] of [
      // The assignment is what the rate divides by, so it is the figure a
      // contractor will want to check.
      ['55', '/drive-test/sites?bucket=assigned&contractor_id=1'],
      ['40', '/drive-test/sites?bucket=done&contractor_id=1'],
      ['15', '/drive-test/sites?bucket=ongoing&contractor_id=1'],
      ['5', '/drive-test/sites?bucket=problematic&contractor_id=1'],
    ]) {
      expect(within(row).getByText(value).closest('a')).toHaveAttribute('href', href)
    }
  })

  it('links the unattributed row through contractor_id=none', async () => {
    // There is no contractor to name, and there is still a list: the sites
    // nobody holds are the ones most worth reading.
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Unattributed').closest('tr')
    expect(within(row).getByText('6').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=ongoing&contractor_id=none',
    )
  })

  it('links every count in a province row', async () => {
    serve()
    draw()

    const table = await section('Province breakdown')
    const row = within(table).getByText('Kerman').closest('tr')
    for (const [value, href] of [
      ['60', '/drive-test/sites?bucket=onair&province_id=7'],
      ['23', '/drive-test/sites?bucket=done&province_id=7'],
      ['37', '/drive-test/sites?bucket=remaining&province_id=7'],
      ['30', '/drive-test/sites?bucket=ongoing&province_id=7'],
      ['7', '/drive-test/sites?bucket=problematic&province_id=7'],
    ]) {
      expect(within(row).getByText(value).closest('a')).toHaveAttribute('href', href)
    }
  })

  it('links the month’s delivered figure to that month’s drive tests', async () => {
    serve()
    draw()

    const card = await section('Plan and delivery')
    const tile = within(card).getByText('Actual').closest('.dt-figure-tile')
    expect(within(tile).getByText('6').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=delivered&year=1405&month=6',
    )
  })

  it('leaves the trend chart and the flow ledger unlinked', async () => {
    // Both are built from monthly snapshots. There is no list of sites behind
    // a snapshot, and a link that opened one would be answering a different
    // question with the same number.
    serve()
    draw()

    const trend = await section('Where this is going')
    const flow = await section('What moved')
    expect(within(trend).queryAllByRole('link')).toHaveLength(0)
    expect(within(flow).queryAllByRole('link')).toHaveLength(0)
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
          done_percent: 72.7,
        },
      ],
    }
    serve(planDelivery(), contractorView)
    draw()

    const card = await section('Ongoing breakdown')
    expect(within(card).getByText('Alfa Drive Tests').closest('a')).toHaveAttribute(
      'href',
      '/drive-test/sites?bucket=ongoing&contractor_id=1',
    )
    expect(within(card).getByText('Other contractors').closest('a')).toBeNull()
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
    await userEvent.click(screen.getByRole('button', { name: /Export DT workbook/ }))

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
    await userEvent.click(screen.getByRole('button', { name: /Export DT workbook/ }))

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

    expect(await screen.findByText('Drive Test Overview')).toBeInTheDocument()
    const card = await section('Plan and delivery')
    expect(await within(card).findByText(/Couldn’t load plan and delivery/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })

  it('retries just the failed section without a page reload', async () => {
    let attempt = 0
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      if (url === '/drive-test/trend') return Promise.resolve({ data: trend() })
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: planDelivery() })
    })
    draw()

    const card = await section('Plan and delivery')
    await userEvent.click(await within(card).findByRole('button', { name: /Retry/ }))
    expect(await screen.findByText('1 not committed')).toBeInTheDocument()
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
      return Promise.resolve({ data: planDelivery() })
    })
    draw()

    expect(await screen.findByText(/Could not load the Drive Test figures/)).toBeInTheDocument()
    // Plan and delivery comes from a different request and is unaffected.
    expect(await screen.findByText('1 not committed')).toBeInTheDocument()
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

    expect(await screen.findByText('Drive Test Overview')).toBeInTheDocument()
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

    await screen.findByText('Drive Test Overview')
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', {
        params: { province_id: 7 },
      }),
    )
  })

  it('names the province it has been narrowed to', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    expect(
      await screen.findByText('On-air and drive-test status in Kerman'),
    ).toBeInTheDocument()
  })

  it('narrows from a province row, which is where a reader knows which one', async () => {
    // The dropdown this replaces asked for a province before the reader had
    // seen anything to pick one by. This is the same scope, entered from the
    // row they just read.
    serve()
    draw()

    const card = await section('Province breakdown')
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

    const card = await section('Plan and delivery')
    expect(
      within(card).getByText(/committed per contractor for the whole programme/),
    ).toBeInTheDocument()
  })

  it('shows no scope chip when nothing is narrowed', async () => {
    serve()
    draw()

    expect(await screen.findByText('All provinces')).toBeInTheDocument()
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

    const card = await section('Plan and delivery')
    expect(
      within(card).getByText(/committed per contractor for the whole programme/),
    ).toBeInTheDocument()
  })

  it('does not carry that warning when the whole programme is on screen', async () => {
    serve()
    draw()

    const card = await section('Plan and delivery')
    expect(
      within(card).queryByText(/committed per contractor for the whole programme/),
    ).not.toBeInTheDocument()
  })
})

describe('the trend section', () => {
  it('draws the series when months have been captured', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    expect(within(card).getByRole('img', { name: /Drive test trend/ })).toBeInTheDocument()
    expect(within(card).getByText('Remaining')).toBeInTheDocument()
  })

  it('reports problematic as a figure rather than drawing it', async () => {
    // It used to be a third line in a strip of its own, with its own vertical
    // scale under the panel -- a second set of gridlines a reader had to
    // learn before they could read the shape they came for. It is an order of
    // magnitude smaller than the other two, so there is no honest way to draw
    // it beside them; what people actually took from the strip was the level
    // and the direction, and both fit in a sentence.
    serve(planDelivery(), overview, {
      ...trend(),
      months: [
        month('مرداد', { shamsi_month: 5, problematic: 18 }),
        month('شهریور', { shamsi_month: 6, problematic: 11, is_open: true }),
      ],
    })
    draw()

    const card = await section('Where this is going')
    const caption = card.querySelector('.dt-trend-caption')
    expect(within(caption).getByText('11')).toBeInTheDocument()
    expect(within(caption).getByText('7')).toBeInTheDocument()
    // A real em dash. `\u2014` written in JSX text is six literal characters,
    // not an escape — the mistake renders as "not plotted \u2014 hover".
    expect(within(caption).getByText(/not plotted — hover a month/)).toBeInTheDocument()
    expect(caption.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/)

    // A fall in problematic is good news, so it is not painted in the alarm
    // colour -- the same rule the KPI deltas follow.
    expect(caption.querySelector('.dt-trend-down')).toBeTruthy()
    expect(caption.querySelector('.dt-trend-up')).toBeFalsy()

    // And it is gone from the legend: a swatch for a series that is not
    // drawn sends a reader hunting for a line that is not there.
    const legend = card.querySelector('.dt-legend')
    expect(within(legend).queryByText('Problematic')).not.toBeInTheDocument()
    expect(within(legend).getByText('Remaining')).toBeInTheDocument()
  })

  it('reads the trend over six months or twelve, without reloading the page', async () => {
    serve()
    draw()

    const card = await section('Where this is going')
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/trend', {
        params: { months: 12 },
      }),
    )
    const overviewCalls = api.get.mock.calls.filter((c) => c[0] === '/drive-test/overview').length

    await userEvent.click(within(card).getByRole('button', { name: '6m' }))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/trend', {
        params: { months: 6 },
      }),
    )
    // The window changes one card. Re-reading the overview to answer it would
    // blank every section on the page to redraw one chart.
    expect(
      api.get.mock.calls.filter((c) => c[0] === '/drive-test/overview').length,
    ).toBe(overviewCalls)
  })

  it('keeps the province scope when the window changes', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    const card = await section('Where this is going')
    await userEvent.click(within(card).getByRole('button', { name: '6m' }))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/trend', {
        params: { months: 6, province_id: 7 },
      }),
    )
  })

  it('says the series is empty rather than drawing an empty chart', async () => {
    serve(planDelivery(), overview, {
      months: [month('مرداد', { captured: false, onair: null, remaining: null })],
      latest_flows: null,
    })
    draw()

    const card = await section('Where this is going')
    expect(
      within(card).getByText(/No monthly snapshots have been captured yet/),
    ).toBeInTheDocument()
  })

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

  it('says which flows are measured and which are derived', async () => {
    serve()
    draw()

    const card = await section('What moved')
    expect(within(card).getByText(/Arrivals are derived from the/)).toBeInTheDocument()
  })

  it('hides the ledger when no month has one', async () => {
    serve(planDelivery(), overview, trend({ latest_flows: null }))
    draw()

    await screen.findByText('Drive Test Overview')
    await waitFor(() => expect(screen.queryByText('What moved')).not.toBeInTheDocument())
  })
})

describe('the contractor scorecard', () => {
  it('scores each contractor against their assignment, not every site they are named on', async () => {
    // Alfa is named on 60 on-air sites, 5 of them problematic. Problematic
    // work was never committed to them, so the book is 40 done + 15 ongoing
    // = 55, and the rate is 40/55, not 40/60.
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('tr')
    expect(within(row).getByText('55')).toBeInTheDocument()
    expect(within(row).getByText('73%')).toBeInTheDocument()
  })

  it('draws each row against the widest book, so size is not thrown away', async () => {
    // The bar used to be a fixed-width track filled to the rate, so 73% of 55
    // and 33% of 27 drew bars of the same length. Length is now the size of
    // the book; fill is the rate.
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const widths = ['Alfa Drive Tests', 'Beta Surveys'].map((name) => {
      const row = within(card).getByText(name).closest('tr')
      return row.querySelector('.dt-book-bar').style.width
    })

    expect(widths[0]).toBe('100%')
    // 27 of 55, to the precision the style attribute carries.
    expect(parseFloat(widths[1])).toBeCloseTo(49.1, 1)
  })

  it('splits each bar into what is done and what is still held', async () => {
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('tr')
    const segments = within(row)
      .getAllByTestId('dt-bar')
      .map((seg) => seg.dataset.segment)

    expect(segments).toEqual(['done', 'ongoing'])
  })

  it('still shows the assignment when the payload does not carry it', async () => {
    // Assignment is DT done plus ongoing -- that is its definition, and the
    // backend computes that very sum. Deriving it here means a payload
    // without the field renders the figure instead of a dash, and a dash is
    // the worst failure this column has: it is the denominator every rate on
    // the row divides by, so losing it costs the reader the whole row.
    serve({
      ...overview,
      contractor_scorecard: overview.contractor_scorecard.map(
        ({ assigned: _assigned, ...rest }) => rest,
      ),
    })
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('tr')
    expect(within(row).getByText('55')).toBeInTheDocument()
    expect(within(row).queryByText('\u2014')).not.toBeInTheDocument()
  })

  it('sorts on any column, and keeps the unattributed bucket out of the ranking', async () => {
    // "Who is holding the most" and "who has the most problems" are the next
    // two questions asked of this table and both are a column already on it.
    // The unattributed row is not a company, so it cannot out-rank one or be
    // out-ranked by one, whichever column is chosen.
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const names = () =>
      within(card)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.querySelector('td').textContent)

    expect(names()).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    // Ongoing ascending: Alfa holds 15, Beta 18. Unattributed holds 6 and
    // would sort first on the figures alone; it stays last.
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    expect(names()).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    await userEvent.click(within(card).getByRole('button', { name: /Problematic/ }))
    expect(names()).toEqual(['Alfa Drive Tests', 'Beta Surveys', 'Unattributed'])

    // Assignment ascending puts the smaller book first, and still not the
    // unattributed one.
    await userEvent.click(within(card).getByRole('button', { name: /Assignment/ }))
    await userEvent.click(within(card).getByRole('button', { name: /Assignment/ }))
    expect(names()).toEqual(['Beta Surveys', 'Alfa Drive Tests', 'Unattributed'])
  })

  it('tells a screen reader which column the table is sorted on', async () => {
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const header = () =>
      within(card).getByRole('button', { name: /Ongoing/ }).closest('th')

    expect(header()).toHaveAttribute('aria-sort', 'none')
    await userEvent.click(within(card).getByRole('button', { name: /Ongoing/ }))
    expect(header()).toHaveAttribute('aria-sort', 'descending')
  })
})
