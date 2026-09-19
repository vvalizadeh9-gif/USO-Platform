// What the sidebar offers each role.
//
// The interesting property is not which links appear — the role lists say
// that — but that a section heading never appears over nothing. Admin sees no
// Drive Test Project item at all, and a category owner sees one screen in the
// whole platform, so an unguarded heading would give both of them a label
// pointing at empty space.
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const HC_QUEUE_COUNTS = {
  pool: 3, in_progress: 5, hc_review: 2, remediation: 4,
  reroutes: 1, dt_assignment: 6, dt_in_progress: 7, dt_review: 2,
}
const MY_DT_COUNTS = { todo: 4, submitted: 2 }

const mockApi = vi.hoisted(() => ({
  get: vi.fn((url) => {
    if (url === '/hc/queues/counts') return Promise.resolve({ data: HC_QUEUE_COUNTS })
    if (url === '/drive-tests/my/counts') return Promise.resolve({ data: MY_DT_COUNTS })
    return Promise.resolve({ data: { counters: [] } })
  }),
}))
vi.mock('../api/client', () => ({ default: mockApi }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const Layout = (await import('./Layout')).default

async function sidebarAs(roleName) {
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
  await act(async () => {})
}

/** The nav links under a heading, in order, or null if the heading is absent. */
function itemsUnder(label) {
  const heading = screen.queryByText(label)
  if (!heading) return null
  const names = []
  for (let el = heading.nextElementSibling; el; el = el.nextElementSibling) {
    if (el.classList.contains('nav-section-label')) break
    // The label span, not the whole link -- a badge, when one is shown, is a
    // second span inside the same link and must not be read as part of the name.
    names.push(el.querySelector('span').textContent.trim())
  }
  return names
}

describe('the Drive Test Project section', () => {
  it('shows a PM the whole project in the order the work happens', async () => {
    await sidebarAs('PM')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a Coordinator the same four screens', async () => {
    await sidebarAs('Coordinator')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a contractor only their own three screens', async () => {
    await sidebarAs('Contractor')
    expect(itemsUnder('Drive Test Project')).toEqual([
      'Monthly Plan',
      'My Health Check',
      'My Drive Tests',
    ])
  })

  it('does not offer a contractor the Drive Test work screen', async () => {
    await sidebarAs('Contractor')
    expect(screen.queryByText('Drive Test')).toBeNull()
  })
})

describe('a heading is never shown over nothing', () => {
  it.each(['Admin', 'CpgPower', 'NwgPlanning'])(
    '%s sees no empty Drive Test Project heading',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(screen.queryByText('Drive Test Project')).toBeNull()
    },
  )

  it('leaves a category owner with the ungrouped items and nothing else', async () => {
    await sidebarAs('CpgPower')
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
  it('is an ungrouped item, not part of the project section', async () => {
    await sidebarAs('CpgPower')
    expect(itemsUnder('Operations')).toContain('My Fix Queue')
  })
})

describe('sidebar badges sum the tab counts they cover (D2-D4)', () => {
  // A sidebar badge that disagrees with the tabs behind it is worse than no
  // badge -- these read the same counts endpoint the tabs themselves use.
  function badgeNear(label) {
    const link = screen.getByText(label).closest('a')
    return link.querySelector('.badge')?.textContent
  }

  it('shows a PM Health Check = pool + hc_review + reroutes (In Progress and Remediation excluded)', async () => {
    await sidebarAs('PM')
    expect(badgeNear('Health Check')).toBe(
      String(HC_QUEUE_COUNTS.pool + HC_QUEUE_COUNTS.hc_review + HC_QUEUE_COUNTS.reroutes),
    )
  })

  it('shows a PM Drive Test = dt_assignment + dt_review (In Progress excluded)', async () => {
    await sidebarAs('PM')
    expect(badgeNear('Drive Test')).toBe(
      String(HC_QUEUE_COUNTS.dt_assignment + HC_QUEUE_COUNTS.dt_review),
    )
  })

  it("shows a contractor's My Drive Tests badge as their To do count", async () => {
    await sidebarAs('Contractor')
    expect(badgeNear('My Drive Tests')).toBe(String(MY_DT_COUNTS.todo))
  })

  it('shows no badge on My Health Check, which has no count endpoint', async () => {
    await sidebarAs('Contractor')
    expect(badgeNear('My Health Check')).toBeUndefined()
  })
})
