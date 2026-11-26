// Admin › Sign-in page (UEP-26): Save and Discard wait for a change, the email
// and the notice window are checked, the preview follows the typing, and a
// save shows the confirmation and the new "Last saved".
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('../../api/client', () => ({ default: api }))

const auth = vi.hoisted(() => ({ user: { id: 1, full_name: 'Mina Rahimi', role: { name: 'Admin' } } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess(auth) }))

const SignInSettingsPage = (await import('./SignInSettingsPage')).default

const ROW = {
  support_name: 'UEP support desk',
  support_hours: 'Saturday to Wednesday',
  support_email: 'support@uep.example',
  support_phone: 'Extension 2140',
  notice_enabled: false,
  notice_text: null,
  notice_from: null,
  notice_to: null,
  updated_by: 1,
  updated_by_name: 'Mina Rahimi',
  updated_at: '2026-11-20T09:00:00+00:00',
}

async function renderPage() {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <SignInSettingsPage />
    </MemoryRouter>,
  )
  await screen.findByDisplayValue('UEP support desk')
  return user
}

const saveButton = () => screen.getByRole('button', { name: /Save changes/ })
const discardButton = () => screen.getByRole('button', { name: 'Discard changes' })
const preview = () => screen.getByRole('region', { name: 'Preview' })

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: ROW })
  api.put.mockReset().mockImplementation((url, body) =>
    Promise.resolve({ data: { ...ROW, ...body, updated_at: '2026-11-26T09:00:00+00:00' } }),
  )
})

describe('Admin › Sign-in page', () => {
  it('shows who saved last, and keeps Save and Discard disabled until something changes', async () => {
    const user = await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Sign-in page' })).toBeInTheDocument()
    expect(screen.getByText('Last saved by Mina Rahimi on 20 Nov 2026')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()

    await user.type(screen.getByLabelText('Phone or extension'), '1')
    expect(saveButton()).toBeEnabled()
    await user.click(discardButton())
    expect(screen.getByLabelText('Phone or extension')).toHaveValue('Extension 2140')
    expect(saveButton()).toBeDisabled()
  })

  it('updates the preview as the Admin types, notice on top when switched on', async () => {
    const user = await renderPage()
    const phone = screen.getByLabelText('Phone or extension')
    await user.clear(phone)
    await user.type(phone, 'Extension 9999')
    expect(within(preview()).getByText('Extension 9999')).toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: 'Show on the sign-in page' }))
    await user.type(screen.getByLabelText('Message'), 'Offline on Friday')
    expect(within(preview()).getByText('Offline on Friday')).toBeInTheDocument()
  })

  it('checks the email and the notice window before saving', async () => {
    const user = await renderPage()
    const email = screen.getByLabelText('Email')
    await user.clear(email)
    await user.type(email, 'name@company')
    await user.type(screen.getByLabelText('Show from (Tehran time)'), '2026-12-01T10:00')
    await user.type(screen.getByLabelText('Hide after (Tehran time)'), '2026-12-01T09:00')
    await user.click(saveButton())
    expect(screen.getByText('Enter an email like name@company.com.')).toBeInTheDocument()
    expect(screen.getByText('Hide after must be later than Show from.')).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('requires the message when the notice is switched on', async () => {
    const user = await renderPage()
    await user.click(screen.getByRole('switch', { name: 'Show on the sign-in page' }))
    await user.click(saveButton())
    expect(screen.getByText('Enter the message to show on the sign-in page.')).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saves, confirms, and updates "Last saved"', async () => {
    const user = await renderPage()
    const phone = screen.getByLabelText('Phone or extension')
    await user.clear(phone)
    await user.type(phone, 'Extension 3000')
    await user.click(saveButton())
    expect(api.put).toHaveBeenCalledWith('/admin/signin-settings', expect.objectContaining({
      support_phone: 'Extension 3000', notice_enabled: false,
    }))
    expect(await screen.findByText('Saved. The sign-in page shows the new details now.')).toBeInTheDocument()
    expect(screen.getByText('Last saved by Mina Rahimi on 26 Nov 2026')).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  it("shows the server's sentence when a save is refused", async () => {
    api.put.mockRejectedValue({ response: { status: 422, data: { detail: 'Email can be at most 254 characters.' } } })
    const user = await renderPage()
    await user.type(screen.getByLabelText('Team or person'), '!')
    await user.click(saveButton())
    expect(await screen.findByText('Email can be at most 254 characters.')).toBeInTheDocument()
  })
})
