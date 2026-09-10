// The monthly plan screen, from both sides.
//
// What is worth testing here is not the layout but the two things this screen
// gets wrong easily: showing the contractor a form when the number is no
// longer theirs to change, and offering a decision to somebody who cannot
// make one. Both are re-checked by the server — these tests are about what
// the interface offers, which is what decides whether a person can work.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const api = (await import('../../api/client')).default
const MonthlyPlan = (await import('./MonthlyPlan')).default

function signedInAs(roleName) {
  mockAuth.current = { user: { full_name: 'Someone', role: { name: roleName } } }
}

// ---------------------------------------------------------------------- data
// Shaped from app/schemas: MonthlyPlanContext, MonthlyPlanQueueOut and the
// rows they carry. Field names come from the backend, not from a guess.
const plan = (over = {}) => ({
  id: 7,
  contractor_id: 3,
  shamsi_year: 1405,
  shamsi_month: 6,
  version: 1,
  is_current: true,
  committed_count: 40,
  status: 'Draft',
  is_default: false,
  submitted_by: null,
  submitted_at: null,
  decided_by: null,
  decided_at: null,
  return_comment: null,
  is_late: false,
  ...over,
})

const context = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  shamsi_month_name: 'شهریور',
  plan: null,
  previous_month_committed: 30,
  open_assignments: 12,
  deadline_shamsi: '1405/06/03',
  deadline_gregorian: '2026-08-25',
  deadline_passed: false,
  ...over,
})

const HISTORY = [
  {
    shamsi_year: 1405, shamsi_month: 6, shamsi_month_name: 'شهریور',
    committed_count: null, status: 'Draft', version: 1,
  },
  {
    shamsi_year: 1405, shamsi_month: 5, shamsi_month_name: 'مرداد',
    committed_count: 30, status: 'Approved', version: 1,
  },
]

const queueRow = (over = {}) => ({
  contractor_id: 1,
  contractor_name: 'Alpha Telecom',
  plan_id: 11,
  status: 'Submitted',
  committed_count: 40,
  previous_month_committed: 30,
  version: 1,
  submitted_at: '2026-08-24T09:00:00Z',
  is_late: false,
  return_comment: null,
  ...over,
})

const queue = (rows) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  shamsi_month_name: 'شهریور',
  deadline_shamsi: '1405/06/03',
  deadline_passed: false,
  rows,
})

// The queue as it usually looks on day four: one waiting on the PM, one
// already decided, and one company that has not filed at all.
const MIXED_QUEUE = queue([
  queueRow(),
  queueRow({
    contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12,
    status: 'Approved', committed_count: 25, previous_month_committed: 20,
  }),
  queueRow({
    contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: null,
    status: null, committed_count: null, previous_month_committed: 18, version: null,
  }),
])

//: The scorecard that now sits above the form. Its own behaviour is covered
//: in Scorecard.test.jsx; here it only has to render so that the form below it
//: can be reached, which is what these tests are about.
const SCORECARD = {
  months: [
    {
      shamsi_year: 1405, shamsi_month: 5, shamsi_month_name: 'مرداد',
      pip: 30, carried_in: 4, newly_assigned: 28, available: 32,
      delivered: 26, released: 2, carried_out: 4,
      achievement_percent: 86.7, coverage_percent: 106.7, execution_percent: 81.3,
      committed_contractors: 1, uncommitted_contractors: 0, rows: [],
    },
  ],
  summable: ['newly_assigned', 'delivered', 'released', 'pip'],
  balances: ['carried_in', 'available', 'carried_out'],
  is_contractor: false,
}

