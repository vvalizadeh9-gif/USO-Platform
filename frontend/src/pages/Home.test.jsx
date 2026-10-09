import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// UEP Home. Every figure comes from GET /home/summary; these tests hold the
// page to the approved design's rules: exactly one primary button, in the
// card that holds the Up-next queue (which the API names, not the page); the
// dot rule with a spoken equivalent; apps listed by the sidebar's own rule;
// and loading, empty and error states that keep the layout.

const mockApi = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/client', () => ({ default: mockApi }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

// The footer asks the API's health check once; answer it quietly.
globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }))

const Home = (await import('./Home')).default

const DAY = 86400000
const daysAgo = (d) => new Date(Date.now() - d * DAY - 3600000).toISOString()

const ticket = (queue_key, short_label, label, { on_time = 0, due_soon = 0, late = 0, age = 3, url, owners = [], more = 0 } = {}) => ({
  queue_key, short_label, label,
  count: on_time + due_soon + late, on_time, due_soon, late,
  oldest_started_at: daysAgo(age), earliest_due_at: null, date_kind: 'since',
  url: url || `/queue/${queue_key}`, owners, owners_more: more,
})

function summary(overrides = {}) {
  const groups = overrides.groups || [
    {
      key: 'drive_test', label: 'Drive test',
      tickets: [
        ticket('dt_review', 'DT review', 'Review DT results', { on_time: 6, late: 3, age: 21, url: '/drive-test?tab=review', owners: ['پیشرو فن', 'آرین'], more: 7 }),
        ticket('hc_review', 'HC review', 'Review HC results', { on_time: 4, late: 2, age: 18, url: '/health-check?tab=review' }),
        ticket('dt_assign', 'DT assignment', 'Assign drive tests', { on_time: 28, due_soon: 3, late: 1, age: 16, url: '/drive-test?tab=assignment' }),
      ],
    },
    {
      key: 'acceptance', label: 'Acceptance',
      tickets: [ticket('ict_to_validate', 'ICT filings', 'Validate contractor filings', { on_time: 3, url: '/my-work?authority=ICT&tab=filled' })],
    },
    {
      key: 'plans', label: 'Plans',
      tickets: [ticket('plans_approve', 'Plan approvals', 'Approve plans', { due_soon: 2, url: '/monthly-plan?tab=plans' })],
    },
  ]
  const tickets = groups.flatMap((g) => g.tickets)
  const sum = (k) => tickets.reduce((n, t) => n + t[k], 0)
  return {
    role: 'PM', scope_label: 'All provinces', generated_at: new Date().toISOString(),
    due_soon_days: 3, sla_uniform_days: 14, sla_days: { dt_review: 14 },
    totals: {
      pending: sum('count'), queues: tickets.length, overdue: sum('late'), due_soon: sum('due_soon'),
      pending_week_delta: 4, overdue_week_delta: -2, done_today: 6, done_yesterday: 4,
    },
    up_next: 'dt_review',
    groups,
    plan: { stream: 'DT', shamsi_year: 1405, shamsi_month: 7, month_name: 'Mehr', pip: 64, delivered: 41, days_left: 13 },
    app_badges: { '/drive-test': 41, '/health-check': 6, '/my-work': 3, '/monthly-plan': 2 },
    ...overrides,
  }
}

function signedInAs(roleName) {
  mockAuth.current = {
    user: { username: 'mina', first_name: 'Mina', full_name: 'Mina Rahimi', role: { name: roleName } },
    logout: vi.fn(),
  }
}

async function renderHome(data = summary()) {
  mockApi.get.mockResolvedValue({ data })
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
  await screen.findByText('Your work')
}

beforeEach(() => {
  mockApi.get.mockReset()
  signedInAs('PM')
})

