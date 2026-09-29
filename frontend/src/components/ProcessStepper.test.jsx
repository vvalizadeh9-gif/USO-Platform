// The compact process stepper in the PageBar: the same three steps and the
// same link rule as LifecycleStrip, with the current one marked.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const ProcessStepper = (await import('./ProcessStepper')).default

function stepperAs(roleName, current) {
  mockAuth.current = { user: { role: { name: roleName } } }
  render(
    <MemoryRouter>
      <ProcessStepper current={current} />
    </MemoryRouter>,
  )
}

describe('ProcessStepper', () => {
  it('numbers the three steps and marks the current one', () => {
    stepperAs('PM', 'hc')
    const current = screen.getByText('Health Check').closest('[aria-current="step"]')
    expect(current).toHaveClass('is-current')
    expect(current).toHaveTextContent('2')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('links the other steps a PM can open', () => {
    stepperAs('PM', 'hc')
    expect(screen.getByText('Monthly Plan').closest('a')).toHaveAttribute('href', '/monthly-plan')
    expect(screen.getByText('Drive Test').closest('a')).toHaveAttribute('href', '/drive-test')
    expect(screen.getByText('Health Check').closest('a')).toBeNull()
  })

  it('keeps a step this person cannot open as plain text', () => {
    // Admin's sidebar offers no Monthly Plan.
    stepperAs('Admin', 'dt')
    expect(screen.getByText('Monthly Plan').closest('a')).toBeNull()
    expect(screen.getByText('Monthly Plan').closest('.stepper-step')).toHaveClass('is-muted')
  })
})
