// UEP-31: the Drive test pages refined, and Admin › Contractors.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as F from '../../../e2e/workFixtures.js'

const ROUTES = {
  '/drive-test/pipeline/summary': F.pipelineSummary,
  '/hc/contractors/load': F.contractorLoad,
  '/drive-test/contractors/load': F.contractorLoad,
  '/hc/basket': F.hcBasket.slice(0, 40),
  '/hc/queues/dt-assignment': F.dtAssignment,
  '/hc/queues/remediations': F.remediations,
  '/hc/batches': F.hcBatches,
  '/drive-test/tests': F.dtTests,
  '/admin/contractors': F.adminContractors,
  '/hc/my/assignments': F.myAssignments,
}
const answer = (url) =>
  /^\/hc\/batches\/\d+$/.test(url) ? F.hcBatchDetail(Number(url.split('/').pop())) : ROUTES[url] ?? []

vi.mock('../../api/client', () => ({
  default: { get: vi.fn((url) => Promise.resolve({ data: answer(url) })), post: vi.fn(), patch: vi.fn() },
}))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { id: 7, role: { name: 'PM' } } }) }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))

const api = (await import('../../api/client')).default
const HealthCheck = (await import('../HealthCheck')).default
const DriveTest = (await import('../DriveTest')).default
const ContractorsPage = (await import('../admin/ContractorsPage')).default
const MyHealthCheck = (await import('../MyHealthCheck')).default
const { slaPill } = await import('./ChecksStep')
const { ToastProvider } = await import('../../context/ToastContext')

async function draw(path) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/drive-test" element={<DriveTest />} />
          <Route path="/admin/contractors" element={<ContractorsPage />} />
          <Route path="/my-health-check" element={<MyHealthCheck />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
  return view
}

const headers = (table) => within(table).getAllByRole('columnheader').map((th) => th.textContent.trim()).filter(Boolean)

beforeEach(() => vi.clearAllMocks())

describe('the strip and the heading', () => {
  it('say "late", never "overdue", and the heading has no meta line', async () => {
    const { container } = await draw('/health-check?tab=assign')
    expect(container.textContent).not.toMatch(/overdue/i)
    expect(screen.getAllByText('26 late', { selector: '.uw-flow-late' }).length).toBeGreaterThan(0)
    expect(container.querySelector('.uw-heading-meta')).toBeNull()
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected).toHaveClass('uw-flow-step', 'is-selected')
    // DT done is shown, not a tab.
    expect(screen.queryByRole('tab', { name: /DT done/ })).toBeNull()
    expect(screen.getByText('DT done')).toBeInTheDocument()
  })
})

describe('Assign', () => {
  it('shows Site type instead of Requested tech, on both pages', async () => {
    await draw('/health-check?tab=assign')
    expect(headers(screen.getByRole('table'))).toEqual(['Site ID', 'Villages', 'Province', 'Site type', 'Previous contractor', 'Waiting'])
  })

  it('names the health-check contractor on Drive test', async () => {
    await draw('/drive-test?tab=assign')
    expect(headers(screen.getByRole('table'))).toEqual(['Site ID', 'Villages', 'Province', 'Site type', 'Health check by', 'Waiting'])
    expect(screen.getAllByText('1 new').length).toBeGreaterThan(0)
  })

  it('opens the village names without ticking the row', async () => {
    await draw('/health-check?tab=assign')
    const count = screen.getAllByRole('button', { name: /villages?, show names$/ })[0]
    const row = count.closest('tr')
    fireEvent.click(count)
    expect(count).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByRole('checkbox')).not.toBeChecked()
    expect(document.querySelector('.uw-vpop')).toHaveTextContent('villages')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(count).toHaveAttribute('aria-expanded', 'false')
    expect(count).toHaveFocus()
  })

  it('sorts by the Waiting and Province headers, longest wait first', async () => {
    await draw('/health-check?tab=assign')
    expect(screen.getByRole('columnheader', { name: /Waiting/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: /Province/ })).toHaveAttribute('aria-sort', 'none')
    expect(screen.queryByRole('combobox', { name: 'Sort' })).toBeNull()
  })
})

