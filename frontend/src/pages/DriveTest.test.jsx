// The Drive Test page: a PageBar over three queues, and the Assignment queue
// on a fill-height card with the shared dock.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const COUNTS = { dt_assignment: 2, dt_in_progress: 96, dt_review: 0 }
const READY = [
  { work_item_id: 1, site_code: 'YZD-1', province: 'یزد', requested_technologies: ['4G'], rounds_taken: 1, hc_contractor: 'پارس تل', days_waiting: 7, returned_reason: null },
  { work_item_id: 2, site_code: 'YZD-2', province: 'یزد', requested_technologies: ['4G'], rounds_taken: 3, hc_contractor: 'پارس تل', days_waiting: 15, returned_reason: null },
]

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: { name: 'PM' } } }),
}))
vi.mock('./drivetest/DtInProgressTab', () => ({ default: () => <p>in progress</p> }))
vi.mock('./drivetest/DtReviewTab', () => ({ default: () => <p>review</p> }))

const api = (await import('../api/client')).default
const DriveTest = (await import('./DriveTest')).default
const { ToastProvider } = await import('../context/ToastContext')

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => {
    if (url === '/hc/queues/counts') return Promise.resolve({ data: COUNTS })
    if (url === '/hc/queues/dt-assignment') return Promise.resolve({ data: READY })
    if (url === '/reference/contractors') return Promise.resolve({ data: [{ id: 5, name: 'آریا موج' }] })
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

describe('the Drive Test page', () => {
  it('has a PageBar with the stepper on step 3 and the three queues with counts', async () => {
    await draw()
    expect(screen.getByRole('heading', { level: 1, name: 'Drive Test' }).closest('.page-bar')).not.toBeNull()
    expect(screen.getByText('Drive Test', { selector: '.stepper-label' }).closest('[aria-current="step"]')).not.toBeNull()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Assignment2', 'In Progress96', 'Review'])
  })

  it('reads waiting by the week, and names a multi-round site', async () => {
    await draw()
    const row = (code) => screen.getByText(code).closest('tr')
    await screen.findByText('YZD-1')
    expect(within(row('YZD-1')).getByText('7 days')).toHaveClass('pill-dim')
    expect(within(row('YZD-2')).getByText('15 days')).toHaveClass('pill-red')
    expect(within(row('YZD-2')).getByText('3 rounds')).toHaveClass('pill', 'pill-dim')
    expect(screen.getByText('2 sites ready')).toBeInTheDocument()
  })

  it('assigns from the dock, naming the contractor', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { assigned: 1 } })
    await draw()
    await screen.findByText('YZD-1')
    await user.click(within(screen.getByText('YZD-1').closest('tr')).getByRole('checkbox'))
    await user.click(screen.getByRole('radio', { name: /آریا موج/ }))
    await user.click(screen.getByRole('button', { name: 'Assign drive test to آریا موج' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/work-items/assign', {
        work_item_ids: [1], contractor_id: 5, assignment_type: 'official',
      }),
    )
  })
})
