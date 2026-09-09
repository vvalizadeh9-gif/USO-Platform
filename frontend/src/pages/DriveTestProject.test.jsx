// The Drive Test dashboard's plan-and-delivery section.
//
// What is worth testing here is not the layout but what the section reports:
// the four figures, the achievement bars, and the two cases where a number is
// deliberately absent rather than zero — a month with no approved plan, and a
// contractor with none. The rest of the dashboard is charts, which jsdom
// cannot lay out and which say nothing a test can read.
import { render, screen, waitFor, within } from '@testing-library/react'
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
}

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

function serve(plan) {
  api.get.mockImplementation((url) => {
    if (url === '/drive-test/overview') return Promise.resolve({ data: overview })
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
