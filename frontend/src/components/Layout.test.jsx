// What the sidebar offers each role.
//
// The interesting property is not which links appear — the role lists say
// that — but that a section heading never appears over nothing, and that
// grouping the sidebar by project moved links without adding or removing one
// for anybody. Admin and the category owners see no Performance or Month-end
// item at all, so an unguarded heading would give them a label pointing at
// empty space.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
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
const BOARD = vi.hoisted(() => ({ totals: { pending: 23, overdue: 5 }, stages: [] }))

const mockApi = vi.hoisted(() => ({
  get: vi.fn((url) => {
    if (url === '/hc/queues/counts') return Promise.resolve({ data: HC_QUEUE_COUNTS })
    if (url === '/drive-tests/my/counts') return Promise.resolve({ data: MY_DT_COUNTS })
    if (url === '/action-center/board') return Promise.resolve({ data: BOARD })
    return Promise.resolve({ data: { counters: [] } })
  }),
}))
vi.mock('../api/client', () => ({ default: mockApi }))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const Layout = (await import('./Layout')).default
const PageFrame = (await import('./PageFrame')).default

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

/** The section headings, in order, as written (the capitals are CSS). */
function headings() {
  return [...document.querySelectorAll('.sidebar .nav-section-label')].map((el) =>
    el.textContent.trim(),
  )
}

/** The nav labels under a heading, in order, or null if the heading is absent. */
function itemsUnder(label) {
  const heading = headings().includes(label)
    ? [...document.querySelectorAll('.sidebar .nav-section-label')].find(
        (el) => el.textContent.trim() === label,
      )
    : null
  if (!heading) return null
  // The label span, not the whole link -- a badge or a step number, when one
  // is shown, is another span inside the same link.
  return [...heading.parentElement.querySelectorAll('a .nav-label')].map((el) =>
    el.textContent.trim(),
  )
}

/** Every sidebar section, heading by heading, with its items. */
function sidebarLayout() {
  return Object.fromEntries(headings().map((h) => [h, itemsUnder(h)]))
}

/** Every URL the sidebar's nav links to. */
function navHrefs() {
  return [...document.querySelectorAll('.sidebar-nav a')]
    .map((a) => a.getAttribute('href'))
    .sort()
}

