import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The Action Center ticket board. Every number on it comes from
// GET /action-center/board; these tests hold the page to the approved board:
// one column per stage with work, one ticket per queue linking to its screen,
// the overdue pill only when something is late, Shamsi dates in Persian
// digits, and no motion for a reader who asked for none.

const mockApi = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/client', () => ({ default: mockApi }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => mockAuth.current }))

const ActionCenter = (await import('./ActionCenter')).default

const ticket = (queue_key, label, count, overdue, extra = {}) => ({
  queue_key, label, count, overdue,
  oldest_started_at: '2026-09-22T20:30:00Z', // 1 Mehr 1405 in Tehran
  earliest_due_at: null,
  date_kind: 'since',
  url: `/queue/${queue_key}`,
  ...extra,
})

const stage = (key, label, tickets) => ({
  key, label, total: tickets.reduce((n, t) => n + t.count, 0), tickets,
})

const COORDINATOR_BOARD = {
  role: 'Coordinator',
  scope_label: 'Tehran',
  generated_at: '2026-10-01T08:00:00Z',
  totals: { pending: 54, overdue: 12 },
  stages: [
    stage('hc', 'Health Check', [ticket('hc_review', 'HC results to review', 9, 2)]),
    stage('dt', 'Drive Test', [ticket('dt_assign', 'DT to assign', 21, 0)]),
    stage('ict', 'ICT Acceptance', [
      ticket('ict_to_file', 'Villages to file', 11, 3),
      ticket('ict_to_validate', 'Contractor filings to validate', 6, 0),
    ]),
    stage('cra', 'CRA Acceptance', [ticket('cra_to_file', 'Villages to file', 7, 7)]),
  ],
}

const CONTRACTOR_BOARD = {
  ...COORDINATOR_BOARD,
  role: 'Contractor',
  stages: [
    ...COORDINATOR_BOARD.stages,
    stage('plans', 'Plans & Data', [
      ticket('plan_submit', 'Monthly plan to submit', 4, 4, {
        date_kind: 'due', oldest_started_at: null, earliest_due_at: '2026-09-25T20:29:59Z',
      }),
    ]),
  ],
}

function signedInAs(roleName) {
  mockAuth.current = { user: { full_name: 'A Person', role: { name: roleName } } }
}

function renderBoard() {
  return render(
    <MemoryRouter>
      <ActionCenter />
    </MemoryRouter>,
  )
}

const columns = () => [...document.querySelectorAll('.ac-col')].map((c) => c.dataset.stage)

beforeEach(() => {
  mockApi.get.mockReset()
  signedInAs('Coordinator')
})

describe('the board', () => {
  it('draws one column per stage that has work, in lifecycle order', async () => {
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    await screen.findByRole('heading', { name: 'Health Check' })
    expect(columns()).toEqual(['hc', 'dt', 'ict', 'cra'])
    expect(document.querySelector('.ac-board').style.getPropertyValue('--ac-cols')).toBe('4')
  })

  it('gives a contractor the Plans column too', async () => {
    signedInAs('Contractor')
    mockApi.get.mockResolvedValue({ data: CONTRACTOR_BOARD })
    renderBoard()
    await screen.findByRole('heading', { name: 'Plans & Data' })
    expect(columns()).toEqual(['hc', 'dt', 'ict', 'cra', 'plans'])
  })

  it('shows the totals in the header and each stage total on its column', async () => {
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    expect(await screen.findByLabelText('54 pending')).toHaveTextContent('54 pending')
    expect(screen.getByLabelText('12 overdue')).toHaveTextContent('12 overdue')
    const ict = screen.getByRole('region', { name: 'ICT' })
    expect(within(ict).getByLabelText('17 pending')).toHaveTextContent('17')
  })

  it('makes every ticket a real link to its queue, the same size as the rest', async () => {
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    const tickets = await screen.findAllByTestId('ac-ticket')
    expect(tickets).toHaveLength(5)
    for (const t of tickets) {
      expect(t.tagName).toBe('A')
      expect(t.getAttribute('href')).toMatch(/^\/queue\//)
      expect(t).toHaveClass('ac-ticket')
    }
    expect(screen.getByRole('link', { name: /^Villages to file: 11, 3 overdue/ }))
      .toHaveAttribute('href', '/queue/ict_to_file')
  })

  it('shows the overdue pill only when something is overdue', async () => {
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    await screen.findAllByTestId('ac-ticket')
    const pills = [...document.querySelectorAll('.ac-overdue')].map((p) => p.textContent)
    expect(pills).toEqual(['2 overdue', '3 overdue', '7 overdue'])
  })

  it('dates each ticket in Shamsi with Persian digits, "due" for a deadline', async () => {
    signedInAs('Contractor')
    mockApi.get.mockResolvedValue({ data: CONTRACTOR_BOARD })
    renderBoard()
    await screen.findAllByTestId('ac-ticket')
    const dates = [...document.querySelectorAll('.ac-ticket-date')].map((d) => d.textContent)
    expect(dates[0]).toBe('since ۱۴۰۵/۰۷/۰۱')
    expect(dates.at(-1)).toBe('due ۱۴۰۵/۰۷/۰۳')
    expect(document.querySelector('.ac-today').textContent).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/)
  })
})

describe('motion', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows the final numbers at once when the reader prefers reduced motion', async () => {
    // The shared setup answers prefers-reduced-motion with "yes".
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    const counts = await screen.findAllByText('21')
    expect(counts.some((el) => el.classList.contains('ac-ticket-count'))).toBe(true)
  })

  it('counts up from zero otherwise', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }))
    const frames = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb))
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    mockApi.get.mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    await screen.findAllByTestId('ac-ticket')
    const count = () => [...document.querySelectorAll('.ac-ticket-count')].map((c) => c.textContent)
    expect(count()).toEqual(['0', '0', '0', '0', '0'])
    // Run frames, a second apart, until no counter asks for another: every
    // one is past its delay and its 1.3s count well before the cap.
    await act(async () => {
      for (let t = 0; frames.length && t <= 60000; t += 1000) {
        frames.splice(0).forEach((cb) => cb(t))
      }
    })
    expect(count()).toEqual(['9', '21', '11', '6', '7'])
    expect(frames).toHaveLength(0)
  })
})

describe('states', () => {
  it('keeps the final layout while loading', () => {
    mockApi.get.mockReturnValue(new Promise(() => {}))
    renderBoard()
    expect(columns()).toEqual(['hc', 'dt', 'ict', 'cra'])
    expect(document.querySelector('.ac-board')).toHaveAttribute('aria-busy', 'true')
  })

  it('offers a retry when the board cannot be read', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: COORDINATOR_BOARD })
    renderBoard()
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findAllByTestId('ac-ticket')).toHaveLength(5)
    expect(mockApi.get).toHaveBeenCalledTimes(2)
  })

  it('says so once when nothing is pending', async () => {
    mockApi.get.mockResolvedValue({
      data: { ...COORDINATOR_BOARD, totals: { pending: 0, overdue: 0 }, stages: [] },
    })
    renderBoard()
    expect(await screen.findByRole('heading', { name: 'All caught up' })).toBeInTheDocument()
    expect(screen.getByLabelText('0 pending')).toBeInTheDocument()
    expect(document.querySelector('.ac-col')).toBeNull()
  })
})
