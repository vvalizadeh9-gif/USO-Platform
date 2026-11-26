// The sign-in page (UEP-26): username first with no server call, the
// password step, remembered usernames and "Not you?", the lockout countdown
// from Retry-After, the help panel with the Admin contact, notices, and
// always landing on the landing page.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', () => ({ default: api }))

const login = vi.hoisted(() => vi.fn())
vi.mock('../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ login }) }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }))

const Login = (await import('./Login')).default

const SUPPORT = {
  name: 'UEP support desk',
  hours: 'Saturday to Wednesday, 8:00 to 16:00',
  email: 'support@uep.example',
  phone: 'Extension 2140',
}

function settingsAre(data) {
  api.get.mockImplementation((url) =>
    url === '/auth/signin-settings' ? Promise.resolve({ data }) : Promise.reject(new Error(`unexpected ${url}`)),
  )
}

const refused = (status, { detail, headers = {} } = {}) =>
  Object.assign(new Error('refused'), { response: { status, data: { detail }, headers } })

function renderLogin(url = '/login', userOptions) {
  const user = userEvent.setup(userOptions)
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <Login />
    </MemoryRouter>,
  )
  return { user, ...view }
}

const usernameInput = () => screen.getByLabelText('Username')
const passwordInput = () => screen.getByLabelText('Password')
const continueButton = () => screen.getByRole('button', { name: /^Continue/ })
const signInButton = () => screen.getByRole('button', { name: /^(Sign in|Signing in…|Signed in|Try again in)/ })

async function toPasswordStep(user, name = 'sara') {
  await user.type(usernameInput(), name)
  await user.click(continueButton())
}

/** Type on real timers, then submit on fake ones: from the click on, the
 * clock moves only when the test moves it, however slow the machine. */
async function signInOnFakeClock(user) {
  await toPasswordStep(user)
  await user.type(passwordInput(), 'pw')
  vi.useFakeTimers()
  fireEvent.click(signInButton())
  // Let the mocked request settle.
  await act(async () => {})
}

async function signIn(user, name = 'sara', password = 'pw') {
  await toPasswordStep(user, name)
  await user.type(passwordInput(), password)
  await user.click(signInButton())
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.uepMotion
  login.mockReset().mockResolvedValue({ username: 'sara' })
  navigate.mockReset()
  api.post.mockReset()
  api.get.mockReset()
  settingsAre({ support: SUPPORT, notice: null })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the page', () => {
  it('has the approved content: one heading, the big title, no maths question, no legal links', async () => {
    renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('USO Enterprise Platform')).toBeInTheDocument()
    expect(usernameInput()).toHaveAttribute('placeholder', 'name.surname')
    expect(usernameInput()).toHaveAttribute('autocomplete', 'username')
    expect(usernameInput()).toHaveAttribute('autocapitalize', 'none')
    expect(usernameInput()).toHaveAttribute('dir', 'ltr')
    expect(usernameInput()).toHaveFocus()
    expect(screen.queryByLabelText('Security check')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /privacy|terms|help/i })).not.toBeInTheDocument()
    expect(screen.getByText('Authorised use only. Sign-ins are recorded.')).toBeInTheDocument()
    expect(screen.getByText(`© ${new Date().getFullYear()} USO`)).toBeInTheDocument()
  })

  it('hides both sets of waves from assistive technology', () => {
    const { container } = renderLogin()
    expect(container.querySelector('.uep-signin-waves').closest('[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.uep-signin-wave')).toHaveLength(7)
  })
})

