// The monthly plan screen, from both sides.
//
// What is worth testing here is not the layout but the two things this screen
// gets wrong easily: showing the contractor a form when the number is no
// longer theirs to change, and offering a decision to somebody who cannot
// make one. Both are re-checked by the server — these tests are about what
// the interface offers, which is what decides whether a person can work.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'
import { currentShamsiPeriod, nextPeriod, shamsiMonthName } from '../../lib/shamsi'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const api = (await import('../../api/client')).default
const MonthlyPlan = (await import('./MonthlyPlan')).default
const PlanQueue = (await import('./PlanQueue')).default
const AcceptanceTarget = (await import('./AcceptanceTarget')).default

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
  // The running month, not the one being decided — see MonthlyPlanQueueRow.
  assignment: 76,
  pip: 38,
  delivered: 24,
  ...over,
})

const queue = (rows, over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 7,
  shamsi_month_name: 'مهر',
  label: 'مهر 1405',
  deadline_shamsi: '1405/07/03',
  deadline_passed: false,
  days_remaining: 6,
  current_month: month(over.current_month),
  rows,
})

// The queue as it usually looks on day four: one waiting on the PM, one
// already decided, and one company that has not filed at all.
const MIXED_QUEUE = queue([
  queueRow(),
  queueRow({
    contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12,
    status: 'Approved', committed_count: 25, previous_month_committed: 20,
    assignment: 52, pip: 44, delivered: 39,
  }),
  queueRow({
    contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: null,
    status: null, committed_count: null, previous_month_committed: 18, version: null,
    assignment: 31, pip: null, delivered: 11,
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

/** Shaped from app/schemas: AcceptancePlanResponse. */
const acceptancePlan = (over = {}) => ({
  current: {
    shamsi_year: 1405, shamsi_month: 6, label: 'شهریور 1405',
    target_count: 3200, set_by: 'PM One', set_at: '2026-08-20T00:00:00Z', note: null,
  },
  previous: {
    shamsi_year: 1405, shamsi_month: 5, label: 'مرداد 1405',
    target_count: 2860, set_by: 'PM One', set_at: '2026-07-20T00:00:00Z', note: null,
  },
  history: [],
  ...over,
})

const revisionsOut = (params = {}) => ({
  contractor_id: 1, contractor_name: 'Alpha Telecom', stream: params.stream || 'DT',
  shamsi_year: params.year, shamsi_month: params.month, shamsi_month_name: 'مهر',
  revisions: [],
})

function serve({ my, queue: q, scorecard = SCORECARD, plan = acceptancePlan() }) {
  api.get.mockImplementation((url, config) => {
    // `my` is one context for every /pip/my read, or a function of the
    // params (year, month, stream) when a test needs them to differ.
    if (url === '/pip/my') {
      return Promise.resolve({ data: typeof my === 'function' ? my(config?.params ?? {}) : my })
    }
    if (url === '/pip/revisions') return Promise.resolve({ data: revisionsOut(config?.params) })
    if (url === '/pip/queue') return Promise.resolve({ data: q })
    if (url === '/pip/scorecard') return Promise.resolve({ data: scorecard })
    if (url === '/acceptance/plan') {
      return plan instanceof Error ? Promise.reject(plan) : Promise.resolve({ data: plan })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const show = (path = '/monthly-plan') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><MonthlyPlan /></ToastProvider>
    </MemoryRouter>,
  )
const showQueue = (canDecide = true) =>
  render(<ToastProvider><PlanQueue period={{ year: 1405, month: 7 }} canDecide={canDecide} /></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({ data: {} })
  api.put.mockResolvedValue({ data: {} })
})

// ----------------------------------------------------------------- the form
//
// The contractor's screen is one card read top to bottom: what the PM said,
// the number being filed, where the running month stands, and the six months
// behind it. What these tests hold up is that order, the three words the
// figures are called by, and the two buttons that are no longer there.
describe('a contractor filing next month', () => {
  it('names the month being planned and hands both numbers in, one plan per stream', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    expect(await screen.findByText('Planning مهر 1405')).toBeInTheDocument()

    await userEvent.type(await screen.findByLabelText(/your مهر DT PIP/i), '42')
    await userEvent.type(screen.getByLabelText(/your مهر Acceptance PIP/i), '18')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post).toHaveBeenCalledWith(
      '/pip/my',
      expect.objectContaining({ stream: 'DT', committed_count: 42, submit: true }),
    )
    expect(api.post).toHaveBeenCalledWith(
      '/pip/my',
      expect.objectContaining({ stream: 'ACCEPTANCE', committed_count: 18, submit: true }),
    )
  })

  it('reads each stream’s plan on its own', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByText('Planning مهر 1405')
    const streams = api.get.mock.calls
      .filter(([url]) => url === '/pip/my')
      .map(([, config]) => config.params.stream)
    expect(streams).toContain('DT')
    expect(streams).toContain('ACCEPTANCE')
  })

  it('will not hand in one number without the other', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await userEvent.type(await screen.findByLabelText(/your مهر DT PIP/i), '42')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('Enter your Acceptance PIP')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('says which number failed, and does not report success for both', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    api.post.mockImplementation((url, body) =>
      body.stream === 'ACCEPTANCE'
        ? Promise.reject({ response: { data: { detail: 'The deadline has passed' } } })
        : Promise.resolve({ data: {} }),
    )
    show()

    await userEvent.type(await screen.findByLabelText(/your مهر DT PIP/i), '42')
    await userEvent.type(screen.getByLabelText(/your مهر Acceptance PIP/i), '18')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('Only your DT PIP was handed in')).toBeInTheDocument()
    expect(screen.getByText(/Acceptance: The deadline has passed/)).toBeInTheDocument()
    expect(screen.queryByText('Handed in')).not.toBeInTheDocument()
  })

  it('submits only the stream still open when the other is with the PM', async () => {
    signedInAs('Contractor')
    serve({
      my: ({ stream }) =>
        stream === 'DT'
          ? context({ planning: { status: 'Submitted', committed_count: 40 } })
          : context(),
    })
    show()

    await userEvent.type(await screen.findByLabelText(/your مهر Acceptance PIP/i), '18')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post).toHaveBeenCalledWith('/pip/my', expect.objectContaining({ stream: 'ACCEPTANCE' }))
  })

  // The old rule was "no revision, ever"; revisions now exist, for the running
  // month's approved PIP only. With nothing approved there is nothing to revise.
  it('offers no draft to save, and no revision while nothing is approved', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByRole('button', { name: 'Submit' })
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request revision/i })).not.toBeInTheDocument()
  })

  it('shows the version, the deadline and how long is left beside each field', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    const metas = await screen.findAllByText(/1405\/07\/03/)
    expect(metas).toHaveLength(2)
    for (const node of metas) {
      const meta = node.closest('.pip-meta')
      expect(meta).toHaveTextContent('Version 1')
      expect(meta).toHaveTextContent('6 days left')
    }
  })

  it('says how late it is once the deadline is behind them', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { days_remaining: -4, deadline_passed: true } }) })
    show()

    expect((await screen.findAllByText('4 days late')).length).toBeGreaterThan(0)
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

    const note = (await screen.findAllByText(/Ali Karimi, PM/))[0].closest('.pip-note')
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

    const note = (await screen.findAllByText(/Ali Karimi, PM/))[0].closest('.pip-note')
    expect(note.querySelector('img')).toBeNull()
    expect(note).toHaveTextContent('<img src=x onerror="alert(1)">too low')
  })

  it('locks a plan the PM has already approved', async () => {
    signedInAs('Contractor')
    serve({
      my: context({ planning: { status: 'Approved', committed_count: 40 } }),
    })
    show()

    expect((await screen.findAllByText(/this is your target for the month/i)).length).toBe(2)
    expect(document.querySelector('.pip-locked')).toHaveTextContent('40')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit|revise/i })).not.toBeInTheDocument()
  })

  it('holds a submitted plan read-only while the PM has it', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { status: 'Submitted', committed_count: 40 } }) })
    show()

    expect((await screen.findAllByText(/waiting on the pm/i)).length).toBe(2)
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

  // ----------------------------------------------------- revision requests
  //
  // The running month is شهریور (the fixture's current_month); the picker
  // opens on the planning month, so the running month is read separately.
  const runningApproved = (over = {}) =>
    context({
      shamsi_month: 6,
      planning: {
        shamsi_month: 6, shamsi_month_name: 'شهریور', label: 'شهریور 1405',
        status: 'Approved', committed_count: 38, version: 1,
        in_force_count: 38, in_force_version: 1, revision_open: true,
        ...over,
      },
    })
  const byMonth = (running) => ({ month: m, stream }) =>
    m === 6 ? running(stream) : context()

  it('asks the PM for a new number, with a reason, while the window is open', async () => {
    signedInAs('Contractor')
    serve({ my: byMonth(() => runningApproved()) })
    show()

    const row = (await screen.findAllByRole('button', { name: 'Request revision' }))[0].closest('[data-revision]')
    expect(row).toHaveAttribute('data-revision', 'DT')
    await userEvent.click(within(row).getByRole('button', { name: 'Request revision' }))
    await userEvent.type(within(row).getByRole('spinbutton'), '35')
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'SITES_BLOCKED')
    await userEvent.click(within(row).getByRole('button', { name: 'Send to PM' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/pip/my/revision-request', {
        year: 1405, month: 6, stream: 'DT', committed_count: 35, reason: 'SITES_BLOCKED', comment: undefined,
      }),
    )
  })

  it('needs a comment when the reason is Other', async () => {
    signedInAs('Contractor')
    serve({ my: byMonth(() => runningApproved()) })
    show()

    const row = (await screen.findAllByRole('button', { name: 'Request revision' }))[0].closest('[data-revision]')
    await userEvent.click(within(row).getByRole('button', { name: 'Request revision' }))
    await userEvent.type(within(row).getByRole('spinbutton'), '35')
    await userEvent.selectOptions(within(row).getByRole('combobox'), 'OTHER')
    await userEvent.click(within(row).getByRole('button', { name: 'Send to PM' }))

    expect(await screen.findByText('Add a comment')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('offers a revision for each approved stream', async () => {
    signedInAs('Contractor')
    serve({ my: byMonth(() => runningApproved()) })
    show()

    const buttons = await screen.findAllByRole('button', { name: 'Request revision' })
    expect(buttons.map((b) => b.closest('[data-revision]').dataset.revision)).toEqual(['DT', 'ACCEPTANCE'])
  })

  it('hides the request once the window has closed', async () => {
    signedInAs('Contractor')
    serve({ my: byMonth(() => runningApproved({ revision_open: false })) })
    show()

    await screen.findByText('شهریور 1405 — your approved PIP')
    expect(screen.queryByRole('button', { name: 'Request revision' })).not.toBeInTheDocument()
  })

  it('says a request is pending and the approved number stays in force', async () => {
    signedInAs('Contractor')
    serve({
      my: byMonth((stream) =>
        stream === 'DT'
          ? runningApproved({ status: 'RevisionRequested', committed_count: 35, version: 2 })
          : runningApproved(),
      ),
    })
    show()

    expect(await screen.findByText('Revision to 35 requested · 38 stays in force')).toBeInTheDocument()
    const dt = document.querySelector('[data-revision="DT"]')
    expect(within(dt).queryByRole('button', { name: 'Request revision' })).not.toBeInTheDocument()
  })

  it('shows the PM’s comment when a request was returned', async () => {
    signedInAs('Contractor')
    serve({
      my: byMonth((stream) =>
        stream === 'ACCEPTANCE'
          ? runningApproved({
              status: 'RevisionReturned', committed_count: 20, version: 2,
              return_comment: 'Permits are cleared, keep 38.', returned_by: 'Ali Karimi',
            })
          : runningApproved(),
      ),
    })
    show()

    expect(await screen.findByText('Permits are cleared, keep 38.')).toBeInTheDocument()
  })

  it('opens the version history of one stream', async () => {
    signedInAs('Contractor')
    serve({ my: byMonth(() => runningApproved()) })
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Acceptance revision history' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/revisions', {
        params: { year: 1405, month: 6, stream: 'ACCEPTANCE' },
      }),
    )
    expect(await screen.findByText('Revision history')).toBeInTheDocument()
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
//
// The PM's screen answers two questions about two different months at once:
// what is being proposed for next month, and how this month is actually
// going. Keeping those apart is the whole design, so most of what is checked
// here is that a figure is attributed to the right month and the right
// company.
describe('the PM deciding the month', () => {
  it('names the month being decided and counts what is outstanding', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    expect(await screen.findByText('Deciding مهر 1405')).toBeInTheDocument()
    expect(screen.getByText('1 awaiting a decision')).toBeInTheDocument()
    expect(screen.getByText('1 approved')).toBeInTheDocument()
    expect(screen.getByText('1 not filed')).toBeInTheDocument()
    expect(screen.getByText(/6 days left/)).toBeInTheDocument()
  })

  it('shows the programme in the same three words the contractor sees', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    await screen.findByText(/شهریور 1405 — where the programme stands/)
    // Scoped to the three cards: "PIP" is also a column heading in the table
    // below, and an unscoped query now matches both.
    const trio = within(document.querySelector('.pip-trio'))
    const card = (label) => trio.getByText(label).closest('.stat')
    expect(within(card('Assignment')).getByText('76')).toBeInTheDocument()
    expect(within(card('PIP')).getByText('38')).toBeInTheDocument()
    expect(within(card('Delivered')).getByText('24')).toBeInTheDocument()
    // Same bar, same marker, and the sentence is about the programme.
    expect(screen.getByTestId('pip-pace')).toHaveStyle({ left: '81%' })
    expect(screen.getByText(/The programme is 7 drive tests behind that pace/)).toBeInTheDocument()
  })

  it('puts each company\'s running month beside what they are proposing', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    const row = (await screen.findByText('Beta Networks')).closest('tr')
    expect(within(row).getByText('52')).toBeInTheDocument()   // assignment
    expect(within(row).getByText('44')).toBeInTheDocument()   // pip
    expect(within(row).getByText('39')).toBeInTheDocument()   // delivered
    expect(within(row).getByText('89%')).toBeInTheDocument()  // 39 of 44
    expect(within(row).getByText('25')).toBeInTheDocument()   // proposed for مهر
  })

  it('lists every contractor, including one who has not filed', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    expect(await screen.findByText('Alpha Telecom')).toBeInTheDocument()
    expect(screen.getByText('Beta Networks')).toBeInTheDocument()
    expect(screen.getByText('Gamma Survey')).toBeInTheDocument()
    expect(screen.getByText('Not filed')).toBeInTheDocument()

    // Gamma has no approved PIP this month, so there is no share to draw.
    const row = screen.getByText('Gamma Survey').closest('tr')
    expect(within(row).queryByText(/%/)).not.toBeInTheDocument()
  })

  it('totals the proposals but never the assignment column', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    const totals = (await screen.findByText(/total — 3 contractors/i)).closest('tr')
    expect(within(totals).getByText('65')).toBeInTheDocument()   // 40 + 25 proposed
    // Assignment is a balance: the programme's own figure, not a sum of rows
    // (52 + 76 + 31 would count a site held by two months twice).
    expect(within(totals).getByText('76')).toBeInTheDocument()
  })

  it('will not return a plan until there is a reason to send back', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

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
    showQueue()

    await userEvent.click(await screen.findByRole('button', { name: 'Alpha Telecom' }))
    await userEvent.click(screen.getByRole('button', { name: /approve/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/11/approve'))
  })

  it('carries both months into the panel it opens', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    await userEvent.click(await screen.findByRole('button', { name: 'Alpha Telecom' }))
    expect(
      screen.getByText(/Proposing.*for مهر 1405, against 76 held and 24 delivered in شهریور/s),
    ).toBeInTheDocument()
  })

  it('offers no decision on a plan that is not waiting on them', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    showQueue()

    await userEvent.click(await screen.findByRole('button', { name: 'Beta Networks' }))
    expect(screen.getByText(/approved and locked/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
  })
})

