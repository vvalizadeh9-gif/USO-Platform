// Route guards.
//
// These are convenience, not security — every endpoint re-checks the role
// server-side, and the backend audit proved that is where it counts. What they
// decide is whether someone lands on a screen they can use or one that 403s at
// them, and where "/" sends each kind of user.
//
// The category-owner case is the one worth guarding: those four roles can work
// exactly one screen, so sending them anywhere else is a dead end.
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real pages pull in charts, animation and the API client. This is a test
// about routing, so they are replaced with markers naming where we landed.
vi.mock('./shell/AppShell', () => ({
  default: () => <Outlet />,
}))

const page = (name) => ({ default: () => <p data-testid="page">{name}</p> })
// The login marker also shows the query it was reached with, so a test can see
// which page travelled along to be returned to.
vi.mock('./pages/Login', async () => {
  const { useLocation } = await import('react-router-dom')
  function LoginMarker() {
    return (
      <p data-testid="page" data-search={useLocation().search}>
        login
      </p>
    )
  }
  return { default: LoginMarker }
})
vi.mock('./pages/drivetest/DriveTestProject', () => page('dt-dashboard'))
vi.mock('./pages/DriveTest', () => page('drive-test'))
vi.mock('./pages/HealthCheck', () => page('health-check'))
vi.mock('./pages/MyHealthCheck', () => page('my-health-check'))
vi.mock('./pages/MyDriveTests', () => page('my-drive-tests'))
vi.mock('./pages/MyFixQueue', () => page('my-fix-queue'))
// The Explorer markers also show the address they were reached at, so a
// redirect from the old All sites URLs can be checked end to end.
const located = async (name) => {
  const { useLocation } = await import('react-router-dom')
  function Marker() {
    const { pathname, search } = useLocation()
    return <p data-testid="page" data-at={pathname + search}>{name}</p>
  }
  return { default: Marker }
}
vi.mock('./pages/explorer/ExplorerList', () => located('explorer'))
vi.mock('./pages/explorer/SiteRecord', () => located('site-record'))
vi.mock('./pages/Home', () => page('home'))
vi.mock('./pages/mywork/MyWork', () => located('my-work'))
vi.mock('./pages/validation/ValidationPage', () => located('validation'))
vi.mock('./pages/monthlyplan/MonthlyPlan', () => page('monthly-plan'))
vi.mock('./pages/reports/AcceptanceDashboard', () => page('acceptance'))
vi.mock('./pages/reports/rolesPerformance/RolesPerformance.jsx', () => page('kpi'))
vi.mock('./pages/mojri/MojriImport', () => page('mojri'))
vi.mock('./pages/Admin', () => page('admin'))
vi.mock('./pages/ChangePassword', () => page('change-password'))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('./context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const App = (await import('./App')).default

function signedInAs(roleName, { mustChangePassword = false } = {}) {
  mockAuth.current = {
    user: {
      username: 'someone',
      role: { name: roleName },
      must_change_password: mustChangePassword,
    },
    loading: false,
    isAdmin: roleName === 'Admin',
    mustChangePassword,
  }
}

async function landOn(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
  return (await screen.findByTestId('page')).textContent
}

beforeEach(() => {
  mockAuth.current = { user: null, loading: false, isAdmin: false, mustChangePassword: false }
})

describe('signed out', () => {
  it('sends anything to the login screen', async () => {
    expect(await landOn('/explorer')).toBe('login')
  })

  it('carries the page along, so signing in comes back to it', async () => {
    await landOn('/my-work?village=12')
    expect(screen.getByTestId('page')).toHaveAttribute(
      'data-search',
      `?next=${encodeURIComponent('/my-work?village=12')}`,
    )
  })

  it('carries nothing for the home page', async () => {
    await landOn('/')
    expect(screen.getByTestId('page')).toHaveAttribute('data-search', '')
  })
})

describe('where "/" lands', () => {
  it('sends an admin to the admin console', async () => {
    signedInAs('Admin')
    expect(await landOn('/')).toBe('admin')
  })

  // it.each rather than a loop: each case gets its own render and its own
  // cleanup, so the second iteration is not querying a document that still
  // holds the first one's page.
  it.each(['Coordinator', 'PM', 'Contractor', 'CpgPower', 'CpgRolloutPM', 'ManagedService', 'NwgPlanning'])(
    'sends %s to Home, which counts whatever their role owes',
    async (role) => {
      signedInAs(role)
      expect(await landOn('/')).toBe('home')
    },
  )

  // Neither owns queues of their own.
  it('sends a Regional Manager to Roles Performance (My area)', async () => {
    signedInAs('RegionalManager')
    expect(await landOn('/')).toBe('kpi')
  })

  it('sends a Viewer to the Drive Test dashboard', async () => {
    signedInAs('Viewer')
    expect(await landOn('/')).toBe('dt-dashboard')
  })
})

describe('the Home route', () => {
  // A Regional Manager has a Home (the acceptance headline queues) but still
  // lands on Roles Performance; Home is a link away.
  it('opens Home for a Regional Manager who asks for it', async () => {
    signedInAs('RegionalManager')
    expect(await landOn('/home')).toBe('home')
  })

  it.each([
    ['Viewer', 'dt-dashboard'],
    ['Admin', 'admin'],
  ])('sends %s to their own landing instead of a Home they do not have', async (role, home) => {
    signedInAs(role)
    expect(await landOn('/home')).toBe(home)
  })

})

describe('the removed Action Center', () => {
  it.each(['/action-center', '/action-center?view=overdue', '/notifications'])(
    '%s redirects to Home',
    async (path) => {
      signedInAs('PM')
      expect(await landOn(path)).toBe('home')
    },
  )
})

describe('guarded routes', () => {
  it('keeps a non-owner out of the fix queue', async () => {
    signedInAs('Coordinator')
    // Bounced to "/", which for a queue-working role is Home.
    expect(await landOn('/my-fix-queue')).toBe('home')
  })

  it('lets a category owner into the fix queue', async () => {
    signedInAs('NwgPlanning')
    expect(await landOn('/my-fix-queue')).toBe('my-fix-queue')
  })

  // The monthly plan is the one screen Admin is deliberately kept off. Not a
  // permission the interface invents -- deciding a contractor's monthly target
  // is an operational act, and Admin is a systems role (ARCHITECTURE.md).
  it.each(['Contractor', 'PM', 'Coordinator', 'RegionalManager', 'Viewer'])(
    'lets %s onto the monthly plan',
    async (role) => {
      signedInAs(role)
      expect(await landOn('/monthly-plan')).toBe('monthly-plan')
    },
  )

  it('sends an admin away from the monthly plan', async () => {
    signedInAs('Admin')
    // "/" for an admin is the console, which is where they belong.
    expect(await landOn('/monthly-plan')).toBe('admin')
  })

  it('keeps a category owner off it too, as the server does', async () => {
    signedInAs('NwgPlanning')
    expect(await landOn('/monthly-plan')).toBe('home')
  })

  it('keeps a contractor out of the admin console', async () => {
    signedInAs('Contractor')
    expect(await landOn('/admin')).toBe('home')
  })

  it('lets a PM into the admin console, where the backend narrows what they see', async () => {
    signedInAs('PM')
    expect(await landOn('/admin')).toBe('admin')
  })

  // The Mojri reconciliation is the Admin/PM separation again: the import
  // writes operational data, so PM alone reaches it. Admin takes the template
  // from the Admin Console, which is a read, and the server refuses Admin both
  // import endpoints regardless of what the interface offers.
  it('lets a PM onto the Mojri reconciliation', async () => {
    signedInAs('PM')
    expect(await landOn('/mojri-tracker')).toBe('mojri')
  })

  it('sends an admin away from the Mojri import', async () => {
    signedInAs('Admin')
    expect(await landOn('/mojri-tracker')).toBe('admin')
  })

  it.each([
    ['Coordinator', 'home'],
    ['Contractor', 'home'],
    ['RegionalManager', 'kpi'],
    ['Viewer', 'dt-dashboard'],
  ])(
    'keeps %s off the Mojri import',
    async (role, home) => {
      signedInAs(role)
      expect(await landOn('/mojri-tracker')).toBe(home)
    },
  )
})

// The drive test used to be two tabs at the end of the Health Check row, and
// /drive-test used to be a bookmark alias for the dashboard. The work screen
// now owns the plain path; the dashboard keeps its own under Reports, with the
// drill-through a segment deeper.
describe('the drive test paths', () => {
  it.each([
    ['/drive-test', 'drive-test'],
    ['/reports/drive-test', 'dt-dashboard'],
  ])('%s opens the right screen', async (path, expected) => {
    signedInAs('Coordinator')
    expect(await landOn(path)).toBe(expected)
  })
})

describe('old paths people have bookmarked', () => {
  it.each([
    ['/acceptance', 'my-work'],
    ['/my-acceptance', 'my-work'],
  ])('%s still answers', async (path, expected) => {
    signedInAs('Coordinator')
    expect(await landOn(path)).toBe(expected)
  })

  it('sends an unknown path home rather than showing nothing', async () => {
    signedInAs('Coordinator')
    expect(await landOn('/no-such-page')).toBe('home')
  })
})

// UEP-16: Validation and Letters left My Work for their own pages.
describe('acceptance validation routes', () => {
  async function landAt(path) {
    await landOn(path)
    return screen.getByTestId('page').dataset.at
  }

  it.each([
    ['/my-work?tab=filled', '/validation/ict'],
    ['/my-work?tab=all', '/my-work'],
    ['/my-work?tab=all&q=W4318', '/my-work?q=W4318'],
    ['/acceptance', '/my-work'],
    ['/validation', '/validation/ict'],
    ['/validation/xyz', '/validation/ict'],
    ['/validation/cra', '/validation/cra'],
  ])('%s lands on %s', async (path, expected) => {
    signedInAs('Coordinator')
    expect(await landAt(path)).toBe(expected)
  })

  it.each(['Contractor', 'Viewer', 'RegionalManager'])('keeps %s out of validation', async (role) => {
    signedInAs(role)
    expect(await landOn('/validation/ict')).not.toBe('validation')
  })
})

describe('the My Work splat route', () => {
  // One splat rather than two paths is deliberate -- two Route entries
  // pointing at the same component are still two routes to React Router, so
  // selecting a village unmounted and remounted the workspace, silently
  // resetting the chosen bucket and the search box on every click.
  it.each(['/my-work', '/my-work/v/42'])('%s renders the workspace', async (path) => {
    signedInAs('Contractor')
    expect(await landOn(path)).toBe('my-work')
  })

  // React Router 7 changed how a relative `to` resolves inside a splat route
  // (the v7_relativeSplatPath flag in v6). MyWork is unaffected because it
  // navigates by absolute path; that was checked by reading it, not asserted
  // here — a test that regexes a component's source would pass happily the
  // moment someone refactored to navigate(someVariable).
})

// ---------------------------------------------------------------------------
// An account on a password an administrator issued
// ---------------------------------------------------------------------------
//
// The server refuses every endpoint but three for such an account. These
// guards are the interface agreeing with that: without them the person sees a
// permission error on each screen in turn, which reads as a fault rather than
// as an instruction.
describe('when a password reset is outstanding', () => {
  it('sends "/" straight to the change-password screen', async () => {
    signedInAs('Coordinator', { mustChangePassword: true })
    expect(await landOn('/')).toBe('change-password')
  })

  it('sends every other screen there too, whatever the role', async () => {
    for (const [role, path] of [
      ['Admin', '/admin'],
      ['Coordinator', '/explorer'],
      ['NwgPlanning', '/my-fix-queue'],
    ]) {
      signedInAs(role, { mustChangePassword: true })
      expect(await landOn(path), path).toBe('change-password')
      cleanup()
    }
  })

  it('lets them onto the change-password screen itself', async () => {
    // Or there is nowhere to go, and the redirect above is a loop.
    signedInAs('Coordinator', { mustChangePassword: true })
    expect(await landOn('/change-password')).toBe('change-password')
  })

  it('still sends a signed-out visitor to the login screen', async () => {
    expect(await landOn('/change-password')).toBe('login')
  })
})

describe('changing your password when nothing is forcing it', () => {
  it('is reachable by anyone signed in', async () => {
    signedInAs('Contractor')
    expect(await landOn('/change-password')).toBe('change-password')
  })

  it('does not divert anyone who does not owe a change', async () => {
    signedInAs('Coordinator')
    expect(await landOn('/explorer')).toBe('explorer')
  })
})

// UEP-11: All sites became Explorer. The old addresses still land.
describe('Explorer', () => {
  beforeEach(() => signedInAs('Coordinator'))

  it('opens the list and a site record', async () => {
    expect(await landOn('/explorer')).toBe('explorer')
    cleanup()
    expect(await landOn('/explorer/sites/42?village=V10232')).toBe('site-record')
  })

  it('sends /work-items to the list, keeping the query string', async () => {
    expect(await landOn('/work-items?q=W4318&stage=Assigned')).toBe('explorer')
    expect(screen.getByTestId('page')).toHaveAttribute('data-at', '/explorer?q=W4318&stage=Assigned')
  })

  it('sends /work-items/:id to the site record', async () => {
    expect(await landOn('/work-items/42')).toBe('site-record')
    expect(screen.getByTestId('page')).toHaveAttribute('data-at', '/explorer/sites/42')
  })

  it('still opens the Drive Test dashboard at its own address', async () => {
    expect(await landOn('/reports/drive-test')).toBe('dt-dashboard')
  })
})
