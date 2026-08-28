// Route guards.
//
// These are convenience, not security — every endpoint re-checks the role
// server-side, and the backend audit proved that is where it counts. What they
// decide is whether someone lands on a screen they can use or one that 403s at
// them, and where "/" sends each kind of user.
//
// The category-owner case is the one worth guarding: those four roles can work
// exactly one screen, so sending them anywhere else is a dead end.
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real pages pull in charts, animation and the API client. This is a test
// about routing, so they are replaced with markers naming where we landed.
vi.mock('./components/Layout', () => ({
  default: () => <Outlet />,
}))

const page = (name) => ({ default: () => <p data-testid="page">{name}</p> })
vi.mock('./pages/Login', () => page('login'))
vi.mock('./pages/DriveTestProject', () => page('drive-test'))
vi.mock('./pages/HealthCheck', () => page('health-check'))
vi.mock('./pages/MyHealthCheck', () => page('my-health-check'))
vi.mock('./pages/MyFixQueue', () => page('my-fix-queue'))
vi.mock('./pages/WorkItems', () => page('work-items'))
vi.mock('./pages/WorkItemDetail', () => page('work-item-detail'))
vi.mock('./pages/ActionCenter', () => page('action-center'))
vi.mock('./pages/mywork/MyWork', () => page('my-work'))
vi.mock('./pages/reports/AcceptanceDashboard', () => page('acceptance'))
vi.mock('./pages/Admin', () => page('admin'))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('./context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const App = (await import('./App')).default

function signedInAs(roleName) {
  mockAuth.current = {
    user: { username: 'someone', role: { name: roleName } },
    loading: false,
    isAdmin: roleName === 'Admin',
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
  mockAuth.current = { user: null, loading: false, isAdmin: false }
})

describe('signed out', () => {
  it('sends anything to the login screen', async () => {
    expect(await landOn('/work-items')).toBe('login')
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
  it.each(['CpgPower', 'CpgRolloutPM', 'ManagedService', 'NwgPlanning'])(
    'sends %s to their fix queue, the one screen they work',
    async (role) => {
      signedInAs(role)
      expect(await landOn('/')).toBe('my-fix-queue')
    },
  )

  it('sends everyone else to work items', async () => {
    signedInAs('Coordinator')
    expect(await landOn('/')).toBe('work-items')
  })
})

describe('guarded routes', () => {
  it('keeps a non-owner out of the fix queue', async () => {
    signedInAs('Coordinator')
    // Bounced to "/", which for a coordinator is work items.
    expect(await landOn('/my-fix-queue')).toBe('work-items')
  })

  it('lets a category owner into the fix queue', async () => {
    signedInAs('NwgPlanning')
    expect(await landOn('/my-fix-queue')).toBe('my-fix-queue')
  })

  it('keeps a contractor out of the admin console', async () => {
    signedInAs('Contractor')
    expect(await landOn('/admin')).toBe('work-items')
  })

  it('lets a PM into the admin console, where the backend narrows what they see', async () => {
    signedInAs('PM')
    expect(await landOn('/admin')).toBe('admin')
  })
})

describe('old paths people have bookmarked', () => {
  it.each([
    ['/drive-test', 'drive-test'],
    ['/acceptance', 'my-work'],
    ['/my-acceptance', 'my-work'],
    ['/notifications', 'action-center'],
  ])('%s still answers', async (path, expected) => {
    signedInAs('Coordinator')
    expect(await landOn(path)).toBe(expected)
  })

  it('sends an unknown path home rather than showing nothing', async () => {
    signedInAs('Coordinator')
    expect(await landOn('/no-such-page')).toBe('work-items')
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
