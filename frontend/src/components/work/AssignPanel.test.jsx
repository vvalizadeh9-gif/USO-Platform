import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const api = (await import('../../api/client')).default
const AssignPanel = (await import('./AssignPanel')).default
const { WorkProvider, useWork } = await import('./WorkContext')

const LOAD = [
  { contractor_id: 1, name: 'پارس تل', open: 7, late: 1, avg_submit_days: 5.2, provinces: [{ province: 'تهران', share: 0.6 }] },
  { contractor_id: 2, name: 'رعد', open: 2, late: 0, avg_submit_days: null, provinces: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: LOAD })
})

function Confirm() {
  const { confirmAction } = useWork()
  return <button onClick={() => confirmAction({ text: '✓ 2 sites assigned to رعد.', undoUrl: '/x/undo' })}>do</button>
}

async function draw(props = {}) {
  const onAssign = vi.fn().mockResolvedValue()
  render(
    <WorkProvider>
      <Confirm />
      <AssignPanel process="dt" selectedCount={0} selectedProvinces={[]} onClear={vi.fn()} onAssign={onAssign} busyId={null} {...props} />
    </WorkProvider>,
  )
  await act(async () => {})
  return onAssign
}

const cards = () => screen.getAllByRole('button').filter((b) => b.classList.contains('uw-assign-card'))

describe('the assign panel', () => {
  it('reads the drive-test load and orders cards by open load', async () => {
    await draw()
    expect(api.get).toHaveBeenCalledWith('/drive-test/contractors/load')
    expect(cards().map((c) => c.textContent)).toEqual([expect.stringContaining('رعد'), expect.stringContaining('پارس تل')])
  })

  it('is disabled until sites are selected', async () => {
    const user = userEvent.setup()
    const onAssign = await draw()
    expect(screen.getByText('Contractors')).toBeInTheDocument()
    for (const card of cards()) expect(card).toHaveAttribute('aria-disabled', 'true')
    await user.click(cards()[0])
    expect(onAssign).not.toHaveBeenCalled()
  })

  it('suggests the contractor that covers the provinces, and assigns in one click', async () => {
    const user = userEvent.setup()
    const onAssign = await draw({ selectedCount: 2, selectedProvinces: ['تهران', 'تهران'] })
    const [first] = cards()
    expect(first).toHaveClass('is-suggested')
    expect(first).toHaveAccessibleName(
      'Assign 2 sites to پارس تل. 7 with them, 1 late, about 5 days to submit. Suggested: works in تهران',
    )
    expect(screen.getByText(/Suggested: works in/)).toBeInTheDocument()
    await user.click(first)
    expect(onAssign).toHaveBeenCalledWith(LOAD[0])
  })

  it('says Pick a contractor when nobody covers the selection, and hides avg without one', async () => {
    await draw({ selectedCount: 1, selectedProvinces: ['کرمان'] })
    expect(screen.getByText('Pick a contractor')).toBeInTheDocument()
    const raad = cards().find((c) => c.textContent.includes('رعد'))
    expect(within(raad).queryByText(/avg/)).toBeNull()
    expect(cards().find((c) => c.textContent.includes('پارس')).textContent).toContain('avg 5 d')
  })

  it('keeps the confirmation until it is dismissed, and announces it', async () => {
    const user = userEvent.setup()
    await draw()
    await user.click(screen.getByText('do'))
    expect(screen.getByText('✓ 2 sites assigned to رعد.', { selector: '.uw-notice-text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(r))
    })
    expect(screen.getByTestId('work-live')).toHaveTextContent('✓ 2 sites assigned to رعد.')
    await user.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('✓ 2 sites assigned to رعد.', { selector: '.uw-notice-text' })).toBeNull()
  })

  it('undoes through the endpoint the action named', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { status: 'ok' } })
    await draw()
    await user.click(screen.getByText('do'))
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(api.post).toHaveBeenCalledWith('/x/undo')
    expect(await screen.findByText('Undone. The sites are back where they were.', { selector: '.uw-notice-text' })).toBeInTheDocument()
  })
})