describe('everyone else who reads the queue', () => {
  it('shows a coordinator the month and no way to decide it', async () => {
    signedInAs('Coordinator')
    serve({ queue: MIXED_QUEUE })
    showQueue(false)

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
    showQueue(false)

    expect(await screen.findByText(/not yours to read/i)).toBeInTheDocument()
  })
})

// ------------------------------------------------------- acceptance target
//
// The programme's acceptance target moved here from the Acceptance
// Dashboard, whose Plan vs Actual chart still draws its dashed line from it.
// It is a PM's to set and everyone else's to read; a contractor has no part
// in it.
describe('the acceptance target', () => {
  // AcceptanceTarget is no longer on the PM page (the split screen has a
  // Set link per stream); the component is kept, and tested on its own.
  const show = () => render(<ToastProvider><AcceptanceTarget /></ToastProvider>)

  const targetCard = async () =>
    (await screen.findByText('Acceptance target', { selector: '.dt-kpi-title' })).closest('.dt-kpi-card')

  it('shows the current target and its change from last month', async () => {
    signedInAs('Coordinator')
    serve({ queue: MIXED_QUEUE })
    show()

    const card = await targetCard()
    expect(within(card).getByText('3,200')).toBeInTheDocument()
    expect(within(card).getByText(/\+340 from مرداد 1405/)).toBeInTheDocument()
    // Readable, not settable, for anyone but the PM.
    expect(within(card).queryByRole('button', { name: /Set this month’s acceptance target/ })).toBeNull()
  })

  it('lets the PM set it, and re-reads it once saved', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE })
    show()

    const card = await targetCard()
    await userEvent.click(within(card).getByRole('button', { name: /Set this month’s acceptance target/ }))
    const input = screen.getByLabelText('Target (villages this month)')
    await userEvent.clear(input)
    await userEvent.type(input, '3500')
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/acceptance/plan',
        expect.objectContaining({ target_count: 3500 }),
      ),
    )
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([url]) => url === '/acceptance/plan')).toHaveLength(2),
    )
  })

  it('says "not set yet" rather than showing a 0 when there is no target', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE, plan: { current: null, previous: null, history: [] } })
    show()

    expect(within(await targetCard()).getByText('Not set yet')).toBeInTheDocument()
  })

  it('shows nothing, rather than "not set yet", when the target cannot be read', async () => {
    signedInAs('PM')
    serve({ queue: MIXED_QUEUE, plan: new Error('boom') })
    show()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/acceptance/plan'))
    expect(screen.queryByText('Acceptance target')).toBeNull()
    expect(screen.queryByText('Not set yet')).toBeNull()
  })

  it('is not offered to a contractor', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    render(<MemoryRouter><ToastProvider><MonthlyPlan /></ToastProvider></MemoryRouter>)

    await screen.findByText('Planning مهر 1405')
    expect(screen.queryByText('Acceptance target')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/acceptance/plan')
  })
})

