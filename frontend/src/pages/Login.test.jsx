// The sign-in page: validation, the password toggle, what each refusal says,
// the security check after repeated failures, the session-expired notice,
// returning to the page that sent you, and remembering the username.
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

const refused = (status, { detail, headers = {} } = {}) =>
  Object.assign(new Error('refused'), { response: { status, data: { detail }, headers } })

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
const submit = () => screen.getByRole('button', { name: 'Sign in' })
const alertText = () => screen.getByRole('alert').textContent

async function signIn(user, name = 'sara', password = 'pw') {
  await user.type(usernameInput(), name)
  await user.type(passwordInput(), password)
  await user.click(submit())
}

beforeEach(() => {
  localStorage.clear()
  login.mockReset().mockResolvedValue({ username: 'sara' })
  navigate.mockReset()
  api.get.mockReset().mockResolvedValue({ data: { token: 'tok', num1: 4, num2: 7 } })
})

describe('the page', () => {
  it('has the approved content and nothing about SSO', () => {
    renderLogin()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Enter your UEP username and password.')).toBeInTheDocument()
    expect(usernameInput()).toHaveAttribute('placeholder', 'v.valizadeh')
    expect(usernameInput()).toHaveAttribute('autocomplete', 'username')
    expect(passwordInput()).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: 'Contact your UEP administrator' })).toHaveAttribute('href', '/request-access')
    for (const word of ['USO', 'Enterprise', 'Platform']) expect(screen.getByText(word)).toBeInTheDocument()
    expect(screen.queryByText(/organization/i)).not.toBeInTheDocument()
  })

  it('hides the waves from assistive technology', () => {
    const { container } = render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    )
    expect(container.querySelector('.uep-signin-waves')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('.uep-signin-wave')).toHaveLength(4)
  })
})

describe('validation', () => {
  it('asks for both fields on an empty submit, without calling the server', async () => {
    const user = renderLogin()
    await user.click(submit())
    expect(alertText()).toBe('Enter your username and password.')
    expect(usernameInput()).toHaveAttribute('aria-invalid', 'true')
    expect(usernameInput()).toHaveFocus()
    expect(login).not.toHaveBeenCalled()
  })

  it('clears the message as soon as either field changes', async () => {
    const user = renderLogin()
    await user.click(submit())
    await user.type(passwordInput(), 'x')
    expect(alertText()).toBe('')
  })

  it('submits with the Enter key', async () => {
    const user = renderLogin()
    await user.type(usernameInput(), 'sara')
    await user.type(passwordInput(), 'pw{Enter}')
    expect(login).toHaveBeenCalledWith('sara', 'pw', undefined, '')
  })
})

describe('the password toggle', () => {
  it('shows and hides the password, and says which it will do', async () => {
    const user = renderLogin()
    await user.type(passwordInput(), 'secret')
    expect(passwordInput()).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput()).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput()).toHaveAttribute('type', 'password')
  })
})

describe('refusals', () => {
  it('gives one generic message for wrong credentials and clears the password', async () => {
    login.mockRejectedValue(refused(401))
    const user = renderLogin()
    await signIn(user)
    expect(alertText()).toBe('Username or password is incorrect.')
    expect(passwordInput()).toHaveValue('')
    expect(passwordInput()).toHaveFocus()
  })

  it('says how long a lockout lasts', async () => {
    login.mockRejectedValue(refused(429, { headers: { 'retry-after': '900' } }))
    const user = renderLogin()
    await signIn(user)
    expect(alertText()).toBe('Too many attempts. Try again in 15 minutes.')
  })

  it('shows the security check after two wrong passwords', async () => {
    login.mockRejectedValue(refused(401))
    const user = renderLogin()
    await signIn(user)
    expect(screen.queryByLabelText('Security check')).not.toBeInTheDocument()
    await user.type(passwordInput(), 'again')
    await user.click(submit())
    expect(await screen.findByText('4 + 7 =')).toBeInTheDocument()
  })

  it('shows the security check when the server asks for it', async () => {
    login.mockRejectedValue(refused(400))
    const user = renderLogin()
    await signIn(user)
    expect(await screen.findByText('Answer the security check to sign in.')).toBeInTheDocument()
    expect(screen.getByLabelText('Security check')).toBeInTheDocument()
  })
})

describe('while signing in', () => {
  it('shows a spinner in place of the icon, keeps the label, and ignores a second submit', async () => {
    let finish
    login.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const user = renderLogin()
    await signIn(user)

    expect(submit()).toHaveAttribute('aria-disabled', 'true')
    expect(submit().querySelector('.uep-signin-spinner')).not.toBeNull()
    expect(submit().querySelector('[data-icon="login"]')).toBeNull()

    await user.click(submit())
    expect(login).toHaveBeenCalledTimes(1)
    finish({ username: 'sara' })
    await waitFor(() => expect(navigate).toHaveBeenCalled())
  })
})

describe('after signing in', () => {
  it('goes to Home', async () => {
    const user = renderLogin()
    await signIn(user)
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('returns to the page that sent them here', async () => {
    const user = renderLogin('/login?next=%2Fmy-work%3Fvillage%3D12')
    await signIn(user)
    expect(navigate).toHaveBeenCalledWith('/my-work?village=12', { replace: true })
  })

  it('never follows a next that leaves the site', async () => {
    const user = renderLogin('/login?next=https%3A%2F%2Fevil.example')
    await signIn(user)
    expect(navigate).toHaveBeenCalledWith('/', { replace: true })
  })

  it('remembers the username only when asked to', async () => {
    const user = renderLogin()
    await user.click(screen.getByLabelText('Remember my username'))
    await signIn(user)
    expect(localStorage.getItem('uep_remembered_username')).toBe('sara')
  })
})

describe('the session-expired notice', () => {
  it('is shown, neutrally, when the session ran out', () => {
    renderLogin('/login?next=%2Fmy-work&reason=expired')
    expect(screen.getByText('Your session expired. Sign in again.')).toBeInTheDocument()
    expect(alertText()).toBe('')
  })

  it('is not shown otherwise', () => {
    renderLogin('/login?next=%2Fmy-work')
    expect(screen.queryByText('Your session expired. Sign in again.')).not.toBeInTheDocument()
  })
})
