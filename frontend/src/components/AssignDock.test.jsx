// The assignment dock: a radio group of contractor tiles and one action that
// names the pick. The rule worth pinning is that nothing can be assigned
// until there is both a site and a contractor, and that each tile shows the
// work its contractor already holds.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))

const api = (await import('../api/client')).default
const AssignDock = (await import('./AssignDock')).default

const CONTRACTORS = [
  { id: 1, name: 'پیشرو فن' },
  { id: 2, name: 'ارتباط گستر' },
  { id: 3, name: 'پارس تل' },
]

function Harness({ kind = 'hc', selectedCount = 0, onAssign = () => {} }) {
  const [contractorId, setContractorId] = useState('')
  return (
    <AssignDock
      kind={kind}
      selectedCount={selectedCount}
      onClear={() => {}}
      contractors={CONTRACTORS}
      contractorId={contractorId}
      onSelectContractor={setContractorId}
      onAssign={onAssign}
      busy={false}
      actionLabel={kind === 'hc' ? 'Assign health check' : 'Assign drive test'}
      hint="Pick one"
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => {
    if (url === '/hc/queues/in-progress') {
      return Promise.resolve({
        data: [
          { contractor_id: 1, sites_pending: 10, days_outstanding: 20 },
          { contractor_id: 1, sites_pending: 4, days_outstanding: 3 },
          { contractor_id: 2, sites_pending: 2, days_outstanding: 1 },
        ],
      })
    }
    return Promise.resolve({ data: [{ contractor_id: 3 }, { contractor_id: 3 }] })
  })
})

const radio = (name) => screen.getByRole('radio', { name: new RegExp(name) })

describe('AssignDock', () => {
  it('is a radio group of real buttons, one per contractor, none checked at first', () => {
    render(<Harness />)
    const group = screen.getByRole('radiogroup', { name: 'Contractor' })
    const radios = within(group).getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(radios.every((r) => r.tagName === 'BUTTON')).toBe(true)
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    // One tab stop for the group.
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('stays disabled until there is both a site and a contractor', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness selectedCount={0} />)
    expect(screen.getByRole('button', { name: 'Assign health check' })).toBeDisabled()

    await user.click(radio('پیشرو فن'))
    // A contractor alone is not enough.
    expect(screen.getByRole('button', { name: 'Assign health check to پیشرو فن' })).toBeDisabled()

    rerender(<Harness selectedCount={3} />)
    // Harness state survives the rerender; the pick is kept.
    expect(radio('پیشرو فن')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Assign health check to پیشرو فن' })).toBeEnabled()
  })

  it('moves the choice with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Harness selectedCount={1} />)
    await user.click(radio('پیشرو فن'))
    await user.keyboard('{ArrowRight}')
    expect(radio('ارتباط گستر')).toHaveAttribute('aria-checked', 'true')
    expect(radio('ارتباط گستر')).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    // Wraps from the first to the last.
    expect(radio('پارس تل')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Assign health check to پارس تل' })).toBeEnabled()
  })

  it('shows each contractor’s open and late health checks', async () => {
    render(<Harness />)
    await waitFor(() => expect(radio('پیشرو فن')).toHaveTextContent('14 open · 10 late'))
    expect(radio('ارتباط گستر')).toHaveTextContent('2 open · 0 late')
    expect(radio('پارس تل')).toHaveTextContent('0 open · 0 late')
    expect(api.get).toHaveBeenCalledWith('/hc/queues/in-progress')
  })

  it('shows drive tests in progress for the drive-test dock', async () => {
    render(<Harness kind="dt" />)
    await waitFor(() => expect(radio('پارس تل')).toHaveTextContent('2 in progress'))
    expect(api.get).toHaveBeenCalledWith('/hc/queues/dt-in-progress')
  })

  it('assigns on the named button', async () => {
    const user = userEvent.setup()
    const onAssign = vi.fn()
    render(<Harness selectedCount={2} onAssign={onAssign} />)
    await user.click(radio('ارتباط گستر'))
    expect(screen.getByRole('region', { name: 'Assign' })).toHaveTextContent('2 sites selected')
    await user.click(screen.getByRole('button', { name: 'Assign health check to ارتباط گستر' }))
    expect(onAssign).toHaveBeenCalledTimes(1)
  })
})