function serve({ my, queue: q, scorecard = SCORECARD }) {
  api.get.mockImplementation((url) => {
    if (url === '/pip/my') return Promise.resolve({ data: my })
    if (url === '/pip/my/history') return Promise.resolve({ data: HISTORY })
    if (url === '/pip/queue') return Promise.resolve({ data: q })
    if (url === '/pip/scorecard') return Promise.resolve({ data: scorecard })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const show = () => render(<ToastProvider><MonthlyPlan /></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({ data: {} })
})

// ----------------------------------------------------------------- the form
describe('a contractor filling in the month', () => {
  it('offers the number and hands it in', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    const input = await screen.findByLabelText(/drive tests committed/i)
    await userEvent.type(input, '42')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/pip/my',
        expect.objectContaining({ committed_count: 42, submit: true }),
      ),
    )
  })

  it('saves a draft without submitting it', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await userEvent.type(await screen.findByLabelText(/drive tests committed/i), '15')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/pip/my',
        expect.objectContaining({ committed_count: 15, submit: false }),
      ),
    )
  })

  it('shows the context the number is decided against', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    // Scoped to the tile each number belongs to: the same figures appear in
    // the history table underneath, and a bare getByText('30') would pass on
    // the wrong one.
    const tile = (label) => screen.getByText(label).closest('.stat')
    await screen.findByText(/last month, approved/i)
    expect(within(tile(/last month, approved/i)).getByText('30')).toBeInTheDocument()
    expect(within(tile(/sites you hold now/i)).getByText('12')).toBeInTheDocument()
    expect(within(tile(/^due$/i)).getByText('1405/06/03')).toBeInTheDocument()
  })

  it('puts the PM comment in front of them when the plan came back', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        plan: plan({ status: 'Returned', return_comment: 'Too low against your 30 open sites.' }),
      }),
    })
    show()

    expect(await screen.findByText(/the pm sent this back/i)).toBeInTheDocument()
    expect(screen.getByText('Too low against your 30 open sites.')).toBeInTheDocument()
    // And the way to answer it, labelled as the answer it is.
    expect(screen.getByRole('button', { name: 'Resubmit' })).toBeInTheDocument()
  })

  it('locks an approved plan and offers a revision instead', async () => {
    signedInAs('Contractor')
    serve({ my: context({ plan: plan({ status: 'Approved', committed_count: 40 }) }) })
    show()

    const card = (await screen.findByText('YOUR COMMITMENT')).closest('.card')
    expect(within(card).getByText('Approved')).toBeInTheDocument()
    expect(within(card).getByText('40')).toBeInTheDocument()
    expect(within(card).getByText(/locked/i)).toBeInTheDocument()
    // No way to edit the number that is somebody's target.
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Revise' }))
    const input = screen.getByLabelText(/drive tests committed/i)
    expect(input).toHaveValue(40)

    await userEvent.clear(input)
    await userEvent.type(input, '45')
    await userEvent.click(screen.getByRole('button', { name: 'Open revision' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/pip/my/revise',
        expect.objectContaining({ committed_count: 45 }),
      ),
    )
  })

  it('holds a submitted plan read-only while the PM has it', async () => {
    signedInAs('Contractor')
    serve({ my: context({ plan: plan({ status: 'Submitted' }) }) })
    show()

    expect(await screen.findByText(/waiting on the pm/i)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('shows their own months, and only an approved figure as a commitment', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    // Scoped to the history card. The scorecard above it names months too,
    // so an unscoped query now matches both and would pass on either.
    const history = (await screen.findByText(/your last 6 months/i)).closest('.card')
    expect(within(history).getByText(/مرداد 1405/)).toBeInTheDocument()
    expect(within(history).getByText('30')).toBeInTheDocument()
  })

  it('says so rather than showing an empty form when the server refuses', async () => {
    signedInAs('Contractor')
    api.get.mockImplementation((url) =>
      url === '/pip/my'
        ? Promise.reject({ response: { status: 403 } })
        : Promise.resolve({ data: [] }),
    )
    show()

    expect(await screen.findByText(/belongs to a contractor account/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- the queue
describe('the PM deciding the month', () => {
  it('lists every contractor, including one who has not filed', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    expect(await screen.findByText('Alpha Telecom')).toBeInTheDocument()
    expect(screen.getByText('Beta Networks')).toBeInTheDocument()
    expect(screen.getByText('Gamma Survey')).toBeInTheDocument()
    expect(screen.getByText('Not submitted')).toBeInTheDocument()
    expect(screen.getByText(/1 not submitted/)).toBeInTheDocument()
  })

  it('totals what the month has been committed to', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    const totals = (await screen.findByText(/total — 3 contractors/i)).closest('tr')
    expect(within(totals).getByText('65')).toBeInTheDocument()
  })

  it('will not return a plan until there is a reason to send back', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Alpha Telecom' }))

    const returnButton = screen.getByRole('button', { name: /return/i })
    expect(returnButton).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/comment/i), 'Please account for the 12 open sites.')
    expect(returnButton).toBeEnabled()

    await userEvent.click(returnButton)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/pip/11/return', {
        comment: 'Please account for the 12 open sites.',
      }),
    )
  })

  it('approves the plan that is waiting on them', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Alpha Telecom' }))
    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/11/approve'))
  })

  it('offers no decision on a plan that is not waiting on them', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Beta Networks' }))
    expect(screen.getByText(/approved and locked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
  })
})

describe('everyone else who reads the queue', () => {
  it('shows a coordinator the month and no way to decide it', async () => {
    signedInAs('Coordinator')
    serve({ queue: MIXED_QUEUE })
    show()

    expect(await screen.findByText('Alpha Telecom')).toBeInTheDocument()
    expect(screen.getByText('Gamma Survey')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument()
    // Nothing to select, so nothing opens a panel that would 403.
    expect(screen.queryByRole('button', { name: 'Alpha Telecom' })).not.toBeInTheDocument()
  })

  it('says so when the server refuses the queue', async () => {
    signedInAs('Viewer')
    api.get.mockRejectedValue({ response: { status: 403 } })
    show()

    expect(await screen.findByText(/not yours to read/i)).toBeInTheDocument()
  })
})
