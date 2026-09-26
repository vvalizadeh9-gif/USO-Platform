// What the sidebar offers each role.
//
// The interesting property is not which links appear — the role lists say
// that — but that a section heading never appears over nothing. Admin sees no
// Planning item at all, and a category owner sees one screen in the whole
// platform, so an unguarded heading would give both of them a label pointing
// at empty space.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const HC_QUEUE_COUNTS = {
  // pool is every on-air site whose drive test is not Done — a programme
  // quantity. pool_assignable is the slice a PM can raise a check for now,
  // and it is deliberately smaller here so the badge cannot pass by reading
  // the wrong one.
  pool: 3, pool_assignable: 2,
  in_progress: 5, hc_review: 2, remediation: 4,
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

describe('the Planning section', () => {
  // Renamed from "Drive Test Project" (Prompt 2): item-for-item the same
  // group, in the same order, under a new heading among the sidebar's three
  // — Operations / Planning / Follow-up.
  it('shows a PM the whole project in the order the work happens', async () => {
    await sidebarAs('PM')
    expect(itemsUnder('Planning')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a Coordinator the same four screens', async () => {
    await sidebarAs('Coordinator')
    expect(itemsUnder('Planning')).toEqual([
      'Monthly Plan',
      'Health Check',
      'Drive Test',
    ])
  })

  it('shows a contractor only their own three screens', async () => {
    await sidebarAs('Contractor')
    expect(itemsUnder('Planning')).toEqual([
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
    '%s sees no empty Planning heading',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(screen.queryByText('Planning')).toBeNull()
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
    expect(screen.queryByText('Follow-up')).not.toBeNull()
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

  it('shows a PM Health Check = assignable pool + hc_review + reroutes (In Progress and Remediation excluded)', async () => {
    await sidebarAs('PM')
    expect(badgeNear('Health Check')).toBe(
      String(
        HC_QUEUE_COUNTS.pool_assignable +
          HC_QUEUE_COUNTS.hc_review +
          HC_QUEUE_COUNTS.reroutes,
      ),
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

describe('when the badges are re-read', () => {
  // Counting a queue is the most expensive read the sidebar makes. It used to
  // happen on every page change, which put it in front of every click.
  const countCalls = () =>
    mockApi.get.mock.calls.filter(([url]) => url === '/hc/queues/counts').length

  beforeEach(() => mockApi.get.mockClear())

  it('asks for the Action Center counters without the item feed', async () => {
    await sidebarAs('PM')
    expect(mockApi.get).toHaveBeenCalledWith(
      '/action-center/summary',
      { params: { items: false } },
    )
  })

  it('does not re-read them on navigation', async () => {
    mockAuth.current = {
      user: { full_name: 'A Person', role: { name: 'PM' } },
      logout: () => {},
      isAdmin: false,
      mustChangePassword: false,
    }
    render(
      <MemoryRouter initialEntries={['/work-items']}>
        <Layout />
        <Link to="/health-check">go</Link>
      </MemoryRouter>,
    )
    await act(async () => {})
    const before = countCalls()

    await act(async () => { screen.getByText('go').click() })

    expect(countCalls()).toBe(before)
  })

  it('re-reads them after a write', async () => {
    vi.useFakeTimers()
    try {
      await sidebarAs('PM')
      const before = countCalls()

      await act(async () => {
        window.dispatchEvent(new Event('uep:data-changed'))
        window.dispatchEvent(new Event('uep:data-changed'))
        vi.advanceTimersByTime(300)
      })

      // Twice announced, once read: a burst of writes is answered once.
      expect(countCalls()).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the account menu at the foot of the sidebar', () => {
  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>
  }

  async function renderAs(roleName, { mustChangePassword = false } = {}) {
    const logout = vi.fn()
    mockAuth.current = {
      user: { full_name: 'Sara Karimi', role: { name: roleName } },
      logout,
      isAdmin: roleName === 'Admin',
      mustChangePassword,
    }
    render(
      <MemoryRouter initialEntries={['/work-items']}>
        <Layout />
        <Where />
        <Link to="/health-check">elsewhere</Link>
        <p>outside</p>
      </MemoryRouter>,
    )
    await act(async () => {})
    return logout
  }

  const accountButton = () => screen.getByRole('button', { name: /Sara Karimi/ })

  it('has no "Your account" section and no Change password link in the nav', async () => {
    await renderAs('PM')
    expect(screen.queryByText('Your account')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Change password' })).toBeNull()
  })

  it('is a real menu button showing the name and the role in full', async () => {
    await renderAs('PM')
    const button = accountButton()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveTextContent('Project Manager')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens with Change password and Log out', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    expect(accountButton()).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual(['Change password', 'Log out'])
  })

  it('closes on a second click', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    fireEvent.click(accountButton())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and gives focus back to the button', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(accountButton()).toHaveFocus()
  })

  it('closes on a click outside it', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when the page changes', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    await act(async () => { screen.getByText('elsewhere').click() })
    expect(screen.getByTestId('where')).toHaveTextContent('/health-check')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('takes Change password to /change-password', async () => {
    await renderAs('PM')
    fireEvent.click(accountButton())
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Change password' }))
    })
    expect(screen.getByTestId('where')).toHaveTextContent('/change-password')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('calls logout from Log out', async () => {
    const logout = await renderAs('PM')
    fireEvent.click(accountButton())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('keeps the "Set a new password" link while a new password is owed', async () => {
    const logout = await renderAs('PM', { mustChangePassword: true })
    const link = screen.getByRole('link', { name: 'Set a new password' })
    expect(link).toHaveAttribute('href', '/change-password')
    expect(screen.queryByRole('button', { name: /Sara Karimi/ })).toBeNull()
    fireEvent.click(screen.getByTitle('Sign out'))
    expect(logout).toHaveBeenCalledTimes(1)
  })
})
