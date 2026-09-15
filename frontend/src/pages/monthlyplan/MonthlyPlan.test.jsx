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
const planning = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 7,
  shamsi_month_name: 'مهر',
  label: 'مهر 1405',
  version: 1,
  status: null,
  committed_count: null,
  return_comment: null,
  returned_by: null,
  deadline_shamsi: '1405/07/03',
  deadline_gregorian: '2026-09-25',
  deadline_passed: false,
  is_late: false,
  days_remaining: 6,
  ...over,
})

const month = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  shamsi_month_name: 'شهریور',
  label: 'شهریور 1405',
  assignment: 76,
  carried_in: 52,
  newly_assigned: 24,
  pip: 38,
  delivered: 24,
  pace_pct: 81,
  ...over,
})

const point = (over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 5,
  shamsi_month_name: 'مرداد',
  label: 'مرداد 1405',
  assignment: 60,
  pip: 50,
  delivered: 22,
  in_progress: false,
  ...over,
})

const HISTORY_POINTS = [
  point({ shamsi_month: 4, shamsi_month_name: 'تیر', label: 'تیر 1405', pip: 45, delivered: 38 }),
  point(),
  point({
    shamsi_month: 6, shamsi_month_name: 'شهریور', label: 'شهریور 1405',
    assignment: 76, pip: 38, delivered: 24, in_progress: true,
  }),
]

