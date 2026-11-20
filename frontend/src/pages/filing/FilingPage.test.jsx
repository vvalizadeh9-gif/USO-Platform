// Acceptance › Filing (UEP-22 §3.1): the inbox groups, the two status boxes,
// the required comment, a save that moves to the next village, J/K, and the
// empty inbox.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null, reload: vi.fn() }) }))
vi.mock('../../shell/crumbs', () => ({ usePageCrumb: () => {} }))
const api = vi.hoisted(() => ({
  fetchInbox: vi.fn(), fetchCase: vi.fn(), fetchHistory: vi.fn(), fetchCategories: vi.fn(),
  saveUpdate: vi.fn(), uploadScan: vi.fn(), changeBasket: vi.fn(),
}))
vi.mock('./api', () => api)
vi.mock('../mywork/api', () => ({ viewScan: vi.fn() }))

const FilingPage = (await import('./FilingPage')).default

const row = (id, state, extra = {}) => ({
  case_id: id, village_id: id, village_code: `V${id}`, village_name: `روستا ${id}`, site_code: 'S1',
  state, category: state === 'rejected' ? 'CPG Power' : null, basket_key: 'contractor:1',
  basket_owner: state === 'rejected' ? 'CPG Power' : 'Contractor A',
  sub: state === 'rejected' ? 'CPG Power · CPG Power' : `V${id} · Contractor A`,
  days_in_basket: 20 - id, over_sla: 20 - id > 14, stale: id === 2, in_validation: false, ...extra,
})

const CAN = { record_letters: true, comment: true, fix: true, change_basket: true, lands_directly: true, read_only: false }

function inbox(rows = [row(1, 'waiting'), row(2, 'waiting'), row(3, 'rejected')]) {
  const waiting = rows.filter((r) => r.state === 'waiting')
  const rejected = rows.filter((r) => r.state === 'rejected')
  return {
    authority: 'ICT', tab: 'all', shown: rows.length, sla_days: 14, fresh_days: 7, can: CAN,
    counts: { all: rows.length, waiting: waiting.length, rejected: rejected.length, no_comment: 1 },
    groups: [
      { key: 'waiting', label: 'Waiting for ICT · contractors', count: waiting.length, rows: waiting },
      { key: 'rejected', label: 'Rejected · team baskets', count: rejected.length, rows: rejected },
    ],
  }
}

const detail = (id) => ({
  village: { id, code: `V${id}`, name: `روستا ${id}`, site_code: 'S1', work_item_id: 9, province: 'کرمان', tech: '2G', contractor: 'Contractor A' },
  boxes: [
    { case_id: id, authority: 'ICT', state: 'waiting', label: 'Waiting for ICT', days_in_basket: 19, over_sla: true,
      sub: 'Contractor basket · Contractor A', in_validation: false, comment: { stale: true, age_days: null } },
    { case_id: 100 + id, authority: 'CRA', state: 'approved', label: 'Approved', days_in_basket: 0, over_sla: false,
      sub: 'Approved on 18 Sep 2026', in_validation: false, comment: null },
  ],
})

const history = { authority: 'ICT', dt_date: '2026-09-30', dt_legacy: true, days_since_dt: 52, steps: [
  { kind: 'dt', title: 'Imported from CPM', date: '2026-09-30', status_step: true, delta_days: null },
  { kind: 'now', title: 'Now · in Contractor A basket', date: '2026-11-21', status_step: true, delta_days: 19, over_sla: true, state: 'waiting' },
] }

function renderAt(path = '/filing') {
  return render(<MemoryRouter initialEntries={[path]}><FilingPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchInbox.mockResolvedValue(inbox())
  api.fetchCase.mockImplementation((id) => Promise.resolve(detail(id)))
  api.fetchHistory.mockResolvedValue(history)
  api.fetchCategories.mockResolvedValue([{ id: 6, code: 'cpg_power', label: 'CPG Power', basket_role: 'CpgPower' }])
  api.saveUpdate.mockResolvedValue({ applied: [1], in_validation: [] })
})

