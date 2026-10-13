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
  /** Type a number into each named stream's field. */
  const fill = async (numbers) => {
    for (const [name, value] of Object.entries(numbers)) {
      await userEvent.type(await screen.findByLabelText(new RegExp(`your مهر ${name} PIP`, 'i')), value)
    }
  }
  const EVERY = { DT: '42', Acceptance: '18', ICT: '30', CRA: '26' }

  it('names the month being planned and hands every number in, one plan per stream', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    expect(await screen.findByText('Planning مهر 1405')).toBeInTheDocument()

    await fill(EVERY)
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(4))
    for (const [stream, count] of [['DT', 42], ['ACCEPTANCE', 18], ['ICT', 30], ['CRA', 26]]) {
      expect(api.post).toHaveBeenCalledWith(
        '/pip/my',
        expect.objectContaining({ stream, committed_count: count, submit: true }),
      )
    }
  })

  it('reads each stream’s plan on its own', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show()

    await screen.findByText('Planning مهر 1405')
    const streams = api.get.mock.calls
      .filter(([url]) => url === '/pip/my')
      .map(([, config]) => config.params.stream)
    expect(streams).toEqual(expect.arrayContaining(['DT', 'ACCEPTANCE', 'ICT', 'CRA']))
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

  it('says which number failed, and does not report success for all of them', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    api.post.mockImplementation((url, body) =>
      body.stream === 'ACCEPTANCE'
        ? Promise.reject({ response: { data: { detail: 'The deadline has passed' } } })
        : Promise.resolve({ data: {} }),
    )
    show()

    await fill(EVERY)
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(await screen.findByText('Only your DT, ICT and CRA PIP was handed in')).toBeInTheDocument()
    expect(screen.getByText(/Acceptance: The deadline has passed/)).toBeInTheDocument()
    expect(screen.queryByText('Handed in')).not.toBeInTheDocument()
  })

  it('submits only the stream still open when the others are with the PM', async () => {
    signedInAs('Contractor')
    serve({
      my: ({ stream }) =>
        stream === 'ACCEPTANCE'
          ? context()
          : context({ planning: { status: 'Submitted', committed_count: 40 } }),
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
    expect(metas).toHaveLength(4)
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

    expect((await screen.findAllByText(/this is your target for the month/i)).length).toBe(4)
    expect(document.querySelector('.pip-locked')).toHaveTextContent('40')
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit|revise/i })).not.toBeInTheDocument()
  })

  it('holds a submitted plan read-only while the PM has it', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { status: 'Submitted', committed_count: 40 } }) })
    show()

    expect((await screen.findAllByText(/waiting on the pm/i)).length).toBe(4)
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
    expect(buttons.map((b) => b.closest('[data-revision]').dataset.revision)).toEqual(['DT', 'ACCEPTANCE', 'ICT', 'CRA'])
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
  expected_by_today: 13, pace_diff: 8,
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
    ovRow({ contractor_id: 2, name: 'Beta Networks', pip: 50, delivered: 12, assignment: 30, pip_above_assignment: true, in_force_count: 50, expected_by_today: 17, pace_diff: -5 }),
    ovRow({ contractor_id: 3, name: 'Gamma Survey', pip: null, delivered: 0, diff: null, status: 'not_submitted', plan_id: null, in_force_count: null }),
  ]),
  acceptance: streamOut('ACCEPTANCE', [
    ovRow({ assignment: null, pip: 30, delivered: 9, pip_above_assignment: null, status: 'revision_requested', revision_from: 38, revision_to: 35, expected_by_today: 10, pace_diff: -1 }),
  ], {
    kpis: {
      assignment: null, internal_pip: null, contractor_pip: 30, gap_vs_internal: null, delivered: 9,
      achievement_percent: 30, expected_by_today: 10, pace_diff: -1,
    },
  }),
  ict: streamOut('ICT', []),
  cra: streamOut('CRA', []),
  needs_attention: [
    { contractor_id: 3, name: 'Gamma Survey', stream: 'DT', kind: 'not_submitted', label: 'DT مهر · not submitted', shamsi_year: 1405, shamsi_month: 7, plan_id: null },
    { contractor_id: 1, name: 'Alpha Telecom', stream: 'ACCEPTANCE', kind: 'awaiting_approval', label: 'Acceptance آبان · 20 awaiting approval', shamsi_year: 1405, shamsi_month: 8, plan_id: 21 },
  ],
  ...over,
})
const accQueue = queue([
  queueRow({ plan_id: 21, status: 'Submitted', committed_count: 20, in_force_count: null }),
], { current_month: {} })