const SIDEBAR_BY_ROLE = {
  PM: {
    Today: ['Action Center'],
    'Drive Test': ['Dashboard', 'Monthly Plan', 'Health Check', 'Drive Test', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
    Performance: ['Roles Performance', 'Lifecycle Gaps'],
    'Month-end': ['Mojri Tracker'],
  },
  Coordinator: {
    Today: ['Action Center'],
    'Drive Test': ['Dashboard', 'Monthly Plan', 'Health Check', 'Drive Test', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
    Performance: ['Roles Performance', 'Lifecycle Gaps'],
  },
  Contractor: {
    Today: ['Action Center'],
    'Drive Test': ['Dashboard', 'Monthly Plan', 'My Health Check', 'My Drive Tests', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
    Performance: ['Roles Performance', 'Lifecycle Gaps'],
  },
  // No Action Center for Viewer, Regional Manager or Admin, so no "Today".
  Viewer: {
    'Drive Test': ['Dashboard', 'Monthly Plan', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
    // The general manager: Roles Performance and Lifecycle Gaps, read-only.
    Performance: ['Roles Performance', 'Lifecycle Gaps'],
  },
  RegionalManager: {
    'Drive Test': ['Dashboard', 'Monthly Plan', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
    Performance: ['Roles Performance', 'Lifecycle Gaps'],
  },
  Admin: {
    'Drive Test': ['Dashboard'],
    Acceptance: ['Dashboard'],
    Administration: ['Admin Console'],
  },
  CpgPower: {
    Today: ['My Fix Queue', 'Action Center'],
    'Drive Test': ['Dashboard', 'Work Items'],
    Acceptance: ['Dashboard', 'My Work'],
  },
}

// The links each role was offered before the sidebar was grouped by project
// (Operations / Planning / Follow-up), written out from the old lists. The
// regrouping moves links; it must not add or remove one for anybody.
// Since the ticket board, the Action Center is only for the roles that work a
// queue; Viewer, Regional Manager and Admin lost that one link.
const EVERYONE = ['/reports/drive-test', '/reports/acceptance']
const ACTION = ['/action-center']
const WORKERS = [...EVERYONE, '/work-items', '/my-work']
const KPI = ['/reports/kpi', '/reports/gaps']
const STAFF_LIFECYCLE = ['/monthly-plan', '/health-check', '/drive-test']
const LINKS_BEFORE = {
  PM: [...ACTION, ...WORKERS, ...KPI, ...STAFF_LIFECYCLE, '/mojri-tracker'],
  Coordinator: [...ACTION, ...WORKERS, ...KPI, ...STAFF_LIFECYCLE],
  Contractor: [...ACTION, ...WORKERS, ...KPI, '/monthly-plan', '/my-health-check', '/my-drive-tests'],
  // Viewer gained the two Performance pages with Roles Performance.
  Viewer: [...WORKERS, ...KPI, '/monthly-plan'],
  RegionalManager: [...WORKERS, ...KPI, '/monthly-plan'],
  Admin: [...EVERYONE, '/admin'],
  CpgPower: [...ACTION, ...WORKERS, '/my-fix-queue'],
}

describe('the sidebar, grouped by project', () => {
  it.each(Object.keys(SIDEBAR_BY_ROLE))(
    'shows %s these headings, in this order, with these items',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(headings()).toEqual(Object.keys(SIDEBAR_BY_ROLE[roleName]))
      expect(sidebarLayout()).toEqual(SIDEBAR_BY_ROLE[roleName])
    },
  )

  it.each(Object.keys(LINKS_BEFORE))(
    'offers %s exactly the links it offered before the regrouping',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(navHrefs()).toEqual([...LINKS_BEFORE[roleName]].sort())
    },
  )

  it('files My Work under Acceptance', async () => {
    await sidebarAs('PM')
    expect(itemsUnder('Acceptance')).toContain('My Work')
    expect(itemsUnder('Today')).not.toContain('My Work')
  })

  it('has no "Operations", "Planning" or "Follow-up" heading any more', async () => {
    await sidebarAs('PM')
    for (const old of ['Operations', 'Planning', 'Follow-up']) {
      expect(headings()).not.toContain(old)
    }
  })
})

describe('a heading is never shown over nothing', () => {
  it.each(['Admin', 'CpgPower', 'NwgPlanning'])(
    '%s sees no Performance or Month-end heading',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(headings()).not.toContain('Performance')
      expect(headings()).not.toContain('Month-end')
    },
  )

  it.each(['Coordinator', 'Contractor', 'Viewer', 'RegionalManager'])(
    'shows %s no Month-end heading (Mojri Tracker is PM only)',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(headings()).not.toContain('Month-end')
    },
  )
})

describe('My Fix Queue stays at the top', () => {
  // A category owner has exactly one screen. Filing it under a heading about
  // the drive test project would put their whole job behind a label about
  // someone else's process.
  it.each(['CpgPower', 'NwgPlanning', 'HuaweiCleanup'])(
    'is the first item in the sidebar for %s',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(headings()[0]).toBe('Today')
      expect(itemsUnder('Today')[0]).toBe('My Fix Queue')
    },
  )

  it('is not offered to anyone else', async () => {
    await sidebarAs('PM')
    expect(screen.queryByText('My Fix Queue')).toBeNull()
  })
})

