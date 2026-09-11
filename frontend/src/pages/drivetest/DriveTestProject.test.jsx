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
    by_age: [
      { name: 'Under a month', value: 20 },
      { name: '1–3 months', value: 15 },
      { name: '3–6 months', value: 8 },
      { name: '6–12 months', value: 4 },
      { name: 'Over a year', value: 1 },
    ],
    without_launch_date: 2,
  },
  problematic_breakdown: {
    total: 10,
    by_category: [
      { name: 'Power', value: 6 },
      { name: 'Access', value: 4 },
    ],
    by_province: [
      { name: 'Kerman', value: 7 },
      { name: 'Yazd', value: 3 },
    ],
  },
  province_breakdown: [
    { name: 'Kerman', onair: 60, done: 23, remaining: 37, ongoing: 30, problematic: 7, done_percent: 38.3 },
    { name: 'Yazd', onair: 40, done: 17, remaining: 23, ongoing: 20, problematic: 3, done_percent: 42.5 },
  ],
  contractor_scorecard: [
    { contractor_id: 1, name: 'Alfa Drive Tests', onair: 60, done: 40, ongoing: 15, problematic: 5, done_percent: 66.7 },
    { contractor_id: 2, name: 'Beta Surveys', onair: 30, done: 9, ongoing: 18, problematic: 3, done_percent: 30.0 },
    { contractor_id: null, name: 'Unattributed', onair: 10, done: 2, ongoing: 6, problematic: 2, done_percent: 20.0 },
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
  return heading.closest('.dt-section')
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
      const tile = within(card).getByText(label).closest('.dt-figure-tile')
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

  it('explains the target line on screen rather than in a tooltip', async () => {
    // The old dashboard's only explanation of the marker was a title
    // attribute, which a touch screen can never reveal.
    serve()
    draw()

    const card = await section('Plan and delivery')
    expect(
      within(card).getByText(/100% of each contractor’s own plan/),
    ).toBeInTheDocument()
  })

  it('colours each bar by band: at target, close to it, short of it', async () => {
    // One contractor in each band, including the middle one — 80-99 is the
    // band a two-colour "met it or did not" reading would lose.
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

    expect(barFor('Beta Surveys')).toHaveStyle({ background: 'var(--green)' })
    expect(barFor('Delta Field')).toHaveStyle({ background: 'var(--amber)' })
    expect(barFor('Gamma Networks')).toHaveStyle({ background: 'var(--red)' })
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
    expect(within(card).getByText('no approved plan')).toBeInTheDocument()
    expect(within(card).queryByText('0%')).not.toBeInTheDocument()
    expect(within(card).getByText('no plan')).toBeInTheDocument()
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
    expect(within(card).getByText('No contractor plans for this month.')).toBeInTheDocument()
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

    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long waiting' }))
    expect(within(ongoing).getByText('Over a year')).toBeInTheDocument()
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
    await userEvent.click(within(ongoing).getByRole('tab', { name: 'How long waiting' }))
    expect(
      within(ongoing).getByText(/2 ongoing sites have no launch date recorded/),
    ).toBeInTheDocument()
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
    expect(chip).toHaveStyle({ color: 'var(--green)' })
  })

  it('reads rising problems as bad news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+4/)
    expect(chip).toHaveStyle({ color: 'var(--red)' })
  })

  it('still reads rising completions as good news', async () => {
    serve(planDelivery(), moving)
    draw()

    await screen.findByLabelText('Programme totals')
    const chip = within(band()).getByText(/\+12/)
    expect(chip).toHaveStyle({ color: 'var(--green)' })
  })

  it('says there is no baseline rather than showing a change of zero', async () => {
    serve()
    draw()

    await screen.findByLabelText('Programme totals')
    expect(screen.getAllByText('no baseline yet').length).toBeGreaterThan(0)
  })
})

describe('the band', () => {
  it('shows every on-air site in exactly one of three segments', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    // 40 done + 50 ongoing + 10 problematic = 100 on-air, and the bar says so
    // because the segments are the total rather than a picture of it.
    const bar = within(band).getByRole('img')
    expect(bar).toHaveAttribute(
      'aria-label',
      'Drive tests done: 40, 40 per cent. Ongoing: 50, 50 per cent. Problematic: 10, 10 per cent',
    )
  })

  it('brackets Remaining under the two segments it is made of', async () => {
    // Remaining is not a fourth figure. The old page asserted the
    // relationship with a heading and a nesting convention; here it is the
    // geometry, and the figure is the sum of the two segments above it.
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    const bracket = within(band).getByText('Remaining').closest('.dt-bracket-text')
    expect(within(bracket).getByText('60')).toBeInTheDocument()
    expect(within(bracket).getByText('60%')).toBeInTheDocument()
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
  it('links each KPI that has sites behind it into the work queue', async () => {
    serve()
    draw()

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).getByText('Drive tests done').closest('a')).toHaveAttribute(
      'href',
      '/work-items?stage=DT+Done',
    )
    expect(within(band).getByText('Problematic').closest('a')).toHaveAttribute(
      'href',
      '/work-items?stage=Problematic',
    )
  })

  it('carries the province filter into the links it builds', async () => {
    serve()
    draw('/reports/drive-test?province=7')

    const band = await screen.findByLabelText('Programme totals')
    expect(within(band).getByText('Problematic').closest('a')).toHaveAttribute(
      'href',
      '/work-items?stage=Problematic&province_id=7',
    )
  })

  it('links every stage in the pipeline to that stage of the queue', async () => {
    serve()
    draw()

    const pipeline = await section('Where the ongoing work is stuck')
    expect(within(pipeline).getByText('Ready for Assignment').closest('a')).toHaveAttribute(
      'href',
      '/work-items?stage=Ready+for+Assignment',
    )
    // A stage with nothing in it is still drawn — "nothing is waiting on
    // approval" is an answer, and a bucket that vanishes when it empties
    // changes what the row of buckets means between readings.
    expect(within(pipeline).getByText('Returned by Contractor')).toBeInTheDocument()
  })

  it('links a contractor row to that contractor’s sites', async () => {
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Alfa Drive Tests').closest('tr')
    expect(within(row).getByText('15').closest('a')).toHaveAttribute(
      'href',
      '/work-items?contractor_id=1',
    )
  })

  it('gives the unattributed row no contractor link, because there is no contractor', async () => {
    serve()
    draw()

    const card = await section('Contractor scorecard')
    const row = within(card).getByText('Unattributed').closest('tr')
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
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

  it('offers every province in the caller’s scope, and no others', async () => {
    serve()
    draw()

    const select = await screen.findByLabelText('Narrow to one province')
    expect(within(select).getByRole('option', { name: 'Kerman' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'All provinces' })).toBeInTheDocument()
    expect(within(select).getAllByRole('option')).toHaveLength(3)
  })

  it('re-fetches when the filter changes', async () => {
    serve()
    draw()

    const select = await screen.findByLabelText('Narrow to one province')
    await userEvent.selectOptions(select, '9')

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/drive-test/overview', {
        params: { province_id: 9 },
      }),
    )
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
