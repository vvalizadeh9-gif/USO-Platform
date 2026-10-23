// The monthly plan screen, from both sides.
//
// What is worth testing here is not the layout but the two things this screen
// gets wrong easily: showing the contractor a form when the number is no
// longer theirs to change, and offering a decision to somebody who cannot
// make one. Both are re-checked by the server — these tests are about what
// the interface offers, which is what decides whether a person can work.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'
import { currentShamsiPeriod, nextPeriod, shamsiMonthName } from '../../lib/shamsi'
import { pickOption } from '../../test/pickOption'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const persian = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
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

  it('says so, once, when the PM approved a different number', async () => {
    signedInAs('Contractor')
    serve({
      my: context({
        planning: { status: 'Approved', committed_count: 18, asked_count: 25, decision_comment: 'Too high for the sites held' },
      }),
    })
    show()

    const lines = await screen.findAllByText('Adjusted by the PM from 25 to 18 — Too high for the sites held')
    expect(lines.length).toBeGreaterThan(0)
  })

  it('shows no adjustment line on a plan approved as asked', async () => {
    signedInAs('Contractor')
    serve({ my: context({ planning: { status: 'Approved', committed_count: 40 } }) })
    show()

    await screen.findAllByText(/this is your target for the month/i)
    expect(screen.queryByText(/Adjusted by the PM/)).toBeNull()
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
    await pickOption(within(row).getByRole('combobox'), 'SITES_BLOCKED')
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
    await pickOption(within(row).getByRole('combobox'), 'OTHER')
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
 * The staff page's reads: GET /pip/overview (the running and planning months,
 * and period=year through `year`), GET /pip/queue by params, the Internal PIP
 * targets and the DT scorecard. Any of them can be replaced per test.
 */
function serveOverview(data = overview(), { queues, year, overviewFails, targets, scorecard } = {}) {
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
    if (url === '/pip/internal-target') {
      const t = targets ? targets(params) : { current: 150, previous: 145 }
      const period = (n) => (n == null ? null : { stream: params.stream, target_count: n })
      return Promise.resolve({ data: { stream: params.stream, current: period(t.current), previous: period(t.previous), history: [] } })
    }
    if (url === '/pip/scorecard') return Promise.resolve({ data: scorecard ?? SCORECARD_YEAR(params.year) })
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

const { monthLabel } = await import('./planBoard')
const PLANNING = nextPeriod(RUNNING.year, RUNNING.month)

/** Shaped from app/schemas: OverviewYearMonth, for one stream of one year. */
const yearMonths = (year, { scale = 1 } = {}) =>
  Array.from({ length: 12 }, (_, i) => {
    const m = i + 1
    const future = year > RUNNING.year || (year === RUNNING.year && m > RUNNING.month)
    const base = { shamsi_year: year, shamsi_month: m, shamsi_month_name: shamsiMonthName(m) }
    if (future) {
      return { ...base, plan: null, delivered: null, internal: null, is_running: false, is_future: true, contractors: [] }
    }
    // Month 2 is half of plan for Alpha; every other closed month meets its plan.
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

/** The DT scorecard for a year: Alpha held 7 sites every month. */
const SCORECARD_YEAR = (year) => ({
  months: Array.from({ length: 12 }, (_, i) => ({
    shamsi_year: year, shamsi_month: i + 1, shamsi_month_name: shamsiMonthName(i + 1),
    pip: 10, carried_in: 0, newly_assigned: 7, available: 7, delivered: 10, released: 0, carried_out: 0,
    achievement_percent: null, coverage_percent: null, execution_percent: null,
    committed_contractors: 1, uncommitted_contractors: 0,
    rows: [{
      contractor_id: 1, name: 'Alpha Telecom', pip: 10, carried_in: 0, newly_assigned: 7, available: 7,
      delivered: 10, released: 0, carried_out: 0, achievement_percent: null, execution_percent: null, coverage_percent: null,
    }],
  })),
  summable: [], balances: [], is_contractor: false,
})

// What the PM sees for the planning month. Alpha (oldest) and Zulu are
// waiting on DT, Alpha on Acceptance too; Beta is decided (Acceptance changed
// from 25 to 18); Delta's DT plan was returned and Gamma filed nothing. A
// revision is pending on the running month, and an ICT plan is waiting.
const row = (over) => queueRow({ assignment: 76, pip: 38, delivered: 24, ...over })
const none = (id, name) => row({ contractor_id: id, contractor_name: name, plan_id: null, status: null, committed_count: null, submitted_at: null })
const PLAN_QUEUES = queuesBy({
  planning: {
    DT: [
      row({ plan_id: 11, submitted_at: '2026-08-20T09:00:00Z' }),
      row({ contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 12, status: 'Approved', committed_count: 30, in_force_count: 30 }),
      none(3, 'Gamma Survey'),
      row({ contractor_id: 4, contractor_name: 'Delta Co', plan_id: 14, status: 'Returned', committed_count: 25 }),
      row({ contractor_id: 5, contractor_name: 'Zulu Net', plan_id: 61, committed_count: 12, submitted_at: '2026-08-25T09:00:00Z' }),
    ],
    ACCEPTANCE: [
      row({ plan_id: 21, committed_count: 20, submitted_at: '2026-08-20T09:00:00Z' }),
      row({
        contractor_id: 2, contractor_name: 'Beta Networks', plan_id: 22, status: 'Approved', committed_count: 18, in_force_count: 18,
        asked_count: 25, decision_comment: 'Too high for the sites held',
      }),
      none(3, 'Gamma Survey'),
      none(4, 'Delta Co'),
      none(5, 'Zulu Net'),
    ],
    ICT: [row({ contractor_id: 6, contractor_name: 'Epsilon Ltd', plan_id: 71, committed_count: 9 })],
  },
  running: {
    DT: [row({ contractor_id: 3, contractor_name: 'Gamma Survey', plan_id: 31, status: 'RevisionRequested', in_force_count: 30 })],
  },
})

const planPage = () => screen.findByRole('group', { name: 'Needs your decision' })
const band = (name) => screen.getByRole('region', { name })
const summary = (name) => screen.getByRole('region', { name: `${name} summary` })
const stepperOf = (name) => within(band(name))

// ------------------------------------------------------------- navigation
describe('the staff page: the rail is the menu', () => {
  const title = () => screen.getByRole('heading', { level: 1 })

  it('opens on Plans with no tab bar, showing the planning month', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()

    await planPage()
    expect(title()).toHaveTextContent('Plans')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByTestId('mp-period')).toHaveTextContent(monthLabel(PLANNING))
  })

  it.each([
    ['?tab=approvals', 'Plans'],
    ['?tab=plans', 'Plans'],
    ['?tab=history', 'History'],
    ['?tab=internal', 'Internal PIP'],
    ['?tab=pip', 'Plans'],
    ['?tab=nonsense', 'Plans'],
  ])('titles %s with the rail label %s', async (search, name) => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show(`/monthly-plan${search}`)
    await waitFor(() => expect(title()).toHaveTextContent(name))
  })

  it('shows the Shamsi year on History, in the header', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show('/monthly-plan?tab=history')
    expect(await screen.findByRole('combobox', { name: 'Year' })).toHaveTextContent(persian(RUNNING.year))
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

// ------------------------------------------------------------------- Plans
describe('Plans', () => {
  const chips = (name) => [...within(screen.getByRole('button', { name: new RegExp(`^${name}`) })).getAllByText(/^(DT|Acc)$/)]

  it('groups contractors by what they need, oldest waiting first', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    const names = (group) => within(screen.getByRole('group', { name: group })).getAllByRole('button').map((b) => b.querySelector('.mp2-row-name').textContent)
    expect(names('Revision requests')).toEqual(['Gamma Survey'])
    expect(names('Needs your decision')).toEqual(['Alpha Telecom', 'Zulu Net'])
    expect(names('Not filed')).toEqual(['Delta Co', 'Gamma Survey'])
    expect(names('Decided')).toEqual(['Beta Networks'])
    expect(names('Other streams (ICT, CRA)')).toEqual(['Epsilon Ltd'])
    // The first row needing a decision is selected.
    expect(screen.getByRole('button', { name: /^Alpha Telecom/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: 'Alpha Telecom' })).toBeInTheDocument()
  })

  it('marks each stream: grey while waiting, green when approved, red when not filed', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    expect(chips('Alpha').map((c) => c.dataset.tone)).toEqual(['neutral', 'neutral'])
    expect(chips('Beta').map((c) => c.dataset.tone)).toEqual(['approved', 'approved'])
    // A returned plan is not filed: Delta's DT is red.
    expect(chips('Delta').map((c) => c.dataset.tone)).toEqual(['danger', 'danger'])
  })

  it('counts who submitted, leaving out a returned plan', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    // DT: Alpha, Beta and Zulu of five; Delta's returned plan does not count.
    expect(within(summary('DT delivery')).getByText('3 of 5 contractors submitted')).toBeInTheDocument()
    expect(within(summary('Acceptance')).getByText('2 of 5 contractors submitted')).toBeInTheDocument()
    expect(summary('DT delivery').querySelectorAll('.mp2-dots i[data-on]')).toHaveLength(3)
  })

  it('shows asked, the total after decisions and what is left to cover', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    const dt = within(summary('DT delivery'))
    expect(dt.getByText('Asked').previousSibling).toHaveTextContent('82')
    expect(dt.getByText('After your decisions').previousSibling).toHaveTextContent('82No change')
    expect(dt.getByText('Internal PIP').previousSibling).toHaveTextContent('150')
    expect(dt.getByText('68 to cover')).toBeInTheDocument()
    // Beta's Acceptance plan was asked at 25 and approved at 18.
    const acc = within(summary('Acceptance'))
    expect(acc.getByText('Asked').previousSibling).toHaveTextContent('45')
    expect(acc.getByText('After your decisions').previousSibling).toHaveTextContent('38−7')
    expect(acc.queryByText(/to cover/)).toBeNull()
  })

  it('recomputes the bar as a decision moves', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    const dtBand = stepperOf('DT delivery')
    for (let i = 0; i < 5; i += 1) fireEvent.click(dtBand.getByRole('button', { name: 'Decrease' }))
    expect(dtBand.getByRole('status', { name: 'DT delivery, Alpha Telecom' })).toHaveTextContent('35')

    const dt = within(summary('DT delivery'))
    expect(dt.getByText('After your decisions').previousSibling).toHaveTextContent('77−5')
    expect(dt.getByText('73 to cover')).toBeInTheDocument()
    expect(summary('DT delivery').querySelector('.mp2-bar')).toHaveAccessibleName('DT delivery: 30 approved, 47 waiting, of Internal PIP 150')
  })

  it('confirms as asked with no comment, through /approve', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    expect(screen.queryByLabelText(/Comment/)).toBeNull()
    await userEvent.click(stepperOf('DT delivery').getByRole('button', { name: 'Confirm 40' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/11/approve'))
    expect((await screen.findAllByText('DT plan approved: 40')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('mp-live')).toHaveTextContent('DT plan approved: 40')
  })

  it('asks for a comment only when the number changes, then approves the adjusted number', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    const dtBand = stepperOf('DT delivery')
    fireEvent.click(dtBand.getByRole('button', { name: 'Decrease' }))
    expect(dtBand.getByText('−1 vs asked')).toBeInTheDocument()
    const decrease = dtBand.getByRole('button', { name: 'Decrease to 39' })
    expect(decrease).toBeDisabled()
    expect(dtBand.getByText('Required')).toBeInTheDocument()

    await userEvent.type(dtBand.getByLabelText(/Comment/), 'Too high for the sites held')
    expect(decrease).toBeEnabled()
    await userEvent.click(decrease)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/pip/11/approve-adjusted', { committed_count: 39, comment: 'Too high for the sites held' }),
    )
    expect(api.post).not.toHaveBeenCalledWith('/pip/11/approve')
    expect((await screen.findAllByText('DT plan approved: 39')).length).toBeGreaterThan(0)
  })

  it('says Increase when the number goes up, and closes the comment when it returns to asked', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    const dtBand = stepperOf('DT delivery')
    fireEvent.click(dtBand.getByRole('button', { name: 'Increase' }))
    expect(dtBand.getByRole('button', { name: 'Increase to 41' })).toBeInTheDocument()
    expect(dtBand.getByText('+1 vs asked')).toBeInTheDocument()
    fireEvent.click(dtBand.getByRole('button', { name: 'Decrease' }))
    expect(dtBand.queryByLabelText(/Comment/)).toBeNull()
    expect(dtBand.getByRole('button', { name: 'Confirm 40' })).toBeInTheDocument()
    expect(dtBand.getByText('As asked')).toBeInTheDocument()
  })

  it('keeps the number and the comment, and shows the reason, when a decision fails', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()
    api.post.mockRejectedValueOnce({ response: { data: { detail: 'The plan was changed by someone else' } } })

    const dtBand = stepperOf('DT delivery')
    fireEvent.click(dtBand.getByRole('button', { name: 'Decrease' }))
    await userEvent.type(dtBand.getByLabelText(/Comment/), 'Too high')
    await userEvent.click(dtBand.getByRole('button', { name: 'Decrease to 39' }))

    expect(await screen.findByText('The plan was changed by someone else')).toBeInTheDocument()
    expect(dtBand.getByRole('status', { name: 'DT delivery, Alpha Telecom' })).toHaveTextContent('39')
    expect(dtBand.getByLabelText(/Comment/)).toHaveValue('Too high')
  })

  it('offers Confirm all as asked only while nothing is changed, and approves every waiting stream', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    expect(screen.getByRole('button', { name: 'Confirm all as asked' })).toBeEnabled()
    fireEvent.click(stepperOf('Acceptance').getByRole('button', { name: 'Increase' }))
    expect(screen.queryByRole('button', { name: 'Confirm all as asked' })).toBeNull()
    fireEvent.click(stepperOf('Acceptance').getByRole('button', { name: 'Decrease' }))

    await userEvent.click(screen.getByRole('button', { name: 'Confirm all as asked' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post).toHaveBeenCalledWith('/pip/11/approve')
    expect(api.post).toHaveBeenCalledWith('/pip/21/approve')
    expect((await screen.findAllByText('Alpha Telecom: plans approved as asked')).length).toBeGreaterThan(0)
  })

  it('shows a decided stream as the plan in force, and says what changed', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()
    await userEvent.click(screen.getByRole('button', { name: /^Beta Networks/ }))

    expect(screen.queryByRole('button', { name: 'Confirm all as asked' })).toBeNull()
    expect(within(band('Acceptance')).getByText('Plan in force')).toBeInTheDocument()
    expect(within(band('Acceptance')).getByText('Asked 25, changed to 18 — Too high for the sites held')).toBeInTheDocument()
    expect(within(band('DT delivery')).getByText('Confirmed as asked')).toBeInTheDocument()
    expect(within(band('DT delivery')).getAllByText('Approved')[0]).toBeInTheDocument()
  })

  it('shows a stream nobody filed as Not filed, with no due line', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()
    await userEvent.click(screen.getByRole('button', { name: /^Delta Co/ }))

    const dtBand = within(band('DT delivery'))
    expect(dtBand.getAllByText('Not filed')).toHaveLength(2)
    expect(dtBand.queryByRole('button')).toBeNull()
    expect(screen.queryByText(/Due in/)).toBeNull()
  })

  it('opens a revision request, and an ICT plan, in the decision drawer', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    await userEvent.click(within(screen.getByRole('group', { name: 'Revision requests' })).getByRole('button', { name: /Gamma Survey/ }))
    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: RUNNING.year, month: RUNNING.month, stream: 'DT' } })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    await userEvent.click(within(screen.getByRole('group', { name: 'Other streams (ICT, CRA)' })).getByRole('button', { name: /Epsilon Ltd/ }))
    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: PLANNING.year, month: PLANNING.month, stream: 'ICT' } })
  })

  it('gives a role that cannot decide the same page with plain numbers', async () => {
    signedInAs('Viewer')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show()
    await planPage()

    expect(screen.queryByRole('button', { name: 'Decrease' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm all as asked' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Confirm \d/ })).toBeNull()
    expect(within(band('DT delivery')).getByText('Asked').nextSibling).toHaveTextContent('40')
    expect(within(band('DT delivery')).getByText('Waiting')).toBeInTheDocument()
  })

  it('selects the contractor a link names', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show(`/monthly-plan?year=${PLANNING.year}&month=${PLANNING.month}&stream=DT&contractor=2`)
    expect(await screen.findByRole('region', { name: 'Beta Networks' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Plan decision' })).toBeNull()
  })

  it('opens the drawer for a link to another month or to ICT', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show(`/monthly-plan?year=${RUNNING.year}&month=${RUNNING.month}&stream=ACCEPTANCE&contractor=1`)

    await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: RUNNING.year, month: RUNNING.month, stream: 'ACCEPTANCE' } })
  })

  it('says so when the plans cannot be read, and tries again', async () => {
    signedInAs('PM')
    api.get.mockRejectedValue(new Error('down'))
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the plans')
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
  })

  it('says there are no contractors yet', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: queuesBy({ planning: {}, running: {} }) })
    show()
    expect(await screen.findByText('No contractors yet')).toBeInTheDocument()
  })
})

