// The panel and the tabs on My Drive Tests: which one opens, that only one
// opens at a time, and that ?tab= drives (and is driven by) the tab row.
//
// The forms themselves (DriveTestSubmitForm / ReturnToCoordinatorForm) are
// already covered by extraction from WorkItemDetail; this page only wires
// them up, so they are replaced with stand-ins that expose a button to fire
// their onSubmit/onReturn callback.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))
vi.mock('../api/client', () => ({ default: mockApi }))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: { name: 'Contractor' } } }),
}))

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('../components/LifecycleStrip', () => ({
  default: () => <nav data-testid="strip" />,
}))

vi.mock('../components/SiteHistoryDrawer', () => ({
  default: () => null,
  SiteCodeButton: ({ siteCode }) => <span>{siteCode}</span>,
}))

vi.mock('../components/DriveTestSubmitForm', () => ({
  default: ({ onSubmit, footer }) => (
    <div data-testid="submit-form">
      <button onClick={() => onSubmit({ execution_date: '2026-01-01' })}>Submit for review</button>
      {footer}
    </div>
  ),
}))

vi.mock('../components/ReturnToCoordinatorForm', () => ({
  default: ({ onSubmit }) => (
    <button onClick={() => onSubmit({ reason: 'Access road is closed' })}>
      Return to coordinator
    </button>
  ),
}))

const MyDriveTests = (await import('./MyDriveTests')).default

const TODO_ROWS = [
  {
    work_item_id: 1, site_code: 'SITE-1', province: 'Kerman',
    status: 'with_contractor', days_since_assigned: 3,
    sent_back_comment: null, active_drive_test_id: null,
  },
  {
    work_item_id: 2, site_code: 'SITE-2', province: 'Kerman',
    status: 'sent_back', days_since_assigned: 9,
    sent_back_comment: 'Route coverage incomplete', active_drive_test_id: 42,
  },
]

const SUBMITTED_ROWS = [
  {
    work_item_id: 3, drive_test_id: 7, site_code: 'SITE-3', province: 'Kerman',
    execution_date: '2026-01-02', submitted_at: '2026-01-03T00:00:00Z',
    days_waiting: 2, evidence_filenames: ['route.pdf'],
  },
]

function mockQueue({ todo = TODO_ROWS, submitted = SUBMITTED_ROWS } = {}) {
  mockApi.get.mockImplementation((url, config) => {
    if (url === '/drive-tests/my/counts') {
      return Promise.resolve({ data: { todo: todo.length, submitted: submitted.length } })
    }
    if (url === '/drive-tests/my/queue') {
      const tab = config?.params?.tab
      return Promise.resolve({ data: tab === 'submitted' ? submitted : todo })
    }
    return Promise.resolve({ data: [] })
  })
}

beforeEach(() => {
  mockApi.get.mockReset()
  mockApi.post.mockReset()
})

async function renderPage(initialPath = '/my-drive-tests') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MyDriveTests />
    </MemoryRouter>,
  )
  await act(async () => {})
}

describe('tab switch', () => {
  it('defaults to To do and fetches it', async () => {
    mockQueue()
    await renderPage()
    expect(screen.getByText('SITE-1')).toBeInTheDocument()
    expect(mockApi.get).toHaveBeenCalledWith(
      '/drive-tests/my/queue', { params: { tab: 'todo' } },
    )
  })

  it('honours ?tab=submitted on load', async () => {
    mockQueue()
    await renderPage('/my-drive-tests?tab=submitted')
    expect(screen.getByText('SITE-3')).toBeInTheDocument()
  })

  it('switches tabs on click and fetches the other queue', async () => {
    mockQueue()
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Submitted/ }))
    expect(screen.getByText('SITE-3')).toBeInTheDocument()
    expect(screen.queryByText('SITE-1')).not.toBeInTheDocument()
  })

  it('closes an open panel when the tab changes', async () => {
    mockQueue()
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Fill in' })[0])
    expect(screen.getByTestId('submit-form')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Submitted/ }))
    expect(screen.queryByTestId('submit-form')).not.toBeInTheDocument()
  })
})

describe('the fill-in panel', () => {
  it('opens for the row that was clicked', async () => {
    mockQueue()
    await renderPage()
    const user = userEvent.setup()
    const rows = screen.getAllByRole('row')
    await user.click(within(rows[2]).getByRole('button', { name: 'Fill in' })) // SITE-2

    const panel = screen.getByTestId('submit-form').closest('.mydt-panel')
    expect(within(panel).getByText('SITE-2')).toBeInTheDocument()
    // The sent-back comment travels with the panel.
    expect(within(panel).getByText('Route coverage incomplete')).toBeInTheDocument()
  })

  it('only shows one panel at a time', async () => {
    mockQueue()
    await renderPage()
    const user = userEvent.setup()
    const buttons = screen.getAllByRole('button', { name: 'Fill in' })
    await user.click(buttons[0])
    await user.click(buttons[1])
    expect(screen.getAllByTestId('submit-form')).toHaveLength(1)
  })

  it('closes on the panel close button', async () => {
    mockQueue()
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Fill in' })[0])
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(screen.queryByTestId('submit-form')).not.toBeInTheDocument()
  })

  it('closes and reloads the lists after a successful submit', async () => {
    mockQueue()
    mockApi.post.mockResolvedValue({ data: { drive_test_id: 99 } })
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Fill in' })[0])
    mockApi.get.mockClear()
    await user.click(screen.getByRole('button', { name: 'Submit for review' }))
    await act(async () => {})

    expect(mockApi.post).toHaveBeenCalledWith(
      '/work-items/1/drive-test', { execution_date: '2026-01-01' },
    )
    expect(screen.queryByTestId('submit-form')).not.toBeInTheDocument()
    expect(mockApi.get).toHaveBeenCalledWith('/drive-tests/my/counts')
    expect(mockApi.get).toHaveBeenCalledWith(
      '/drive-tests/my/queue', { params: { tab: 'todo' } },
    )
  })

  it('closes and reloads the lists after returning to the coordinator', async () => {
    mockQueue()
    mockApi.post.mockResolvedValue({ data: { status: 'ok' } })
    await renderPage()
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Fill in' })[0])
    await user.click(screen.getByRole('button', { name: 'Return to coordinator' }))
    await act(async () => {})

    expect(mockApi.post).toHaveBeenCalledWith(
      '/work-items/1/return-to-coordinator', { reason: 'Access road is closed' },
    )
    expect(screen.queryByTestId('submit-form')).not.toBeInTheDocument()
  })
})

describe('empty states', () => {
  it('says nothing is waiting for a drive test', async () => {
    mockQueue({ todo: [] })
    await renderPage()
    expect(screen.getByText('No sites waiting for a drive test.')).toBeInTheDocument()
  })

  it('says nothing is waiting for review', async () => {
    mockQueue({ submitted: [] })
    await renderPage('/my-drive-tests?tab=submitted')
    expect(screen.getByText('Nothing waiting for review.')).toBeInTheDocument()
  })
})