describe('the lifecycle step rail', () => {
  /** [number, label] for each step circle, in order. */
  function steps() {
    return [...document.querySelectorAll('.nav-steps a')].map((a) => [
      a.querySelector('.step-num').textContent,
      a.querySelector('.nav-label').textContent,
    ])
  }
  const line = () => document.querySelector('.nav-steps-line')

  it('numbers a PM’s three steps 1, 2, 3', async () => {
    await sidebarAs('PM')
    expect(steps()).toEqual([
      ['1', 'Monthly Plan'],
      ['2', 'Health Check'],
      ['3', 'Drive Test'],
    ])
    expect(line()).not.toBeNull()
  })

  it('numbers a contractor’s own three steps 1, 2, 3', async () => {
    await sidebarAs('Contractor')
    expect(steps()).toEqual([
      ['1', 'Monthly Plan'],
      ['2', 'My Health Check'],
      ['3', 'My Drive Tests'],
    ])
  })

  it('numbers a lone visible step 1 and draws no line', async () => {
    await sidebarAs('Viewer')
    expect(steps()).toEqual([['1', 'Monthly Plan']])
    expect(line()).toBeNull()
  })

  it('draws no rail at all when no step is visible', async () => {
    await sidebarAs('Admin')
    expect(document.querySelector('.nav-steps')).toBeNull()
  })

  it('does not offer a contractor the staff Drive Test screen', async () => {
    await sidebarAs('Contractor')
    expect(document.querySelector('.sidebar-nav a[href="/drive-test"]')).toBeNull()
  })
})

describe('sidebar badges sum the tab counts they cover (D2-D4)', () => {
  // A sidebar badge that disagrees with the tabs behind it is worse than no
  // badge -- these read the same counts endpoint the tabs themselves use.
  // By URL, not by text: "Drive Test" is both a heading and a link now.
  const HREF = {
    'Health Check': '/health-check',
    'Drive Test': '/drive-test',
    'My Drive Tests': '/my-drive-tests',
    'My Health Check': '/my-health-check',
  }
  function badgeNear(label) {
    const link = document.querySelector(`.sidebar-nav a[href="${HREF[label]}"]`)
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

  it("reads the Action Center badge from the board's pending total", async () => {
    await sidebarAs('PM')
    expect(mockApi.get).toHaveBeenCalledWith('/action-center/board')
    const link = document.querySelector('.sidebar-nav a[href="/action-center"]')
    await waitFor(() => expect(link.querySelector('.badge')?.textContent).toBe('23'))
    expect(mockApi.get).not.toHaveBeenCalledWith('/action-center/summary', expect.anything())
  })

  it.each(['Viewer', 'RegionalManager', 'Admin'])(
    'does not ask for a board %s would be refused',
    async (roleName) => {
      await sidebarAs(roleName)
      expect(mockApi.get).not.toHaveBeenCalledWith('/action-center/board')
    },
  )

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

  it('carries the full name and role in a title, for when the card cuts them short', async () => {
    // The sidebar is 224px, so a long name or role ends in an ellipsis; the
    // title is where the whole of it can still be read.
    await renderAs('CpgRolloutPM')
    const button = screen.getByRole('button', { name: /Sara Karimi/ })
    expect(button.querySelector('.who b')).toHaveAttribute('title', 'Sara Karimi')
    expect(button.querySelector('.who small')).toHaveAttribute(
      'title',
      'CPG Rollout Project Manager (On-Site)',
    )
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

// ---------------------------------------------------------------- page mode
//
// The shell never scrolls the browser page. A page that renders PageFrame
// fills the main column; any other page scrolls inside .page-outlet.
describe('the page mode', () => {
  function drawAt(path) {
    mockAuth.current = {
      user: { full_name: 'A Person', role: { name: 'PM' } },
      logout: () => {},
      isAdmin: false,
      mustChangePassword: false,
    }
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/fill" element={<PageFrame bar={<h1>Fill</h1>}>body</PageFrame>} />
            <Route path="/scroll" element={<p>A long page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
  }

  it('scrolls a page that does not ask to fill', async () => {
    const { container } = drawAt('/scroll')
    await act(async () => {})
    expect(container.querySelector('main')).toHaveClass('main-scroll')
    expect(container.querySelector('main .page-outlet')).toHaveTextContent('A long page')
  })

  it('fills the column for a PageFrame page', async () => {
    const { container } = drawAt('/fill')
    await act(async () => {})
    expect(container.querySelector('main')).toHaveClass('main-fill')
    expect(container.querySelector('.page-frame .page-body')).toHaveTextContent('body')
  })
})