// ----------------------------------------------------------------- History
describe('History', () => {
  const closed = RUNNING.month - 1
  const deliveredYear = closed * 10 - (closed >= 2 ? 5 : 0)
  const alphaPct = closed ? Math.round((100 * deliveredYear) / (closed * 10)) : null
  const loaded = () => screen.findByRole('button', { name: /^Alpha Telecom/ })

  it('reads the year and the DT assignment once', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    await loaded()

    expect(api.get).toHaveBeenCalledWith('/pip/overview', { params: { period: 'year', year: RUNNING.year, month: 1 } })
    expect(api.get).toHaveBeenCalledWith('/pip/scorecard', { params: { year: RUNNING.year } })
  })

  it('lists contractors worst first, with their DT and Acceptance share of PIP', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    await loaded()

    const group = screen.getByRole('group', { name: 'Worst first' })
    const rows = within(group).getAllByRole('button')
    // Beta never had a plan: no share, so last.
    expect(rows.map((r) => r.querySelector('.mp2-row-name').textContent)).toEqual(['Alpha Telecom', 'Beta Networks'])
    const share = alphaPct == null ? '—' : `${alphaPct}%`
    expect([...rows[0].querySelectorAll('.mp2-figure')].map((f) => f.textContent)).toEqual([share, share])
    expect([...rows[1].querySelectorAll('.mp2-figure')].map((f) => f.textContent)).toEqual(['—', '—'])
    expect(rows[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('draws DT delivery and Acceptance stacked, as a trend with the running month as a capsule', async () => {
    signedInAs('PM')
    serveOverview()
    const { container } = show('/monthly-plan?tab=history')
    await loaded()

    for (const name of ['DT delivery', 'Acceptance']) {
      expect(within(band(name)).getByRole('img', { name: new RegExp(`^${name}, Alpha Telecom`) })).toBeInTheDocument()
    }
    expect(container.querySelectorAll('.mp2-capsule')).toHaveLength(2)
    expect(within(band('DT delivery')).getByText('10 of 10')).toBeInTheDocument()
    expect(within(band('Acceptance')).getByText('20 of 20')).toBeInTheDocument()
    // Gap and % under the chart, for completed months only.
    const strips = band('DT delivery').querySelectorAll('.mp2-strip')
    expect(strips).toHaveLength(2)
    expect(strips[0].querySelectorAll('.mp2-strip-cell:not(:empty)')).toHaveLength(closed)
    if (closed >= 2) expect(strips[1].querySelectorAll('.mp2-strip-cell')[1]).toHaveTextContent('50%')
    if (closed >= 2) expect(strips[1].querySelectorAll('.mp2-strip-cell')[1]).toHaveAttribute('data-tone', 'danger')
  })

  it('switches to the table: Assigned for DT only, gap and percent per month', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))

    const dt = within(band('DT delivery'))
    const acc = within(band('Acceptance'))
    expect(dt.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['Assigned', 'PIP', 'Actual', 'Gap', '%'])
    expect(acc.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['PIP', 'Actual', 'Gap', '%'])
    const cellsOf = (view, name) => [...view.getByRole('rowheader', { name }).closest('tr').querySelectorAll('td')].map((td) => td.textContent)
    expect(cellsOf(dt, 'Assigned')[0]).toBe('7')
    expect(cellsOf(dt, 'PIP')[0]).toBe('10')
    expect(cellsOf(dt, 'Actual')[0]).toBe('10')
    expect(cellsOf(dt, 'Gap')[0]).toBe('0')
    expect(cellsOf(dt, '%')[0]).toBe('100%')
    if (closed >= 2) {
      expect(cellsOf(dt, 'Gap')[1]).toBe('−5')
      expect(cellsOf(dt, '%')[1]).toBe('50%')
    }
    // Twelve months and a pinned Total; a month ahead is empty, not a dash.
    expect(cellsOf(dt, 'PIP')).toHaveLength(13)
    if (RUNNING.month < 12) expect(cellsOf(dt, 'Actual')[11]).toBe('')
    expect(cellsOf(dt, 'PIP').at(-1)).toBe(String(closed * 10))
    expect(dt.getByRole('columnheader', { name: shamsiMonthName(RUNNING.month) })).toHaveAttribute('data-running', 'true')
  })

  it('picks another contractor and another year', async () => {
    signedInAs('PM')
    serveOverview()
    show('/monthly-plan?tab=history')
    await loaded()

    await userEvent.click(screen.getByRole('button', { name: /^Beta Networks/ }))
    expect(screen.getByRole('region', { name: 'Beta Networks' })).toBeInTheDocument()

    await pickOption(screen.getByRole('combobox', { name: 'Year' }), String(RUNNING.year - 1))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/overview', { params: { period: 'year', year: RUNNING.year - 1, month: 1 } }),
    )
  })

  it('still draws the page when the assignment cannot be read', async () => {
    signedInAs('PM')
    serveOverview()
    const wrapped = api.get.getMockImplementation()
    api.get.mockImplementation((url, config) => (url === '/pip/scorecard' ? Promise.reject(new Error('down')) : wrapped(url, config)))
    show('/monthly-plan?tab=history')
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(within(band('DT delivery')).getByRole('rowheader', { name: 'Assigned' })).toBeInTheDocument()
  })

  it('offers a retry when the year cannot be read', async () => {
    signedInAs('PM')
    serveOverview(overview(), { overviewFails: new Error('down') })
    show('/monthly-plan?tab=history')
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the history')
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------ Internal PIP
describe('Internal PIP', () => {
  const planningRow = () => screen.findByRole('button', { name: new RegExp(`^${monthLabel(PLANNING)}`) })
  const value = (name) => within(band(name)).getByRole('status', { name: `${name} Internal PIP` })

  it('opens on the planning month, with last month beside each number', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show('/monthly-plan?tab=internal')

    expect(await planningRow()).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: new RegExp(`^${monthLabel(RUNNING)}`) })).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(value('DT delivery')).toHaveTextContent('150'))
    expect(within(band('DT delivery')).getByText('Last month 145')).toBeInTheDocument()
    expect(within(band('DT delivery')).getByText('+5')).toBeInTheDocument()
    // Approved contractor plans cover 143 of 150.
    expect(within(band('DT delivery')).getByText('143 in contractor plans')).toBeInTheDocument()
    expect(within(band('DT delivery')).getByText('7 to cover')).toBeInTheDocument()
  })

  it('has one Save and one Discard for the page, disabled until something changes', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show('/monthly-plan?tab=internal')
    await planningRow()
    await waitFor(() => expect(value('DT delivery')).toHaveTextContent('150'))

    const save = screen.getByRole('button', { name: 'Save' })
    const discard = screen.getByRole('button', { name: 'Discard' })
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
    expect(save).toBeDisabled()
    expect(discard).toBeDisabled()

    fireEvent.click(within(band('DT delivery')).getByRole('button', { name: 'Increase' }))
    fireEvent.click(within(band('Acceptance')).getByRole('button', { name: 'Decrease' }))
    expect(value('DT delivery')).toHaveTextContent('151')
    expect(save).toBeEnabled()

    await userEvent.click(discard)
    expect(value('DT delivery')).toHaveTextContent('150')
    expect(save).toBeDisabled()
  })

  it('saves every changed target in one go, through the existing endpoint', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show('/monthly-plan?tab=internal')
    await planningRow()
    await waitFor(() => expect(value('DT delivery')).toHaveTextContent('150'))

    fireEvent.click(within(band('DT delivery')).getByRole('button', { name: 'Increase' }))
    fireEvent.click(within(band('Acceptance')).getByRole('button', { name: 'Increase' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2))
    expect(api.put).toHaveBeenCalledWith('/pip/internal-target', { stream: 'DT', year: PLANNING.year, month: PLANNING.month, target_count: 151 })
    expect(api.put).toHaveBeenCalledWith('/pip/internal-target', { stream: 'ACCEPTANCE', year: PLANNING.year, month: PLANNING.month, target_count: 151 })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows a role that cannot set it the numbers as text, without Save or Discard', async () => {
    signedInAs('Viewer')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    show('/monthly-plan?tab=internal')
    await waitFor(() => expect(value('DT delivery')).toHaveTextContent('150'))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Increase' })).toBeNull()
  })
})

describe('the staff export', () => {
  it('downloads the month in the header, every stream', async () => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    show()

    await planPage()
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

describe('a contractor opening a link from the Action Center', () => {
  it('opens on the month the item is about', async () => {
    signedInAs('Contractor')
    serve({ my: context() })
    show('/monthly-plan?year=1405&month=6')

    await screen.findByText('Planning مهر 1405')
    const requested = api.get.mock.calls.filter(([url]) => url === '/pip/my').map(([, c]) => c.params)
    expect(requested[0]).toMatchObject({ year: 1405, month: 6 })
  })
})

describe('the three pages have no axe violations', () => {
  it.each(['', '?tab=history', '?tab=internal'])('/monthly-plan%s', async (search) => {
    signedInAs('PM')
    serveOverview(overview(), { queues: PLAN_QUEUES })
    const { container } = show(`/monthly-plan${search}`)
    await screen.findAllByRole('region', { name: /DT delivery|Internal PIP/ })
    await waitFor(() => expect(container.querySelector('.mp2-skel')).toBeNull())

    // Contrast needs a real browser; jsdom reports it as incomplete.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))
    expect(serious.map((v) => `${v.id}: ${v.nodes[0].html}`)).toEqual([])
  })
})