const context = (over = {}) => {
  const { planning: p, current_month: c, ...rest } = over
  return {
    shamsi_year: 1405,
    shamsi_month: 7,
    shamsi_month_name: 'مهر',
    plan: null,
    previous_month_committed: 30,
    open_assignments: 12,
    deadline_shamsi: '1405/07/03',
    deadline_gregorian: '2026-09-25',
    deadline_passed: false,
    planning: planning(p),
    current_month: month(c),
    history: HISTORY_POINTS,
    ...rest,
  }
}

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
//
// The contractor's screen is one card read top to bottom: what the PM said,
// the number being filed, where the running month stands, and the six months
// behind it. What these tests hold up is that order, the three words the
// figures are called by, and the two buttons that are no longer there.
describe('a contractor filing next month', () => {
  it('names the month being planned and hands the number in', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    expect(await screen.findByText('Planning مهر 1405')).toBeInTheDocument()

    const input = await screen.findByLabelText(/your مهر PIP/i)
    await userEvent.type(input, '42')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/pip/my',
        expect.objectContaining({ committed_count: 42, submit: true }),
      ),
    )
  })

  it('offers no draft to save and no revision to open', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByRole('button', { name: 'Submit' })
    // The endpoints behind both are gone; offering either would be a button
    // whose only outcome is an error.
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revise/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open revision/i })).not.toBeInTheDocument()
  })

  it('shows the version, the deadline and how long is left beside the field', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    const meta = (await screen.findByText(/1405\/07\/03/)).closest('.pip-meta')
    expect(meta).toHaveTextContent('Version 1')
    expect(meta).toHaveTextContent('6 days left')
  })

  it('says how late it is once the deadline is behind them', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { days_remaining: -4, deadline_passed: true } }) })
    show()

    expect(await screen.findByText('4 days late')).toBeInTheDocument()
  })

  it('puts the PM comment, and their name, in front of the field that answers it', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        planning: {
          status: 'Returned',
          return_comment: 'You delivered 22 in مرداد against a PIP of 50. Resubmit closer to 30.',
          returned_by: 'Ali Karimi',
        },
      }),
    })
    show()

    const note = (await screen.findByText(/Ali Karimi, PM/)).closest('.pip-note')
    expect(within(note).getByText(/Resubmit closer to 30/)).toBeInTheDocument()
    // And the way to answer it, labelled as the answer it is.
    expect(screen.getByRole('button', { name: 'Resubmit' })).toBeInTheDocument()
  })

  it('renders the PM comment as text and never as markup', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        planning: {
          status: 'Returned',
          return_comment: '<img src=x onerror="alert(1)">too low',
          returned_by: 'Ali Karimi',
        },
      }),
    })
    show()

    const note = (await screen.findByText(/Ali Karimi, PM/)).closest('.pip-note')
    expect(note.querySelector('img')).toBeNull()
    expect(note).toHaveTextContent('<img src=x onerror="alert(1)">too low')
  })

  it('locks a plan the PM has already approved', async () => {
    signedInAs('Contractor')
    serve({
      my: context({ planning: { status: 'Approved', committed_count: 40 } }),
    })
    show()

    expect(await screen.findByText(/this is your target for the month/i)).toBeInTheDocument()
    expect(document.querySelector('.pip-locked')).toHaveTextContent('40')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit|revise/i })).not.toBeInTheDocument()
  })

  it('holds a submitted plan read-only while the PM has it', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { status: 'Submitted', committed_count: 40 } }) })
    show()

    expect(await screen.findByText(/waiting on the pm/i)).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  // ------------------------------------------------- where the month stands
  it('shows the three figures, with the split behind the assignment', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByText(/شهریور 1405 — where you stand/)
    const card = (label) => screen.getByText(label).closest('.stat')
    expect(within(card('Assignment')).getByText('76')).toBeInTheDocument()
    expect(within(card('Assignment')).getByText('52 carried in + 24 new')).toBeInTheDocument()
    expect(within(card('PIP')).getByText('38')).toBeInTheDocument()
    expect(within(card('Delivered')).getByText('24')).toBeInTheDocument()
  })

  it('measures delivery against the calendar, in drive tests', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    // 24 of 38 is 63%; the calendar is 81% through, which is 31 of them.
    const standing = (await screen.findByText(/delivered against pip/i)).closest('.pip-standtop')
    expect(standing).toHaveTextContent('24 of 38 · 63%')
    expect(screen.getByText(/Marker at 81%/)).toBeInTheDocument()
    expect(screen.getByText(/7 drive tests behind that pace/)).toBeInTheDocument()
    expect(screen.getByTestId('pip-pace')).toHaveStyle({ left: '81%' })
  })

  it('shows a dash rather than a zero when no PIP was approved', async () => {
    signedInAs('Contractor')
    serve({ my: context({ current_month: { pip: null } }) })
    show()

    const card = (await screen.findByText('PIP')).closest('.stat')
    expect(within(card).getByText('—')).toBeInTheDocument()
    // Nothing to measure against, so nothing is measured — and no bar.
    expect(screen.getByText(/nothing to measure this month/i)).toBeInTheDocument()
    expect(screen.queryByTestId('pip-pace')).not.toBeInTheDocument()
  })

  it('drops the pace marker once the month is over', async () => {
    signedInAs('Contractor')
    serve({ my: context({ current_month: { pace_pct: 100, delivered: 38 } }) })
    show()

    await screen.findByText(/the month is over/i)
    expect(screen.queryByTestId('pip-pace')).not.toBeInTheDocument()
  })

  it('survives a month with no assignment at all', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        current_month: { assignment: 0, carried_in: 0, newly_assigned: 0, delivered: 0, pip: null },
      }),
    })
    show()

    const card = (await screen.findByText('Assignment')).closest('.stat')
    expect(within(card).getByText('0')).toBeInTheDocument()
  })

  // -------------------------------------------------------------- the chart
  it('draws a month for every one that came back, and no more', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    const chart = await screen.findByRole('img', { name: /delivered against the approved PIP/i })
    // Three months of history, not six: a programme younger than the window
    // draws what happened, not blanks where it did not.
    expect(chart.querySelectorAll('.pip-band')).toHaveLength(3)
    expect(chart.querySelectorAll('.pip-target')).toHaveLength(3)
    expect(chart).toHaveAccessibleName(/تیر 1405: 38 delivered, 84% of 45/)
    expect(chart).toHaveAccessibleName(/شهریور 1405: 24 delivered, 63% of 38, still running/)
  })

  it('draws no target and no percentage for a month with no PIP', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        history: [point({ pip: null, delivered: 4 }), point({ shamsi_month: 6, in_progress: true })],
      }),
    })
    show()

    const chart = await screen.findByRole('img', { name: /delivered against the approved PIP/i })
    expect(chart.querySelectorAll('.pip-target')).toHaveLength(1)
    expect(within(chart).getByText('—')).toBeInTheDocument()
  })

  // ---------------------------------------------------------- what is gone
  it('shows neither the scorecard ledger nor a table of past months', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByText('Planning مهر 1405')
    // The three cards and the chart say what both of them said.
    expect(document.querySelector('table')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/pip/scorecard', expect.anything())
    expect(api.get).not.toHaveBeenCalledWith('/pip/my/history', expect.anything())
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
