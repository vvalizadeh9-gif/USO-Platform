// The monthly plan screen, from both sides.
//
// What is worth testing here is not the layout but the two things this screen
// gets wrong easily: showing the contractor a form when the number is no
// longer theirs to change, and offering a decision to somebody who cannot
// make one. Both are re-checked by the server — these tests are about what
// the interface offers, which is what decides whether a person can work.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../context/ToastContext'
import { planningPeriod, previousPeriod } from '../../lib/shamsi'

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

function serve({ my, queue: q, scorecard = SCORECARD, plan = acceptancePlan(), revisions }) {
  api.get.mockImplementation((url, config) => {
    // `my` is one context for every /pip/my read, or a function of the
    // params (year, month, stream) when a test needs them to differ.
    if (url === '/pip/my') {
      return Promise.resolve({ data: typeof my === 'function' ? my(config?.params ?? {}) : my })
    }
    if (url === '/pip/revisions') {
      return Promise.resolve({ data: (revisions || revisionsOut)(config?.params ?? {}) })
    }
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

// ------------------------------------------------------ the contractor screen
//
// The contractor's own company, both streams side by side: KPI cards for the
// month now running, the plan block for the month picked, and the trend.
// What these tests hold up is what the screen offers in each state of a plan,
// that one Submit hands in both streams, that the pace is the server's, and
// that nothing on the page names another company or MTN's internal target.
//
// The running month is شهریور 1405 (month 6); the month being planned is مهر
// 1405 (month 7). Shaped from app/schemas: MonthlyPlanContext with
// MyMonthStanding.
const RIVAL = 'Rival Networks'
const INTERNAL = 4321

const standing = (stream, over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 6,
  shamsi_month_name: 'شهریور',
  label: 'شهریور 1405',
  ...(stream === 'DT'
    ? { assignment: 76, carried_in: 52, newly_assigned: 24, pip: 38, delivered: 31, expected_by_today: 31 }
    : { assignment: null, carried_in: null, newly_assigned: null, pip: 20, delivered: 16, expected_by_today: 16 }),
  pace_pct: 81,
  ...over,
})

const myPlanning = (stream, over = {}) => ({
  shamsi_year: 1405,
  shamsi_month: 7,
  shamsi_month_name: 'مهر',
  label: 'مهر 1405',
  stream,
  version: null,
  status: null,
  committed_count: null,
  return_comment: null,
  returned_by: null,
  deadline_shamsi: '1405/07/03',
  deadline_gregorian: '2026-09-25',
  deadline_passed: false,
  is_late: false,
  days_remaining: 6,
  in_force_count: null,
  in_force_version: null,
  revision_reason: null,
  revision_comment: null,
  revision_open: false,
  ...over,
})

const NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور']
const trail = (stream) =>
  NAMES.map((name, i) => ({
    shamsi_year: 1405,
    shamsi_month: i + 1,
    shamsi_month_name: name,
    label: `${name} 1405`,
    assignment: stream === 'DT' ? 60 : null,
    // فروردین had no plan; تیر was missed; the rest were hit.
    pip: i === 0 ? null : i === 5 ? (stream === 'DT' ? 38 : 20) : stream === 'DT' ? 30 : 15,
    delivered: i === 3 ? 10 : i === 5 ? (stream === 'DT' ? 31 : 16) : stream === 'DT' ? 32 : 16,
    in_progress: i === 5,
  }))

/** One /pip/my answer, for a stream and the month asked for. */
function mine({ year = 1405, month = 7, stream = 'DT', planning: p = {}, current = {} } = {}) {
  const running = year === 1405 && month === 6
  return {
    shamsi_year: year,
    shamsi_month: month,
    shamsi_month_name: NAMES[month - 1] || 'مهر',
    plan: null,
    previous_month_committed: null,
    open_assignments: 12,
    deadline_shamsi: '1405/07/03',
    deadline_gregorian: '2026-09-25',
    deadline_passed: false,
    planning: myPlanning(stream, {
      ...(running
        ? {
            shamsi_month: 6, shamsi_month_name: 'شهریور', label: 'شهریور 1405',
            deadline_shamsi: '1405/06/03', deadline_passed: true, days_remaining: -20,
            status: 'Approved', version: 1, committed_count: stream === 'DT' ? 38 : 20,
            in_force_count: stream === 'DT' ? 38 : 20, in_force_version: 1,
          }
        : {}),
      ...p,
    }),
    current_month: standing(stream, current),
    history: trail(stream),
  }
}

/** Serve /pip/my from a table of overrides by stream and month. */
function serveMine({ planning = {}, running = {}, current = {}, revisions } = {}) {
  serve({
    my: ({ year, month, stream }) => {
      const isRunning = year === 1405 && month === 6
      return mine({
        year,
        month,
        stream,
        planning: (isRunning ? running : planning)[stream] || {},
        current: current[stream] || {},
      })
    },
    revisions,
  })
}

const half = async (name) => screen.findByRole('region', { name })
const PLANNING_URL = '/monthly-plan?year=1405&month=7'
const RUNNING_URL = '/monthly-plan?year=1405&month=6'

describe('the contractor screen', () => {
  it('shows both halves with the contractor’s own numbers', async () => {
    signedInAs('Contractor')
    serveMine()
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    const acc = screen.getByRole('region', { name: 'Acceptance' })

    expect(screen.getByRole('heading', { level: 1, name: 'Monthly Plan' })).toBeInTheDocument()
    expect(screen.getByText('Alpha Telecom')).toBeInTheDocument()

    expect(within(dt).getByText('Your assignment')).toBeInTheDocument()
    expect(within(dt).getByText('76')).toBeInTheDocument()
    expect(within(dt).getByText('Your PIP covers 50% of it')).toBeInTheDocument()
    // Acceptance has no Assignment: one card fewer.
    expect(within(acc).queryByText('Your assignment')).toBeNull()
    expect(within(acc).getByText('villages fully accepted', { exact: false })).toBeInTheDocument()
    expect(within(acc).getByRole('img', { name: /Delivered 16 of 20/ })).toBeInTheDocument()
    expect(within(dt).getByRole('img', { name: /Delivered 31 of 38, today's target 31, assignment 76/ }))
      .toBeInTheDocument()

    // Each stream reads its own plan.
    const streams = api.get.mock.calls.filter(([url]) => url === '/pip/my').map(([, c]) => c.params.stream)
    expect(new Set(streams)).toEqual(new Set(['DT', 'ACCEPTANCE']))
  })

  it('shows no other contractor and no internal PIP, even if the server sent them', async () => {
    signedInAs('Contractor')
    api.get.mockImplementation((url, config) => {
      if (url === '/pip/my') {
        const body = mine(config.params)
        // What a leaky server might add. None of it may reach the page.
        body.internal_pip = INTERNAL
        body.current_month.internal_pip = INTERNAL
        body.current_month.rows = [{ contractor_id: 2, name: RIVAL, pip: 999 }]
        body.rows = [{ contractor_id: 2, contractor_name: RIVAL, pip: 999 }]
        body.history = body.history.map((h) => ({ ...h, internal_pip: INTERNAL, contractor_name: RIVAL }))
        return Promise.resolve({ data: body })
      }
      if (url === '/pip/revisions') return Promise.resolve({ data: revisionsOut(config.params) })
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    show(RUNNING_URL)

    await half('DT Delivery')
    const text = document.body.textContent
    expect(text).not.toContain(RIVAL)
    expect(text).not.toContain(String(INTERNAL))
    expect(text).not.toContain('999')
    expect(text.toLowerCase()).not.toContain('internal')
    // Nothing on the screen asks for a company either.
    for (const [, config] of api.get.mock.calls) {
      expect(config?.params).not.toHaveProperty('contractor_id')
    }
  })

  // ------------------------------------------------------- the plan block
  it('offers the number field for a month not yet handed in', async () => {
    signedInAs('Contractor')
    serveMine()
    show(PLANNING_URL)

    const dt = await half('DT Delivery')
    const input = within(dt).getByLabelText(/Your PIP for/)
    expect(input).toHaveAttribute('type', 'number')
    expect(within(dt).getByText('Not submitted')).toBeInTheDocument()
    expect(within(dt).getByText(/6 days left/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Acceptance' })).getByLabelText(/Your PIP for/))
      .toBeInTheDocument()
    // One Submit for both, not one per half.
    expect(screen.getAllByRole('button', { name: 'Submit' })).toHaveLength(1)
  })

  it('puts the PM’s comment and name in front of a returned plan, and resubmits', async () => {
    signedInAs('Contractor')
    serveMine({
      planning: {
        DT: { status: 'Returned', version: 1, committed_count: 50, return_comment: '<b>Too many</b> for your sites', returned_by: 'PM One' },
      },
    })
    show(PLANNING_URL)

    const dt = await half('DT Delivery')
    const note = within(dt).getByRole('status')
    expect(note).toHaveTextContent('PM One, PM sent this back')
    // Text, never markup.
    expect(note).toHaveTextContent('<b>Too many</b> for your sites')
    expect(note.querySelector('b')).toBeNull()
    // The comment comes before the field that answers it.
    const input = within(dt).getByLabelText(/Your PIP for/)
    expect(note.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(input).toHaveValue(50)
    expect(screen.getByRole('button', { name: 'Resubmit' })).toBeInTheDocument()
  })

  it('says the deadline passed, with no field, when nothing was handed in', async () => {
    signedInAs('Contractor')
    serveMine({ running: { DT: { status: null, version: null, committed_count: null, in_force_count: null, in_force_version: null } } })
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    expect(within(dt).getByText('Not submitted — deadline passed')).toBeInTheDocument()
    expect(within(dt).queryByLabelText(/Your PIP for/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
  })

  it('holds a submitted plan read-only while the PM has it', async () => {
    signedInAs('Contractor')
    serveMine({ planning: { DT: { status: 'Submitted', version: 1, committed_count: 40 } } })
    show(PLANNING_URL)

    const dt = await half('DT Delivery')
    expect(within(dt).getByText('Waiting for PM')).toBeInTheDocument()
    expect(within(dt).getByText('40')).toBeInTheDocument()
    expect(within(dt).queryByLabelText(/Your PIP for/)).toBeNull()
    // The Acceptance plan is still open, so Submit hands in that one only.
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(screen.getByText(/Hands in your Acceptance PIP/)).toBeInTheDocument()
  })

  it('offers Request revision on an approved plan while the window is open', async () => {
    signedInAs('Contractor')
    serveMine({ running: { DT: { revision_open: true } } })
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    expect(within(dt).getByRole('button', { name: 'Request revision' })).toBeInTheDocument()
    // The Acceptance plan's window is closed in this fixture: Final.
    const acc = screen.getByRole('region', { name: 'Acceptance' })
    expect(within(acc).queryByRole('button', { name: 'Request revision' })).toBeNull()
    expect(within(acc).getByText('Final')).toBeInTheDocument()
  })

  it('says a revision is with the PM and the approved number still counts', async () => {
    signedInAs('Contractor')
    serveMine({
      running: {
        DT: { status: 'RevisionRequested', version: 2, committed_count: 35, revision_open: true, revision_reason: 'PERMITS' },
      },
    })
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    expect(within(dt).getByText('Revision 38→35 · with PM')).toBeInTheDocument()
    expect(within(dt).getByText('Until PM approves, 38 counts.')).toBeInTheDocument()
    expect(within(dt).getByText('Approved v1 · stays until PM decides')).toBeInTheDocument()
    // Pending: no second request, even with the window open.
    expect(within(dt).queryByRole('button', { name: 'Request revision' })).toBeNull()
    expect(screen.getByRole('list', { name: 'Updates' })).toHaveTextContent('DT: revision 38→35 waiting for PM')
  })

  it('hides Request revision after day 15', async () => {
    signedInAs('Contractor')
    serveMine({ running: { DT: { revision_open: false }, ACCEPTANCE: { revision_open: false } } })
    show(RUNNING_URL)

    await half('DT Delivery')
    expect(screen.queryByRole('button', { name: 'Request revision' })).toBeNull()
    expect(screen.getAllByText('Final')).toHaveLength(2)
    expect(screen.getByText('revisions closed')).toBeInTheDocument()
  })

  it('sends a revision with its reason, and needs a comment for Other', async () => {
    signedInAs('Contractor')
    serveMine({ running: { DT: { revision_open: true } } })
    show(RUNNING_URL)
    const user = userEvent.setup()

    const dt = await half('DT Delivery')
    await user.click(within(dt).getByRole('button', { name: 'Request revision' }))
    await user.type(within(dt).getByLabelText('New DT PIP'), '35')
    await user.selectOptions(within(dt).getByLabelText('Reason'), 'OTHER')
    await user.click(within(dt).getByRole('button', { name: 'Send to PM' }))
    expect(api.post).not.toHaveBeenCalled()

    await user.type(within(dt).getByLabelText('Comment'), 'Two sites flooded')
    await user.click(within(dt).getByRole('button', { name: 'Send to PM' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/pip/my/revision-request', {
        year: 1405, month: 6, stream: 'DT', committed_count: 35, reason: 'OTHER', comment: 'Two sites flooded',
      }),
    )
  })

  it('lists the versions of the month, with reason and date', async () => {
    signedInAs('Contractor')
    serveMine({
      running: { DT: { status: 'RevisionRequested', version: 2, committed_count: 35 } },
      revisions: (params) => ({
        ...revisionsOut(params),
        revisions:
          params.stream === 'DT'
            ? [
                { version: 1, status: 'Approved', committed_count: 38, is_current: false, in_force: true, is_late: false,
                  return_comment: null, revision_reason: null, revision_comment: null,
                  submitted_shamsi: '1405/05/28', decided_shamsi: '1405/06/01', decided_by: 'PM One' },
                { version: 2, status: 'RevisionRequested', committed_count: 35, is_current: true, in_force: false, is_late: false,
                  return_comment: null, revision_reason: 'PERMITS', revision_comment: 'Road closed',
                  submitted_shamsi: '1405/06/03', decided_shamsi: null, decided_by: null },
              ]
            : [],
      }),
    })
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    const versions = within(dt).getAllByRole('listitem')
    expect(versions[0]).toHaveTextContent('v1')
    expect(versions[0]).toHaveTextContent('Approved · 1 شهریور')
    expect(versions[1]).toHaveTextContent('Permits · Road closed')
    expect(versions[1]).toHaveTextContent('Waiting for PM · 3 شهریور')
  })

  // --------------------------------------------------------------- submit
  it('hands in both streams with one Submit', async () => {
    signedInAs('Contractor')
    serveMine()
    show(PLANNING_URL)
    const user = userEvent.setup()

    const dt = await half('DT Delivery')
    const acc = screen.getByRole('region', { name: 'Acceptance' })
    await user.type(within(dt).getByLabelText(/Your PIP for/), '40')
    await user.type(within(acc).getByLabelText(/Your PIP for/), '25')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect(api.post).toHaveBeenCalledWith('/pip/my', { year: 1405, month: 7, stream: 'DT', committed_count: 40, submit: true })
    expect(api.post).toHaveBeenCalledWith('/pip/my', { year: 1405, month: 7, stream: 'ACCEPTANCE', committed_count: 25, submit: true })
  })

  it('submits neither when one number is missing or not a number', async () => {
    signedInAs('Contractor')
    serveMine()
    show(PLANNING_URL)
    const user = userEvent.setup()

    const dt = await half('DT Delivery')
    const acc = screen.getByRole('region', { name: 'Acceptance' })
    await user.type(within(dt).getByLabelText(/Your PIP for/), '40')
    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(api.post).not.toHaveBeenCalled()
    expect(within(acc).getByLabelText(/Your PIP for/)).toHaveAttribute('aria-invalid', 'true')
    expect(within(acc).getByRole('alert')).toHaveTextContent('Enter the villages fully accepted you commit to.')

    await user.type(within(acc).getByLabelText(/Your PIP for/), '20000')
    await user.click(screen.getByRole('button', { name: 'Submit' }))
    expect(api.post).not.toHaveBeenCalled()
    expect(within(acc).getByRole('alert')).toHaveTextContent('A whole number between 0 and 10000.')
  })

  // ----------------------------------------------------------------- pace
  it('reads today’s target and how far behind from the server', async () => {
    signedInAs('Contractor')
    // pace_pct would put the target somewhere else entirely; the screen
    // must not work it out for itself.
    serveMine({ current: { DT: { delivered: 24, expected_by_today: 31, pace_pct: 10 } } })
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    const sub = within(dt).getByText('7 behind · target today 31')
    expect(sub).toHaveClass('cp-behind')
    expect(within(dt).getByRole('img', { name: /Delivered 24 of 38, today's target 31/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Updates' })).toHaveTextContent('DT: 7 behind today’s target')
    // Acceptance is on pace.
    expect(within(screen.getByRole('region', { name: 'Acceptance' })).getByText('On pace · target today 16'))
      .toBeInTheDocument()
  })

  it('shows no Updates strip when there is nothing to say', async () => {
    signedInAs('Contractor')
    serveMine()
    show(RUNNING_URL)

    await half('DT Delivery')
    expect(screen.queryByRole('list', { name: 'Updates' })).toBeNull()
  })

  it('lists a plan not handed in among the updates', async () => {
    signedInAs('Contractor')
    serveMine()
    show(PLANNING_URL)

    const updates = await screen.findByRole('list', { name: 'Updates' })
    expect(updates).toHaveTextContent('DT: مهر 1405 plan not submitted · due 1405/07/03')
    expect(updates).toHaveTextContent('Acceptance: مهر 1405 plan not submitted')
  })

  // ---------------------------------------------------------------- trend
  it('draws the trend with “no plan” for a month without one, and counts the hits', async () => {
    signedInAs('Contractor')
    serveMine()
    show(RUNNING_URL)

    const dt = await half('DT Delivery')
    // Closed months with a plan: اردیبهشت, خرداد, تیر (missed), مرداد.
    expect(within(dt).getByText('Last 6 months · hit 3 of the last 4 closed months')).toBeInTheDocument()
    const chart = within(dt).getByRole('img', { name: /last 6 months/ })
    expect(within(chart).getByText('no plan')).toBeInTheDocument()
    expect(within(chart).getByText('10/30')).toBeInTheDocument()
    expect(chart).toHaveAccessibleName(/فروردین 1405: 32 delivered, no plan/)
    expect(chart).toHaveAccessibleName(/تیر 1405: 10 of 30, missed/)
    expect(within(chart).getByText('تیر')).toHaveAttribute('lang', 'fa')
  })

  // ----------------------------------------------------------------- type
  it('uses no font smaller than 12px', async () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../../styles/app.css'), 'utf8')
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    try {
      signedInAs('Contractor')
      serveMine({ running: { DT: { revision_open: true } } })
      show(RUNNING_URL)
      await half('DT Delivery')

      // Font size as the browser would resolve it: the nearest declared one.
      const px = (el) => {
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const size = getComputedStyle(node).fontSize
          if (size) return size
        }
        return ''
      }
      const page = document.querySelector('.cp-page')
      const small = []
      for (const el of page.querySelectorAll('*')) {
        const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
        if (!ownText) continue
        const size = px(el)
        expect(size, `${el.className}: ${size}`).toMatch(/^\d+(\.\d+)?px$/)
        if (parseFloat(size) < 12) small.push(`${el.tagName}.${el.className} “${el.textContent.trim().slice(0, 30)}” ${size}`)
      }
      expect(small).toEqual([])
    } finally {
      style.remove()
    }
  })

  // ------------------------------------------------------------ the month
  it('opens on the planning month, and the picker moves it', async () => {
    signedInAs('Contractor')
    serveMine()
    show()

    await half('DT Delivery')
    const first = api.get.mock.calls.find(([url]) => url === '/pip/my')[1].params
    expect({ year: first.year, month: first.month }).toEqual(planningPeriod())

    api.get.mockClear()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Previous month' }))
    await waitFor(() => {
      const asked = api.get.mock.calls.filter(([url]) => url === '/pip/my').map(([, c]) => c.params)
      expect(asked[0]).toMatchObject(previousPeriod(first.year, first.month))
    })
  })

  it('says so rather than showing an empty screen when the server refuses', async () => {
    signedInAs('Contractor')
    api.get.mockRejectedValue({ response: { status: 403 } })
    show(PLANNING_URL)

    expect(await screen.findByText('This screen belongs to a contractor account')).toBeInTheDocument()
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
    serveMine()
    render(<MemoryRouter><ToastProvider><MonthlyPlan /></ToastProvider></MemoryRouter>)

    await screen.findByRole('region', { name: 'DT Delivery' })
    expect(screen.queryByText('Acceptance target')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/acceptance/plan')
  })
})

// ------------------------------------------------------ the PM split screen
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

function serveOverview(data = overview()) {
  api.get.mockImplementation((url, config) => {
    if (url === '/pip/overview') return Promise.resolve({ data })
    if (url === '/pip/queue') return Promise.resolve({ data: { ...accQueue, label: 'آبان 1405', stream: config?.params?.stream } })
    if (url === '/pip/revisions') return Promise.resolve({ data: revisionsOut(config?.params) })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

describe('the PM split screen', () => {
  it('shows DT Delivery and Acceptance side by side, from one read', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    const dt = await screen.findByRole('region', { name: 'DT Delivery' })
    const acc = screen.getByRole('region', { name: 'Acceptance' })
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
    // The old ledger and queue table are not on the page.
    expect(api.get).not.toHaveBeenCalledWith('/pip/scorecard', expect.anything())
    expect(document.querySelector('table')).toBeNull()
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

  it('opens the decision drawer from a Needs attention chip, on that stream and month', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    expect(await screen.findByText('Needs attention · 2')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Acceptance آبان · 20 awaiting approval'))

    const drawer = await screen.findByRole('dialog', { name: 'Plan decision' })
    expect(api.get).toHaveBeenCalledWith('/pip/queue', { params: { year: 1405, month: 8, stream: 'ACCEPTANCE' } })
    expect(await within(drawer).findByRole('button', { name: 'Approve 20' })).toBeInTheDocument()
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/pip/revisions', {
        params: { year: 1405, month: 8, stream: 'ACCEPTANCE', contractor_id: 1 },
      }),
    )
  })

  it('approves through /pip/{id}/approve and reloads the page', async () => {
    signedInAs('PM')
    serveOverview()
    show()

    await userEvent.click(await screen.findByText('Acceptance آبان · 20 awaiting approval'))
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
    show()

    await userEvent.click(await screen.findByText('Acceptance آبان · 20 awaiting approval'))
    const drawer = await screen.findByRole('dialog', { name: 'Plan decision' })
    const ret = await within(drawer).findByRole('button', { name: 'Return' })
    expect(ret).toBeDisabled()
    await userEvent.type(within(drawer).getByRole('textbox'), 'Too low for آبان.')
    await userEvent.click(ret)
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/pip/21/return', { comment: 'Too low for آبان.' }))
  })

  it('opens the drawer from a contractor row', async () => {
    signedInAs('PM')
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
    show()

    await userEvent.click(await screen.findByText('Acceptance آبان · 20 awaiting approval'))
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
    serveMine()
    show('/monthly-plan?year=1405&month=6')

    await screen.findByRole('region', { name: 'DT Delivery' })
    const asked = api.get.mock.calls.filter(([url]) => url === '/pip/my').map(([, c]) => c.params)
    expect(asked[0]).toMatchObject({ year: 1405, month: 6 })
  })
})