describe('UEP Home', () => {
  it('greets the person by first name and reads one endpoint', async () => {
    await renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Good (morning|afternoon|evening), Mina$/)
    expect(mockApi.get).toHaveBeenCalledWith('/home/summary')
  })

  it('shows the totals, with neutral trend chips', async () => {
    await renderHome()
    const kpis = screen.getByRole('region', { name: 'Your numbers' })
    expect(within(kpis).getByText('52')).toBeInTheDocument()
    expect(within(kpis).getByLabelText('up 4 this week')).toBeInTheDocument()
    expect(within(kpis).getByLabelText('down 2')).toBeInTheDocument()
    expect(within(kpis).getByText(/past the 14-day SLA/)).toBeInTheDocument()
  })

  it('has exactly one primary button, in the card holding the Up-next queue', async () => {
    await renderHome()
    const primaries = document.querySelectorAll('.h-pill.primary')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveTextContent('Start with DT review')
    expect(primaries[0]).toHaveAttribute('href', '/drive-test?tab=review')
    expect(primaries[0].closest('article')).toHaveAccessibleName('Drive test')
  })

  it('highlights whichever queue the API names as next', async () => {
    await renderHome(summary({ up_next: 'plans_approve' }))
    expect(document.querySelector('[data-queue="plans_approve"]')).toHaveClass('next')
    expect(document.querySelector('[data-queue="dt_review"]')).not.toHaveClass('next')
    expect(document.querySelector('.h-pill.primary')).toHaveTextContent('Start with Plan approvals')
  })

  it('gives every queue row its figures in words', async () => {
    await renderHome()
    expect(
      screen.getByRole('link', { name: 'DT review, up next, 9 items: 6 on time, 0 due soon, 3 late, oldest 21 days' }),
    ).toHaveAttribute('href', '/drive-test?tab=review')
  })

  it('draws dots up to 30 items and a bar beyond', async () => {
    await renderHome()
    const row = (key) => document.querySelector(`[data-queue="${key}"]`)
    expect(within(row('dt_review')).getByTestId('item-dots')).toBeInTheDocument()
    expect(within(row('dt_assign')).getByTestId('item-bar')).toBeInTheDocument()
  })

  it('counts who holds the items, with their names on hover', async () => {
    await renderHome()
    const owners = document.querySelector('[data-queue="dt_review"] .h-owners')
    expect(owners).toHaveTextContent('9')
    expect(owners).toHaveAttribute('title', 'پیشرو فن، آرین')
  })

  it("shows the month's plan as delivered of planned", async () => {
    await renderHome()
    expect(screen.getByRole('link', { name: 'Mehr plan: 41 of 64 sites delivered, 64 percent, 13 days left' }))
      .toBeInTheDocument()
    expect(screen.getByTestId('plan-dots').querySelectorAll('i.done')).toHaveLength(41)
  })

  it('says all is on time when nothing in a card is late or due soon', async () => {
    await renderHome()
    expect(screen.getByText('All 3 on time')).toBeInTheDocument()
  })

  it('says so when nothing is waiting', async () => {
    await renderHome(summary({ groups: [], up_next: null, plan: null, app_badges: {} }))
    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument()
    expect(document.querySelectorAll('.h-pill.primary')).toHaveLength(0)
  })

  it('draws the final layout while loading', async () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(document.querySelectorAll('.h-skel').length).toBeGreaterThan(0)
  })

  it('offers a retry when the read fails', async () => {
    mockApi.get.mockRejectedValueOnce({ response: { status: 500 } })
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    const retry = await screen.findByRole('button', { name: /Retry/ })
    mockApi.get.mockResolvedValue({ data: summary() })
    await act(async () => fireEvent.click(retry))
    expect(await screen.findByText('Your work')).toBeInTheDocument()
  })

  it('explains a refusal rather than showing an empty page', async () => {
    mockApi.get.mockRejectedValueOnce({ response: { status: 403 } })
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    )
    expect(await screen.findByText("Home isn't available for your role")).toBeInTheDocument()
  })
})

describe('the Apps panel', () => {
  const apps = () => screen.getByRole('complementary', { name: 'Apps' })

  it("lists a PM's apps, with badges from the tickets", async () => {
    await renderHome()
    const panel = apps()
    expect(within(panel).getByRole('link', { name: 'Drive Test, 41 waiting' })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Mojri Tracker' })).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /My Drive Tests/ })).toBeNull()
  })

  it("lists a contractor's own apps and none of the staff's", async () => {
    signedInAs('Contractor')
    await renderHome(summary({ role: 'Contractor' }))
    const panel = apps()
    expect(within(panel).getByRole('link', { name: 'My Drive Tests' })).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /^Drive Test(,|$)/ })).toBeNull()
    expect(within(panel).queryByRole('link', { name: 'Mojri Tracker' })).toBeNull()
  })
})