/**
 * The staff page's reads. `data` answers GET /pip/overview for the running
 * and planning months; `year` answers period=year (a function of its params);
 * `queues` answers GET /pip/queue by params.
 */
function serveOverview(data = overview(), { queues, year, overviewFails } = {}) {
  api.get.mockImplementation((url, config) => {
    const params = config?.params ?? {}
    if (url === '/pip/overview') {
      if (overviewFails) return Promise.reject(overviewFails)
      if (params.period === 'year') return Promise.resolve({ data: year ? year(params) : yearOverview(params) })
      return Promise.resolve({ data: typeof data === 'function' ? data(params) : data })
    }
    if (url === '/pip/queue') {
      if (queues) return Promise.resolve({ data: queues(params) })
      return Promise.resolve({ data: { ...accQueue, label: 'آبان 1405', stream: params.stream } })
    }
    if (url === '/pip/revisions') return Promise.resolve({ data: revisionsOut(params) })
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
const { monthLabel } = await import('./planBoard')
const PLANNING = nextPeriod(RUNNING.year, RUNNING.month)
const persian = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])

/** Shaped from app/schemas: OverviewYearMonth, for one stream of one year. */
const yearMonths = (year, { scale = 1 } = {}) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const future = year > RUNNING.year || (year === RUNNING.year && m > RUNNING.month)
    const base = { shamsi_year: year, shamsi_month: m, shamsi_month_name: shamsiMonthName(m) }
    if (future) {
      return { ...base, plan: null, delivered: null, internal: null, is_running: false, is_future: true, contractors: [] }
    }
    // Month 2 is below 80% for Alpha; every other closed month meets its plan.
    const alpha = { id: 1, name: 'Alpha Telecom', plan: 10 * scale, delivered: (m === 2 ? 5 : 10) * scale }
    const beta = { id: 2, name: 'Beta Networks', plan: null, delivered: 4 * scale }
    return {
      ...base,
      plan: alpha.plan,
      delivered: alpha.delivered + beta.delivered,
      internal: 20 * scale,
      is_running: isRunning({ year, month: m }),
      is_future: false,
      contractors: [alpha, beta],
    }
  })
const yearOverview = (params) => ({
  ...overview({ period: 'year' }),
  dt: streamOut('DT', [], { months: yearMonths(params.year) }),
  acceptance: streamOut('ACCEPTANCE', [], { months: yearMonths(params.year, { scale: 2 }) }),
  ict: streamOut('ICT', [], { months: yearMonths(params.year) }),
  cra: streamOut('CRA', [], { months: yearMonths(params.year) }),
})

const approvalsLoaded = () => screen.findByRole('list', { name: 'Contractors waiting' })
const card = (name) => screen.getByRole('listitem', { name })
const grid = () => screen.getByRole('region', { name: 'Waiting for approval' })

