// ICT / CRA validation (UEP-16 §8): the view switch and its memory, selection
// (row click, X, select-all mixed), return reasons, Undo, shortcuts ignored
// while typing, and the viewer's tabs per file kind.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allState } from './FilingTable'
import { missingReasons } from './ReturnPanel'
import { readView } from './useValidation'

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: { name: 'Coordinator' } } }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../context/ToastContext', () => ({ useToast: () => toast }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null }) }))

const api = vi.hoisted(() => ({
  fetchValidation: vi.fn(), fetchGroup: vi.fn(), reviewFilings: vi.fn(), fetchEmail: vi.fn(),
  downloadEvidence: vi.fn(), downloadAttachment: vi.fn(), downloadLetterZip: vi.fn(),
}))
vi.mock('./api', () => ({
  ...api,
  REVIEW_PATH: '/acceptance/letters/review',
  evidenceUrl: (id) => `/api/v1/acceptance/my-work/evidence/${id}`,
  attachmentUrl: (id, i) => `/api/v1/acceptance/my-work/evidence/${id}/email/attachments/${i}`,
}))
vi.mock('../mywork/api', () => ({ sendNow: vi.fn(), REVIEW_PATH: '/acceptance/letters/review' }))

const ValidationPage = (await import('./ValidationPage')).default
const HOLD = 6000

const filing = (id, authority, extra = {}) => ({
  submission_id: id, authority, version: 0, village_id: id, village_code: `V-${id}`, village_name: 'روستا',
  site_id: 1, site_code: 'TB-4471', letter_number: authority === 'ICT' ? '1405/3290' : 'CRA-77',
  letter_date: '2026-10-14', letter_date_shamsi: '1405/07/22', requested_techs: ['3G', '4G'],
  claims: [{ tech: '3G', result: 'approved' }, { tech: '4G', result: 'approved' }],
  missing_techs: [], has_rejection: false, has_evidence: true, waiting_days: 1, late: false, ...extra,
})

const letter = (authority, evidence) => ({
  authority, letter_number: authority === 'ICT' ? '1405/3290' : 'CRA-77', letter_date: '2026-10-14',
  letter_date_shamsi: '1405/07/22', villages: 2, without_evidence: 0, evidence,
  duplicate_use: { villages: authority === 'ICT' ? 3 : 0, contractors: 1 },
})

const ICT_FILES = [
  { id: 11, filename: 'letter.pdf', kind: 'pdf', size_bytes: 2048 },
  { id: 12, filename: 'mail.eml', kind: 'email', size_bytes: 900 },
]

function listFor(group) {
  return {
    authority: 'ICT', group, sla_days: 2, next_cursor: null, contractors: [{ id: 3, name: 'پیشرو فن' }],
    provinces: [], regions: [],
    counts: { waiting: 3, late: 0, filtered: 3, letter: 1, site: 1, has_rejection: 1 },
    groups: [{
      key: group === 'letter' ? '1405/3290' : '1', kind: group, label: group === 'letter' ? '1405/3290' : 'TB-4471',
      contractor: { id: 3, name: 'پیشرو فن' }, province: 'کرمان', letter_date: '2026-10-14',
      letter_date_shamsi: '1405/07/22', waiting_days: 1, late: false, villages: 3, rejected: 1, letters: 1,
      other_waiting: group === 'site' ? 1 : 0,
    }],
  }
}