describe('Filing', () => {
  it('lists the two groups oldest first, with counts and the stale flag', async () => {
    renderAt()
    expect(await screen.findByText('Waiting for ICT · contractors')).toBeInTheDocument()
    expect(screen.getByText('Rejected · team baskets')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /No comment/ })).toHaveTextContent('1')
    expect(screen.getByText(/· no comment/)).toBeInTheDocument()
  })

  it('shows both authorities and switches with the other box', async () => {
    renderAt()
    expect(await screen.findByText('Waiting for ICT')).toBeInTheDocument()
    expect(screen.getByText('No comment yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open CRA' }))
    await waitFor(() => expect(api.fetchInbox).toHaveBeenLastCalledWith(expect.objectContaining({ authority: 'CRA' })))
  })

  it('requires a comment before saving', async () => {
    renderAt()
    const save = await screen.findByRole('button', { name: /Save · next village/ })
    fireEvent.click(save)
    expect(await screen.findByText('A comment is required on every save')).toBeInTheDocument()
    expect(api.saveUpdate).not.toHaveBeenCalled()
  })

  it('saves a comment and moves to the next village', async () => {
    renderAt()
    const box = await screen.findByPlaceholderText('Latest follow-up with ICT')
    await userEvent.type(box, 'Called ICT office')
    fireEvent.click(screen.getByRole('button', { name: /Save · next village/ }))
    await waitFor(() => expect(api.saveUpdate).toHaveBeenCalled())
    expect(api.saveUpdate.mock.calls[0][0]).toMatchObject({
      village_ids: [1], authority: 'ICT', choice: 'waiting', comment: 'Called ICT office',
    })
    expect(toast.success).toHaveBeenCalledWith('Saved · روستا 1', undefined)
    await waitFor(() => expect(api.fetchCase).toHaveBeenLastCalledWith(2, 'ICT'))
  })

  it('asks for a category, the letter and the file on a rejection', async () => {
    renderAt()
    await screen.findByPlaceholderText('Latest follow-up with ICT')
    fireEvent.click(screen.getByRole('radio', { name: /Rejected/ }))
    await userEvent.type(screen.getByPlaceholderText('Why did ICT reject?'), 'Temporary power')
    fireEvent.click(screen.getByRole('button', { name: /Save · next village/ }))
    expect(await screen.findByText('Pick a rejection category')).toBeInTheDocument()
    expect(screen.getByText('Letter number is required')).toBeInTheDocument()
    expect(screen.getByText('Attach the letter')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'CPG Power' }))
    expect(screen.getByText(/Goes to/)).toHaveTextContent('Goes to CPG Power basket')
  })

  it('moves with J and K, but not while typing', async () => {
    renderAt()
    await screen.findByPlaceholderText('Latest follow-up with ICT')
    fireEvent.keyDown(window, { key: 'j' })
    await waitFor(() => expect(api.fetchCase).toHaveBeenLastCalledWith(2, 'ICT'))
    const box = await screen.findByPlaceholderText('Latest follow-up with ICT')
    fireEvent.keyDown(box, { key: 'j' })
    expect(api.fetchCase).toHaveBeenLastCalledWith(2, 'ICT')
  })

  it('titles the card for many ticked villages', async () => {
    renderAt()
    await screen.findByPlaceholderText('Latest follow-up with ICT')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select روستا 1' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select روستا 2' }))
    expect(await screen.findByRole('heading', { name: 'Update 2 villages' })).toBeInTheDocument()
  })

  it('says so when the inbox is empty', async () => {
    api.fetchInbox.mockResolvedValue(inbox([]))
    renderAt()
    expect(await screen.findByText('Nothing waiting in your inbox')).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'ICT inbox' })
    expect(within(list).queryByRole('button', { name: /روستا/ })).toBeNull()
  })
})
