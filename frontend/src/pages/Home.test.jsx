import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// UEP Home. Every figure comes from GET /home/summary; these tests hold the
// page to the approved design's rules: no queue singled out (no "Up next",
// one neutral button per card), status as words in a tag, every KPI a link
// with a 14-day trend described in words, owners as a count, badges that say
// what they add up, the Shamsi date in Persian digits, and loading, empty and
// error states that keep the layout.

const mockApi = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/client', () => ({ default: mockApi }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

// The footer asks the API's health check once; answer it quietly.
globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true }))

const Home = (await import('./Home')).default

const DAY = 86400000
const daysAgo = (d) => new Date(Date.now() - d * DAY - 3600000).toISOString()

const ticket = (queue_key, short_label, label, {
  on_time = 0, due_soon = 0, late = 0, age = 3, url, owners = [], more = 0, unit = 'sites',
} = {}) => ({
  queue_key, short_label, label, unit,
  count: on_time + due_soon + late, on_time, due_soon, late,
  oldest_started_at: daysAgo(age), earliest_due_at: null, date_kind: 'since',
  url: url || `/queue/${queue_key}`, owners, owners_more: more, owners_total: owners.length + more,
})

const series = (...values) => [...Array(14 - values.length).fill(null), ...values]

function summary(overrides = {}) {
  const scope = overrides.scope_label || 'All project'
  const groups = overrides.groups || [
    {
      key: 'drive_test', label: 'Drive test', scope_label: null,
      tickets: [
        ticket('dt_review', 'DT review', 'Review DT results', { on_time: 6, late: 3, age: 21, url: '/drive-test?tab=review', owners: ['پیشرو فن', 'آرین'], more: 7 }),
        ticket('hc_review', 'HC review', 'Review HC results', { on_time: 4, due_soon: 2, age: 9, url: '/health-check?tab=review' }),
      ],
    },
    {
      key: 'acceptance', label: 'Acceptance', scope_label: scope,
      tickets: [
        ticket('ict_pending', 'Pending ICT', 'Open ICT acceptance', { on_time: 5, late: 2, unit: 'villages', url: '/my-work?authority=ICT' }),
        ticket('cra_pending', 'Pending CRA', 'Open CRA acceptance', { on_time: 0, unit: 'villages', url: '/my-work?authority=CRA' }),
      ],
    },
    {
      key: 'plans', label: 'Plans', scope_label: null,
      tickets: [ticket('plans_approve', 'Plan approvals', 'Approve plans', { due_soon: 2, url: '/monthly-plan?tab=plans' })],
    },
  ]
  const tickets = groups.flatMap((g) => g.tickets)
  const sum = (k) => tickets.reduce((n, t) => n + t[k], 0)
  const badges = {}
  for (const t of tickets.filter((x) => x.count)) {
    const path = t.url.split('?')[0]
    badges[path] = badges[path] || { count: 0, parts: [] }
    badges[path].count += t.count
    badges[path].parts.push({ label: t.short_label, count: t.count })
  }
  return {
    role: 'PM', scope_label: scope, generated_at: new Date().toISOString(),
    shamsi_date: '1405-07-17',
    due_soon_days: 3, sla_uniform_days: 14, sla_days: { dt_review: 14 },
    totals: {
      pending: sum('count'), queues: tickets.length, overdue: sum('late'), due_soon: sum('due_soon'),
      pending_week_delta: 4, overdue_week_delta: -2, due_soon_week_delta: null,
      done_today: 6, done_yesterday: 4,
    },
    trends: {
      days: Array.from({ length: 14 }, (_, i) => `2026-09-${String(26 + i).padStart(2, '0')}`),
      pending: series(20, 22, sum('count')),
      overdue: series(9, 7, sum('late')),
      due_soon: series(sum('due_soon')),
      done: series(3, 4, 6),
    },
    groups,
    plan: { stream: 'DT', shamsi_year: 1405, shamsi_month: 7, month_name: 'Mehr', pip: 64, delivered: 41, days_left: 13 },
    app_badges: badges,
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

const card = (name) => screen.getByRole('article', { name })

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

  it('dates the page in Shamsi too, in Persian digits', async () => {
    await renderHome()
    const shamsi = screen.getByTestId('shamsi-date')
    expect(shamsi).toHaveTextContent('۱۷ مهر ۱۴۰۵')
    expect(shamsi).toHaveAttribute('lang', 'fa')
    expect(shamsi).toHaveAttribute('dir', 'rtl')
  })

  it('makes every figure a link to its list, with a neutral change badge', async () => {
    await renderHome()
    const kpis = screen.getByRole('region', { name: 'Your numbers' })
    const links = within(kpis).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/action-center', '/action-center?view=overdue', '/action-center', '/action-center',
    ])
    expect(within(links[0]).getByText('24')).toBeInTheDocument()
    expect(within(kpis).getByLabelText('Up 4 on last week')).toHaveTextContent('▲ 4')
    expect(within(kpis).getByLabelText('Down 2 on last week')).toHaveTextContent('▼ 2')
    expect(within(kpis).getByLabelText('Up 2 on yesterday')).toBeInTheDocument()
    // No comparison point, no badge.
    expect(within(links[2]).queryByText(/▲|▼/)).toBeNull()
    // The old captions are gone.
    expect(within(kpis).queryByText(/SLA|within 3 days|queues|vs yesterday/)).toBeNull()
    expect(screen.getByText('Trend lines show the last 14 days')).toBeInTheDocument()
  })

  it('draws a 14-day trend for each figure, described in words', async () => {
    await renderHome()
    const kpis = screen.getByRole('region', { name: 'Your numbers' })
    expect(within(kpis).getByRole('img', { name: 'Overdue over the last 14 days, falling from 9 to 5' }))
      .toBeInTheDocument()
    expect(within(kpis).getByRole('img', { name: 'Waiting on you over the last 14 days, rising from 20 to 24' }))
      .toBeInTheDocument()
    expect(within(kpis).getAllByRole('img')).toHaveLength(4)
  })

  it('singles no queue out: no Up next, and one same button per card', async () => {
    await renderHome()
    expect(screen.queryByText(/up next/i)).toBeNull()
    expect(document.querySelector('.h-pill.primary, [data-primary]')).toBeNull()
    const buttons = ['Drive test', 'Acceptance', 'Plans'].map((name) => card(name).querySelector('.h-cf a'))
    buttons.forEach((b) => expect(b).toHaveClass('h-btn'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Review DT results', 'Open acceptance', 'Approve plans'])
  })

  it('gives every queue row its figures in words', async () => {
    await renderHome()
    expect(
      screen.getByRole('link', { name: 'DT review, 9 sites, 3 late, oldest 21 days, 9 owners' }),
    ).toHaveAttribute('href', '/drive-test?tab=review')
    expect(screen.getByRole('link', { name: 'HC review, 6 sites, 2 due soon, oldest 9 days' })).toBeInTheDocument()
  })

  it('says status in words, in tags, and draws no dots or bars', async () => {
    await renderHome()
    const row = document.querySelector('[data-queue="dt_review"]')
    expect(within(row).getByText('3 late')).toHaveClass('h-tag', 'late')
    expect(within(document.querySelector('[data-queue="hc_review"]')).getByText('2 due soon')).toHaveClass('h-tag', 'soon')
    expect(document.querySelector('.item-dots, .item-bar, .h-plan-dots')).toBeNull()
  })

  it('counts who holds the items, with their names on hover', async () => {
    await renderHome()
    const owners = document.querySelector('[data-queue="dt_review"] .h-owners')
    expect(owners).toHaveTextContent('9 owners')
    expect(owners).toHaveAttribute('title', 'پیشرو فن، آرین +7 more')
  })

  it('shows Pending ICT and Pending CRA under Acceptance, with the scope', async () => {
    await renderHome()
    const acceptance = card('Acceptance')
    expect([...acceptance.querySelectorAll('[data-queue]')].map((r) => r.dataset.queue))
      .toEqual(['ict_pending', 'cra_pending'])
    expect(within(acceptance).getByText('All project')).toHaveClass('h-scope')
    expect(within(acceptance).getByRole('link', { name: 'Pending CRA, 0 villages' })).toBeInTheDocument()
  })

  it.each([
    ['Coordinator', 'Your regions'],
    ['Contractor', 'Your sites'],
    ['RegionalManager', 'Your regions'],
  ])('labels the Acceptance scope for a %s', async (role, scope) => {
    signedInAs(role)
    await renderHome(summary({ role, scope_label: scope }))
    expect(within(card('Acceptance')).getByText(scope)).toBeInTheDocument()
  })

  it("shows the month's plan as delivered of planned, on a bar", async () => {
    await renderHome()
    expect(screen.getByRole('link', { name: 'Mehr plan: 41 of 64 sites delivered, 13 days left' }))
      .toBeInTheDocument()
    expect(screen.getByTestId('plan-bar').querySelector('i')).toHaveStyle({ width: '64%' })
  })

  it('has no "all on time" block any more', async () => {
    await renderHome()
    expect(screen.queryByText(/on time$/)).toBeNull()
  })

  it('gives a regional manager plain figures and no Done today', async () => {
    signedInAs('RegionalManager')
    const data = summary({ role: 'Regional manager', scope_label: 'Your regions' })
    data.groups = data.groups.filter((g) => g.key === 'acceptance')
    data.totals = { ...data.totals, done_today: null, done_yesterday: null }
    data.trends = { ...data.trends, done: null }
    await renderHome(data)
    const kpis = screen.getByRole('region', { name: 'Your numbers' })
    expect(within(kpis).queryAllByRole('link')).toHaveLength(0)
    expect(within(kpis).queryByText('Done today')).toBeNull()
    expect(within(kpis).getAllByRole('img')).toHaveLength(3)
  })

  it('uses no green anywhere', async () => {
    await renderHome()
    const green = /#(0?[0-9a-f]{2})?(107C10|0E700E|13A10E|16A34A|22C55E|00FF00)|(^|\W)green(\W|$)/i
    for (const el of document.querySelectorAll('*')) {
      expect(el.getAttribute('style') || '').not.toMatch(green)
      for (const attr of ['fill', 'stroke']) expect(el.getAttribute(attr) || '').not.toMatch(green)
    }
  })

  it('says so when nothing is waiting', async () => {
    await renderHome(summary({ groups: [], plan: null }))
    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument()
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

  it("lists a PM's apps in sentence case, with badges that say what they add up", async () => {
    await renderHome()
    const panel = apps()
    const dt = within(panel).getByRole('link', { name: 'Drive test, 9 waiting: DT review 9' })
    expect(dt.querySelector('.h-badge')).toHaveAttribute('title', 'DT review 9')
    expect(within(panel).getByRole('link', { name: 'Mojri tracker' })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Roles performance' })).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Drive test dashboard' })).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /My drive tests/ })).toBeNull()
  })

  it('no longer lists the Action Center', async () => {
    await renderHome()
    expect(within(apps()).queryByRole('link', { name: /action center/i })).toBeNull()
  })

  it("lists a contractor's own apps and none of the staff's", async () => {
    signedInAs('Contractor')
    await renderHome(summary({ role: 'Contractor', scope_label: 'Your sites' }))
    const panel = apps()
    expect(within(panel).getByRole('link', { name: 'My drive tests' })).toBeInTheDocument()
    expect(within(panel).queryByRole('link', { name: /^Drive test(,|$)/ })).toBeNull()
    expect(within(panel).queryByRole('link', { name: 'Mojri tracker' })).toBeNull()
  })
})
