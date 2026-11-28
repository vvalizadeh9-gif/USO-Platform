// Drive test · Assign: the site table and the Contractors column (UEP-31 §2).
// Select sites, pick a contractor, press Assign: assigned through the endpoint
// the page has always used, with a confirmation that stays and can be undone.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pickOption } from '../test/pickOption'

const V = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id * 10 + i, name: `ده ${id}-${i}`, code: `${id}${i}`, is_new: false }))

const READY = [
  { work_item_id: 1, site_code: 'YZD-1', site_type: 'New Site', province: 'یزد', village: 'ده نو', village_count: 1, villages: V(1, 1), requested_technologies: ['4G'], rounds_taken: 1, hc_contractor: 'پارس تل', days_waiting: 7, returned_reason: null },
  { work_item_id: 2, site_code: 'YZD-2', site_type: 'Add Tech', province: 'یزد', village: null, village_count: 0, villages: [], requested_technologies: ['4G'], rounds_taken: 3, hc_contractor: 'پارس تل', days_waiting: 35, returned_reason: null },
  { work_item_id: 3, site_code: 'THR-1', site_type: 'New Site', province: 'تهران', village: 'کن', village_count: 3, villages: V(3, 3), requested_technologies: ['3G', '4G'], rounds_taken: 1, hc_contractor: 'رعد', days_waiting: 30, returned_reason: 'Road closed' },
]
const LOAD = [
  { contractor_id: 5, name: 'آریا موج', open: 2, late: 0, avg_submit_days: 4, provinces: [{ province: 'یزد', share: 0.8 }] },
  { contractor_id: 6, name: 'رعد', open: 9, late: 2, avg_submit_days: null, provinces: [] },
]
const SUMMARY = { dt4: { count: 3, late: 2, oldest_days: 30, sla_days: 14 } }

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: 'PM' } } }) }))
vi.mock('../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))

const api = (await import('../api/client')).default
const DriveTest = (await import('./DriveTest')).default
const { ToastProvider } = await import('../context/ToastContext')
const { clearActionLog } = await import('../lib/actionLog')

beforeEach(() => {
  vi.clearAllMocks()
  clearActionLog()
  api.get.mockImplementation((url) => {
    if (url === '/drive-test/pipeline/summary') return Promise.resolve({ data: SUMMARY })
    if (url === '/hc/queues/dt-assignment') return Promise.resolve({ data: READY })
    if (url === '/drive-test/contractors/load') return Promise.resolve({ data: LOAD })
    return Promise.resolve({ data: [] })
  })
})

async function draw() {
  render(
    <MemoryRouter initialEntries={['/drive-test']}>
      <ToastProvider><DriveTest /></ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

const row = (code) => screen.getByText(code).closest('tr')
const card = (name) => screen.getAllByRole('radio').find((b) => b.textContent.includes(name))
const assignButton = () => screen.getByRole('button', { name: /^Assign( to |$)/ })

describe('the site table', () => {
  it('shows villages as a count and Site type, not Requested tech', async () => {
    await draw()
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent).filter(Boolean)
    expect(heads).toEqual(['Site ID', 'Villages', 'Province', 'Site type', 'Health check by', 'Waiting'])
    expect(within(row('THR-1')).getByRole('button', { name: '3 villages, show names' })).toBeInTheDocument()
    expect(within(row('THR-1')).getByText('New site')).toBeInTheDocument()
    expect(within(row('THR-1')).getByText('Handed back')).toHaveClass('uw-sub')
  })

  it('marks waiting past the SLA as late, in words too', async () => {
    await draw()
    expect(within(row('YZD-2')).getByText('35 d', { exact: false })).toHaveClass('uw-days', 'is-late')
    expect(within(row('YZD-1')).getByText('7 d')).not.toHaveClass('is-late')
    expect(within(row('YZD-2')).getByText('late')).toHaveClass('uw-sr-only')
  })

  it('sorts longest waiting first by default, or by the Province header', async () => {
    const user = userEvent.setup()
    await draw()
    const order = () => screen.getAllByRole('row').slice(1).map((r) => r.querySelector('.uw-site-id').textContent)
    expect(order()).toEqual(['YZD-2', 'THR-1', 'YZD-1'])
    await user.click(screen.getByRole('button', { name: 'Province' }))
    expect(screen.getByRole('columnheader', { name: /Province/ })).toHaveAttribute('aria-sort', 'ascending')
    expect(order()).toEqual(['THR-1', 'YZD-2', 'YZD-1'])
  })

  it('toggles a row by clicking it, and the header selects the filtered set', async () => {
    const user = userEvent.setup()
    await draw()
    await user.click(within(row('YZD-1')).getByText('New site'))
    expect(within(row('YZD-1')).getByRole('checkbox')).toBeChecked()
    await user.click(within(row('YZD-1')).getByText('New site'))
    expect(within(row('YZD-1')).getByRole('checkbox')).not.toBeChecked()

    await pickOption(screen.getByRole('combobox', { name: 'Province' }), 'یزد')
    await user.click(screen.getByRole('checkbox', { name: 'Select every site shown' }))
    expect(screen.getByText('2 sites')).toBeInTheDocument()
    // Selection survives filtering.
    await pickOption(screen.getByRole('combobox', { name: 'Province' }), '')
    expect(screen.getByText('2 sites')).toBeInTheDocument()
    expect(within(row('THR-1')).getByRole('checkbox')).not.toBeChecked()
  })
})

describe('assigning', () => {
  it('assigns the selected sites in one click, keeps the confirmation, and undoes it', async () => {
    const user = userEvent.setup()
    api.post.mockImplementation((url) =>
      Promise.resolve({ data: url === '/work-items/assign' ? { assigned: 1, batch_id: 77, batch_code: 'DT-77' } : { status: 'ok' } }),
    )
    await draw()
    expect(assignButton()).toBeDisabled()
    await user.click(within(row('YZD-1')).getByRole('checkbox'))
    // The suggestion is pre-selected; a card click alone never assigns.
    expect(card('آریا موج')).toHaveAttribute('aria-checked', 'true')
    await user.click(card('آریا موج'))
    expect(api.post).not.toHaveBeenCalled()
    await user.click(assignButton())
    expect(api.post).toHaveBeenCalledWith('/work-items/assign', {
      work_item_ids: [1], contractor_id: 5, assignment_type: 'official',
    })
    const text = 'Batch DT-77 sent to آریا موج · 1 site · 1 village recorded'
    expect(await screen.findByText(text, { selector: '.uw-notice-text' })).toBeInTheDocument()
    // Focus returns to the heading after the action.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    await act(async () => new Promise((r) => requestAnimationFrame(r)))
    expect(screen.getByTestId('work-live')).toHaveTextContent(text)

    const summaryReads = () => api.get.mock.calls.filter(([u]) => u === '/drive-test/pipeline/summary').length
    const before = summaryReads()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(api.post).toHaveBeenLastCalledWith('/work-items/assign/77/undo')
    expect(await screen.findByText('Undone. The sites are back where they were.', { selector: '.uw-notice-text' })).toBeInTheDocument()
    expect(summaryReads()).toBeGreaterThan(before)
  })

  it('says it is too late when the server refuses the undo', async () => {
    const user = userEvent.setup()
    api.post.mockImplementation((url) =>
      url === '/work-items/assign'
        ? Promise.resolve({ data: { assigned: 1, batch_id: 9, batch_code: 'DT-9' } })
        : Promise.reject({ response: { status: 409, data: { detail: 'Too late to undo; reassign the sites instead.' } } }),
    )
    await draw()
    await user.click(within(row('YZD-1')).getByRole('checkbox'))
    await user.click(card('رعد'))
    await user.click(assignButton())
    await screen.findByText('Batch DT-9 sent to رعد · 1 site · 1 village recorded', { selector: '.uw-notice-text' })
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(await screen.findByText('Too late to undo; reassign the sites instead.', { selector: '.uw-notice-text' })).toBeInTheDocument()
  })
})
