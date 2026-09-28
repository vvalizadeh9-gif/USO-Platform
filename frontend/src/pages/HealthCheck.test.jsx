// What the Health Check page does with the `?tab=` it is handed.
//
// Three kinds of key arrive there: the current ones, the renamed ones the
// LEGACY_TABS map covers, and the two that are not on this page at all any
// more because the drive test became its own screen. The last kind is the one
// worth a test: the Action Center URLs the server builds still say
// ?tab=dt-assign, so the redirect is what keeps those links working — and it
// is invisible from the backend's side if it breaks.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const COUNTS = vi.hoisted(() => ({
  pool: 1012, in_progress: 320, hc_in_progress_late: 4, hc_review: 12, remediation: 9, reroutes: 0,
}))
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn((url) => Promise.resolve({ data: url === '/hc/queues/counts' ? COUNTS : {} })),
  },
}))

// The tab bodies each fetch their own queue. This is a test about which tab
// the URL selects, so they are replaced with markers.
const stub = (name) => ({ default: () => <p data-testid="tab">{name}</p> })
vi.mock('./healthcheck/HcBasketTab', () => stub('pool'))
vi.mock('./healthcheck/HcInProgressTab', () => stub('running'))
vi.mock('./healthcheck/HcResultsTab', () => stub('review'))
vi.mock('./healthcheck/HcHistoryTab', () => stub('history'))
vi.mock('./healthcheck/RemediationTab', () => stub('remediation'))
vi.mock('./healthcheck/ReroutesTab', () => stub('reroutes'))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: { name: 'Coordinator' } } }),
}))


const HealthCheck = (await import('./HealthCheck')).default

/** Stands in for the Drive Test page, reporting the URL it was reached at. */
function DriveTestStandIn() {
  const { pathname, search } = useLocation()
  return <p data-testid="landed">{`${pathname}${search}`}</p>
}

async function landOn(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/health-check" element={<HealthCheck />} />
        <Route path="/drive-test" element={<DriveTestStandIn />} />
      </Routes>
    </MemoryRouter>,
  )
  // The page fetches its badge counts on mount. Settling that here keeps the
  // assertions below free of act() warnings about a state update they did not
  // ask for.
  await act(async () => {})
}

describe('tab keys that moved to the Drive Test page', () => {
  it.each([
    ['dt-assign', 'assignment'],
    ['dt-review', 'review'],
  ])('?tab=%s is sent on to the drive test %s tab', async (from, to) => {
    await landOn(`/health-check?tab=${from}`)
    expect(screen.getByTestId('landed')).toHaveTextContent(`/drive-test?tab=${to}`)
  })

  it('keeps the other query params when it redirects', async () => {
    await landOn('/health-check?tab=dt-review&site=ABC123')
    const landed = screen.getByTestId('landed').textContent
    expect(landed).toContain('tab=review')
    expect(landed).toContain('site=ABC123')
  })
})

describe('tab keys that only got renamed', () => {
  it.each([
    ['basket', 'pool'],
    ['results', 'review'],
  ])('?tab=%s still opens the %s tab in place', async (from, to) => {
    await landOn(`/health-check?tab=${from}`)
    expect(screen.getByTestId('tab')).toHaveTextContent(to)
  })

  it('defaults to the pool when no tab is named', async () => {
    await landOn('/health-check')
    expect(screen.getByTestId('tab')).toHaveTextContent('pool')
  })
})

describe('the tab row reads as an order', () => {
  const tab = (name) => screen.getByRole('tab', { name })

  it('puts the fix loop in one group and History at the far end', async () => {
    await landOn('/health-check')

    const group = document.querySelector('.ui-tab-group')
    expect(group).toHaveTextContent('Fix loop')
    expect([...group.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual([
      'Remediation9',
      'Re-routes',
    ])
    // No chevron inside the group: neither queue follows the other.
    expect(group.querySelector('.ui-tab-sep')).toBeNull()
    expect(document.querySelector('.ui-tab-end')).toHaveTextContent('History')
  })

  it('separates the steps before the group with a chevron each', async () => {
    await landOn('/health-check')
    // Three steps: the first has no separator, so two chevrons between them,
    // plus one before the fix loop.
    expect(document.querySelectorAll('.ui-tabs > .ui-tab-sep')).toHaveLength(3)
  })

  it('counts each queue, and puts the late health checks on In Progress', async () => {
    await landOn('/health-check')
    expect(tab(/HC Pool/)).toHaveTextContent('1012')
    const running = tab(/In Progress/)
    expect(running.querySelector('.ui-tab-count')).toHaveTextContent('320')
    expect(running.querySelector('.ui-tab-alert')).toHaveTextContent('4 late')
    // A queue at zero carries no chip.
    expect(tab('Re-routes').querySelector('.ui-tab-count')).toBeNull()
  })

  it('sits under a PageBar with the process stepper on step 2', async () => {
    await landOn('/health-check')
    expect(screen.getByRole('heading', { level: 1, name: 'Health Check' }).closest('.page-bar')).not.toBeNull()
    expect(screen.getByText('Health Check', { selector: '.stepper-label' }).closest('[aria-current="step"]')).not.toBeNull()
  })

  it('switches tabs with the keyboard', async () => {
    await landOn('/health-check')
    tab(/HC Pool/).focus()
    fireEvent.keyDown(tab(/HC Pool/), { key: 'ArrowRight' })
    expect(screen.getByTestId('tab')).toHaveTextContent('running')
  })
})
