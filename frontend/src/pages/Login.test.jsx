// The sign-in screen: validation and the error summary, the generic answer to
// wrong credentials, the security check that appears only after repeated
// failures, and where focus goes on every change of view.
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

function renderLogin() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
  return user
}

async function signIn(user, name = 'sara', password = 'pw') {
  await user.type(screen.getByLabelText('Username'), name)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ data: { token: 'tok', num1: 4, num2: 7 } })
  api.post.mockResolvedValue({ data: {} })
})

describe('the form', () => {
  it('is labelled, has no placeholders, and no security check to begin with', () => {
    renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    const username = screen.getByLabelText('Username')
    const password = screen.getByLabelText('Password')
    expect(username).toHaveAttribute('autocomplete', 'username')
    expect(username).toHaveAttribute('autocapitalize', 'none')
    expect(username).toHaveAttribute('spellcheck', 'false')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
    for (const input of document.querySelectorAll('input')) expect(input).not.toHaveAttribute('placeholder')
    expect(screen.queryByText(/Security check/)).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('signs in without a captcha and goes home', async () => {
    login.mockResolvedValue({})
    const user = renderLogin()
    await signIn(user)
    expect(login).toHaveBeenCalledWith('sara', 'pw', undefined, '')
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('shows and hides the password with a named, tabbable button', async () => {
    const user = renderLogin()
    const password = screen.getByLabelText('Password')
    const toggle = screen.getByRole('button', { name: 'Show password' })
    expect(toggle).toHaveAttribute('aria-controls', 'login-password')
    expect(toggle).not.toHaveAttribute('tabindex')
    await user.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveTextContent('Hide')
  })

  it('warns when Caps Lock is on, in a status region tied to the password', async () => {
    const user = renderLogin()
    const password = screen.getByLabelText('Password')
    await user.click(password)
    await user.keyboard('{CapsLock}A')
    const status = document.getElementById('login-capslock')
    expect(status).toHaveAttribute('role', 'status')
    expect(password.getAttribute('aria-describedby')).toContain('login-capslock')
    // jsdom reports modifier state from user-event's keyboard model.
    await waitFor(() => expect(status).toHaveTextContent('Caps Lock is on'))
  })
})

describe('errors', () => {
  it('lists every problem in a focused summary whose entries move to the field', async () => {
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const summary = screen.getByRole('alert')
    expect(summary).toHaveFocus()
    expect(summary).toHaveTextContent('There is a problem')
    const username = screen.getByLabelText('Username')
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveAccessibleDescription('Error: Enter your username')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(/Enter your password/)
    expect(login).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Enter your password' }))
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })

  it('says the same thing for any wrong credentials, and clears the password', async () => {
    login.mockRejectedValue(refused(401, 'Incorrect username or password'))
    const user = renderLogin()
    await signIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('The username or password is incorrect')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    // One failure is not enough to ask for the check.
    expect(screen.queryByText(/Security check/)).not.toBeInTheDocument()
  })

  it('passes on what the server says about a lockout', async () => {
    login.mockRejectedValue(refused(429, 'Too many failed sign-in attempts. Please wait about 15 minute(s) and try again.'))
    const user = renderLogin()
    await signIn(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed sign-in attempts')
  })
})

describe('the security check', () => {
  it('appears after two failed attempts', async () => {
    login.mockRejectedValue(refused(401))
    const user = renderLogin()
    await signIn(user)
    await user.type(screen.getByLabelText('Password'), 'pw2')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const answer = await screen.findByLabelText('Security check: what is 4 + 7?')
    expect(answer).toHaveAttribute('inputmode', 'numeric')
    expect(answer).toHaveAccessibleDescription(/Shown after repeated failed attempts/)
    expect(screen.getByRole('link', { name: 'Ask an administrator to unlock your account' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^mailto:/),
    )
  })

  it('appears when the server asks for it', async () => {
    login.mockRejectedValueOnce(refused(400, 'Answer the security check to sign in'))
    const user = renderLogin()
    await signIn(user)
    expect(await screen.findByLabelText('Security check: what is 4 + 7?')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Answer the security check to sign in')
  })

  it('wants a number, and accepts Persian and Arabic digits', async () => {
    login.mockRejectedValueOnce(refused(400)).mockResolvedValue({})
    const user = renderLogin()
    await signIn(user)
    const answer = await screen.findByLabelText('Security check: what is 4 + 7?')

    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.type(answer, 'eleven')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the answer as a number')

    await user.clear(answer)
    await user.type(answer, '۱١')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(login).toHaveBeenLastCalledWith('sara', 'pw', 'tok', '11'))
  })
})

describe('forgotten password', () => {
  it('moves focus to each view heading, and back to the username on return', async () => {
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ask for a password reset' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(screen.getByLabelText('Username or email address')).toHaveFocus()
    expect(api.post).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Username or email address'), 'sara')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(api.post).toHaveBeenCalledWith('/auth/password-reset-request', { identifier: 'sara' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toHaveFocus()
    expect(screen.getByText(/If that account exists/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(screen.getByLabelText('Username')).toHaveFocus()
  })

  it('shows the same confirmation when the request fails', async () => {
    api.post.mockRejectedValue(new Error('down'))
    const user = renderLogin()
    await user.click(screen.getByRole('button', { name: 'Forgot your password?' }))
    await user.type(screen.getByLabelText('Username or email address'), 'nobody')
    await user.click(screen.getByRole('button', { name: 'Send request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Request sent' })).toBeInTheDocument()
  })
})

describe('the page around the form', () => {
  it('has a skip link to the username, a support address and legal links', async () => {
    const user = renderLogin()
    screen.getByLabelText('Username').blur()
    await user.click(screen.getByRole('link', { name: 'Skip to sign-in form' }))
    expect(screen.getByLabelText('Username')).toHaveFocus()
    expect(screen.getByRole('link', { name: 'vahid.val@mtnirancell.ir' })).toHaveAttribute(
      'href',
      'mailto:vahid.val@mtnirancell.ir',
    )
    const legal = screen.getByRole('navigation', { name: 'Legal' })
    expect(legal).toHaveTextContent('Privacy notice')
    expect(legal).toHaveTextContent('Accessibility statement')
    // The product name in the panel is not a heading; the only h1 is the form's.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
