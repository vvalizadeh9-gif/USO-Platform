// axe over every work-page view in jsdom (UEP-06 §8): roles, names, the tabs
// pattern, labels, ids. Contrast needs a real browser and is checked by the
// Playwright spec (e2e/workPages.spec.js); jsdom reports it as incomplete.
import { act, render } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import * as F from '../../../e2e/workFixtures.js'
import { FILTER_OPTIONS, sitesPage } from '../explorer/fixtures.js'

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
  '/hc/batches': F.hcBatches,
  '/drive-test/tests': F.dtTests,
  '/work-items/counts': F.workItemCounts,
  '/reference/provinces': [{ id: 1, name: 'تهران' }],
  '/explorer/sites': sitesPage({ total: 60 }),
  '/explorer/sites/filters': FILTER_OPTIONS,
  '/admin/contractors': F.adminContractors,
  '/hc/my/assignments': F.myAssignments,
}

const answer = (url) => {
  if (url === '/work-items') return F.workItems('http://x/work-items')
  if (/^\/hc\/batches\/\d+$/.test(url)) return F.hcBatchDetail(Number(url.split('/').pop()))
  return ROUTES[url] ?? []
}

vi.mock('../../api/client', () => ({
  default: {
    get: vi.fn((url) => Promise.resolve({ data: answer(url) })),
    post: vi.fn(),
  },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: 'PM' } } }) }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))
vi.mock('../healthcheck/HcHistoryTab', () => ({ default: () => <p>archive</p> }))

const HealthCheck = (await import('../HealthCheck')).default
const DriveTest = (await import('../DriveTest')).default
const ExplorerList = (await import('../explorer/ExplorerList')).default
const ContractorsPage = (await import('../admin/ContractorsPage')).default
const MyHealthCheck = (await import('../MyHealthCheck')).default
const { ToastProvider } = await import('../../context/ToastContext')
const { fireEvent, screen } = await import('@testing-library/react')

const RULES = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
}

function draw(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/drive-test" element={<DriveTest />} />
          <Route path="/explorer" element={<ExplorerList />} />
          <Route path="/admin/contractors" element={<ContractorsPage />} />
          <Route path="/my-health-check" element={<MyHealthCheck />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const violations = async (node) =>
  (await axe.run(node, RULES)).violations.map((v) => `${v.id}: ${v.nodes[0].html.slice(0, 120)}`)

const VIEWS = [
  '/health-check?tab=assign', '/health-check?tab=checks', '/drive-test?tab=assign', '/drive-test?tab=tests',
  '/drive-test?tab=done', '/health-check?tab=remediation', '/health-check?tab=reroutes', '/health-check?tab=history', '/explorer', '/explorer?q=W40&province=1&sort=villages&dir=desc',
  '/admin/contractors', '/my-health-check',
]

describe('the work pages have no axe violations', () => {
  it.each(VIEWS)('%s', async (path) => {
    const { container } = draw(path)
    await act(async () => {})
    expect(await violations(container)).toEqual([])
    // axe walks every node of a full list; it needs more than the default 5s
    // when the whole suite runs at once.
  }, 20000)

  it('with the villages list open', async () => {
    const { container } = draw('/health-check?tab=assign')
    await act(async () => {})
    fireEvent.click(screen.getAllByRole('button', { name: /villages?, show names$/ })[0])
    expect(document.querySelector('.uw-vpop')).not.toBeNull()
    expect(await violations(container)).toEqual([])
  }, 20000)

  it('with the Fill pop-up open', async () => {
    draw('/my-health-check')
    await act(async () => {})
    fireEvent.click(screen.getAllByRole('button', { name: 'Fill' })[0])
    expect(await violations(screen.getByRole('dialog'))).toEqual([])
  }, 20000)
})