// ------------------------------------------------------------ the PM page
//
// Shaped from app/schemas: PipOverviewOut.
const hit = (h, of) => ({ hit: h, of })
const ovRow = (over = {}) => ({
  contractor_id: 1, name: 'Alpha Telecom', assignment: 40, pip: 38, delivered: 21, diff: -17,
  status: 'approved', pip_above_assignment: false, hit_last_6: hit(4, 6),
  plan_id: 11, plan_status: 'Approved', committed_count: 38, version: 1,
  in_force_count: 38, in_force_version: 1, revision_from: null, revision_to: null,
  revision_reason: null, revision_comment: null, return_comment: null, is_late: false,
  ...over,
})
const trendPoints = Array.from({ length: 12 }, (_, i) => ({
  shamsi_year: i < 6 ? 1404 : 1405, shamsi_month: ((i + 6) % 12) + 1,
  shamsi_month_name: ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'][(i + 6) % 12],
  pip: 100, delivered: i % 2 ? 110 : 80, hit: Boolean(i % 2), in_progress: i === 11,
}))
const streamOut = (stream, rows, over = {}) => ({
  stream,
  kpis: {
    assignment: stream === 'DT' ? 143 : null, internal_pip: stream === 'DT' ? 150 : null,
    contractor_pip: 143, gap_vs_internal: stream === 'DT' ? -7 : null, delivered: 21,
    achievement_percent: 14.7, expected_by_today: 19, pace_diff: 2,
  },
  all_contractors: {
    assignment: stream === 'DT' ? 143 : null, pip: 143, delivered: 21, diff: -122,
    plans_approved: 3, plans_total: 5, hit_last_6: hit(3, 6),
  },
  rows,
  trend: trendPoints,
  ...over,
})
const overview = (over = {}) => ({
  period: 'month', shamsi_year: 1405, shamsi_month: 7, shamsi_month_name: 'مهر',
  months: [{ shamsi_year: 1405, shamsi_month: 7, shamsi_month_name: 'مهر' }],
  running_year: 1405, running_month: 7, day_of_month: 4, days_in_month: 30,
  revision_window_open: true, revisions_close_on: '1405/07/15',
  dt: streamOut('DT', [
    ovRow(),
    ovRow({ contractor_id: 2, name: 'Beta Networks', pip: 50, assignment: 30, pip_above_assignment: true, in_force_count: 50 }),
    ovRow({ contractor_id: 3, name: 'Gamma Survey', pip: null, delivered: 0, diff: null, status: 'not_submitted', plan_id: null, in_force_count: null }),
  ]),
  acceptance: streamOut('ACCEPTANCE', [
    ovRow({ assignment: null, pip_above_assignment: null, status: 'revision_requested', revision_from: 38, revision_to: 35 }),
  ]),
  needs_attention: [
    { contractor_id: 3, name: 'Gamma Survey', stream: 'DT', kind: 'not_submitted', label: 'DT مهر · not submitted', shamsi_year: 1405, shamsi_month: 7, plan_id: null },
    { contractor_id: 1, name: 'Alpha Telecom', stream: 'ACCEPTANCE', kind: 'awaiting_approval', label: 'Acceptance آبان · 20 awaiting approval', shamsi_year: 1405, shamsi_month: 8, plan_id: 21 },
  ],
  ...over,
})
const accQueue = queue([
  queueRow({ plan_id: 21, status: 'Submitted', committed_count: 20, in_force_count: null }),
], { current_month: {} })

