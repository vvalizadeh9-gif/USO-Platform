// The PIP scorecard.
//
// What is worth testing here is not that twelve rows render. It is the three
// claims the screen makes that a reader would otherwise have to take on trust:
//
//   * the Available column is never totalled, because it is a balance and
//     adding it would count a carried site once per month it stayed open;
//   * a month with no approved plan reads as unmeasured, not as a failure;
//   * a contractor is offered no way to name another company.
//
// The arithmetic itself is the server's and is asserted there
// (backend/tests/test_pip_scorecard.py), on figures a real request produced.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const api = (await import('../../api/client')).default
const Scorecard = (await import('./Scorecard')).default

// Shaped from app/schemas: ScorecardOut. Field names come from the backend.
const month = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 5,
  shamsi_month_name: 'مرداد',
  pip: 30,
  carried_in: 4,
  newly_assigned: 28,
  available: 32,
  delivered: 26,
  released: 2,
  carried_out: 4,
  achievement_percent: 86.7,
  coverage_percent: 106.7,
  execution_percent: 81.3,
  committed_contractors: 2,
  uncommitted_contractors: 0,
  rows: [],
  ...over,
})

const row = (over = {}) => ({
  contractor_id: 1,
  name: 'Alfa Drive Tests',
  pip: 20,
  carried_in: 3,
  newly_assigned: 18,
  available: 21,
  delivered: 18,
  released: 1,
  carried_out: 2,
  achievement_percent: 90,
  execution_percent: 85.7,
  coverage_percent: 105,
  ...over,
})

const payload = (over = {}) => ({
  months: [
    month({ shamsi_month: 4, shamsi_month_name: 'تیر', pip: 20, delivered: 22, achievement_percent: 110 }),
    month(),
  ],
  summable: ['newly_assigned', 'delivered', 'released', 'pip'],
  balances: ['carried_in', 'available', 'carried_out'],
  is_contractor: false,
  ...over,
})

function serve(data) {
  api.get.mockImplementation((url) => {
    if (url === '/pip/scorecard') return Promise.resolve({ data })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const show = (props = {}) =>
  render(
    <ToastProvider>
      <Scorecard canSeeAllContractors {...props} />
    </ToastProvider>,
  )

const card = async (title) => (await screen.findByText(title)).closest('.card')

beforeEach(() => vi.clearAllMocks())

// --------------------------------------------------------- balances vs flows
describe('what may be added up', () => {
  it('totals the flows and leaves the balance column as a dash', async () => {
    serve(payload())
    show()

    const grid = await card('Month by month')
    const footer = within(grid).getByText(/Total — 2 months/).closest('tr')
    const cells = within(footer).getAllByRole('cell').map((c) => c.textContent)

    // PIP 20 + 30 and delivered 22 + 26 are flows and add up.
    expect(cells).toContain('50')
    expect(cells).toContain('48')
    // Available is a balance: 21 + 32 would count a carried site twice.
    expect(cells).toContain('—')
    expect(cells).not.toContain('53')
  })

  it('says why the column is not totalled, where the column is', async () => {
    serve(payload())
    show()

    const grid = await card('Month by month')
    expect(
      within(grid).getByText(/counted in all three, so the column is not totalled/i),
    ).toBeInTheDocument()
  })

  it('takes the list of flows from the server rather than repeating it', async () => {
    // The server calls only delivered a flow here. The footer must follow it,
    // not a copy of the rule kept in the component.
    serve(payload({ summable: ['delivered'] }))
    show()

    const grid = await card('Month by month')
    const footer = within(grid).getByText(/Total — 2 months/).closest('tr')
    expect(within(footer).getByText('48')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------- no plan ≠ zero
describe('a month with no approved plan', () => {
  it('reads as unmeasured rather than as a failure', async () => {
    serve(
      payload({
        months: [month({ pip: 0, achievement_percent: null, coverage_percent: null })],
      }),
    )
    show()

    const grid = await card('Month by month')
    expect(within(grid).getByText('no plan')).toBeInTheDocument()
    expect(within(grid).queryByText('0%')).not.toBeInTheDocument()
  })

  it('says so in the funnel too', async () => {
    serve(payload({ months: [month({ pip: 0, achievement_percent: null })] }))
    show()

    expect(
      await screen.findByText(/not an achievement of zero/i),
    ).toBeInTheDocument()
  })
})

// -------------------------------------------------------------- the funnel
describe('attributing a bad month', () => {
  it('calls out an assignment gap when the work was never handed over', async () => {
    serve(
      payload({
        months: [
          month({ pip: 30, available: 12, delivered: 11, achievement_percent: 36.7 }),
        ],
      }),
    )
    show()

    expect(
      await screen.findByText(/partly an assignment gap rather than a delivery one/i),
    ).toBeInTheDocument()
  })

  it('puts it on execution when there was plenty of work in hand', async () => {
    serve(
      payload({
        months: [
          month({ pip: 30, available: 40, delivered: 12, achievement_percent: 40 }),
        ],
      }),
    )
    show()

    expect(
      await screen.findByText(/shortfall is in execution, not in what was assigned/i),
    ).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ scoping
describe('what a contractor is offered', () => {
  it('does not offer to open a month into other companies', async () => {
    serve(payload({ is_contractor: true }))
    show({ canSeeAllContractors: false })

    const grid = await card('Month by month')
    expect(within(grid).getByText(/No other company appears here/i)).toBeInTheDocument()
    expect(within(grid).queryByRole('button', { expanded: false })).toBeNull()
  })

  it('opens a month into its contractors for staff', async () => {
    serve(payload({ months: [month({ rows: [row(), row({ contractor_id: 2, name: 'Beta Surveys' })] })] }))
    show()

    const grid = await card('Month by month')
    await userEvent.click(within(grid).getByRole('button', { name: /مرداد 1405/ }))

    expect(await within(grid).findByText('Alfa Drive Tests')).toBeInTheDocument()
    expect(within(grid).getByText('Beta Surveys')).toBeInTheDocument()
    // The full ledger is here, where there is room for it.
    expect(within(grid).getByRole('columnheader', { name: 'Carried in' })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------- chart
describe('the delivery chart', () => {
  it('draws a target only for a month that had a plan', async () => {
    serve(payload({ months: [month(), month({ shamsi_month: 6, pip: 0 })] }))
    show()

    const chart = await card('Commitment against delivery')
    expect(within(chart).getAllByTestId('delivered-bar')).toHaveLength(2)
    expect(within(chart).getAllByTestId('pip-target')).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ failure
describe('when the server will not answer', () => {
  it('loses the scorecard and not the page', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    show()

    expect(await screen.findByText(/could not load the scorecard/i)).toBeInTheDocument()
  })

  it('degrades rather than throwing on a payload with no months', async () => {
    serve({ summable: [], balances: [] })
    show()

    expect(await screen.findByText(/nothing to show yet/i)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------- range
describe('the range', () => {
  it('asks the server again when the window changes', async () => {
    serve(payload())
    show()

    await screen.findByText('Month by month')
    expect(api.get).toHaveBeenCalledWith('/pip/scorecard', { params: { months: 12 } })

    await userEvent.click(screen.getByRole('button', { name: '1405' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/scorecard', { params: { year: 1405 } }),
    )
  })
})
