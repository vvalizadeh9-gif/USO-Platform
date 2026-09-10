// The Drive Test dashboard's plan-and-delivery section and its three
// breakdown sections.
//
// What is worth testing here is not the layout but what the section reports:
// the four figures, the achievement bars, and the two cases where a number is
// deliberately absent rather than zero — a month with no approved plan, and a
// contractor with none. The rest of the dashboard is charts, which jsdom
// cannot lay out and which say nothing a test can read.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { get: vi.fn() },
}))

const api = (await import('../api/client')).default
const DriveTestProject = (await import('./DriveTestProject')).default

// ---------------------------------------------------------------------- data
// Shaped from app/schemas: DriveTestOverview and PlanAndDelivery. The field
// names come from the backend, not from a guess.
const kpi = (value) => ({ value, delta: null, percent_of_onair: null })

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
  ongoing_breakdown: {
    total: 50,
    // Workflow order, zeros kept — the order and the empty buckets are both
    // part of what the tab says, so the fixture carries them.
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
}

/** An overview with ``count`` provinces, for the collapse-and-show-all tests. */
const overviewWithProvinces = (count) => ({
  ...overview,
  province_breakdown: Array.from({ length: count }, (_, i) => ({
    name: `Province ${i + 1}`,
    onair: 100,
    // Descending remaining, the order the backend sends and the page keeps.
    done: i,
    remaining: 100 - i,
    ongoing: 100 - i,
    problematic: 0,
    done_percent: i,
  })),
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

function serve(plan, body = overview) {
  api.get.mockImplementation((url) => {
    if (url === '/drive-test/overview') return Promise.resolve({ data: body })
    if (url === '/drive-test/plan-delivery') return Promise.resolve({ data: plan })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

/** The plan-and-delivery card, once it has loaded. */
async function section() {
  const heading = await screen.findByText('Plan and delivery')
  return heading.closest('.card')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('plan and delivery', () => {
  it('renders the four figures for the month', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getByText('شهریور 1405')).toBeInTheDocument()

    for (const [label, value] of [
      ['PIP', '16'],
      ['Assigned', '9'],
      ['Actual', '6'],
      ['Achievement', '37.5%'],
    ]) {
      const figure = within(card).getByText(label).closest('div').parentElement
      expect(within(figure).getByText(value)).toBeInTheDocument()
    }
  })

  it('says how many contractors have not committed, so a short PIP explains itself', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getByText('1 not committed')).toBeInTheDocument()
  })

  it('draws one achievement bar per contractor, in the order it was given', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getAllByTestId('achievement-bar')).toHaveLength(3)
    // A target marker on every row: the bar is meaningless without the 100%
    // line it is being read against.
    expect(within(card).getAllByTestId('target-marker')).toHaveLength(3)

    for (const [name, percent, detail] of [
      ['Beta Surveys', '100%', '2 of 2'],
      ['Alfa Drive Tests', '75%', '3 of 4'],
      ['Gamma Networks', '10%', '1 of 10'],
    ]) {
      const row = within(card).getByText(name).parentElement
      expect(within(row).getByText(percent)).toBeInTheDocument()
      expect(within(row).getByText(detail)).toBeInTheDocument()
    }
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
    render(<DriveTestProject />)

    const card = await section()
    const barFor = (name) =>
      within(within(card).getByText(name).parentElement).getByTestId('achievement-bar')

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
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getByText('—')).toBeInTheDocument()
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
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getByText('No contractor plans for this month.')).toBeInTheDocument()
    // The rest of the dashboard is still there.
    expect(screen.getByText('Drive Test Overview')).toBeInTheDocument()
  })

  it("gives a contractor their own row and an unnamed programme line", async () => {
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
    render(<DriveTestProject />)

    const card = await section()
    expect(within(card).getByText('Alfa Drive Tests')).toBeInTheDocument()
    expect(within(card).getByText('Programme average')).toBeInTheDocument()
    expect(within(card).getByText('all contractors')).toBeInTheDocument()
    // The benchmark carries no company name with it.
    expect(within(card).getAllByTestId('achievement-bar')).toHaveLength(2)
    expect(within(card).queryByText('Beta Surveys')).not.toBeInTheDocument()
    expect(within(card).queryByText('Gamma Networks')).not.toBeInTheDocument()
  })

  it('leaves the rest of the dashboard standing when this section fails to load', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
      return Promise.reject(new Error('boom'))
    })
    render(<DriveTestProject />)

    expect(await screen.findByText('Drive Test Overview')).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Plan and delivery')).not.toBeInTheDocument()
  })
})