// ------------------------------------------------------------- navigation
describe('the staff page: four tabs', () => {
  it('has Approvals, Plans, History, Internal PIP and opens on Approvals', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()

    await approvalsLoaded()
    expect(tabNames().map((t) => t.replace(/\d.*$/, ''))).toEqual(['Approvals', 'Plans', 'History', 'Internal PIP'])
    expect(selectedTab()).toHaveTextContent('Approvals')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', selectedTab().id)
    for (const tab of screen.getAllByRole('tab')) expect(tab).toHaveAttribute('aria-controls', panel.id)
    // The planning month on Approvals.
    expect(screen.getByTestId('mp-period')).toHaveTextContent(monthLabel(PLANNING))
  })

  it.each([
    ['?tab=approvals', 'Approvals'],
    ['?tab=plans', 'Plans'],
    ['?tab=history', 'History'],
    ['?tab=internal', 'Internal PIP'],
    ['?tab=pip', 'Approvals'],
    ['?tab=nonsense', 'Approvals'],
  ])('opens %s on %s', async (search, name) => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show(`/monthly-plan${search}`)
    await waitFor(() => expect(selectedTab()).toHaveTextContent(name))
  })

  it('shows the running month in the header on History', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show('/monthly-plan?tab=history')
    await screen.findByRole('table')
    expect(screen.getByTestId('mp-period')).toHaveTextContent(monthLabel(RUNNING))
  })

  it('moves along the tabs with the arrows, Home and End, pushing each into history', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    showWithProbe()
    await approvalsLoaded()

    const tabs = () => screen.getAllByRole('tab')
    expect(tabs().map((t) => t.tabIndex)).toEqual([0, -1, -1, -1])
    tabs()[0].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(selectedTab()).toHaveTextContent('Plans')
    expect(document.activeElement).toBe(tabs()[1])
    expect(screen.getByTestId('location')).toHaveTextContent('PUSH ?tab=plans')
    await userEvent.keyboard('{End}')
    expect(selectedTab()).toHaveTextContent('Internal PIP')
    await userEvent.keyboard('{ArrowRight}')
    expect(selectedTab()).toHaveTextContent('Approvals')
    await userEvent.keyboard('{ArrowLeft}')
    expect(selectedTab()).toHaveTextContent('Internal PIP')
    await userEvent.keyboard('{Home}')
    expect(selectedTab()).toHaveTextContent('Approvals')
    expect(screen.getByTestId('location').textContent).toBe('PUSH ')
  })

  it('counts every decision waiting, revisions included, on the Approvals tab', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()
    await approvalsLoaded()
    // Alpha's DT and Acceptance plans, and Gamma's revision.
    expect(screen.getByRole('tab', { name: /Approvals/ })).toHaveTextContent('Approvals3 waiting')
  })

  it('hides the badge when nothing is waiting', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show()
    await screen.findByText('All plans decided')
    expect(screen.getByRole('tab', { name: /Approvals/ }).textContent).toBe('Approvals')
  })

  it('still sends a contractor to their own screen, with no tabs', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show('/monthly-plan?tab=history')
    await screen.findByText('Planning مهر 1405')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(api.get.mock.calls.some(([url]) => url === '/pip/overview')).toBe(false)
  })
})

