// UEP-27: the overview card, the work cards' filter, the Apps tile grid and
// the right-side panel behind every number.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const auth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess(auth.current) }))

const home = vi.hoisted(() => ({ current: null }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => home.current }))

const download = vi.hoisted(() => ({ saveBlob: vi.fn() }))
vi.mock('../../lib/download', async (orig) => ({ ...(await orig()), saveBlob: download.saveBlob }))

const api = (await import('../../api/client')).default
const Home = (await import('../Home')).default

const t = (queue_key, short_label, url, over) => ({
  queue_key, short_label, url, unit: 'sites', holder: 'self',
  count: 0, late: 0, due_soon: 0, on_time: 0, no_date: 0,
  owners: [], owners_more: 0, owners_total: 0, ...over,
})

const GROUPS = [
  {
    key: 'drive_test', label: 'Drive test', tickets: [
      t('dt_assign', 'DT assignment', '/drive-test?tab=assign', { count: 24, late: 5, due_soon: 6, on_time: 13 }),
      t('hc_review', 'HC review', '/health-check?tab=checks&filter=to_decide', { count: 7, late: 1, on_time: 6 }),
      t('dt_with_contractors', 'DT with contractors', '/drive-test?tab=in-progress', { holder: 'others', count: 9, late: 2, on_time: 7 }),
    ],
  },
  {
    key: 'acceptance', label: 'Acceptance', tickets: [
      t('ict_pending', 'Pending ICT', '/filing?authority=ICT', { holder: 'others', unit: 'villages', count: 40, late: 10, no_date: 20, on_time: 10 }),
      t('mojri_tracker', 'Mojri tracker', '/submissions?view=follow-up', { holder: 'reminder', unit: 'days', count: 1, late: 1, mojri: { age_days: 9, stale: true, follow_up_days: 7 } }),
    ],
  },
  {
    key: 'plans', label: 'Plans', tickets: [
      t('plans_approve', 'Plan approvals', '/monthly-plan?tab=approvals', { unit: 'plans', count: 4, due_soon: 4 }),
    ],
  },
]

const DATA = {
  groups: GROUPS,
  totals: {
    todo: 35, todo_late: 6, todo_due_soon: 10, todo_on_time: 19, todo_no_date: 0,
    waiting: 49, waiting_late: 12, waiting_no_date: 20,
    done_this_week: 31, done_last_week: 40, todo_change_7d: -9,
  },
  plan: { pip: 300, delivered: 212, days_left: 4 },
  cpm_imported_at: '2026-11-24T08:00:00Z',
  generated_at: '2026-11-26T10:05:00Z',
  system: { status: 'normal', headline: 'All systems normal' },
  version: '2.4.0',
}

const ITEMS = {
  queue_key: 'dt_assign', label: 'DT assignment', unit: 'sites', url: '/drive-test?tab=assign', holder: 'self',
  total: 2, counts_by_status: { late: 1, due_soon: 1, on_time: 0, no_date: 0 }, group: 'none', groups: [],
  page: 1, size: 1000,
  items: [
    { id: '1', label: 'TEH-0101', site_id: 'TEH-0101', province: 'Tehran', holder_name: 'Arya', status: 'late', age_days: 30, sla_days: 14, due_at: null, url: '/explorer/sites/1' },
    { id: '2', label: 'FRS-0202', site_id: 'FRS-0202', province: 'Fars', holder_name: 'Pars', status: 'due_soon', age_days: 10, sla_days: 14, due_at: null, url: '/explorer/sites/2' },
  ],
}

function as(role, { data = DATA, access } = {}) {
  auth.current = { user: { first_name: 'Vahid', role: { name: role }, ...(access ? { access } : {}) } }
  home.current = { data, error: null, counts: { dt_assign: 24, hc_review: 7, plans_approve: 4 }, reload: vi.fn() }
}

