// My Work, against the same fixtures the layout tests use (e2e/myWorkFixtures.js):
// tabs and counts, labels by role, single and many-village filing, per-side
// validation with errors inside the fields, the review block, Undo, and
// Persian digits shown while Latin digits are sent.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { myWorkList, myWorkSuggestions, myWorkVillage } from '../../../e2e/myWorkFixtures.js'

const role = vi.hoisted(() => ({ name: 'Contractor' }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role } }) }))
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const api = vi.hoisted(() => ({
  fetchList: vi.fn(), fetchRows: vi.fn(), fetchVillage: vi.fn(), fetchSuggestions: vi.fn(),
  resolveCodes: vi.fn(), uploadScan: vi.fn(), fileLetter: vi.fn(), reviewLetter: vi.fn(),
  sendNow: vi.fn(), viewScan: vi.fn(),
}))
vi.mock('./api', () => ({ ...api, LETTERS_PATH: '/acceptance/letters', REVIEW_PATH: '/acceptance/letters/review' }))

const MyWork = (await import('./MyWork')).default
const HOLD = 6000

const view = () => (role.name === 'Contractor' ? 'contractor' : 'staff')
const url = (path, params = {}) => `http://x/api/v1${path}?${new URLSearchParams(params)}`

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchList.mockImplementation(async (params) => myWorkList(url('/acceptance/my-work', params), view()))
  api.fetchRows.mockImplementation(async (ids) => myWorkList(url('/acceptance/my-work', { ids: ids.join(',') }), view()))
  api.fetchVillage.mockImplementation(async (id) => myWorkVillage(url(`/acceptance/villages/${id}`), view()))
  api.fetchSuggestions.mockImplementation(async (id) => myWorkSuggestions(url(`/acceptance/villages/${id}/suggestions`), view()))
  api.uploadScan.mockResolvedValue({ scan_id: 'scan-1', filename: 'letter.pdf' })
  api.fileLetter.mockResolvedValue({ results: [] })
  api.reviewLetter.mockResolvedValue({ results: [] })
})
afterEach(() => vi.useRealTimers())

async function renderAs(name) {
  role.name = name
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const utils = render(<MemoryRouter initialEntries={['/my-work']}><MyWork /></MemoryRouter>)
  await screen.findByRole('region', { name: 'Requested' })
  return { user, ...utils }
}

const card = (authority) => screen.getByRole('article', { name: authority })
const passTheHold = () => act(async () => { vi.advanceTimersByTime(HOLD + 10) })

async function attachScan(user, scope) {
  await user.upload(scope.querySelector('input[type=file]'), new File(['%PDF'], 'letter.pdf', { type: 'application/pdf' }))
  await within(scope).findByText('letter.pdf')
}

describe('tabs, counts and labels', () => {
  it('a contractor sees their tabs, counts and Send buttons', async () => {
    await renderAs('Contractor')
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Your move44', 'New letter needed10', 'Returned10', 'Not filed24', 'With coordinator13'])
    expect(screen.getAllByText(/not approved/)).toHaveLength(2)
    expect(within(card('ICT')).getByRole('button', { name: 'Send ICT' })).toBeInTheDocument()
  })

  it('a coordinator sees To check first and Save buttons', async () => {
    await renderAs('Coordinator')
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('To check13')
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByText(/to check/)).toHaveLength(2)
    expect(within(card('ICT')).getByRole('button', { name: 'Save ICT' })).toBeInTheDocument()
  })
})

