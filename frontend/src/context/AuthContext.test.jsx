// The boot path, which is the one place a frontend bug takes the whole
// application down rather than one screen.
//
// AuthProvider reads uep_user from localStorage before anything renders. An
// unparseable value used to throw there, and because the login screen is
// behind the same render the user got a blank page with no way back except
// clearing site data by hand -- which nothing on the page could tell them to
// do, because there was no page.
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The provider talks to the API on sign-out and on refresh. Both are about
// what it does with the answer, not about the request, so the client is a
// stub here.
const post = vi.hoisted(() => vi.fn())
const get = vi.hoisted(() => vi.fn())
vi.mock('../api/client', () => ({ default: { post, get } }))

const { AuthProvider, useAuth } = await import('./AuthContext')

function Probe() {
  const { user, loading } = useAuth()
  if (loading) return <p>loading</p>
  return <p data-testid="who">{user ? user.username : 'signed out'}</p>
}

function renderApp() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  post.mockReset().mockResolvedValue({ data: { status: 'ok' } })
  get.mockReset().mockResolvedValue({ data: { username: 'maryam' } })
})

describe('restoring a session on load', () => {
  it('restores a stored user', async () => {
    localStorage.setItem('uep_user', JSON.stringify({ username: 'maryam' }))
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('maryam'))
  })

  it('starts signed out when there is nothing stored', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('signed out'))
  })
})

describe('when localStorage cannot be trusted', () => {
  it('renders signed out rather than a blank page for unparseable JSON', async () => {
    localStorage.setItem('uep_user', '{not json at all')
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('signed out'))
  })

  it('clears the bad value so the next load is not stuck on it too', async () => {
    localStorage.setItem('uep_user', '{not json at all')
    localStorage.setItem('uep_token', 'a-stale-token')
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toBeInTheDocument())
    expect(localStorage.getItem('uep_user')).toBeNull()
    // The token goes with it: a session whose user cannot be read is not a
    // session, and leaving the token would send it on every request.
    expect(localStorage.getItem('uep_token')).toBeNull()
  })

  it('survives storage that throws on read', async () => {
    // A browser configured to block site data raises on access rather than
    // returning null. That is a different failure from bad contents, and it
    // used to take the page down the same way.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('signed out'))
  })

  it('survives storage that throws on the cleanup write too', async () => {
    // The recovery path must not itself be the thing that throws.
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{not json')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
    renderApp()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('signed out'))
  })
})

describe('useAuth outside a provider', () => {
  it('fails loudly rather than returning undefined', () => {
    // Silently returning null here would surface as "cannot read property
    // role of null" somewhere far from the actual mistake.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/AuthProvider/)
  })
})

// ---------------------------------------------------------------------------
// Signing out
// ---------------------------------------------------------------------------
function Controls() {
  const { user, logout, refreshUser, mustChangePassword } = useAuth()
  return (
    <div>
      <p data-testid="who">{user ? user.username : 'signed out'}</p>
      <p data-testid="forced">{String(mustChangePassword)}</p>
      <button onClick={logout}>sign out</button>
      <button onClick={refreshUser}>refresh</button>
    </div>
  )
}

function renderControls() {
  return render(
    <AuthProvider>
      <Controls />
    </AuthProvider>,
  )
}

describe('signing out', () => {
  it('tells the server, so the audit log records it', async () => {
    // A session that simply stops being used leaves no trace of when its
    // holder stopped working, and "logout" is one of the events the audit
    // trail is required to carry.
    localStorage.setItem('uep_user', JSON.stringify({ username: 'maryam' }))
    localStorage.setItem('uep_token', 'a-token')
    renderControls()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('maryam'))

    await act(async () => screen.getByText('sign out').click())

    expect(post).toHaveBeenCalledWith('/auth/logout')
    expect(localStorage.getItem('uep_token')).toBeNull()
    expect(localStorage.getItem('uep_user')).toBeNull()
  })

  it('signs out locally even when the server call fails', async () => {
    // The token may already have expired, or the network may be down. Neither
    // is a reason to trap someone in a session they asked to leave.
    post.mockRejectedValue(new Error('Network Error'))
    localStorage.setItem('uep_user', JSON.stringify({ username: 'maryam' }))
    localStorage.setItem('uep_token', 'a-token')
    renderControls()
    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('maryam'))

    await act(async () => screen.getByText('sign out').click())

    await waitFor(() =>
      expect(screen.getByTestId('who')).toHaveTextContent('signed out'))
    expect(localStorage.getItem('uep_token')).toBeNull()
  })
})

describe('the must-change-password flag', () => {
  it('is read off the stored user', () => {
    localStorage.setItem(
      'uep_user',
      JSON.stringify({ username: 'maryam', must_change_password: true }),
    )
    renderControls()
    expect(screen.getByTestId('forced')).toHaveTextContent('true')
  })

  it('clears when the server says the password has been replaced', async () => {
    // Without this the cached copy keeps the interface locked on the
    // change-password screen until the next sign-in, even though the change
    // has already happened.
    localStorage.setItem(
      'uep_user',
      JSON.stringify({ username: 'maryam', must_change_password: true }),
    )
    get.mockResolvedValue({ data: { username: 'maryam', must_change_password: false } })
    renderControls()
    expect(screen.getByTestId('forced')).toHaveTextContent('true')

    await act(async () => screen.getByText('refresh').click())

    await waitFor(() => expect(screen.getByTestId('forced')).toHaveTextContent('false'))
    expect(JSON.parse(localStorage.getItem('uep_user')).must_change_password).toBe(false)
  })

  it('leaves the session alone when the refresh fails', async () => {
    // A failed refresh is not evidence of anything. Signing someone out for it
    // would turn a blip into a sign-in.
    localStorage.setItem('uep_user', JSON.stringify({ username: 'maryam' }))
    get.mockRejectedValue(new Error('Network Error'))
    renderControls()

    await act(async () => screen.getByText('refresh').click())

    expect(screen.getByTestId('who')).toHaveTextContent('maryam')
  })
})
