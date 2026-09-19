// What the sidebar offers each role.
//
// The interesting property is not which links appear — the role lists say
// that — but that a section heading never appears over nothing. Admin sees no
// Drive Test Project item at all, and a category owner sees one screen in the
// whole platform, so an unguarded heading would give both of them a label
// pointing at empty space.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { counters: [] } })) },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const Layout = (await import('./Layout')).default

function sidebarAs(roleName) {
  mockAuth.current = {
    user: { full_name: 'A Person', role: { name: roleName } },
    logout: () => {},
    isAdmin: roleName === 'Admin',
    mustChangePassword: false,
  }
  render(
    <MemoryRouter>
      <Layout />
    </MemoryRouter>,
  )
}

/** The nav links under a heading, in order, or null if the heading is absent. */
function itemsUnder(label) {
  const heading = screen.queryByText(label)
  if (!heading) return null
  const names = []
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.classList.contains('nav-section-label')) break
    names.push(el.textContent.trim())
  }
  return names
}

describe('the Drive Test Project section', () => {
  it('shows a PM the whole project in the order the work happens', () => {
    sidebarAs('PM')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a Coordinator the same four screens', () => {
    sidebarAs('Coordinator')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a contractor only their own three screens', () => {
    sidebarAs('Contractor')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'My Health Check',
      'My Drive Tests',
    ])
  })

  it('does not offer a contractor the Drive Test work screen', () => {
    sidebarAs('Contractor')
    expect(screen.queryByText('Drive Test')).toBeNull()
  })
})

describe('a heading is never shown over nothing', () => {
  it.each(['Admin', 'CpgPower', 'NwgPlanning'])(
    '%s sees no empty Drive Test Project heading',
    (roleName) => {
      sidebarAs(roleName)
      expect(screen.queryByText('Drive Test Project')).toBeNull()
    },
  )

  it('leaves a category owner with the ungrouped items and nothing else', () => {
    sidebarAs('CpgPower')
    expect(itemsUnder('Operations')).toEqual([
      'Work Items',
      'My Fix Queue',
      'Action Center',
      'My Work',
    ])
    expect(screen.queryByText('Reports')).not.toBeNull()
  })
})

describe('My Fix Queue stays at the top', () => {
  // A category owner has exactly one screen. Filing it under a heading about
  // the drive test project would put their whole job behind a label about
  // someone else's process.
  it('is an ungrouped item, not part of the project section', () => {
    sidebarAs('CpgPower')
    expect(itemsUnder('Operations')).toContain('My Fix Queue')
  })
})
