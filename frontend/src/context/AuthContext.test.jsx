// The boot path, which is the one place a frontend bug takes the whole
// application down rather than one screen.
//
// AuthProvider reads uep_user from localStorage before anything renders. An
// unparseable value used to throw there, and because the login screen is
// behind the same render the user got a blank page with no way back except
// clearing site data by hand -- which nothing on the page could tell them to
// do, because there was no page.
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

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