function groupFor(group) {
  const ict = [
    filing(101, 'ICT', { has_rejection: true, claims: [{ tech: '3G', result: 'approved' }, { tech: '4G', result: 'rejected' }] }),
    filing(102, 'ICT', { missing_techs: ['4G'], claims: [{ tech: '3G', result: 'approved' }] }),
    filing(103, 'ICT'),
  ]
  return {
    authority: 'ICT', sla_days: 2,
    group: listFor(group).groups[0],
    filings: ict,
    other: group === 'site' ? { authority: 'CRA', sla_days: 2, filings: [filing(201, 'CRA')] } : null,
    letters: group === 'site'
      ? [letter('ICT', ICT_FILES), letter('CRA', [{ id: 21, filename: 'scan.png', kind: 'image', size_bytes: 10 }])]
      : [letter('ICT', ICT_FILES)],
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  window.localStorage.clear()
  for (const fn of [...Object.values(api), ...Object.values(toast)]) fn.mockReset()
  api.fetchValidation.mockImplementation(async (params) => listFor(params.group))
  api.fetchGroup.mockImplementation(async (group) => groupFor(group))
  api.reviewFilings.mockResolvedValue({ results: [] })
  api.fetchEmail.mockResolvedValue({
    from: 'ICT <ict@example.org>', to: 'co@example.org', cc: null, date: '2026-10-14T10:00:00+03:30',
    subject: 'Acceptance', text_body: 'Approved for 3G', attachments: [],
  })
})
afterEach(() => vi.useRealTimers())

async function open() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<MemoryRouter><ValidationPage authority="ICT" /></MemoryRouter>)
  await screen.findByRole('table', { name: 'ICT filings' })
  return user
}

const rowOf = (code) => screen.getByText(code).closest('tr')
const passTheHold = () => act(async () => { vi.advanceTimersByTime(HOLD + 10) })

describe('views', () => {
  it('opens By letter and remembers By site per user', async () => {
    const user = await open()
    expect(screen.getByRole('button', { name: /By letter/, pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'ICT validation' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /By site/ }))
    await screen.findByRole('table', { name: 'CRA filings' })
    expect(readView(7)).toBe('site')
    expect(screen.getByText('also waiting on this site')).toBeInTheDocument()
    expect(screen.getByText(/\+1 CRA/)).toBeInTheDocument()
  })

  it('lists rejected and incomplete rows first, with a not-filed tag', async () => {
    await open()
    expect(rowOf('V-101')).toHaveClass('is-attention')
    expect(within(rowOf('V-102')).getByText('4G not filed')).toBeInTheDocument()
    expect(within(rowOf('V-101')).getByText('4G rejected')).toHaveClass('is-rejected')
    expect(screen.getByText(/also used on 3 other villages/)).toBeInTheDocument()
  })
})

describe('selection', () => {
  it('ticks on row click and X, and select-all shows mixed', async () => {
    const user = await open()
    await user.click(rowOf('V-101'))
    const all = screen.getByRole('checkbox', { name: /Select all 3 ICT filings/ })
    expect(all.indeterminate).toBe(true)
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'j' })
    fireEvent.keyDown(window, { key: 'x' })
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    await user.click(all)
    expect(screen.getByText('All 3 selected')).toBeInTheDocument()
    expect(all.indeterminate).toBe(false)
  })

  it('selects every filing, not only the rows drawn', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ submission_id: i }))
    expect(allState(many, new Set(many.map((f) => f.submission_id)))).toMatchObject({ checked: true, count: 500 })
    expect(allState(many, new Set([1]))).toMatchObject({ mixed: true, count: 1 })
  })

  it('ignores shortcuts while typing', async () => {
    await open()
    const search = screen.getByRole('searchbox')
    fireEvent.keyDown(search, { key: 'x' })
    fireEvent.keyDown(search, { key: 'c' })
    expect(screen.queryByText(/selected/)).toBeNull()
  })
})