function serveOverview(data = overview(), { queues, internal = {} } = {}) {
  api.get.mockImplementation((url, config) => {
    if (url === '/pip/overview') return Promise.resolve({ data })
    if (url === '/pip/queue') {
      const params = config?.params ?? {}
      if (queues) return Promise.resolve({ data: queues(params) })
      return Promise.resolve({ data: { ...accQueue, label: 'آبان 1405', stream: params.stream } })
    }
    if (url === '/pip/revisions') return Promise.resolve({ data: revisionsOut(config?.params) })
    if (url === '/pip/internal-target') {
      const count = internal[config?.params?.stream]
      return Promise.resolve({ data: { current: count == null ? null : { target_count: count } } })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

// The month the browser calls "now", the same way the page asks for it.
const RUNNING = currentShamsiPeriod()
const isRunning = (p) => p.year === RUNNING.year && p.month === RUNNING.month

/** Queues keyed by month (running or planning) and stream. */
const queuesBy = (table) => (params) => {
  const rows = table[isRunning(params) ? 'running' : 'planning']?.[params.stream] ?? []
  return queue(rows, { current_month: {} })
}

// Two decisions for the planning month (one per stream) and a revision on
// the running month: three things waiting on the PM.
const WAITING_QUEUES = queuesBy({
  planning: {
    DT: [queueRow(), queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12, status: 'Approved' })],
    ACCEPTANCE: [queueRow({ plan_id: 21 })],
  },
  running: {
    DT: [queueRow({ contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: 31, status: 'RevisionRequested', in_force_count: 30 })],
    ACCEPTANCE: [queueRow({ plan_id: 41, status: 'Approved' })],
  },
})
const NOTHING_WAITING = queuesBy({
  planning: { DT: [queueRow({ status: 'Approved' })], ACCEPTANCE: [queueRow({ plan_id: 21, status: 'Draft' })] },
  running: { DT: [queueRow({ status: 'Approved' })], ACCEPTANCE: [] },
})

/** Where the router is, and whether it got there by a push. */
function LocationProbe() {
  const location = useLocation()
  const type = useNavigationType()
  return <output data-testid="location">{`${type} ${location.search}`}</output>
}
const showWithProbe = (path = '/monthly-plan') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><MonthlyPlan /><LocationProbe /></ToastProvider>
    </MemoryRouter>,
  )

const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent)
const selectedTab = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')