// --------------------------------------------------------------- Approvals
describe('Approvals', () => {
  it('shows every waiting contractor at once, one block per waiting stream', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()
    await approvalsLoaded()

    const alpha = card('Alpha Telecom')
    expect(within(alpha).getByText('DT Delivery')).toBeInTheDocument()
    expect(within(alpha).getByText('Acceptance')).toBeInTheDocument()
    expect(within(alpha).getAllByText('Last month 30')).toHaveLength(2)
    expect(within(alpha).getByText(/^Submitted/)).toBeInTheDocument()
    // The revision request, in a card of the same shape.
    const gamma = card('Gamma Survey')
    expect(within(gamma).getByText('Revision request')).toBeInTheDocument()
    expect(within(gamma).getByText('In force 30')).toBeInTheDocument()
    // Beta's plan is decided: the quiet line, not a card.
    expect(screen.queryByRole('listitem', { name: 'Beta Networks' })).toBeNull()
    const decided = screen.getByRole('region', { name: 'Decided' })
    expect(within(decided).getByText('Beta Networks')).toBeInTheDocument()
    expect(within(decided).getByText('Approved')).toBeInTheDocument()
  })

  it('draws a red line only when it is true', async () => {
    signedInAs('PM')
    const queues = queuesBy({
      planning: {
        DT: [
          queueRow({ committed_count: 40, assignment: 30 }),
          queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12, committed_count: 20, assignment: 30 }),
        ],
      },
      running: {},
    })
    serveOverview(overview(), { queues })
    show()
    await approvalsLoaded()
    // Beta: under what they hold, and 5 behind the pace (from the overview).
    expect(await within(card('Beta Networks')).findByText('5 behind')).toBeInTheDocument()
    expect(within(card('Beta Networks')).queryByText(/above sites held/)).toBeNull()
    // Alpha: 40 against 30 held, and ahead of pace in the running month.
    expect(within(card('Alpha Telecom')).getByText('10 above sites held')).toBeInTheDocument()
    expect(within(card('Alpha Telecom')).queryByText(/behind/)).toBeNull()
  })

  it('approves every waiting plan of a contractor, then the card leaves', async () => {
    signedInAs('PM')
    // The server's queue once Alpha's plans are approved.
    const approved = new Set()
    api.post.mockImplementation((url) => {
      approved.add(Number(url.split('/')[2]))
      return Promise.resolve({ data: {} })
    })
    const queues = (params) => {
      const data = WAITING_QUEUES(params)
      return { ...data, rows: data.rows.map((r) => (approved.has(r.plan_id) ? { ...r, status: 'Approved' } : r)) }
    }
    serveOverview(overview(), { queues })
    show()
    await approvalsLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Approve Alpha Telecom' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Alpha Telecom' })).toBeNull())
    expect(api.post).toHaveBeenCalledWith('/pip/11/approve')
    expect(api.post).toHaveBeenCalledWith('/pip/21/approve')
    expect(api.post).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('mp-live')).toHaveTextContent('Approved Alpha Telecom')
    // Focus goes to the grid, not to a card that left.
    await waitFor(() => expect(document.activeElement).toBe(grid()))
    // No Undo: the API cannot reverse an approval.
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })

  it('says which stream failed and keeps the card', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    api.post.mockImplementation((url) =>
      url === '/pip/21/approve'
        ? Promise.reject({ response: { data: { detail: 'Not open' } } })
        : Promise.resolve({ data: {} }),
    )
    show()
    await approvalsLoaded()

    await userEvent.click(screen.getByRole('button', { name: 'Approve Alpha Telecom' }))
    await waitFor(() =>
      expect(screen.getByTestId('mp-live')).toHaveTextContent('Could not approve Acceptance for Alpha Telecom.'),
    )
    expect(card('Alpha Telecom')).toBeInTheDocument()
  })

  it('returns only with a comment, in a dialog that traps focus and closes on Escape', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()
    await approvalsLoaded()

    const opener = screen.getByRole('button', { name: 'Return Alpha Telecom' })
    await userEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: /Send back to/ })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const field = within(dialog).getByLabelText('What should they change?')
    await waitFor(() => expect(document.activeElement).toBe(field))
    // Everything behind the dialog is inert.
    await waitFor(() => expect(opener.closest('[inert]')).not.toBeNull())
    const send = within(dialog).getByRole('button', { name: 'Send back' })
    expect(send).toBeDisabled()

    // Tab stays inside the dialog.
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(api.post).not.toHaveBeenCalled()

    await userEvent.click(opener)
    await userEvent.type(screen.getByLabelText('What should they change?'), 'Too high for the sites held')
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.post).toHaveBeenCalledWith('/pip/11/return', { comment: 'Too high for the sites held' })
    expect(api.post).toHaveBeenCalledWith('/pip/21/return', { comment: 'Too high for the sites held' })
    await waitFor(() => expect(document.activeElement).toBe(grid()))
  })

  it('decides a revision through the same endpoints', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()
    await approvalsLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Approve Gamma Survey' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/31/approve'))
  })

  it('gives a role that cannot decide the same cards and no buttons', async () => {
    signedInAs('Coordinator')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show()
    await approvalsLoaded()
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Decided' })).toBeInTheDocument()
    expect(card('Alpha Telecom')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Approve|Return) / })).toBeNull()
  })

  it('says so when every plan is decided', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: NOTHING_WAITING })
    show()
    expect(await screen.findByText('All plans decided')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Contractors waiting' })).toBeNull()
  })
})

// ------------------------------------------------------------------- Plans
describe('Plans', () => {
  const queues = queuesBy({
    planning: {
      DT: [
        queueRow({ status: 'Approved', committed_count: 40, in_force_count: 40 }),
        queueRow({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12, status: 'Returned', committed_count: 25 }),
        queueRow({ contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: null, status: null, committed_count: null }),
      ],
      ACCEPTANCE: [queueRow({ plan_id: 21, status: 'Submitted', committed_count: 20 })],
    },
    running: {},
  })

  it('shows who shared, as a count, a segmented bar and a Not shared strip', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues })
    show('/monthly-plan?tab=plans')

    const bar = await screen.findByRole('img', { name: '2 of 3 contractors shared' })
    expect(bar.querySelectorAll('i')).toHaveLength(3)
    expect(bar.querySelectorAll('i[data-shared="false"]')).toHaveLength(1)
    expect(screen.getByText(/contractors shared$/).textContent).toBe('2 of 3 contractors shared')
    const strip = screen.getByRole('region', { name: 'Not shared yet' })
    expect(within(strip).getByText('Gamma Survey')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: `${monthLabel(PLANNING)} plans` })).toBeInTheDocument()
  })

  it('has one column per stream, and each status in words', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues })
    const { container } = show('/monthly-plan?tab=plans')
    await screen.findByRole('list', { name: `${monthLabel(PLANNING)} plans` })

    const head = container.querySelector('.mp-list-head')
    expect([...head.children].map((c) => c.textContent)).toEqual(['Contractor', 'DT Delivery', 'Acceptance', 'ICT', 'CRA'])
    const alpha = container.querySelector('[data-contractor="1"]')
    expect(alpha.querySelectorAll('.mp-cell')).toHaveLength(4)
    expect(within(alpha.querySelector('[data-stream="DT"]')).getByText('Approved')).toBeInTheDocument()
    expect(within(alpha.querySelector('[data-stream="ACCEPTANCE"]')).getByText('Waiting')).toBeInTheDocument()
    expect(within(alpha.querySelector('[data-stream="ICT"]')).getByText('Not shared')).toBeInTheDocument()
    const beta = container.querySelector('[data-contractor="2"]')
    expect(within(beta.querySelector('[data-stream="DT"]')).getByText('Sent back')).toBeInTheDocument()
  })

  it('measures the running month: on track, or behind in words', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues })
    const { container } = show('/monthly-plan?tab=plans')
    await screen.findByRole('img', { name: 'DT Delivery: 21 delivered of 38 planned' })
    const alpha = container.querySelector('[data-contractor="1"]')
    expect(within(alpha.querySelector('[data-stream="DT"]')).getByText('On track')).toBeInTheDocument()
    expect(within(alpha.querySelector('[data-stream="ACCEPTANCE"]')).getByText('1 behind')).toBeInTheDocument()
  })

  it('opens a contractor’s plan history from the row, read-only', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues })
    show('/monthly-plan?tab=plans')
    await userEvent.click(await screen.findByRole('button', { name: 'Alpha Telecom' }))
    expect(screen.getByRole('dialog', { name: 'Plan history' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
  })
})

