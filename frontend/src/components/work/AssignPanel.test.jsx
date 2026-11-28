import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
let role = 'PM'
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: role } } }) }))
const api = (await import('../../api/client')).default
const AssignPanel = (await import('./AssignPanel')).default
const { WorkProvider } = await import('./WorkContext')
const { ToastProvider } = await import('../../context/ToastContext')

const LOAD = [
  { contractor_id: 1, name: 'پارس تل', open: 7, late: 1, avg_submit_days: 2, provinces: [{ province: 'تهران', share: 0.6 }] },
  { contractor_id: 2, name: 'آریا', open: 2, late: 0, avg_submit_days: null, provinces: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  role = 'PM'
  api.get.mockResolvedValue({ data: LOAD })
})

async function draw(props = {}) {
  const onAssign = vi.fn().mockResolvedValue()
  render(
    <MemoryRouter>
      <ToastProvider>
        <WorkProvider>
          <AssignPanel process="hc" selectedCount={0} villageCount={0} selectedProvinces={[]} onClear={vi.fn()} onAssign={onAssign} busy={false} {...props} />
        </WorkProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
  return onAssign
}

describe('the Contractors column', () => {
  it('lists contractors A to Z with the name and the basket number only', async () => {
    await draw()
    expect(screen.getByRole('radiogroup', { name: 'Contractor' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['آریا, 2 sites in basket', 'پارس تل, 7 sites in basket'])
    expect(radios[1]).toHaveTextContent(/^پارس تل7$/)
    expect(screen.queryByText(/late|overdue|h\/d/)).toBeNull()
    expect(screen.getByText('No sites selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled()
  })

  it('asks for sites first when a contractor is clicked with none selected', async () => {
    const user = userEvent.setup()
    await draw()
    await user.click(screen.getAllByRole('radio')[0])
    expect(await screen.findByText('Select sites first')).toBeInTheDocument()
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('never assigns on a click; the button does, and reads "Assign to <name>"', async () => {
    const user = userEvent.setup()
    const onAssign = await draw({ selectedCount: 3, villageCount: 5, selectedProvinces: ['اصفهان'] })
    expect(screen.getByText('3 sites')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /آریا/ }))
    expect(onAssign).not.toHaveBeenCalled()
    const go = screen.getByRole('button', { name: 'Assign to آریا' })
    expect(go).toBeEnabled()
    await user.click(go)
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ contractor_id: 2 }))
  })

  it('pre-selects the previous contractor for a re-check', async () => {
    await draw({ selectedCount: 1, villageCount: 1, selectedProvinces: ['اصفهان'], previousContractorId: 1 })
    expect(screen.getByRole('radio', { name: /پارس تل/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: 'Assign to پارس تل' })).toBeEnabled()
  })

  it('links to Manage only for users with the contractors feature', async () => {
    await draw()
    expect(screen.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/admin/contractors')
  })

  it('has no Manage link without it', async () => {
    role = 'Coordinator'
    await draw()
    expect(screen.queryByRole('link', { name: 'Manage' })).toBeNull()
  })
})
