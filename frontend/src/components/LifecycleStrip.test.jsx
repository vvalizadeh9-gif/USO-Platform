// The strip's one rule worth asserting: a step is a link only when this
// person could actually open it.
//
// It reads the sidebar's own lists, so the failure it guards against is a
// contractor being shown a link to Health Check or Drive Test — two screens
// their sidebar does not offer and whose endpoints answer 403. The step still
// has to be visible, though: the process has three parts whoever is reading.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const LifecycleStrip = (await import('./LifecycleStrip')).default

function stripAs(roleName, current = 'hc', variant) {
  mockAuth.current = { user: { role: { name: roleName } } }
  render(
    <MemoryRouter>
      <LifecycleStrip current={current} variant={variant} />
    </MemoryRouter>,
  )
}

/** The <a> for a step, or null when it was rendered as plain text. */
const linkFor = (label) => screen.getByText(label).closest('a')

describe('steps this person can open', () => {
  it('gives a PM all three as links', () => {
    stripAs('PM', 'dt')
    expect(linkFor('Monthly Plan')).toHaveAttribute('href', '/monthly-plan')
    expect(linkFor('Health Check')).toHaveAttribute('href', '/health-check')
  })

  it('gives a Coordinator the same', () => {
    stripAs('Coordinator', 'dt')
    expect(linkFor('Monthly Plan')).toHaveAttribute('href', '/monthly-plan')
    expect(linkFor('Health Check')).toHaveAttribute('href', '/health-check')
  })
})

describe('steps this person cannot open', () => {
  it('shows a contractor Health Check and Drive Test as plain text', () => {
    stripAs('Contractor', 'plan')
    expect(linkFor('Health Check')).toBeNull()
    expect(linkFor('Drive Test')).toBeNull()
  })

  it('still shows them, because the process has three parts either way', () => {
    stripAs('Contractor', 'plan')
    expect(screen.getByText('Health Check')).toBeInTheDocument()
    expect(screen.getByText('Drive Test')).toBeInTheDocument()
  })

  it('shows a category owner every step as plain text', () => {
    stripAs('CpgPower', 'hc')
    expect(linkFor('Monthly Plan')).toBeNull()
    expect(linkFor('Drive Test')).toBeNull()
  })
})

describe('the contractor variant', () => {
  it("gives a contractor their own three screens as links, not the staff ones", () => {
    stripAs('Contractor', 'plan', 'contractor')
    expect(linkFor('My Health Check')).toHaveAttribute('href', '/my-health-check')
    expect(linkFor('My Drive Tests')).toHaveAttribute('href', '/my-drive-tests')
    // The staff labels are not on this variant at all.
    expect(screen.queryByText('Health Check')).toBeNull()
    expect(screen.queryByText('Drive Test')).toBeNull()
  })

  it('marks My Drive Tests as current rather than linking it', () => {
    stripAs('Contractor', 'dt', 'contractor')
    expect(screen.getByText('My Drive Tests').closest('[aria-current]')).not.toBeNull()
    expect(linkFor('My Drive Tests')).toBeNull()
  })

  it('does not offer a staff role the contractor screens as links', () => {
    stripAs('PM', 'plan', 'contractor')
    expect(linkFor('My Health Check')).toBeNull()
    expect(linkFor('My Drive Tests')).toBeNull()
  })

  it('defaults to the staff variant when none is given', () => {
    stripAs('PM', 'dt')
    expect(screen.getByText('Drive Test')).toBeInTheDocument()
    expect(screen.queryByText('My Drive Tests')).toBeNull()
  })
})

describe('the step you are on', () => {
  it('is marked as the current page and is not a link', () => {
    stripAs('PM', 'hc')
    const step = screen.getByText('Health Check').closest('[aria-current]')
    expect(step).toHaveAttribute('aria-current', 'page')
    expect(linkFor('Health Check')).toBeNull()
  })

  it('marks the drive test instead when that is the page', () => {
    stripAs('PM', 'dt')
    expect(screen.getByText('Drive Test').closest('[aria-current]')).not.toBeNull()
    expect(screen.getByText('Health Check').closest('[aria-current]')).toBeNull()
  })
})
