// Change password in the sign-in frame (UEP-26): the live checklist with
// cobalt ticks, the forced and voluntary wording, and today's rules and
// messages on submit.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('../api/client', () => ({ default: api }))

const auth = vi.hoisted(() => ({ user: null, refreshUser: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('../context/ToastContext', () => ({ useToast: () => toast }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }))

const ChangePassword = (await import('./ChangePassword')).default

function renderPage({ forced = true } = {}) {
  auth.user = { id: 1, username: 'sara', must_change_password: forced, role: { name: 'PM' } }
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ChangePassword />
    </MemoryRouter>,
  )
  return user
}

const rule = (text) => screen.getByText(text).closest('li')
const save = () => screen.getByRole('button', { name: /Save and continue/ })

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({ data: { status: 'ok' } })
  auth.refreshUser.mockReset().mockResolvedValue({})
  toast.success.mockReset()
  navigate.mockReset()
})

describe('the page', () => {
  it('explains a forced change, and offers no way back', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument()
    expect(screen.getByText('Your password was reset by an administrator.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password you were given')).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
  })

  it('asks for the current password on a voluntary change, with a way back', () => {
    renderPage({ forced: false })
    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
    expect(screen.queryByText('Your password was reset by an administrator.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('shows the band, title and footer of the sign-in frame', () => {
    renderPage()
    expect(screen.getByText('USO Enterprise Platform')).toBeInTheDocument()
    expect(screen.getByText('Authorised use only. Sign-ins are recorded.')).toBeInTheDocument()
  })
})

describe('the checklist', () => {
  it('ticks each rule as it is met', async () => {
    const user = renderPage()
    expect(rule('At least 12 characters')).not.toHaveClass('is-met')
    expect(rule('Both new passwords match')).not.toHaveClass('is-met')

    await user.type(screen.getByLabelText('New password'), 'a-long-passphrase')
    expect(rule('At least 12 characters')).toHaveClass('is-met')
    expect(rule('Both new passwords match')).not.toHaveClass('is-met')

    await user.type(screen.getByLabelText('Repeat new password'), 'a-long-passphrase')
    expect(rule('Both new passwords match')).toHaveClass('is-met')
  })

  it('shows and hides both new fields with one toggle', async () => {
    const user = renderPage()
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Repeat new password')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Password you were given')).toHaveAttribute('type', 'password')
  })
})

describe('saving', () => {
  it('keeps the button enabled and names the problem on submit', async () => {
    const user = renderPage()
    expect(save()).toBeEnabled()
    await user.click(save())
    expect(screen.getByRole('alert')).toHaveTextContent('Enter the password you were given.')

    await user.type(screen.getByLabelText('Password you were given'), 'Temp-Pass-1234')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.click(save())
    expect(screen.getByRole('alert')).toHaveTextContent('That is 5 characters; 12 is the minimum.')

    await user.type(screen.getByLabelText('New password'), '-but-long-now')
    await user.type(screen.getByLabelText('Repeat new password'), 'different-one')
    await user.click(save())
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('saves, refreshes the account and goes to the landing page', async () => {
    const user = renderPage()
    await user.type(screen.getByLabelText('Password you were given'), 'Temp-Pass-1234')
    await user.type(screen.getByLabelText('New password'), 'a-long-passphrase')
    await user.type(screen.getByLabelText('Repeat new password'), 'a-long-passphrase')
    await user.click(save())
    expect(api.post).toHaveBeenCalledWith('/auth/me/password', {
      current_password: 'Temp-Pass-1234', new_password: 'a-long-passphrase',
    })
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(auth.refreshUser).toHaveBeenCalled()
  })

  it("shows the server's sentence when it refuses", async () => {
    api.post.mockRejectedValue({ response: { status: 400, data: { detail: 'Your current password is not correct' } } })
    const user = renderPage()
    await user.type(screen.getByLabelText('Password you were given'), 'wrong-one-123')
    await user.type(screen.getByLabelText('New password'), 'a-long-passphrase')
    await user.type(screen.getByLabelText('Repeat new password'), 'a-long-passphrase')
    await user.click(save())
    expect(await screen.findByText('Your current password is not correct')).toBeInTheDocument()
  })
})
