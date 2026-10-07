import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Action Center task board. Every number on it comes from
// GET /action-center/board; these tests hold the page to the approved board:
// all five steps for every role, one card per queue linking to its screen,
// sorted most overdue then oldest, an Overdue tab, arrow-key movement between
// cards, and no motion for a reader who asked for none.

const mockApi = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/client', () => ({ default: mockApi }))

const ActionCenter = (await import('./ActionCenter')).default

const DAY = 24 * 60 * 60 * 1000
const daysAgo = (d) => new Date(Date.now() - d * DAY - 60 * 60 * 1000).toISOString()
const dueIn = (d) => new Date(Date.now() + d * DAY - 60 * 60 * 1000).toISOString()

const ticket = (queue_key, label, count, overdue, age = 3, extra = {}) => ({
  queue_key, label, count, overdue,
  oldest_started_at: daysAgo(age),
  earliest_due_at: null,
  date_kind: 'since',
  url: `/queue/${queue_key}`,
  ...extra,
})

const stage = (key, label, tickets) => ({
  key, label, total: tickets.reduce((n, t) => n + t.count, 0), tickets,
})

function boardOf(role, stages) {
  const all = stages.flatMap((s) => s.tickets)
  return {
    role,
    scope_label: 'Tehran',
    generated_at: new Date().toISOString(),
    totals: { pending: all.reduce((n, t) => n + t.count, 0), overdue: all.reduce((n, t) => n + t.overdue, 0) },
    stages,
  }
}

const PM_BOARD = boardOf('PM', [
  stage('hc', 'Health Check', [
    ticket('hc_assign', 'Assign sites', 112, 0, 30),
    ticket('hc_review', 'Review HC results', 37, 9, 12),
    ticket('hc_reroutes', 'Decide re-routes', 4, 9, 20),
  ]),
  stage('dt', 'Drive Test', [ticket('dt_assign', 'Assign drive tests', 21, 3, 5)]),
  stage('ict', 'ICT Acceptance', [ticket('ict_follow_up', 'Follow up with ICT', 96, 18, 40)]),
  stage('plans', 'Plans & Data', [ticket('plans_approve', 'Approve plans', 6, 0, 2)]),
])

const COORDINATOR_BOARD = boardOf('Coordinator', [
  stage('hc', 'Health Check', [ticket('hc_review', 'Review HC results', 9, 2, 12)]),
  stage('dt', 'Drive Test', [ticket('dt_assign', 'Assign drive tests', 21, 0, 4)]),
  stage('ict', 'ICT Acceptance', [
    ticket('ict_to_validate', 'Validate contractor filings', 6, 0, 1),
    ticket('ict_to_file', 'File villages', 11, 3, 9),
  ]),
  stage('cra', 'CRA Acceptance', [ticket('cra_to_file', 'File villages', 7, 7, 30)]),
])

const CONTRACTOR_BOARD = boardOf('Contractor', [
  stage('dt', 'Drive Test', [ticket('dt_todo', 'Drive-test sites', 5, 0, 2)]),
  stage('plans', 'Plans & Data', [
    ticket('plan_submit', 'Submit monthly plan', 1, 0, 0, {
      date_kind: 'due', oldest_started_at: null, earliest_due_at: dueIn(3),
    }),
  ]),
])

const OWNER_BOARD = boardOf('Problem owner', [
  stage('hc', 'Health Check', [ticket('hc_fixes', 'Fix assigned problems', 3, 1, 6)]),
])

function renderBoard(data) {
  if (data) mockApi.get.mockResolvedValue({ data })
  return render(
    <MemoryRouter>
      <ActionCenter />
    </MemoryRouter>,
  )
}

const column = (key) => document.querySelector(`.ac-col[data-stage="${key}"]`)
const cardsIn = (key) => [...column(key).querySelectorAll('[data-testid="ac-card"]')]
const names = (key) => cardsIn(key).map((c) => c.querySelector('.ac-card-name').textContent)
const allCards = () => screen.queryAllByTestId('ac-card')
const summary = () => document.querySelector('.ac-summary')

beforeEach(() => {
  mockApi.get.mockReset()
})