const draw = () => render(<MemoryRouter><Home /></MemoryRouter>)
const overview = () => screen.getByRole('region', { name: 'Your numbers' })
const card = (name) => screen.getByRole('heading', { name }).closest('article')

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => {
    if (url.endsWith('/items')) return Promise.resolve({ data: ITEMS })
    if (url.endsWith('.xlsx')) return Promise.resolve({ data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="UEP_DT-assignment_26-Nov-2026.xlsx"' } })
    if (url === '/me/done') return Promise.resolve({ data: { period: 'week', since: '2026-11-21', total: 0, items: [] } })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
})

describe('the overview card', () => {
  it('shows To do, its bar and legend, Waiting on others and Done this week from the totals', async () => {
    as('PM')
    draw()
    const o = within(overview())
    // The figures count up once, then rest on the value.
    await waitFor(() => expect(o.getByRole('button', { name: 'To do: 35, show list' })).toHaveTextContent('35'), { timeout: 2000 })
    await waitFor(() => expect(o.getByTestId('waiting')).toHaveTextContent('Waiting on others49'), { timeout: 2000 })
    expect(o.getByTestId('todo-change')).toHaveTextContent('9 vs 7 days ago')
    expect(o.getByTestId('todo-change')).not.toHaveAttribute('data-worse')
    // The bar is for the mouse; the legend is the same control for everyone.
    const bar = o.getByTestId('todo-bar')
    expect([...bar.querySelectorAll('button')].map((b) => b.dataset.status)).toEqual(['late', 'due_soon', 'on_time'])
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(o.getByRole('button', { name: 'Late: 6, show only these', pressed: false })).toHaveTextContent('6Late')
    expect(o.queryByText('No date')).not.toBeInTheDocument()
    expect(o.getByTestId('waiting')).toHaveTextContent('12 late, 20 no date')
    expect(o.getByRole('button', { name: 'Done this week: 31, show list' })).toBeInTheDocument()
    expect(o.getByText('9 vs last week').closest('.ho-change')).toHaveAttribute('data-worse', 'true')
  })

  it('shows the figures at once, with no count-up, when motion is reduced', () => {
    document.documentElement.dataset.uepMotion = 'reduce'
    try {
      as('PM')
      draw()
      expect(within(overview()).getByRole('button', { name: 'To do: 35, show list' })).toHaveTextContent('35')
    } finally {
      delete document.documentElement.dataset.uepMotion
    }
  })

  it('has no card totals, no SLA caption and no sparklines', () => {
    as('PM')
    const { container } = draw()
    expect(container.querySelector('.hw-total, .hk-spark, .hk-strip')).toBeNull()
    expect(screen.queryByText(/SLA 14 days/)).not.toBeInTheDocument()
  })

  it('says the CPM date and the update time in the footer', () => {
    as('PM')
    draw()
    expect(screen.getByTestId('footer-cpm')).toHaveTextContent('CPM data from 24 Nov')
    expect(screen.getByText(/^Updated /)).toBeInTheDocument()
  })
})

describe('filtering the cards', () => {
  it('a part of the bar filters like its legend item', () => {
    as('PM')
    draw()
    fireEvent.click(within(overview()).getByTestId('todo-bar').querySelector('[data-status="due_soon"]'))
    expect(screen.getByTestId('filter-chip')).toHaveTextContent('Showing due in 1 week')
    expect(within(overview()).getByRole('button', { name: /^Due in 1 week/, pressed: true })).toBeInTheDocument()
  })

  it('a legend item filters every row to its part, and a second click clears it', () => {
    as('PM')
    draw()
    const late = within(overview()).getByRole('button', { name: /^Late/ })
    fireEvent.click(late)
    expect(late).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('filter-chip')).toHaveTextContent('Showing late')
    expect(screen.getByTestId('count-dt_assign')).toHaveTextContent('5')
    expect(screen.getByTestId('count-dt_assign')).toHaveClass('is-late')
    // Rows someone else holds are not in the To do bar: 0, faded.
    expect(screen.getByTestId('count-ict_pending')).toHaveTextContent('0')
    expect(screen.getByTestId('count-ict_pending').closest('button')).toHaveClass('is-dim')
    fireEvent.click(late)
    expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
    expect(screen.getByTestId('count-dt_assign')).toHaveTextContent('24')
  })

  it('Waiting on others shows those rows whole; Esc and the chip clear it', () => {
    as('PM')
    draw()
    fireEvent.click(screen.getByTestId('waiting'))
    expect(screen.getByTestId('count-ict_pending')).toHaveTextContent('40')
    expect(screen.getByTestId('count-dt_assign')).toHaveTextContent('0')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
    fireEvent.click(within(overview()).getByRole('button', { name: /^On time/ }))
    fireEvent.click(screen.getByTestId('filter-chip'))
    expect(screen.queryByTestId('filter-chip')).not.toBeInTheDocument()
  })
})

describe('a work card', () => {
  it('lists its own rows, then Waiting on others, each with a status strip and a unit', () => {
    as('PM')
    draw()
    const dt = card('Drive test')
    const rows = within(dt).getAllByRole('button').map((b) => b.dataset.queue)
    expect(rows).toEqual(['dt_assign', 'hc_review', 'dt_with_contractors'])
    expect(within(dt).getByTestId('waiting-drive_test')).toHaveTextContent('Waiting on others')
    const strip = dt.querySelector('[data-queue="dt_assign"] .hw-strip')
    expect([...strip.children].map((i) => i.className)).toEqual(['hs-late', 'hs-due', 'hs-on-time'])
    expect(screen.getByTestId('count-dt_assign')).toHaveTextContent('24sites')
    expect(screen.getByTestId('count-plans_approve')).toHaveTextContent('4plans')
  })

  it('shows the Mojri tracker as days, red when stale, outside every count', () => {
    as('PM')
    draw()
    const row = card('Acceptance').querySelector('[data-queue="mojri_tracker"]')
    expect(row).toHaveTextContent('9days')
    expect(row).toHaveTextContent('Late, upload is 9 days old')
    expect(row.querySelector('.hw-qcount')).toHaveClass('is-late')
  })
})