describe('step 1: username', () => {
  it('goes to the password step without any network call', async () => {
    const { user } = renderLogin()
    await toPasswordStep(user)
    expect(passwordInput()).toHaveFocus()
    expect(screen.getByText('sara')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
    // The only read is the public settings, made on load.
    expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/auth/signin-settings'])
  })

  it('asks for a username on an empty Continue, and stays on step 1', async () => {
    const { user } = renderLogin()
    await user.click(continueButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your username.')
    expect(usernameInput()).toHaveAttribute('aria-invalid', 'true')
    expect(usernameInput()).toHaveFocus()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('clears the message as soon as the field changes', async () => {
    const { user } = renderLogin()
    await user.click(continueButton())
    await user.type(usernameInput(), 's')
    expect(screen.getByRole('alert')).toHaveTextContent('')
  })
})

describe('remembered username', () => {
  it('opens on the password step with the name shown', () => {
    localStorage.setItem('uep_remembered_username', 'name.surname')
    renderLogin()
    expect(passwordInput()).toHaveFocus()
    expect(screen.getByText('name.surname')).toBeInTheDocument()
    expect(screen.getByText('NS')).toBeInTheDocument()
  })

  it('"Not you?" goes back to step 1 with the username selected', async () => {
    localStorage.setItem('uep_remembered_username', 'name.surname')
    const { user } = renderLogin()
    await user.click(screen.getByRole('button', { name: /Not you\?/ }))
    const input = usernameInput()
    expect(input).toHaveFocus()
    expect(input).toHaveValue('name.surname')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'name.surname'.length])
  })
})

describe('step 2: password', () => {
  it('shows and hides the password, and says which it will do', async () => {
    const { user } = renderLogin()
    await toPasswordStep(user)
    await user.type(passwordInput(), 'secret')
    expect(passwordInput()).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput()).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput()).toHaveAttribute('type', 'password')
  })

  it('asks for a password on an empty submit, without calling the server', async () => {
    const { user } = renderLogin()
    await toPasswordStep(user)
    await user.click(signInButton())
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.')
    expect(login).not.toHaveBeenCalled()
  })

  it('sends the username and password, with no captcha', async () => {
    const { user } = renderLogin()
    await toPasswordStep(user, '  sara  ')
    await user.type(passwordInput(), 'pw{Enter}')
    expect(login).toHaveBeenCalledWith('sara', 'pw')
  })

  it('gives one generic message for wrong credentials and clears the password', async () => {
    login.mockRejectedValue(refused(401))
    const { user } = renderLogin()
    await signIn(user)
    expect(screen.getByRole('alert')).toHaveTextContent('Username or password is incorrect.')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).toHaveFocus()
  })

  it('shows a spinner and "Signing in…", and ignores a second submit', async () => {
    let finish
    login.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { user } = renderLogin()
    await signIn(user)
    const button = signInButton()
    expect(button).toHaveTextContent('Signing in…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.querySelector('.uep-signin-spinner')).not.toBeNull()
    await user.click(button)
    expect(login).toHaveBeenCalledTimes(1)
    await act(async () => finish({ username: 'sara' }))
  })
})

describe('lockout', () => {
  it('counts down from Retry-After, then unlocks', async () => {
    login.mockRejectedValue(refused(429, { headers: { 'retry-after': '90' } }))
    const { user } = renderLogin()
    await signInOnFakeClock(user)

    const box = screen.getByText('Too many attempts').closest('.uep-signin-lock')
    expect(box).toHaveTextContent('Try again in 1:30')
    expect(signInButton()).toHaveTextContent('Try again in 1:30')
    expect(signInButton()).toHaveAttribute('aria-disabled', 'true')
    expect(passwordInput()).toBeDisabled()
    expect(screen.queryByText(/Too many attempts\. Try again in/)).not.toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(box).toHaveTextContent('Try again in 1:29')

    await act(async () => { vi.advanceTimersByTime(89_000) })
    expect(screen.queryByText('Too many attempts')).not.toBeInTheDocument()
    expect(passwordInput()).toBeEnabled()
    expect(signInButton()).toHaveTextContent('Sign in')
  })

  it('does not submit while locked', async () => {
    login.mockRejectedValueOnce(refused(429, { headers: { 'retry-after': '60' } }))
    const { user } = renderLogin()
    await signIn(user)
    await user.click(signInButton())
    expect(login).toHaveBeenCalledTimes(1)
  })
})