// --------------------------------------------------------------- breakdowns
//
// Same principle as the section above: the layout is not what is worth
// testing. What is, is that each section renders, that its tabs and its
// table toggle actually change what is on screen, and the two places where
// the numbers would stop reconciling silently if the component lost them —
// the no-contractor note, and the collapsed province table's remainder.
describe('breakdown sections', () => {
  /** A card by its heading, once the page has loaded. */
  async function card(title) {
    const heading = await screen.findByText(title)
    return heading.closest('.card')
  }

  it('renders all three sections, each opening on its chart view', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    const problematic = await card('Problematic breakdown')
    const provinces = await card('Province breakdown')

    // Chart first, table on request: bars are present, the table's own
    // Total row is not.
    expect(within(ongoing).getAllByTestId('breakdown-bar')).toHaveLength(2)
    expect(within(ongoing).queryByText('Total')).not.toBeInTheDocument()
    expect(within(problematic).getAllByTestId('breakdown-bar')).toHaveLength(2)
    // The province section is a table by nature and has no chart view.
    expect(within(provinces).getByText('Kerman')).toBeInTheDocument()
  })

  it('shows the ongoing total, and opens on the contractor split', async () => {
    // The Stage tab this section used to open on has been removed: which
    // stage a site is sitting in is what the work queues answer, and reading
    // a pipeline as a row of unrelated buckets answered it badly. by_stage is
    // still in the payload below, deliberately unrendered.
    serve(planDelivery())
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    expect(within(ongoing).getByText('50')).toBeInTheDocument()
    expect(within(ongoing).getByText('ongoing')).toBeInTheDocument()
    expect(within(ongoing).queryByRole('button', { name: 'Stage' })).not.toBeInTheDocument()
    expect(within(ongoing).queryByText('Ready for Assignment')).not.toBeInTheDocument()
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()
  })

  it('switches the ongoing section between its two tabs', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()

    await userEvent.click(within(ongoing).getByRole('button', { name: 'Province' }))
    expect(within(ongoing).getByText('Kerman')).toBeInTheDocument()
    expect(within(ongoing).queryByText('Alfa Drive Tests')).not.toBeInTheDocument()

    await userEvent.click(within(ongoing).getByRole('button', { name: 'Contractor' }))
    expect(within(ongoing).getByText('Alfa Drive Tests')).toBeInTheDocument()
    expect(within(ongoing).queryByText('Kerman')).not.toBeInTheDocument()
  })

  it('states how many ongoing sites have no contractor, so the tab reconciles', async () => {
    // The contractor rows come to 18 of 50 on purpose. Without this note the
    // view looks like it has lost 32 sites.
    serve(planDelivery())
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('button', { name: 'Contractor' }))

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
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('button', { name: 'Contractor' }))

    expect(within(ongoing).getByText('Every ongoing site has a contractor.')).toBeInTheDocument()
  })

  it('toggles each section to a table and back, in the same card', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    for (const [title, unit] of [
      ['Ongoing breakdown', 'Contractor'],
      ['Problematic breakdown', 'Category'],
    ]) {
      const section = await card(title)
      await userEvent.click(within(section).getByRole('button', { name: /Table/ }))

      // A table with the total spelled out — the row a reader checks the
      // section against.
      expect(within(section).getByRole('columnheader', { name: unit })).toBeInTheDocument()
      expect(within(section).getByText('Total')).toBeInTheDocument()
      expect(within(section).queryAllByTestId('breakdown-bar')).toHaveLength(0)

      await userEvent.click(within(section).getByRole('button', { name: /Chart/ }))
      expect(within(section).queryByText('Total')).not.toBeInTheDocument()
      expect(within(section).getAllByTestId('breakdown-bar').length).toBeGreaterThan(0)
    }
  })

  it('adds the table up to the section total', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const problematic = await card('Problematic breakdown')
    await userEvent.click(within(problematic).getByRole('button', { name: /Table/ }))

    // 6 + 4 = 10, the problematic total, at 100% of it.
    const totalRow = within(problematic).getByText('Total').closest('tr')
    expect(within(totalRow).getByText('10')).toBeInTheDocument()
    expect(within(totalRow).getByText('100%')).toBeInTheDocument()
  })

  it('switches the problematic section between category and province', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const problematic = await card('Problematic breakdown')
    expect(within(problematic).getByText('Power')).toBeInTheDocument()

    await userEvent.click(within(problematic).getByRole('button', { name: 'Province' }))
    expect(within(problematic).getByText('Kerman')).toBeInTheDocument()
    expect(within(problematic).queryByText('Power')).not.toBeInTheDocument()
  })

  it('shows the province table in the order it was given, worst first', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    render(<DriveTestProject />)

    const provinces = await card('Province breakdown')
    const names = within(provinces)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.firstChild.textContent)

    // The backend sorts by remaining descending; the page must not re-sort.
    expect(names).toEqual(['Province 1', 'Province 2', 'Province 3', 'Province 4', 'Province 5', 'Province 6'])
  })

  it('collapses the province table to six rows and expands on Show all', async () => {
    serve(planDelivery(), overviewWithProvinces(10))
    render(<DriveTestProject />)

    const provinces = await card('Province breakdown')
    expect(within(provinces).getAllByRole('row')).toHaveLength(7) // header + 6
    expect(within(provinces).getByText('4 more not shown')).toBeInTheDocument()

    await userEvent.click(within(provinces).getByRole('button', { name: /Show all 10 provinces/ }))
    expect(within(provinces).getAllByRole('row')).toHaveLength(11)
    expect(within(provinces).queryByText('4 more not shown')).not.toBeInTheDocument()

    await userEvent.click(within(provinces).getByRole('button', { name: /Show top 6/ }))
    expect(within(provinces).getAllByRole('row')).toHaveLength(7)
  })

  it('offers no Show all control when every province already fits', async () => {
    serve(planDelivery())
    render(<DriveTestProject />)

    const provinces = await card('Province breakdown')
    expect(within(provinces).queryByRole('button', { name: /Show all/ })).not.toBeInTheDocument()
  })

  it('folds the province tail of a breakdown tab into one remainder line', async () => {
    // Ten provinces with ongoing sites: six rows, then one line carrying the
    // other four so the tab still sums to its total.
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
    render(<DriveTestProject />)

    const ongoing = await card('Ongoing breakdown')
    await userEvent.click(within(ongoing).getByRole('button', { name: 'Province' }))

    // 10+9+8+7+6+5 named, then 4+3+2+1 = 10 in the remainder.
    expect(within(ongoing).getAllByTestId('breakdown-bar')).toHaveLength(7)
    const remainder = within(ongoing).getByText('4 more provinces').closest('.row')
    expect(within(remainder).getByText('10')).toBeInTheDocument()
  })

  it('leaves the rest of the dashboard standing when a breakdown is absent', async () => {
    // An older backend, or a payload that lost these fields: the sections
    // that cannot be drawn are simply not drawn, and nothing above them is
    // affected.
    const older = { ...overview }
    delete older.ongoing_breakdown
    delete older.problematic_breakdown
    delete older.province_breakdown
    serve(planDelivery(), older)
    render(<DriveTestProject />)

    expect(await screen.findByText('Drive Test Overview')).toBeInTheDocument()
    expect(screen.queryByText('Ongoing breakdown')).not.toBeInTheDocument()
    expect(screen.queryByText('Province breakdown')).not.toBeInTheDocument()
    // The existing charts and cards are untouched by their absence.
    expect(screen.getByText('Drive test progress per province')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
  })
})