// ----------------------------------------------------------------- History
describe('History', () => {
  const rowOf = (name) => screen.getByRole('rowheader', { name }).closest('tr')
  const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)

  it('reads the year once and shows twelve months, plan against delivered', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')

    const table = await screen.findByRole('table')
    expect(api.get).toHaveBeenCalledWith('/pip/overview', { params: { period: 'year', year: RUNNING.year, month: 1 } })
    expect(table.querySelector('caption')).toHaveTextContent('DT Delivery plan against delivered by month')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Month', 'Contractor plan', 'Internal PIP', 'Delivered', '% of plan', '% of Internal PIP', 'Result',
    ])
    expect([...table.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual(
      Array.from({ length: 12 }, (_, i) => shamsiMonthName(i + 1)),
    )
    // Farvardin: plan 10, internal 20, delivered 14 (Beta had no plan).
    expect(cells(rowOf(shamsiMonthName(1)))).toEqual(['10', '20', '14', '140%', '70%', 'Met plan'])
  })

  it('leaves the running month out of the totals and never judges it', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    await screen.findByRole('table')

    expect(within(rowOf(shamsiMonthName(RUNNING.month))).getByText('Running')).toBeInTheDocument()
    const closed = RUNNING.month - 1
    // Closed months: plan 10 and internal 20 each; delivered 14 each, 9 in month 2.
    const delivered = closed * 14 - (closed >= 2 ? 5 : 0)
    const total = cells(rowOf('Completed months'))
    expect(total.slice(0, 3)).toEqual([String(closed * 10), String(closed * 20), String(delivered)])
    // A month still ahead is greyed, with a dash.
    if (RUNNING.month < 12) {
      expect(rowOf(shamsiMonthName(12))).toHaveClass('mp-future')
      expect(cells(rowOf(shamsiMonthName(12)))).toEqual(['—'])
    }
  })

  it('colours only Below 80%, with its words', async () => {
    signedInAs('PM')
    serveOverview()
    const { container } = show('/monthly-plan?tab=history')
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText('Contractor'), 'Alpha Telecom')
    const below = container.querySelectorAll('[data-result="below"]')
    expect(below).toHaveLength(RUNNING.month > 2 ? 1 : 0)
    if (RUNNING.month > 2) expect(within(rowOf(shamsiMonthName(2))).getByText('Below 80%')).toBeInTheDocument()
  })

  it('filters by contractor without the Internal PIP, by stream and by year', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    const table = await screen.findByRole('table')

    await userEvent.selectOptions(screen.getByLabelText('Contractor'), 'Alpha Telecom')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual([
      'Month', 'Contractor plan', 'Delivered', '% of plan', 'Result',
    ])
    expect(cells(rowOf(shamsiMonthName(1)))).toEqual(['10', '10', '100%', 'Met plan'])

    await userEvent.selectOptions(screen.getByLabelText('Contractor'), 'Beta Networks')
    // No plan: a dash, never 0, and no verdict.
    expect(cells(rowOf(shamsiMonthName(1)))).toEqual(['—', '4', '—', '—'])

    await userEvent.click(screen.getByRole('button', { name: 'Acceptance' }))
    expect(cells(rowOf(shamsiMonthName(1)))).toEqual(['—', '8', '—', '—'])

    const years = screen.getByLabelText('Year')
    expect(years.options[0].textContent).toBe(persian(RUNNING.year))
    await userEvent.selectOptions(years, String(RUNNING.year - 1))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/overview', { params: { period: 'year', year: RUNNING.year - 1, month: 1 } }),
    )
  })

  it('offers a retry when the year cannot be read', async () => {
    signedInAs('PM')
    serveOverview(overview(), { overviewFails: new Error('down') })
    show('/monthly-plan?tab=history')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load history.')
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------ Internal PIP
describe('Internal PIP', () => {
  it('saves only a changed number, by Save or by Enter', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show('/monthly-plan?tab=internal')

    const input = await screen.findByLabelText('Internal PIP DT Delivery')
    expect(input).toHaveValue(150)
    const save = screen.getByRole('button', { name: 'Save Internal PIP DT Delivery' })
    expect(save).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Increase Internal PIP DT Delivery' }))
    expect(input).toHaveValue(155)
    expect(save).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Decrease Internal PIP DT Delivery' }))
    expect(save).toBeDisabled()

    await userEvent.clear(input)
    await userEvent.type(input, '170{Enter}')
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/pip/internal-target', {
        stream: 'DT', year: RUNNING.year, month: RUNNING.month, target_count: 170,
      }),
    )
    expect(await screen.findByText('Internal PIP saved')).toBeInTheDocument()
  })

  it('shows the running month’s coverage in one sentence', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    const { container } = show('/monthly-plan?tab=internal')
    await screen.findByLabelText('Internal PIP DT Delivery')
    const dt = container.querySelector('.mp-internal-row[data-stream="DT"]')
    // Delivered 21 of 150 (14%); the contractors' PIPs total 143, 7 below.
    expect(dt.querySelector('.mp-sentence').textContent).toBe(
      '21 delivered · 14% of Internal PIP. Contractor PIPs total 143 (7 below Internal PIP).',
    )
    expect(within(dt).getByText('Internal 150')).toBeInTheDocument()
  })

  it('switches to the planning month, counting shared plans and who is waiting', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    const { container } = show('/monthly-plan?tab=internal')
    await screen.findByLabelText('Internal PIP DT Delivery')
    await userEvent.click(screen.getByRole('button', { name: /planning/ }))

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/overview', {
        params: { period: 'month', year: PLANNING.year, month: PLANNING.month },
      }),
    )
    // Alpha 40 waiting, Beta 40 approved: 80 shared of 150.
    await waitFor(() =>
      expect(container.querySelector('.mp-internal-row[data-stream="DT"] .mp-sentence').textContent).toBe(
        '80 shared · 53% of Internal PIP. 70 still to cover. 1 waiting for approval, 0 contractors have not shared.',
      ),
    )
    expect(container.querySelector('.mp-internal-row[data-stream="DT"] .mp-legend').textContent).toContain('(waiting)')
  })

  it('shows a role that cannot set it the number as text', async () => {
    signedInAs('Viewer')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    const { container } = show('/monthly-plan?tab=internal')
    await waitFor(() => expect(container.querySelector('.mp-target')).toHaveTextContent('150'))
    expect(screen.queryByRole('button', { name: /Save Internal PIP/ })).toBeNull()
    expect(screen.queryByLabelText('Internal PIP DT Delivery')).toBeNull()
  })
})

describe('the staff export', () => {
  it('downloads the month in the header, every stream', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    show()

    await approvalsLoaded()
    api.get.mockImplementationOnce(() => Promise.resolve({ data: new Blob(['x']), headers: {} }))
    await userEvent.click(screen.getByRole('button', { name: /Export Excel/ }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/scorecard.xlsx', {
        params: { period: 'month', year: PLANNING.year, month: PLANNING.month },
        responseType: 'blob',
      }),
    )
  })
})

describe('links from the Action Center', () => {
  it('opens the PM on that plan’s drawer', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: WAITING_QUEUES })
    show('/monthly-plan?year=1405&month=8&stream=ACCEPTANCE&contractor=1')

    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: 1405, month: 8, stream: 'ACCEPTANCE' } })
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