describe('Checks', () => {
  it('names no contractor anywhere', async () => {
    const { container } = await draw('/health-check?tab=checks')
    expect(container.textContent).not.toMatch(/contractor/i)
    for (const c of F.contractorLoad) expect(container.textContent).not.toContain(c.name)
  })

  it('opens the first batch with results to decide', async () => {
    await draw('/health-check?tab=checks')
    expect(screen.getByRole('heading', { level: 2, name: 'HC-16OCT-02' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /HC-16OCT-02/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('draws each batch bar from its counts', async () => {
    await draw('/health-check?tab=checks')
    const option = screen.getAllByRole('option')[0]
    const [ready, notReady, pending] = option.querySelectorAll('.uw-batch-bar i')
    expect([ready.style.width, notReady.style.width, pending.style.width]).toEqual([`${(100 * 5) / 9}%`, `${100 / 9}%`, `${(100 * 3) / 9}%`])
    expect(option).toHaveTextContent('5 ready1 not ready3 pending')
  })

  it('says what was not normal', async () => {
    await draw('/health-check?tab=checks')
    expect(screen.getByText('2G:').closest('.uw-why')).toHaveTextContent('2G: Transmission link down')
  })

  it('colours the status pill: due, due soon, late, completed, completed late', () => {
    const now = Date.parse('2026-11-28T10:00:00Z')
    const at = (h) => new Date(now + h * 3600000).toISOString()
    const b = { assigned_at: at(-30) }
    expect(slaPill({ ...b, due_at: at(23) }, now)).toEqual({ tone: 'grey', text: 'Due in 23 h' })
    expect(slaPill({ ...b, due_at: at(3) }, now)).toEqual({ tone: 'yellow', text: 'Due in 3 h' })
    expect(slaPill({ ...b, due_at: at(-2) }, now)).toEqual({ tone: 'red', text: 'Late 2 h' })
    expect(slaPill({ ...b, due_at: at(10), completed_at: at(1) }, now)).toEqual({ tone: 'green', text: 'Completed in 31 h' })
    expect(slaPill({ ...b, due_at: at(-5), completed_at: at(1) }, now)).toEqual({ tone: 'red', text: 'Completed in 31 h' })
  })
})

describe('Tests', () => {
  it('has tabs without counts, no expand button and a Report column', async () => {
    await draw('/drive-test?tab=tests')
    expect(screen.getAllByRole('tab').filter((t) => t.closest('.uw-card')).map((t) => t.textContent)).toEqual(['To review', 'With contractors', 'Reviewed'])
    expect(screen.queryByRole('button', { name: /details of/ })).toBeNull()
    expect(headers(screen.getByRole('table'))).not.toContain('Batch')
    expect(screen.getAllByText('No report').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2 files').length).toBeGreaterThan(0)
    expect(screen.getByText('DT-500')).toHaveClass('uw-sub')
  })

  it('asks for one send-back reason from a dropdown', async () => {
    await draw('/drive-test?tab=tests')
    fireEvent.click(screen.getByRole('radio', { name: 'Send back → Round 2' }))
    expect(screen.getByRole('combobox', { name: 'Reason' })).toHaveTextContent('Choose a reason')
    expect(screen.queryByRole('radio', { name: 'Route incomplete' })).toBeNull()
  })
})

describe('Remediation', () => {
  it('filters by a team tile, and a second click clears it', async () => {
    await draw('/health-check?tab=remediation')
    expect(headers(screen.getByRole('table'))).toEqual(['Site ID', 'Province', 'Owning team', 'Issue', 'Open'])
    const rows = () => screen.getAllByRole('row').length - 1
    expect(rows()).toBe(30)
    const tile = screen.getByRole('button', { name: /^CPG Power/ })
    expect(tile).toHaveTextContent('10 open')
    expect(tile).toHaveTextContent('SLA 7 d')
    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(rows()).toBe(10)
    expect(screen.getByText(/CPG Power · 10 sites/)).toBeInTheDocument()
    fireEvent.click(tile)
    expect(rows()).toBe(30)
  })
})

describe("the contractor's own page", () => {
  it('locks sent results and offers Fill as a secondary button', async () => {
    const { container } = await draw('/my-health-check')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getAllByText('Locked')).toHaveLength(7)
    const fill = screen.getAllByRole('button', { name: 'Fill' })
    expect(fill).toHaveLength(5)
    expect(fill[0]).not.toHaveClass('btn-primary')
    expect(screen.getByText('7 of 12 sites sent')).toBeInTheDocument()
    expect(screen.getByText(/^Due in 2[23] h$/)).toBeInTheDocument()
    expect(container.querySelector('.uep-lifecycle, .lifecycle-strip')).toBeNull()
  })

  it('asks for a comment on Not normal, with no help paragraph', async () => {
    await draw('/my-health-check')
    fireEvent.click(screen.getAllByRole('button', { name: 'Fill' })[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).not.toMatch(/For each technology/)
    const send = within(dialog).getByRole('button', { name: 'Send result' })
    expect(send).toBeDisabled()
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Normal' })[0])
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Not normal' })[1])
    expect(send).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Problem on 4G' }), { target: { value: 'Antenna damaged' } })
    expect(send).toBeEnabled()
    expect(dialog).toHaveTextContent('Locked after sending')
  })
})

describe('Admin › Contractors', () => {
  beforeEach(() => localStorage.setItem('uep.contractors.seen.7', '2026-11-01T00:00:00Z'))

  it('says which new CPM names are hidden, and Review opens them', async () => {
    await draw('/admin/contractors')
    expect(screen.getByText(/1 new name from the 27 Nov CPM import is hidden\./)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Shown 7/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('radio', { name: /Hidden 2/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('CPM · new 27 Nov')).toBeInTheDocument()
    // A hidden contractor with open work is red.
    const busy = screen.getByText('رایان سازه').closest('tr')
    expect(busy.querySelector('.cad-num')).toHaveClass('is-late')
  })

  it('adds a contractor, and says when the name exists', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 409 } })
    await draw('/admin/contractors')
    fireEvent.click(screen.getByRole('button', { name: /Add contractor/ }))
    const input = screen.getByRole('textbox', { name: 'Contractor name' })
    fireEvent.change(input, { target: { value: 'پارس تل' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(api.post).toHaveBeenCalledWith('/admin/contractors', { name: 'پارس تل' })
    expect(screen.getByText('A contractor with this name already exists.')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Contractor name' })).toBeNull()
  })

  it('switches a contractor and offers Undo', async () => {
    const row = F.adminContractors[0]
    api.patch.mockResolvedValue({ data: { ...row, show_in_drive_test: false } })
    await draw('/admin/contractors')
    const sw = screen.getByRole('switch', { name: `Show ${row.name} in Drive test` })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await act(async () => { fireEvent.click(sw) })
    expect(api.patch).toHaveBeenCalledWith(`/admin/contractors/${row.id}`, { show_in_drive_test: false })
    expect(screen.getByRole('status')).toHaveTextContent(`${row.name} hidden from Drive test · open sites stay with them`)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })
})
