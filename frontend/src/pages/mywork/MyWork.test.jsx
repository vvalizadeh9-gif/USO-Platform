// My Work, as the far end of a drill-through.
//
// Half of "every number opens the list it counted" lives on the Acceptance
// Dashboard, which builds the link; the other half is here, where the link
// has to become a request. What is asserted is the join: the filters the
// dashboard sends arrive at the villages endpoint unchanged, the reader is
// told what they are looking at, and a figure counted across every bucket is
// not quietly narrowed to this role's usual one.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: { name: 'PM' } } }),
}))

const api = (await import('../../api/client')).default
const MyWork = (await import('./MyWork')).default
const { ToastProvider } = await import('../../context/ToastContext')

const open = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <MyWork />
      </ToastProvider>
    </MemoryRouter>
  )

/** The params of the villages request this page made. */
const asked = async () => {
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith('/acceptance/villages', expect.anything())
  )
  const call = api.get.mock.calls.find(([url]) => url === '/acceptance/villages')
  return call[1].params
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url) => {
    if (url === '/acceptance/villages') return Promise.resolve({ data: { total: 0, rows: [] } })
    if (url === '/acceptance/villages/bucket-counts') {
      return Promise.resolve({
        data: { needs_attention: 0, ready: 0, awaiting_review: 0, closed: 0, total: 0 },
      })
    }
    return Promise.resolve({ data: {} })
  })
})

describe('a drill-through from the dashboard', () => {
  it('passes the verdicts and the province straight through', async () => {
    open('/my-work?ict_verdict=Approved&cra_verdict=NotApproved&province_id=7&province=Kerman&bucket=all')

    const params = await asked()
    expect(params.ict_verdict).toBe('Approved')
    expect(params.cra_verdict).toBe('NotApproved')
    expect(params.province_id).toBe(7)
    // The province *name* is for the reader; the server was given the id.
    expect(params.province).toBeUndefined()
  })

  it('shows every bucket when the figure was counted across every bucket', async () => {
    open('/my-work?ict_verdict=Rejected&bucket=all')

    expect((await asked()).bucket).toBeUndefined()
  })

  it('still lands on a named bucket when one is named', async () => {
    open('/my-work?bucket=needs_attention')

    expect((await asked()).bucket).toBe('needs_attention')
  })

  it('says what is being filtered, in the words the figure used', async () => {
    open('/my-work?ict_verdict=Approved&cra_verdict=NotApproved&province_id=7&province=Kerman&bucket=all')

    await screen.findByText(/Kerman · ICT approved · CRA not approved/)
  })

  it('clears every filter when the chip is dismissed', async () => {
    const user = userEvent.setup()
    open('/my-work?ict_verdict=Rejected&province_id=7&province=Kerman&bucket=all')

    await user.click(await screen.findByTitle('Show every village again'))

    await waitFor(() => {
      const last = api.get.mock.calls.filter(([url]) => url === '/acceptance/villages').at(-1)
      expect(last[1].params.ict_verdict).toBeUndefined()
      expect(last[1].params.province_id).toBeUndefined()
    })
  })

  it('keeps honouring the older awaiting= spelling', async () => {
    open('/my-work?awaiting=ICT')

    const params = await asked()
    expect(params.authority).toBe('ICT')
    expect(params.status).toBe('Pending')
  })
})