describe('the PM page: two tabs', () => {
  it('has Plans then PIP vs Achieved, and opens on PIP vs Achieved', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    expect(tabNames()).toEqual(['Plans', 'PIP vs Achieved'])
    expect(selectedTab()).toHaveTextContent('PIP vs Achieved')
    expect(screen.getByText('Month-end')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Monthly Plan' })).toBeInTheDocument()
  })

  it('opens the Plans tab from the address, on the month being planned', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show('/monthly-plan?tab=plans')

    await waitFor(() => expect(selectedTab()).toHaveTextContent('Plans'))
    const planning = nextPeriod(RUNNING.year, RUNNING.month)
    expect(screen.getByTestId('mp-period')).toHaveTextContent(`${shamsiMonthName(planning.month)} ${planning.year}`)
    // The overview belongs to the other tab and is not read for this one.
    expect(api.get).not.toHaveBeenCalledWith('/pip/overview', expect.anything())
  })

  it('opens PIP vs Achieved for a tab it does not know', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show('/monthly-plan?tab=ledger')

    await screen.findByRole('region', { name: 'DT Delivery' })
    expect(selectedTab()).toHaveTextContent('PIP vs Achieved')
  })

  it('pushes each tab change into history and keeps each tab’s month', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    showWithProbe()

    await screen.findByRole('region', { name: 'DT Delivery' })
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }))
    const pipMonth = screen.getByTestId('mp-period').textContent

    await userEvent.click(screen.getByRole('tab', { name: /Plans/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('PUSH ?tab=plans')
    const plansMonth = screen.getByTestId('mp-period').textContent
    expect(plansMonth).not.toBe(pipMonth)

    await userEvent.click(screen.getByRole('tab', { name: 'PIP vs Achieved' }))
    expect(screen.getByTestId('location').textContent).toBe('PUSH ')
    expect(screen.getByTestId('mp-period')).toHaveTextContent(pipMonth)
  })

  it('counts waiting decisions per stream, plus revisions, on the Plans tab', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()

    // DT Alpha and Acceptance Alpha submitted, and Gamma's DT revision.
    const badge = await screen.findByLabelText('3 waiting')
    expect(badge).toHaveTextContent('3')
    expect(within(screen.getByRole('tab', { name: /Plans/ })).getByText('3')).toBe(badge)
  })

  it('hides the badge when nothing is waiting', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === '/pip/queue').length).toBe(4))
    expect(screen.getByRole('tab', { name: /Plans/ })).toHaveTextContent(/^Plans$/)
  })

  it.each(['Coordinator', 'Viewer'])('shows a %s no badge, since nothing waits on them', async (role) => {
    signedInAs(role)
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    expect(screen.queryByLabelText(/waiting/)).toBeNull()
    expect(screen.getByRole('tab', { name: /Plans/ })).toHaveTextContent(/^Plans$/)
  })

  it('still sends a contractor to their own screen, with no tabs', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show('/monthly-plan?tab=plans')

    await screen.findByText('Planning مهر 1405')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/pip/queue', expect.anything())
  })
})

// An Action Center link to a plan waiting on the PM, which opens its drawer.
const DRAWER_LINK = '/monthly-plan?year=1405&month=8&stream=ACCEPTANCE&contractor=1'

