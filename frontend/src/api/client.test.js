// The API client: what it attaches to every request, and what it does when the
// server says the session is over.
//
// The 401 handler matters more since token_version landed on the backend. A
// token is now invalidated by a password change or a role change, not only by
// expiry, so a session can end mid-use — and this is the code that has to turn
// that into a trip to the login screen rather than a screen full of errors.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Grab the interceptors as they are registered, so they can be exercised
// directly. Testing them through a real request would mean standing up a
// server to assert on a pure function.
const requestHandlers = []
const responseHandlers = []

vi.mock('axios', () => ({
  default: {
    create: () => ({
      interceptors: {
        request: { use: (fn) => requestHandlers.push(fn) },
        response: { use: (ok, err) => responseHandlers.push({ ok, err }) },
      },
    }),
  },
}))

await import('./client')

const attachToken = requestHandlers[0]
const { err: onError } = responseHandlers[0]

beforeEach(() => {
  localStorage.clear()
  // jsdom does not navigate on an href assignment -- it keeps the current URL
  // and warns. Replacing location with a plain object makes the assignment
  // observable, which is the thing being asserted.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '/', pathname: '/' },
  })
})

describe('attaching the token', () => {
  it('sends the stored token as a bearer credential', () => {
    localStorage.setItem('uep_token', 'abc.def.ghi')
    const config = attachToken({ headers: {} })
    expect(config.headers.Authorization).toBe('Bearer abc.def.ghi')
  })

  it('sends no Authorization header when signed out', () => {
    // An empty header would be sent as "Bearer ", which the server would spend
    // a token decode rejecting on every anonymous request.
    const config = attachToken({ headers: {} })
    expect(config.headers.Authorization).toBeUndefined()
  })
})

describe('when the server rejects the session', () => {
  it('clears the stored session on a 401', async () => {
    localStorage.setItem('uep_token', 'stale')
    localStorage.setItem('uep_user', '{"username":"maryam"}')

    await expect(onError({ response: { status: 401 } })).rejects.toBeDefined()

    expect(localStorage.getItem('uep_token')).toBeNull()
    expect(localStorage.getItem('uep_user')).toBeNull()
  })

  it('sends the person to the login screen', async () => {
    localStorage.setItem('uep_token', 'stale')
    await expect(onError({ response: { status: 401 } })).rejects.toBeDefined()
    expect(window.location.href).toContain('/login')
  })

  it('does nothing on a 401 when there was no session to lose', async () => {
    // A failed sign-in is a 401. Redirecting here would bounce the user off
    // the login page they are currently typing into.
    await expect(onError({ response: { status: 401 } })).rejects.toBeDefined()
    expect(window.location.href).not.toContain('/login')
  })

  it('leaves the session alone on any other error', async () => {
    localStorage.setItem('uep_token', 'good')
    for (const status of [400, 403, 404, 422, 429, 500]) {
      await expect(onError({ response: { status } })).rejects.toBeDefined()
    }
    // A 403 is "you may not do this", not "you are not signed in". Clearing
    // the session there would sign people out for clicking the wrong button.
    expect(localStorage.getItem('uep_token')).toBe('good')
    expect(window.location.href).toBe('/')
  })

  it('leaves the session alone when the request never reached the server', async () => {
    localStorage.setItem('uep_token', 'good')
    await expect(onError({ message: 'Network Error' })).rejects.toBeDefined()
    expect(localStorage.getItem('uep_token')).toBe('good')
  })

  it('always rejects, so callers still see the failure', async () => {
    // Swallowing the error here would leave every caller's catch block dead
    // and every form stuck on "saving".
    const original = { response: { status: 500 } }
    await expect(onError(original)).rejects.toBe(original)
  })
})

// The one 403 that is an instruction rather than a refusal.
//
// An account whose password an administrator has reset may call exactly three
// endpoints. Everything else answers 403 with a code — and without this
// handling, the person sees a permission error on every screen in turn, which
// reads as the platform being broken rather than as "choose a new password".
describe('when the account owes a password change', () => {
  const gated = {
    response: {
      status: 403,
      data: {
        detail: {
          code: 'password_change_required',
          message: 'Your password was reset by an administrator.',
        },
      },
    },
  }

  it('sends the person to the change-password screen', async () => {
    localStorage.setItem('uep_token', 'valid')
    await expect(onError(gated)).rejects.toBeDefined()
    expect(window.location.href).toBe('/change-password')
  })

  it('keeps the session, because it is still a valid one', async () => {
    // Clearing it here would sign them out of the only session that can set a
    // new password, and the reset would be unrecoverable without a second one.
    localStorage.setItem('uep_token', 'valid')
    await expect(onError(gated)).rejects.toBeDefined()
    expect(localStorage.getItem('uep_token')).toBe('valid')
  })

  it('does not redirect while already on that screen', async () => {
    // The change-password screen makes its own requests. Redirecting on those
    // would reload the page in a loop, which is worse than the 403.
    window.location.pathname = '/change-password'
    window.location.href = '/change-password'
    await expect(onError(gated)).rejects.toBeDefined()
    expect(window.location.href).toBe('/change-password')
  })

  it('ignores an ordinary 403, which is a refusal and not an instruction', async () => {
    await expect(
      onError({ response: { status: 403, data: { detail: 'You may not do that' } } }),
    ).rejects.toBeDefined()
    expect(window.location.href).toBe('/')
  })
})
