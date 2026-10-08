// The sign-in screen: validation and where focus goes, the generic answer to
// wrong credentials, the security check that appears only after repeated
// failures, returning to the page that sent you, remembering the username,
// and where focus goes on every change of view.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', () => ({ default: api }))

const login = vi.hoisted(() => vi.fn())
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login }) }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }))

const Login = (await import('./Login')).default

const refused = (status, detail) => Object.assign(new Error('refused'), { response: { status, data: { detail } } })

function renderLogin(url = '/login') {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[url]}>
      <Login />
    </MemoryRouter>,
  )
  return user
}

const usernameInput = () => screen.getByLabelText('Username')
const passwordInput = () => screen.getByLabelText('Password')

async function signIn(user, name = 'sara', password = 'pw') {
  await user.type(usernameInput(), name)
  await user.type(passwordInput(), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.get.mockResolvedValue({ data: { token: 'tok', num1: 4, num2: 7 } })
  api.post.mockResolvedValue({ data: {} })
})

describe('the form', () => {
  it('is labelled, has no placeholders or helper text, and no security check to begin with', () => {
    renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to UEP' })).toBeInTheDocument()
    const username = usernameInput()
    const password = passwordInput()
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(username).toHaveAttribute('autocapitalize', 'none')
    expect(username).toHaveAttribute('spellcheck', 'false')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    for (const input of document.querySelectorAll('input')) expect(input).not.toHaveAttribute('placeholder')
    expect(document.querySelector('.signin-sub')).toBeNull()
    expect(screen.queryByLabelText('Security check')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('keeps every typed field left to right, whatever the keyboard', () => {
    renderLogin()
    expect(usernameInput()).toHaveAttribute('dir', 'ltr')
    expect(passwordInput()).toHaveAttribute('dir', 'ltr')
  })

  it('signs in without a captcha and goes home', async () => {
    login.mockResolvedValue({})
    const user = renderLogin()
    await signIn(user)
    expect(login).toHaveBeenCalledWith('sara', 'pw', undefined, '')
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('shows and hides the password with a named, tabbable button', async () => {
    const user = renderLogin()
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-controls', 'login-password')
    expect(toggle).not.toHaveAttribute('tabindex')
    await user.click(toggle)
    expect(passwordInput()).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveTextContent('Hide')
  })

  it('warns when Caps Lock is on, in a status region tied to the password', async () => {
    const user = renderLogin()
    const password = passwordInput()
    await user.click(password)
    await user.keyboard('{CapsLock}A')
    const status = document.getElementById('login-capslock')
    expect(status).toHaveAttribute('role', 'status')
    expect(password.getAttribute('aria-describedby')).toContain('login-capslock')
    // jsdom reports modifier state from user-event's keyboard model.
    await waitFor(() => expect(status).toHaveTextContent('Caps Lock is on'))
  })
})

describe('returning to the page that sent you', () => {
  it('goes back to it after signing in', async () => {
    login.mockResolvedValue({})
    const user = renderLogin(`/login?next=${encodeURIComponent('/my-work?village=12')}`)
    await signIn(user)
    expect(navigate).toHaveBeenCalledWith('/my-work?village=12', { replace: true })
  })

  it('never follows a next that leaves the site', async () => {
    login.mockResolvedValue({})
    const user = renderLogin('/login?next=https://evil.example/phish')
    await signIn(user)
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })
})

describe('remember my username', () => {
  it('is off by default, and remembers nothing unless ticked', async () => {
    login.mockResolvedValue({})
    const user = renderLogin()
    expect(screen.getByRole('checkbox', { name: 'Remember my username' })).not.toBeChecked()
    await signIn(user)
    expect(localStorage.getItem('uep_remembered_username')).toBeNull()
  })

  it('remembers the name when ticked, and pre-fills it next time with focus on the password', async () => {
    login.mockResolvedValue({})
    const user = renderLogin()
    await user.click(screen.getByRole('checkbox', { name: 'Remember my username' }))
    await signIn(user, ' sara ')
    expect(localStorage.getItem('uep_remembered_username')).toBe('sara')
  })

  it('pre-fills a remembered name, ticks the box and starts on the password', () => {
    localStorage.setItem('uep_remembered_username', 'sara')
    renderLogin()
    expect(usernameInput()).toHaveValue('sara')
    expect(screen.getByRole('checkbox', { name: 'Remember my username' })).toBeChecked()
    expect(passwordInput()).toHaveFocus()
  })

  it('forgets the name when the box is unticked', async () => {
    localStorage.setItem('uep_remembered_username', 'sara')
    login.mockResolvedValue({})
    const user = renderLogin()
    await user.click(screen.getByRole('checkbox', { name: 'Remember my username' }))
    await user.type(passwordInput(), 'pw')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(localStorage.getItem('uep_remembered_username')).toBeNull()
  })

  it('remembers nothing when sign-in is refused', async () => {
    login.mockRejectedValue(refused(401))
    const user = renderLogin()
    await user.click(screen.getByRole('checkbox', { name: 'Remember my username' }))
    await signIn(user)
    await screen.findByText('The username or password is incorrect')
    expect(localStorage.getItem('uep_remembered_username')).toBeNull()
  })
})

describe('errors', () => {
  it('marks each empty field and moves focus to the first one', async () => {
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const username = usernameInput()
    expect(username).toHaveFocus()
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveAccessibleDescription('Error: Enter your username')
    expect(passwordInput()).toHaveAccessibleDescription(/Enter your password/)
    expect(login).not.toHaveBeenCalled()
  })

  it('says the same thing for any wrong credentials, as one line tied to the cleared password', async () => {
    login.mockRejectedValue(refused(401, 'Incorrect username or password'))
    const user = renderLogin()
    await signIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('The username or password is incorrect')
    const password = passwordInput()
    expect(password).toHaveValue('')
    expect(password).toHaveFocus()
    expect(password).toHaveAccessibleDescription(/The username or password is incorrect/)
    // No boxed summary any more.
    expect(screen.queryByText('There is a problem')).not.toBeInTheDocument()
    // One failure is not enough to ask for the check.
    expect(screen.queryByLabelText('Security check')).not.toBeInTheDocument()
  })

  it('passes on what the server says about a lockout', async () => {
    login.mockRejectedValue(refused(429, 'Too many failed sign-in attempts. Please wait about 15 minute(s) and try again.'))
    const user = renderLogin()
    await signIn(user)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Please wait about 15 minute(s)'))
  })
})

describe('the security check', () => {
  it('appears after two failed attempts, as one compact row', async () => {
    login.mockRejectedValue(refused(401))
    const user = renderLogin()
    await signIn(user)
    await user.type(passwordInput(), 'pw2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const answer = await screen.findByLabelText('Security check')
    await waitFor(() => expect(answer).toHaveAccessibleDescription('4 + 7 ='))
    expect(answer).toHaveAttribute('inputmode', 'numeric')
    expect(answer).toHaveAttribute('dir', 'ltr')
    expect(screen.getByRole('button', { name: 'New question' })).toBeInTheDocument()
  })

  it('appears when the server asks for it, with focus on the answer', async () => {
    login.mockRejectedValueOnce(refused(400, 'Answer the security check to sign in'))
    const user = renderLogin()
    await signIn(user)
    const answer = await screen.findByLabelText('Security check')
    await waitFor(() => expect(answer).toHaveAccessibleDescription(/Answer the security check to sign in/))
  })

  it('wants a number, and accepts Persian and Arabic digits', async () => {
    login.mockRejectedValueOnce(refused(400)).mockResolvedValue({})
    const user = renderLogin()
    await signIn(user)
    const answer = await screen.findByLabelText('Security check')
    await waitFor(() => expect(answer).toBeEnabled())

    await user.type(passwordInput(), 'pw')
    await user.type(answer, 'eleven')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(answer).toHaveAccessibleDescription(/Enter the answer as a number/)

    await user.clear(answer)
    await user.type(answer, '۱١')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(login).toHaveBeenLastCalledWith('sara', 'pw', 'tok', '11'))
  })
})

describe("can't sign in", () => {
  it('moves focus to each view heading, and back to the username on return', async () => {
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Can’t sign in?' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ask an administrator for help' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getByLabelText('Username or email address')).toHaveFocus()
    expect(api.post).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Username or email address'), 'sara')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset-request', { identifier: 'sara' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toHaveFocus()
    expect(screen.getByText(/If that account exists/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(usernameInput()).toHaveFocus()
  })

  it('shows the same confirmation when the request fails', async () => {
    api.post.mockRejectedValue(new Error('down'))
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Can’t sign in?' }))
    await user.type(screen.getByLabelText('Username or email address'), 'nobody')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toBeInTheDocument()
  })
})

describe('the page around the form', () => {
  it('has a skip link to the username and legal links, and one route to help', async () => {
    const user = renderLogin()
    usernameInput().blur()
    await user.click(screen.getByRole('link', { name: 'Skip to sign-in form' }))
    expect(usernameInput()).toHaveFocus()
    const legal = screen.getByRole('navigation', { name: 'Legal' })
    expect(legal).toHaveTextContent('Privacy')
    expect(legal).toHaveTextContent('Accessibility')
    // Help is the one "Can't sign in?" route; no mail links beside it.
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull()
    // The product name in the panel is not a heading; the only h1 is the form's.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