describe('confirm, return and undo', () => {
  it('confirms the selection after the hold, with versions', async () => {
    const user = await open()
    await user.click(rowOf('V-103'))
    fireEvent.keyDown(window, { key: 'c' })
    expect(screen.getByRole('status')).toHaveTextContent('Confirmed 1 ICT filing')
    expect(api.reviewFilings).not.toHaveBeenCalled()
    await passTheHold()
    expect(api.reviewFilings).toHaveBeenCalledWith({
      authority: 'ICT', decision: 'confirm', items: [{ submission_id: 103, version: 0 }],
    })
  })

  it('Undo within the hold sends nothing and restores the row', async () => {
    const user = await open()
    await user.click(rowOf('V-103'))
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    expect(screen.queryByText('V-103')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    await passTheHold()
    expect(api.reviewFilings).not.toHaveBeenCalled()
    expect(screen.getByText('V-103')).toBeInTheDocument()
  })

  it('Return is blocked without reasons; own reasons win over the shared one', async () => {
    const user = await open()
    await user.click(rowOf('V-101'))
    await user.click(rowOf('V-103'))
    fireEvent.keyDown(window, { key: 'r' })
    const send = screen.getByRole('button', { name: /Return 2 to/ })
    await user.click(send)
    expect(screen.getByRole('alert')).toHaveTextContent('2 filings have no reason')
    await user.type(screen.getByRole('textbox', { name: 'Own reason for V-101' }), 'wrong village')
    await user.click(send)
    expect(screen.getByRole('alert')).toHaveTextContent('1 filing has no reason')
    await user.type(screen.getByRole('textbox', { name: /Reason for all 2 selected/ }), 'illegible')
    await user.click(send)
    await passTheHold()
    expect(api.reviewFilings).toHaveBeenCalledWith({
      authority: 'ICT', decision: 'return', shared_reason: 'illegible',
      items: [{ submission_id: 101, version: 0, reason: 'wrong village' }, { submission_id: 103, version: 0 }],
    })
  })

  it('missingReasons needs the shared reason or one each', () => {
    const fs = [{ submission_id: 1 }, { submission_id: 2 }]
    expect(missingReasons(fs, '', { 1: 'x' })).toEqual([{ submission_id: 2 }])
    expect(missingReasons(fs, 'all', {})).toEqual([])
  })

  it('sends one request per authority from a merged site', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: /By site/ }))
    await screen.findByRole('table', { name: 'CRA filings' })
    await user.click(rowOf('V-103'))
    await user.click(rowOf('V-201'))
    expect(screen.getByText(/1 ICT/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Confirm/ }))
    await passTheHold()
    await passTheHold()
    const sent = api.reviewFilings.mock.calls.map(([body]) => body.authority).sort()
    expect(sent).toEqual(['CRA', 'ICT'])
  })

  it('a 409 names who decided and keeps the rest selected', async () => {
    api.reviewFilings.mockRejectedValue({
      response: { status: 409, data: { detail: { errors: [
        { code: 'stale', submission_id: 103, decided_by: 'Ali R.', decided_at: '2026-10-18T07:12:00Z', status: 'approved' },
      ] } } },
    })
    const user = await open()
    await user.click(rowOf('V-101'))
    await user.click(rowOf('V-103'))
    fireEvent.keyDown(window, { key: 'c' })
    await passTheHold()
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/^1 was already confirmed by Ali R\./), expect.any(String))
    expect(await screen.findByText('1 selected')).toBeInTheDocument()
  })

  it('a filing without evidence needs the outside tick', async () => {
    api.fetchGroup.mockImplementation(async () => ({ ...groupFor('letter'), filings: [filing(301, 'ICT', { has_evidence: false })] }))
    const user = await open()
    await user.click(rowOf('V-301'))
    const confirm = screen.getByRole('button', { name: /Confirm/ })
    expect(confirm).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /checked the evidence outside UEP/ }))
    expect(confirm).toBeEnabled()
  })
})

describe('evidence viewer', () => {
  it('opens a tab per file and draws each kind its own way', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: /View/ }))
    const viewer = screen.getByRole('region', { name: /Evidence for ICT letter/ })
    const tabs = within(viewer).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([expect.stringMatching(/^PDFletter\.pdf/), expect.stringMatching(/^MAILmail\.eml/)])
    expect(viewer.querySelector('iframe')).toHaveAttribute('src', '/api/v1/acceptance/my-work/evidence/11#page=1&zoom=100')
    await user.click(tabs[1])
    expect(await within(viewer).findByText('Approved for 3G')).toBeInTheDocument()
    expect(viewer.querySelector('iframe')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: /Evidence for ICT letter/ })).toBeNull()
  })
})