describe('filing one village', () => {
  it('validates only the side that was pressed, inside its fields', async () => {
    const { user } = await renderAs('Contractor')
    await user.click(within(card('ICT')).getByRole('button', { name: 'Send ICT' }))
    const ict = card('ICT')
    expect(within(ict).getAllByPlaceholderText('Missing')).toHaveLength(2)
    expect(within(ict).getByRole('button', { name: /Scan missing/ })).toBeInTheDocument()
    expect(within(card('CRA')).queryByPlaceholderText('Missing')).toBeNull()
    expect(api.fileLetter).not.toHaveBeenCalled()
  })

  it('asks for a reason for a rejected technology', async () => {
    const { user } = await renderAs('Contractor')
    const ict = card('ICT')
    await user.click(within(within(ict).getByRole('group', { name: '4G' })).getByRole('button', { name: 'Rejected' }))
    await user.click(within(ict).getByRole('button', { name: 'Send ICT' }))
    expect(within(ict).getByPlaceholderText('Reason missing')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows Persian digits, sends Latin ones, and only after the hold', async () => {
    const { user, container } = await renderAs('Contractor')
    const ict = card('ICT')
    const [number, date] = within(ict).getAllByRole('textbox')
    await user.type(number, '1405/ص/2210')
    await user.type(date, '۱۴۰۵/۰۷/۰۸')
    expect(number).toHaveValue('۱۴۰۵/ص/۲۲۱۰')
    expect(date).toHaveValue('۱۴۰۵/۰۷/۰۸')
    await attachScan(user, ict)
    await user.click(within(ict).getByRole('button', { name: 'Send ICT' }))

    expect(screen.getByRole('status')).toHaveTextContent('Sent ICT for سرآسیاب')
    expect(api.fileLetter).not.toHaveBeenCalled()
    await passTheHold()
    expect(api.fileLetter).toHaveBeenCalledWith(expect.objectContaining({
      authority: 'ICT', letter_number: '1405/ص/2210', letter_date: '1405/07/08', scan_id: 'scan-1',
      items: [{ village_id: 1000, claims: [{ tech: '4G', result: 'approved' }] }],
    }))
    expect(container.querySelector('.mw-toast')).toBeNull()
  })

  it('Undo means nothing is sent, and the form comes back', async () => {
    const { user } = await renderAs('Contractor')
    const ict = card('ICT')
    const [number, date] = within(ict).getAllByRole('textbox')
    await user.type(number, '77')
    await user.type(date, '1405/07/08')
    await attachScan(user, ict)
    await user.click(within(ict).getByRole('button', { name: 'Send ICT' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await passTheHold()
    expect(api.fileLetter).not.toHaveBeenCalled()
    expect(within(card('ICT')).getAllByRole('textbox')[0]).toHaveValue('۷۷')
  })
})

describe('many villages', () => {
  it('ticking two or more makes one letter for every village that can take it', async () => {
    const { user } = await renderAs('Contractor')
    const boxes = screen.getAllByRole('checkbox', { name: /^Tick (?!every)/ })
    await user.click(boxes[0])
    await user.click(boxes[1])
    await user.click(boxes[2])
    expect(await screen.findByRole('table', { name: 'Ticked villages' })).toBeInTheDocument()

    const cra = card('CRA')
    expect(within(cra).getByText('2 of 3 villages')).toBeInTheDocument()
    expect(within(cra).getByText(/Skipped:/)).toHaveTextContent('سرآسیاب (approved)')
    const [number, date] = within(cra).getAllByRole('textbox')
    await user.type(number, '9')
    await user.type(date, '1405/07/08')
    await attachScan(user, cra)
    await user.click(within(cra).getByRole('button', { name: 'Send CRA · 2' }))
    await passTheHold()
    const body = api.fileLetter.mock.calls[0][0]
    expect(body.items.map((i) => i.village_id)).toEqual([1001, 1002])
  })
})

describe('review (coordinator and PM)', () => {
  async function reviewCard() {
    const utils = await renderAs('Coordinator')
    const cra = card('CRA')
    await within(cra).findByRole('button', { name: 'Confirm' })
    return { ...utils, cra }
  }

  it('Confirm decides that one round', async () => {
    const { user, cra } = await reviewCard()
    await user.click(within(cra).getByRole('button', { name: 'Confirm' }))
    await passTheHold()
    expect(api.reviewLetter).toHaveBeenCalledWith({ authority: 'CRA', submission_ids: [10071], decision: 'confirm' })
  })

  it('Confirm all decides every round on the letter', async () => {
    const { user, cra } = await reviewCard()
    await user.click(within(cra).getByRole('button', { name: 'Confirm all 4 on this letter' }))
    await passTheHold()
    expect(api.reviewLetter).toHaveBeenCalledWith({ authority: 'CRA', letter_number: '1405/ر/0994', decision: 'confirm' })
  })

  it('Return needs a reason', async () => {
    const { user, cra } = await reviewCard()
    await user.click(within(cra).getByRole('button', { name: 'Return' }))
    await user.click(within(cra).getByRole('button', { name: 'Return to contractor' }))
    expect(within(cra).getByPlaceholderText('Reason missing')).toBeInTheDocument()
    await user.type(within(cra).getByRole('textbox', { name: 'Why it goes back' }), 'wrong letter number')
    await user.click(within(cra).getByRole('button', { name: 'Return to contractor' }))
    await passTheHold()
    await waitFor(() => expect(api.reviewLetter).toHaveBeenCalledWith({
      authority: 'CRA', submission_ids: [10071], decision: 'return', reason: 'wrong letter number',
    }))
  })
})