describe('PIP vs Achieved', () => {
  it('shows DT Delivery above Acceptance, from one read', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    const dt = await screen.findByRole('region', { name: 'DT Delivery' })
    const acc = screen.getByRole('region', { name: 'Acceptance' })
    expect(dt.compareDocumentPosition(acc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dt).getByText('Assignment', { selector: '.mp-kpi-label' })).toBeInTheDocument()
    expect(within(acc).queryByText('Assignment')).toBeNull()
    expect(within(dt).getByText('−7 vs internal')).toBeInTheDocument()
    expect(within(dt).getByText('By today 19 (+2)')).toBeInTheDocument()
    expect(within(dt).getByText('3 of 5 plans approved')).toBeInTheDocument()
    expect(within(dt).getByText('Hit 3/6')).toBeInTheDocument()
    expect(within(acc).getByText('Revision 38→35')).toBeInTheDocument()
    expect(screen.getByText('Day 4 of 30 · revisions until day 15')).toBeInTheDocument()
    const reads = api.get.mock.calls.filter(([url]) => url === '/pip/overview')
    expect(reads).toHaveLength(1)
    expect(reads[0][1].params).toMatchObject({ period: 'month' })
    // The old ledger and queue table are not on the page, nor the strip.
    expect(api.get).not.toHaveBeenCalledWith('/pip/scorecard', expect.anything())
    expect(document.querySelector('table')).toBeNull()
    expect(screen.queryByText(/Needs attention/)).toBeNull()
  })

  it('renders Not submitted and PIP > assignment', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    const dt = await screen.findByRole('region', { name: 'DT Delivery' })
    const gamma = within(dt).getByText('Gamma Survey').closest('.mp-row')
    expect(within(gamma).getByText('Not submitted')).toBeInTheDocument()
    const beta = within(dt).getByText('Beta Networks').closest('.mp-row')
    expect(within(beta).getByText('PIP > assignment')).toBeInTheDocument()
    expect(beta.querySelector('.mp-bar-tick-over')).not.toBeNull()
  })

  it('approves through /pip/{id}/approve and reloads the page', async () => {
    signedInAs('PM')
    serveOverview()
    show(DRAWER_LINK)

    const drawer = await screen.findByRole('dialog', { name: 'Plan decision' })
    await userEvent.click(await within(drawer).findByRole('button', { name: 'Approve 20' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/21/approve'))
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([url]) => url === '/pip/overview')).toHaveLength(2),
    )
  })

  it('will not return without a comment', async () => {
    signedInAs('PM')
    serveOverview()
    show(DRAWER_LINK)

    const drawer = await screen.findByRole('dialog', { name: 'Plan decision' })
    const ret = await within(drawer).findByRole('button', { name: 'Return' })
    expect(ret).toBeDisabled()
    await userEvent.type(within(drawer).getByRole('textbox'), 'Too low for آبان.')
    await userEvent.click(ret)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/21/return', { comment: 'Too low for آبان.' }))
  })

  it('opens the drawer from a contractor row', async () => {
    signedInAs('Coordinator')
    serveOverview()
    show()

    const dt = await screen.findByRole('region', { name: 'DT Delivery' })
    await userEvent.click(within(dt).getByText('Beta Networks'))
    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: 1405, month: 7, stream: 'DT' } })
  })

  it('shows a non-PM the drawer read-only, with no Approve and no Set link', async () => {
    signedInAs('Coordinator')
    serveOverview()
    show(DRAWER_LINK)

    const drawer = await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(await within(drawer).findByText('Waiting on the PM’s decision.')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: /approve/i })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Return' })).toBeNull()
    expect(screen.queryByRole('button', { name: /internal target/ })).toBeNull()
  })

  it('offers the PM a Set link for an internal target, per stream', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    const acc = await screen.findByRole('region', { name: 'Acceptance' })
    expect(within(acc).getByText('Not set')).toBeInTheDocument()
    await userEvent.click(within(acc).getByRole('button', { name: 'Set the Acceptance internal target' }))
    expect(screen.getByRole('dialog', { name: 'Set the acceptance target' })).toBeInTheDocument()

    const dt = screen.getByRole('region', { name: 'DT Delivery' })
    await userEvent.click(within(dt).getByRole('button', { name: 'Set the DT Delivery internal target' }))
    const form = screen.getByRole('dialog', { name: 'Set the DT internal target' })
    await userEvent.type(within(form).getByLabelText('Target (drive tests this month)'), '160')
    await userEvent.click(within(form).getByRole('button', { name: 'Save target' }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/pip/internal-target', expect.objectContaining({ stream: 'DT', target_count: 160 })),
    )
  })

  it('switches to the year and drops the by-today line', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    serveOverview(overview({ period: 'year', day_of_month: null }))
    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    await waitFor(() =>
      expect(api.get.mock.calls.filter(([url]) => url === '/pip/overview').at(-1)[1].params)
        .toMatchObject({ period: 'year' }),
    )
    await waitFor(() => expect(screen.queryByText('By today 19 (+2)')).toBeNull())
    expect(screen.getAllByText('This period').length).toBe(2)
  })

  it('offers the Month / Year / Since start switch on this tab only', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Plans/ }))
    expect(screen.queryByRole('group', { name: 'Period' })).toBeNull()
  })
})