describe('every role sees the five steps', () => {
  it('draws one heading and one column per step, in lifecycle order', async () => {
    renderBoard(COORDINATOR_BOARD)
    await screen.findAllByTestId('ac-card')
    expect(screen.getByRole('heading', { level: 1, name: 'Action Center' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Health Check', 'Drive Test', 'ICT acceptance', 'CRA acceptance', 'Plans & Data',
    ])
    expect([...document.querySelectorAll('.ac-col')].map((c) => c.dataset.stage))
      .toEqual(['hc', 'dt', 'ict', 'cra', 'plans'])
    expect(screen.getByRole('region', { name: 'ICT acceptance' })).toBe(column('ict'))
  })

  it.each([
    ['PM', PM_BOARD, { hc: 3, dt: 1, ict: 1, cra: 0, plans: 1 }],
    ['Coordinator', COORDINATOR_BOARD, { hc: 1, dt: 1, ict: 2, cra: 1, plans: 0 }],
    ['Contractor', CONTRACTOR_BOARD, { hc: 0, dt: 1, ict: 0, cra: 0, plans: 1 }],
    ['a category owner', OWNER_BOARD, { hc: 1, dt: 0, ict: 0, cra: 0, plans: 0 }],
  ])('puts a %s\'s cards in the right columns', async (_, board, expected) => {
    renderBoard(board)
    await screen.findAllByTestId('ac-card')
    for (const [key, n] of Object.entries(expected)) {
      expect(cardsIn(key)).toHaveLength(n)
      if (n === 0) expect(column(key)).toHaveTextContent('Nothing waiting on you')
    }
    const pending = board.stages.flatMap((s) => s.tickets).reduce((n, t) => n + t.count, 0)
    const overdue = board.stages.flatMap((s) => s.tickets).reduce((n, t) => n + t.overdue, 0)
    const items = pending === 1 ? 'item' : 'items'
    expect(summary()).toHaveTextContent(
      `${pending} ${items} waiting on you, ${overdue > 0 ? `${overdue} overdue` : 'none overdue'}`,
    )
    expect(summary()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('tab', { name: /All tasks/ })).toHaveTextContent(String(pending))
  })

  it('sums each step on the rail', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    const rail = (key) => document.querySelector(`.ac-step[data-stage="${key}"] .ac-step-sub`).textContent
    expect(rail('hc')).toBe('153 pending · 18 overdue')
    expect(rail('cra')).toBe('Nothing waiting on you')
  })
})

describe('a card', () => {
  it('is one link to its queue, labelled with everything it shows', async () => {
    renderBoard(COORDINATOR_BOARD)
    const link = await screen.findByRole('link', {
      name: 'File villages, ICT acceptance: 11 pending, 3 overdue, oldest 9 days',
    })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/queue/ict_to_file')
    expect(link.querySelectorAll('button')).toHaveLength(0)
    expect(within(link).getByText('Oldest 9 days')).toBeInTheDocument()
    expect(link.querySelector('.ac-card-count')).toHaveClass('is-late')
    expect(link.querySelector('.ac-card-overdue')).toHaveTextContent('3 overdue')
  })

  it('shows an overdue label only when something is late', async () => {
    renderBoard(COORDINATOR_BOARD)
    const card = await screen.findByRole('link', { name: /^Assign drive tests/ })
    expect(card.querySelector('.ac-card-overdue')).toBeNull()
    expect(card.querySelector('.ac-card-count')).not.toHaveClass('is-late')
  })

  it('says when a deadline queue is due', async () => {
    renderBoard(CONTRACTOR_BOARD)
    const card = await screen.findByRole('link', {
      name: 'Submit monthly plan, Plans & Data: 1 pending, due in 3 days',
    })
    expect(card).toHaveTextContent('Due in 3 days')
  })
})

describe('sorting', () => {
  it('puts the most overdue first, then the oldest', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    // Two at 9 overdue: the 20-day-old re-routes before the 12-day review.
    expect(names('hc')).toEqual(['Decide re-routes', 'Review HC results', 'Assign sites'])
  })
})

describe('the Overdue tab', () => {
  it('shows "{M} late" and keeps only queues with something late', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    const tab = screen.getByRole('tab', { name: /Overdue/ })
    expect(tab.querySelector('.ui-tab-alert').textContent).toBe('39 late')
    expect(tab).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(tab)
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(names('hc')).toEqual(['Decide re-routes', 'Review HC results'])
    expect(cardsIn('plans')).toHaveLength(0)
    expect(column('plans')).toHaveTextContent('Nothing overdue')
    expect(column('cra')).toHaveTextContent('Nothing waiting on you')
  })
})

