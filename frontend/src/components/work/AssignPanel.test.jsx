import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const api = (await import('../../api/client')).default
const AssignPanel = (await import('./AssignPanel')).default
const { WorkProvider } = await import('./WorkContext')

const LOAD = [
  { contractor_id: 1, name: 'پارس تل', open: 7, late: 1, avg_submit_days: 2, provinces: [{ province: 'تهران', share: 0.6 }] },
  { contractor_id: 2, name: 'رعد', open: 2, late: 0, avg_submit_days: null, provinces: [] },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: LOAD })
})

async function draw(props = {}) {
  const onAssign = vi.fn().mockResolvedValue()
  render(
    <WorkProvider>
      <AssignPanel process="hc" selectedCount={0} villageCount={0} selectedProvinces={[]} onClear={vi.fn()} onAssign={onAssign} busy={false} {...props} />
    </WorkProvider>,
  )
  await act(async () => {})
  return onAssign
}

describe('the assign bar', () => {
  it('draws contractors as a radio group and keeps Assign disabled with no sites', async () => {
    await draw()
    expect(screen.getByRole('radiogroup', { name: 'Contractor' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /^Assign 0 sites/ })).toBeDisabled()
  })

  it('never assigns on a card click; the button does', async () => {
    const user = userEvent.setup()
    const onAssign = await draw({ selectedCount: 3, villageCount: 5, selectedProvinces: ['اصفهان'] })
    await user.click(screen.getByRole('radio', { name: /رعد/ }))
    expect(onAssign).not.toHaveBeenCalled()
    const go = screen.getByRole('button', { name: 'Assign 3 sites · 5 villages' })
    expect(go).toBeEnabled()
    await user.click(go)
    expect(onAssign).toHaveBeenCalledWith(expect.objectContaining({ contractor_id: 2 }))
  })

  it('puts the previous contractor first and pre-selects it for a re-check', async () => {
    await draw({ selectedCount: 1, villageCount: 1, selectedProvinces: ['اصفهان'], previousContractorId: 1 })
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveTextContent('پارس تل')
    expect(radios[0]).toHaveTextContent('Previous contractor')
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  })
})
