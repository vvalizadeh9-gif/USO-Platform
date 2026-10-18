// What the Health check and Drive test pages do with the URL (UEP-06 §1).
//
// The step lives in `?tab=`, so Back and Forward walk through it, and every
// key people already hold keeps working: the renamed ones open their step in
// place, and the two that moved to the Drive test page are sent on there --
// the server built links with ?tab=dt-assign for years, and a broken redirect
// is invisible from the backend's side.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SUMMARY = vi.hoisted(() => ({
  hc1: { count: 196, late: 3, oldest_days: 40, sla_days: 14 },
  hc2: { count: 98, late: 0, oldest_days: 9, sla_days: 14 },
  hc3: { count: 12, late: 0, oldest_days: 2, sla_days: 14 },
  dt4: { count: 49, late: 1, oldest_days: 20, sla_days: 14 },
  dt5: { count: 263, late: 4, oldest_days: 30, sla_days: 14 },
  dt6: { count: 7, late: 0, oldest_days: 1, sla_days: 14 },
  done: { count: 1200, late: 0, oldest_days: null, sla_days: null },
  remediation: { count: 9, late: 2, oldest_days: 30, sla_days: null },
  reroutes: { count: 0, late: 0, oldest_days: null, sla_days: 14 },
  sent_back: { count: 5, late: 0, oldest_days: 3, sla_days: 14 },
}))
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn((url) => Promise.resolve({ data: url === '/drive-test/pipeline/summary' ? SUMMARY : [] })),
    post: vi.fn(),
  },
}))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { role: { name: 'Coordinator' } } }) }))
vi.mock('../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))
// The History view's archive fetches its own assignments.
vi.mock('./healthcheck/HcHistoryTab', () => ({ default: () => <p>archive</p> }))

const api = (await import('../api/client')).default
const HealthCheck = (await import('./HealthCheck')).default
const DriveTest = (await import('./DriveTest')).default
const { ToastProvider } = await import('../context/ToastContext')

let nav
function Where() {
  const { pathname, search } = useLocation()
  nav = useNavigate()
  return <p data-testid="where">{`${pathname}${search}`}</p>
}

async function landOn(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/drive-test" element={<DriveTest />} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

const heading = () => screen.getByRole('heading', { level: 1 })

beforeEach(() => vi.clearAllMocks())

describe('every route opens its step', () => {
  it.each([
    ['/health-check', 'Health check · Assign'],
    ['/health-check?tab=assign', 'Health check · Assign'],
    ['/health-check?tab=pool', 'Health check · Assign'],
    ['/health-check?tab=basket', 'Health check · Assign'],
    ['/health-check?tab=checks', 'Health check · Checks'],
    ['/health-check?tab=running', 'Health check · Checks'],
    ['/health-check?tab=review', 'Health check · Checks'],
    ['/health-check?tab=results', 'Health check · Checks'],
    ['/health-check?tab=remediation', 'Exceptions · Remediation'],
    ['/health-check?tab=reroutes', 'Exceptions · Re-routes'],
    ['/health-check?tab=history', 'History'],
    ['/drive-test', 'Drive test · Assign'],
    ['/drive-test?tab=assignment', 'Drive test · Assign'],
    ['/drive-test?tab=tests', 'Drive test · Tests'],
    ['/drive-test?tab=in-progress', 'Drive test · Tests'],
    ['/drive-test?tab=review', 'Drive test · Tests'],
    ['/drive-test?tab=sent-back', 'Drive test · Tests'],
    ['/drive-test?tab=done', 'DT done'],
    ['/drive-test?tab=history', 'History'],
  ])('%s → %s', async (path, title) => {
    await landOn(path)
    expect(heading()).toHaveTextContent(title)
  })

  it('keeps the query when an old key is redirected', async () => {
    await landOn('/health-check?tab=review&site=ABC123')
    expect(screen.getByTestId('where').textContent).toContain('tab=checks')
    expect(screen.getByTestId('where').textContent).toContain('filter=to_decide')
    expect(screen.getByTestId('where').textContent).toContain('site=ABC123')
  })

  it('sends ?tab=dt-review on Health check to Drive test · Tests', async () => {
    await landOn('/health-check?tab=dt-review')
    expect(screen.getByTestId('where').textContent).toContain('/drive-test?tab=tests')
    expect(heading()).toHaveTextContent('Drive test · Tests')
  })
})

describe('the heading and the strip', () => {
  it('leads the meta line with the step count and overdue', async () => {
    await landOn('/health-check')
    expect(document.querySelector('.uw-heading-meta')).toHaveTextContent('196 sites waiting · 3 overdue')
    expect(heading()).toHaveAttribute('tabindex', '-1')
    expect(api.get).toHaveBeenCalledWith('/drive-test/pipeline/summary')
  })

  it('shows the same pipeline on both pages, the list card as its panel', async () => {
    await landOn('/drive-test?tab=tests')
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.dataset.step).toBe('dt_tests')
    expect(selected).toHaveTextContent('7 to decide')
    const panel = document.getElementById(selected.getAttribute('aria-controls'))
    expect(panel).toHaveAttribute('role', 'tabpanel')
  })

  it('crosses pages when a step on the other one is chosen, and Back returns', async () => {
    await landOn('/health-check?tab=checks')
    fireEvent.keyDown(screen.getByRole('tab', { selected: true }), { key: 'ArrowRight' })
    await act(async () => {})
    expect(screen.getByTestId('where')).toHaveTextContent('/drive-test?tab=assign')
    await act(async () => nav(-1))
    expect(heading()).toHaveTextContent('Health check · Checks')
  })

  it('opens History from the heading, marked as the current view', async () => {
    await landOn('/drive-test')
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    await act(async () => {})
    expect(screen.getByTestId('where')).toHaveTextContent('/drive-test?tab=history')
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('tab', { selected: true })).toBeNull()
  })

  it('has one persistent status region from page load', async () => {
    await landOn('/health-check')
    expect(screen.getAllByRole('status').filter((s) => s.dataset.testid === 'work-live')).toHaveLength(1)
  })
})