// ------------------------------------------------------------ the Plans tab
//
// The month being planned, as usually seen on day four: Alpha has handed in
// both streams and waits on the PM, Epsilon was sent back, Beta is approved,
// Gamma has only a Draft (not shared) and Delta has nothing. On the running
// month Beta asks to revise Acceptance.
const PLANS_QUEUES = queuesBy({
  planning: {
    DT: [
      queueRow({ contractor_id: 1, contractor_name: 'Alpha Telecom', plan_id: 11, status: 'Submitted', committed_count: 40, assignment: 30 }),
      queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12, status: 'Approved', committed_count: 25, in_force_count: 25, assignment: 52 }),
      queueRow({ contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: 13, status: 'Draft', committed_count: 50, previous_month_committed: 26 }),
      queueRow({ contractor_id: 4, contractor_name: 'Delta Radio', plan_id: null, status: null, committed_count: null, previous_month_committed: null }),
      queueRow({ contractor_id: 5, contractor_name: 'Epsilon Link', plan_id: 15, status: 'Returned', committed_count: 20, assignment: 40 }),
    ],
    ACCEPTANCE: [
      queueRow({ contractor_id: 1, contractor_name: 'Alpha Telecom', plan_id: 21, status: 'Submitted', committed_count: 30 }),
      queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 22, status: 'Approved', committed_count: 18, in_force_count: 18 }),
      queueRow({ contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: null, status: null, committed_count: null, previous_month_committed: null }),
      queueRow({ contractor_id: 4, contractor_name: 'Delta Radio', plan_id: null, status: null, committed_count: null }),
      queueRow({ contractor_id: 5, contractor_name: 'Epsilon Link', plan_id: null, status: null, committed_count: null }),
    ],
  },
  running: {
    DT: [
      queueRow({ contractor_id: 1, contractor_name: 'Alpha Telecom', plan_id: 31, status: 'Approved', in_force_count: 35 }),
      queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 32, status: 'Approved', in_force_count: 44 }),
    ],
    ACCEPTANCE: [
      queueRow({
        contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 51, status: 'RevisionRequested',
        committed_count: 15, in_force_count: 20, revision_reason: 'SITES_BLOCKED', revision_comment: 'Two villages flooded.',
      }),
    ],
  },
})

const showPlans = (role = 'PM', opts = {}) => {
  signedInAs(role)
  serveOverview(overview(), { queues: PLANS_QUEUES, internal: { DT: 100 }, ...opts })
  show('/monthly-plan?tab=plans')
}
const sharedRow = async (name) =>
  within(await screen.findByRole('table', { name: 'Shared plans' })).getByText(name).closest('[role="row"]')
const cell = (row, stream) => row.querySelector(`[data-stream="${stream}"]`)