describe('keyboard', () => {
  it('moves between cards with the arrow keys', async () => {
    renderBoard(COORDINATOR_BOARD)
    await screen.findAllByTestId('ac-card')
    const [hc] = cardsIn('hc')
    const [dt] = cardsIn('dt')
    const [ict0, ict1] = cardsIn('ict')
    const [cra] = cardsIn('cra')
    expect(ict1).toHaveAttribute('data-col', '2')
    expect(ict1).toHaveAttribute('data-row', '1')

    hc.focus()
    fireEvent.keyDown(hc, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(dt)
    fireEvent.keyDown(dt, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(ict0)
    fireEvent.keyDown(ict0, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(ict1)
    fireEvent.keyDown(ict1, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(ict1)
    // The nearest card in the next column: CRA has one row only.
    fireEvent.keyDown(ict1, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cra)
    fireEvent.keyDown(cra, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(ict0)
    fireEvent.keyDown(ict0, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(ict0)
  })

  it('jumps over columns with no cards', async () => {
    renderBoard(CONTRACTOR_BOARD)
    await screen.findAllByTestId('ac-card')
    const [dt] = cardsIn('dt')
    dt.focus()
    fireEvent.keyDown(dt, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cardsIn('plans')[0])
  })

  it('toggles the Overdue tab with O, except in a text field', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    const tab = screen.getByRole('tab', { name: /Overdue/ })
    fireEvent.keyDown(document.body, { key: 'o' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document.body, { key: 'O' })
    expect(tab).toHaveAttribute('aria-selected', 'false')

    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'o' })
    expect(tab).toHaveAttribute('aria-selected', 'false')
    input.remove()
  })

  it('offers "Skip to tasks" first, moving focus to the board', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    const skip = screen.getByRole('link', { name: 'Skip to tasks' })
    const focusable = document.querySelectorAll('a[href], button, [tabindex="0"]')
    expect(focusable[0]).toBe(skip)
    fireEvent.click(skip)
    expect(document.activeElement).toHaveAttribute('id', 'ac-tasks')
    expect(document.activeElement).toHaveAttribute('tabindex', '-1')
  })
})

describe('states', () => {
  it('draws the rail and columns in their final place while loading', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    renderBoard()
    expect(document.querySelectorAll('.ac-col')).toHaveLength(5)
    for (const col of document.querySelectorAll('.ac-col')) {
      expect(col.querySelectorAll('.ac-card-skeleton')).toHaveLength(2)
    }
    expect([...document.querySelectorAll('.ac-step .ac-step-sub')].map((s) => s.textContent))
      .toEqual(['Loading…', 'Loading…', 'Loading…', 'Loading…', 'End of lifecycle', 'Loading…'])
    expect(document.querySelector('.ac-board')).toHaveAttribute('aria-busy', 'true')
  })

  it('hides the board and offers Retry when the board cannot be read', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Your tasks didn't load. The server didn't answer in time. Nothing was lost.")
    expect(document.querySelector('.ac-board')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('ac-card')).toHaveLength(5)
    expect(mockApi.get).toHaveBeenCalledTimes(2)
  })

  it('refetches on Refresh', async () => {
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    expect(screen.getByText('Updated just now')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    })
    expect(mockApi.get).toHaveBeenCalledTimes(2)
  })

  it('says all caught up when nothing is pending, and every step says so', async () => {
    renderBoard(boardOf('Coordinator', []))
    const note = await screen.findByText('All caught up.')
    expect(note.closest('.banner')).toHaveClass('banner-success')
    expect(note.closest('.banner')).toHaveTextContent(
      'Nothing is waiting on you. New work appears here as soon as it reaches you.',
    )
    expect(allCards()).toHaveLength(0)
    for (const col of document.querySelectorAll('.ac-col')) {
      expect(col).toHaveTextContent('Nothing waiting on you')
    }
  })
})

describe('motion', () => {
  afterEach(() => vi.restoreAllMocks())

  it('applies no animation when the reader prefers reduced motion', async () => {
    // The shared setup answers prefers-reduced-motion with "yes".
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    expect(document.querySelector('.ac-animate')).toBeNull()
    for (const card of allCards()) expect(card.style.getPropertyValue('--ac-delay')).toBe('')
  })

  it('plays the entrance once otherwise, with numbers final from the start', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }))
    renderBoard(PM_BOARD)
    await screen.findAllByTestId('ac-card')
    expect(document.querySelector('.ac-page')).toHaveClass('ac-animate')
    const [first, second] = cardsIn('hc')
    expect(first.style.getPropertyValue('--ac-delay')).toBe('200ms')
    expect(second.style.getPropertyValue('--ac-delay')).toBe('240ms')
    expect(cardsIn('dt')[0].style.getPropertyValue('--ac-delay')).toBe('250ms')
    expect(first.querySelector('.ac-card-count').textContent).toBe('4')
  })
})