describe('the Apps panel', () => {
  it('lays groups on three columns, Planning and Insights sharing a row', () => {
    as('PM')
    draw()
    const panel = screen.getByRole('complementary', { name: 'Apps' })
    const span = (name) => within(panel).getByRole('region', { name }).style.gridColumn
    expect(span('Rollout')).toBe('span 3')
    expect(span('Planning')).toBe('span 1')
    expect(span('Insights')).toBe('span 1')
  })

  it('opens an app’s to-do summary from its badge', async () => {
    as('PM')
    draw()
    fireEvent.click(screen.getByTestId('badge-drive-test'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('Drive test31')
    expect([...dialog.querySelectorAll('[data-line]')].map((l) => l.dataset.line)).toEqual(['dt_assign', 'hc_review'])
  })
})

describe('the right-side panel', () => {
  it('To do opens its summary; a line opens the list; Back returns; Esc closes and refocuses', async () => {
    as('PM')
    draw()
    const todo = within(overview()).getByRole('button', { name: 'To do: 35, show list' })
    todo.focus()
    fireEvent.click(todo)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('To do35')
    expect([...dialog.querySelectorAll('[data-line]')].map((l) => l.dataset.line)).toEqual(['dt_assign', 'hc_review', 'plans_approve'])
    fireEvent.click(dialog.querySelector('[data-line="dt_assign"]'))
    expect(await within(dialog).findByText('TEH-0101')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/me/queues/dt_assign/items', { params: { status: 'all', q: '', group: 'none', size: 1000 } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Back/ }))
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveTextContent('To do')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(todo)
  })

  it('a row opens its list, filtered to the status the cards show', async () => {
    as('PM')
    draw()
    fireEvent.click(within(overview()).getByRole('button', { name: /^Late/ }))
    fireEvent.click(card('Drive test').querySelector('[data-queue="dt_assign"]'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('TEH-0101')
    expect(within(dialog).getByRole('button', { name: /^Late/, pressed: true })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/me/queues/dt_assign/items', expect.objectContaining({ params: expect.objectContaining({ status: 'late' }) }))
  })

  it('filters, searches and groups through the server', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    as('PM')
    draw()
    fireEvent.click(card('Drive test').querySelector('[data-queue="dt_assign"]'))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('TEH-0101')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Due in 1 week/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Province' }))
    fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Find in this list' }), { target: { value: 'teh' } })
    await act(async () => { vi.advanceTimersByTime(300) })
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/me/queues/dt_assign/items', {
      params: { status: 'due_soon', q: 'teh', group: 'province', size: 1000 },
    }))
    vi.useRealTimers()
  })

  it('exports the whole filtered list as the server names it', async () => {
    as('PM')
    draw()
    fireEvent.click(card('Drive test').querySelector('[data-queue="dt_assign"]'))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('TEH-0101')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Export to Excel' }))
    await waitFor(() => expect(download.saveBlob).toHaveBeenCalled())
    expect(api.get).toHaveBeenCalledWith('/me/queues/dt_assign/export.xlsx', {
      params: { status: 'all', q: '', group: 'none' }, responseType: 'blob',
    })
    expect(download.saveBlob.mock.calls[0][1]).toBe('UEP_DT-assignment_26-Nov-2026.xlsx')
  })

  it('hides Export without the exports feature', async () => {
    as('PM', { access: { features: { explorer: 'view' }, hidden_in_menus: [], landing: 'standard' } })
    draw()
    fireEvent.click(card('Drive test').querySelector('[data-queue="dt_assign"]'))
    const dialog = screen.getByRole('dialog')
    await within(dialog).findByText('TEH-0101')
    expect(within(dialog).queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Open in Drive test/ })).toBeInTheDocument()
  })

  it('Done this week opens the done list; the PIP opens the PIP by contractor', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/me/done') return Promise.resolve({ data: { period: 'week', since: '2026-11-21', total: 0, items: [] } })
      if (url === '/me/pip/by-contractor') return Promise.resolve({ data: { month_name: 'Azar', days_left: 4, rows: [{ contractor: 'Arya', delivered: 40, target: 60 }] } })
      return Promise.reject(new Error(url))
    })
    as('PM')
    draw()
    fireEvent.click(screen.getByRole('button', { name: 'Done this week: 31, show list' }))
    expect(await screen.findByText('Nothing finished yet this week')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('drill-scrim'))
    fireEvent.click(screen.getByTestId('pip'))
    expect(await screen.findByText('Arya')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('40of 60')
  })
})

describe('all caught up', () => {
  it('shows an empty bar, no change, and the caught-up card', () => {
    as('PM', { data: { ...DATA, groups: [], plan: null, totals: { todo: 0, waiting: 0, done_this_week: 0, done_last_week: 0, todo_change_7d: null } } })
    draw()
    expect(within(overview()).getByTestId('todo-change')).toHaveTextContent('No change vs 7 days ago')
    expect(within(overview()).getByTestId('todo-bar').children).toHaveLength(0)
    expect(screen.getByText("You're all caught up")).toBeInTheDocument()
  })
})