describe('the Plans tab', () => {
  it('splits shared from not shared, with a Draft counted as not shared', async () => {
    showPlans()

    const notShared = await screen.findByRole('region', { name: 'Not shared yet' })
    expect(within(notShared).getByText('Gamma Survey')).toBeInTheDocument()
    expect(within(notShared).getByText('Delta Radio')).toBeInTheDocument()
    expect(within(notShared).getByText('Last month: DT 26 · Acceptance —')).toBeInTheDocument()
    expect(within(notShared).queryByRole('button')).toBeNull()

    // Waiting first, then returned, then approved.
    const rows = within(screen.getByRole('table', { name: 'Shared plans' })).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('.pl-name').textContent)).toEqual(['Alpha Telecom', 'Epsilon Link', 'Beta Networks'])

    const card = screen.getByRole('region', { name: 'Shared their plan' })
    expect(within(card).getByText('3')).toBeInTheDocument()
    expect(within(card).getByText('/ 5')).toBeInTheDocument()
    const word = (id) => card.querySelector(`[data-contractor="${id}"] .pl-person-word`).textContent
    expect(word(1)).toBe('Waiting')
    expect(word(2)).toBe('Approved')
    expect(word(3)).toBe('Not shared')
    expect(word(5)).toBe('Returned')
  })

  it('approves one stream’s plan id at a time', async () => {
    showPlans()

    await userEvent.click(await screen.findByRole('button', { name: 'Approve DT Delivery for Alpha Telecom' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/11/approve'))
    expect(api.post).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Approve Acceptance for Alpha Telecom' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/21/approve'))
    expect(api.post).toHaveBeenCalledTimes(2)
  })

  it('will not return a plan until there is a comment, then posts it', async () => {
    showPlans()

    await userEvent.click(await screen.findByRole('button', { name: 'Return DT Delivery for Alpha Telecom' }))
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('What should they change?'), 'Only 30 sites are held.')
    expect(send).toBeEnabled()
    await userEvent.click(send)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/pip/11/return', { comment: 'Only 30 sites are held.' }),
    )
  })

  it('shows an approved stream as a status, with no buttons', async () => {
    showPlans()

    const beta = await sharedRow('Beta Networks')
    expect(within(cell(beta, 'DT')).getByText('Approved')).toBeInTheDocument()
    expect(within(cell(beta, 'DT')).queryByRole('button')).toBeNull()
    expect(within(cell(beta, 'ACCEPTANCE')).queryByRole('button')).toBeNull()
    const epsilon = await sharedRow('Epsilon Link')
    expect(within(cell(epsilon, 'DT')).getByText('Returned')).toBeInTheDocument()
    expect(within(cell(epsilon, 'DT')).queryByRole('button')).toBeNull()
    expect(cell(epsilon, 'ACCEPTANCE')).toHaveTextContent('—')
  })

  it('flags a DT number above the sites held, and only then', async () => {
    showPlans()

    const alpha = await sharedRow('Alpha Telecom')
    expect(within(cell(alpha, 'DT')).getByText('Above 30 sites held')).toBeInTheDocument()
    expect(within(cell(alpha, 'DT')).getByText('35 in شهریور')).toBeInTheDocument()
    expect(screen.getAllByText(/sites held/)).toHaveLength(1)
  })

  it('compares the shared plans with MTN’s internal PIP', async () => {
    showPlans()

    const card = await screen.findByRole('region', { name: 'Contractors vs MTN internal' })
    // 40 (Alpha) + 25 (Beta) + 20 (Epsilon); Gamma's Draft adds nothing.
    expect(await within(card).findByText('85 of 100 · 15 short')).toBeInTheDocument()
    expect(within(card).getByText('No internal PIP set')).toBeInTheDocument()
    expect(within(card).getByText('not shown to contractors')).toBeInTheDocument()
  })

  it('does not draw the internal PIP card for a role that does not see it', async () => {
    showPlans('Admin')

    await screen.findByRole('table', { name: 'Shared plans' })
    expect(screen.queryByRole('region', { name: 'Contractors vs MTN internal' })).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/pip/internal-target', expect.anything())
  })

  it('gives a coordinator the statuses and no decision', async () => {
    showPlans('Coordinator')

    const alpha = await sharedRow('Alpha Telecom')
    expect(within(cell(alpha, 'DT')).getByText('Waiting')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Return/ })).toBeNull()
  })

  it('shows a waiting revision in its own card, decided through the same endpoints', async () => {
    showPlans()

    const card = await screen.findByRole('region', { name: /Revision for شهریور · Beta Networks · Acceptance 20 → 15/ })
    expect(card.querySelector('.pl-revision-note')).toHaveTextContent('Sites blocked — Two villages flooded. · until you decide, 20 counts')

    await userEvent.click(within(card).getByRole('button', { name: /^Return/ }))
    const send = within(card).getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    await userEvent.type(within(card).getByLabelText('What should they change?'), 'Show the flood report.')
    await userEvent.click(send)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/51/return', { comment: 'Show the flood report.' }))

    await userEvent.click(within(card).getByRole('button', { name: /^Approve/ }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/51/approve'))
  })

  it('draws no revision card when none is waiting', async () => {
    showPlans('PM', { queues: NOTHING_WAITING })

    await screen.findByRole('region', { name: 'Shared their plan' })
    expect(screen.queryByRole('region', { name: /^Revision for/ })).toBeNull()
  })

  it('counts the same decisions on the badge and the card, and recounts after one', async () => {
    showPlans()

    // Alpha's two streams and Beta's revision.
    expect(await screen.findByLabelText('3 waiting')).toBeInTheDocument()
    expect(screen.getByText('3 decisions waiting')).toBeInTheDocument()

    // Once approved, the server lists Alpha's DT as Approved.
    const approvedAlpha = queuesBy({
      planning: {
        DT: [queueRow({ contractor_id: 1, contractor_name: 'Alpha Telecom', plan_id: 11, status: 'Approved', in_force_count: 40 })],
        ACCEPTANCE: [queueRow({ contractor_id: 1, contractor_name: 'Alpha Telecom', plan_id: 21, status: 'Submitted' })],
      },
      running: {
        ACCEPTANCE: [queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 51, status: 'RevisionRequested', in_force_count: 20, committed_count: 15 })],
      },
    })
    serveOverview(overview(), { queues: approvedAlpha })
    await userEvent.click(screen.getByRole('button', { name: 'Approve DT Delivery for Alpha Telecom' }))

    expect(await screen.findByLabelText('2 waiting')).toBeInTheDocument()
    expect(screen.getByText('2 decisions waiting')).toBeInTheDocument()
  })

  it('opens a contractor’s plan history, both streams, read-only', async () => {
    showPlans()

    await userEvent.click(within(await sharedRow('Beta Networks')).getByRole('button', { name: 'Beta Networks' }))
    const drawer = await screen.findByRole('dialog', { name: 'Plan history' })
    const planning = nextPeriod(RUNNING.year, RUNNING.month)
    for (const stream of ['DT', 'ACCEPTANCE']) {
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith('/pip/revisions', {
          params: { year: planning.year, month: planning.month, stream, contractor_id: 2 },
        }),
      )
    }
    expect(within(drawer).queryByRole('button', { name: /approve|return/i })).toBeNull()
  })
})

describe('the PM export', () => {
  it('downloads the period on the page, both streams', async () => {
    signedInAs('PM')
    serveOverview()
    const blobUrl = vi.fn(() => 'blob:x')
    globalThis.URL.createObjectURL = blobUrl
    globalThis.URL.revokeObjectURL = vi.fn()
    show()

    await screen.findByRole('region', { name: 'DT Delivery' })
    api.get.mockImplementationOnce(() => Promise.resolve({ data: new Blob(['x']), headers: {} }))
    await userEvent.click(screen.getByRole('button', { name: /Export Excel/ }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/scorecard.xlsx', {
        params: { period: 'month', year: expect.any(Number), month: expect.any(Number) },
        responseType: 'blob',
      }),
    )
  })
})

describe('links from the Action Center', () => {
  it('opens the PM on that month, with that plan’s drawer', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?year=1405&month=8&stream=ACCEPTANCE&contractor=1')

    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: 1405, month: 8, stream: 'ACCEPTANCE' } })
    expect(api.get.mock.calls.find(([url]) => url === '/pip/overview')[1].params)
      .toMatchObject({ period: 'month', year: 1405, month: 8 })
  })

  it('opens a contractor on the month the item is about', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show('/monthly-plan?year=1405&month=6')

    await screen.findByText('Planning مهر 1405')
    const asked = api.get.mock.calls.filter(([url]) => url === '/pip/my').map(([, c]) => c.params)
    expect(asked[0]).toMatchObject({ year: 1405, month: 6 })
  })
})