describe('help panel', () => {
  it('"Need access?" opens the Admin contact, and Back returns to step 1', async () => {
    const { user } = renderLogin()
    await screen.findByText('Need access?', { exact: false })
    await user.click(screen.getByRole('button', { name: 'Ask your UEP administrator' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ask your UEP administrator' })).toBeInTheDocument()
    for (const value of Object.values(SUPPORT)) expect(await screen.findByText(value)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(usernameInput()).toBeInTheDocument()
  })

  it('"Forgot password?" opens it from step 2, and Back returns to step 2', async () => {
    const { user } = renderLogin()
    await toPasswordStep(user)
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('heading', { name: 'Ask your UEP administrator' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(passwordInput()).toBeInTheDocument()
  })

  it('hides empty rows and renders values as text, never HTML', async () => {
    settingsAre({ support: { name: '<b>Desk</b>', hours: null, email: '', phone: null }, notice: null })
    const { container } = renderLogin('/login?help=1')
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('<b>Desk</b>')).toBeInTheDocument()
    expect(container.querySelector('.uep-signin-contact b b')).toBeNull()
  })

  it('says so when no contact has been set', async () => {
    settingsAre({ support: { name: null, hours: null, email: null, phone: null }, notice: null })
    renderLogin('/login?help=1')
    expect(await screen.findByText('Contact details have not been set yet.')).toBeInTheDocument()
  })
})

describe('notices', () => {
  it('shows the planned update from Admin', async () => {
    settingsAre({ support: SUPPORT, notice: { text: 'UEP is offline on Friday 22:00 to 23:00.' } })
    renderLogin()
    expect(await screen.findByText('UEP is offline on Friday 22:00 to 23:00.')).toBeInTheDocument()
  })

  it('shows "session expired" neutrally when the session ran out, and not otherwise', () => {
    const { unmount } = renderLogin('/login?next=%2Fmy-work&reason=expired')
    expect(screen.getByText('Your session expired. Sign in again.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('')
    unmount()
    renderLogin('/login?next=%2Fmy-work')
    expect(screen.queryByText('Your session expired. Sign in again.')).not.toBeInTheDocument()
  })

  it('still signs in when the settings cannot be read', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    document.documentElement.dataset.uepMotion = 'reduce'
    const { user } = renderLogin()
    await signIn(user)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})

describe('after signing in', () => {
  it('says "Signed in", drops the curtain, then lands on the landing page within 900 ms', async () => {
    const { user, container } = renderLogin()
    await signInOnFakeClock(user)
    expect(signInButton()).toHaveTextContent('Signed in')
    expect(container.querySelector('.uep-signin-curtain')).toHaveTextContent('Opening Home')
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(900) })
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('goes straight there under reduced motion, with no curtain', async () => {
    document.documentElement.dataset.uepMotion = 'reduce'
    const { user, container } = renderLogin()
    await signIn(user)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(container.querySelector('.uep-signin-curtain')).toBeNull()
  })

  it('always lands on the landing page, ignoring any next', async () => {
    document.documentElement.dataset.uepMotion = 'reduce'
    const { user } = renderLogin('/login?next=%2Fmy-work%3Fvillage%3D12')
    await signIn(user)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
  })

  it('remembers the username only when asked to', async () => {
    document.documentElement.dataset.uepMotion = 'reduce'
    const { user } = renderLogin()
    await user.click(screen.getByLabelText('Remember my username'))
    await signIn(user)
    expect(localStorage.getItem('uep_remembered_username')).toBe('sara')
  })

  it('forgets a remembered username when the box is unticked', async () => {
    document.documentElement.dataset.uepMotion = 'reduce'
    localStorage.setItem('uep_remembered_username', 'sara')
    const { user } = renderLogin()
    await user.click(screen.getByRole('button', { name: /Not you\?/ }))
    await user.click(screen.getByLabelText('Remember my username'))
    await user.click(continueButton())
    await user.type(passwordInput(), 'pw')
    await user.click(signInButton())
    expect(localStorage.getItem('uep_remembered_username')).toBeNull()
  })
})
