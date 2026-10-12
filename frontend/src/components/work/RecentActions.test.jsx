import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const api = (await import('../../api/client')).default
const RecentActions = (await import('./RecentActions')).default
const { WorkProvider } = await import('./WorkContext')
const { clearActionLog, logAction, markAction } = await import('../../lib/actionLog')

beforeEach(() => {
  vi.clearAllMocks()
  clearActionLog()
})
afterEach(() => vi.useRealTimers())

const draw = () =>
  render(
    <WorkProvider>
      <RecentActions panelProps={{}} />
    </WorkProvider>,
  )

describe('History', () => {
  it('lists recorded actions with a countdown, then says when it is too late', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
    logAction({ label: '✓ 2 sites assigned to رعد.', undoUrl: '/hc/assignments/4/undo' })
    draw()
    expect(screen.getByText('✓ 2 sites assigned to رعد.')).toBeInTheDocument()
    expect(screen.getByText('120 s left')).toBeInTheDocument()
    await act(async () => {
      vi.setSystemTime(new Date('2026-10-12T10:01:30Z'))
      vi.advanceTimersByTime(1000)
    })
    // 10:01:31 against a window ending 10:02:00.
    expect(screen.getByText('29 s left')).toBeInTheDocument()
    await act(async () => {
      vi.setSystemTime(new Date('2026-10-12T10:02:01Z'))
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('Can no longer be undone')).toBeInTheDocument()
  })

  it('undoes through the endpoint and marks the row Undone', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { status: 'ok' } })
    logAction({ label: 'x', undoUrl: '/hc/results/confirm/9/undo' })
    draw()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(api.post).toHaveBeenCalledWith('/hc/results/confirm/9/undo')
    expect(await screen.findByText('Undone')).toBeInTheDocument()
  })

  it('says Undone for an action already undone', () => {
    markAction(logAction({ label: 'y', undoUrl: '/u' }), 'undone')
    draw()
    expect(screen.getByText('Undone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull()
  })
})
