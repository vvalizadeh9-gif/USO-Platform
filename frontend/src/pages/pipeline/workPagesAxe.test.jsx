// axe over every work-page view in jsdom (UEP-06 §8): roles, names, the tabs
// pattern, labels, ids. Contrast needs a real browser and is checked by the
// Playwright spec (e2e/workPages.spec.js); jsdom reports it as incomplete.
import { act, render } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as F from '../../../e2e/workFixtures.js'

const ROUTES = {
  '/drive-test/pipeline/summary': F.pipelineSummary,
  '/hc/contractors/load': F.contractorLoad,
  '/drive-test/contractors/load': F.contractorLoad,
  '/hc/basket': F.hcBasket.slice(0, 60),
  '/hc/queues/in-progress': F.hcInProgress.slice(0, 6),
  '/hc/queues/dt-assignment': F.dtAssignment,
  '/hc/queues/dt-in-progress': F.dtInProgress,
  '/hc/results': F.hcResults,
  '/hc/queues/dt-review': F.dtReview,
  '/hc/queues/remediations': F.remediations,
  '/hc/queues/reroutes': F.reroutes,
  '/work-items/counts': F.workItemCounts,
  '/reference/provinces': [{ id: 1, name: 'تهران' }],
}

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url) =>
      Promise.resolve({ data: url === '/work-items' ? F.workItems('http://x/work-items') : ROUTES[url] ?? [] }),
    ),
    post: vi.fn(),
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: { name: 'PM' } } }) }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))
vi.mock('../healthcheck/HcHistoryTab', () => ({ default: () => <p>archive</p> }))

const HealthCheck = (await import('../HealthCheck')).default
const DriveTest = (await import('../DriveTest')).default
const WorkItems = (await import('../WorkItems')).default
const { ToastProvider } = await import('../../context/ToastContext')

const VIEWS = [
  '/health-check?tab=pool', '/health-check?tab=running', '/health-check?tab=review',
  '/drive-test?tab=assignment', '/drive-test?tab=in-progress', '/drive-test?tab=review',
  '/drive-test?tab=done', '/health-check?tab=remediation', '/health-check?tab=reroutes',
  '/drive-test?tab=sent-back', '/health-check?tab=history', '/work-items', '/work-items?stage=Ready%20for%20Assignment',
]

describe('the work pages have no axe violations', () => {
  it.each(VIEWS)('%s', async (path) => {
    const { container } = render(
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <Routes>
            <Route path="/health-check" element={<HealthCheck />} />
            <Route path="/drive-test" element={<DriveTest />} />
            <Route path="/work-items" element={<WorkItems />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )
    await act(async () => {})
    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(result.violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`)).toEqual([])
    // axe walks every node of a full list; it needs more than the default 5s
    // when the whole suite runs at once.
  }, 20000)
})
