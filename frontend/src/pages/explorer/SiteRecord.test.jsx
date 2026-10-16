// Explorer's site record page (UEP-11 §B3–B5, §B9).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { manyVillages, record, side, village } from './fixtures'

const auth = vi.hoisted(() => ({ role: 'Coordinator' }))
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: { name: auth.role } } }) }))

const api = (await import('../../api/client')).default
const SiteRecord = (await import('./SiteRecord')).default
const { ToastProvider } = await import('../../context/ToastContext')

function serve(body) {
  api.get.mockImplementation((url) => {
    if (url === '/explorer/sites/7') return Promise.resolve({ data: body })
    if (url === '/reference/contractors') return Promise.resolve({ data: [{ id: 5, name: 'آریا موج' }] })
    return Promise.resolve({ data: [] })
  })
}

async function draw(path = '/explorer/sites/7') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/explorer/sites/:workItemId" element={<SiteRecord />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

const panel = (name) => screen.getByRole('region', { name: `${name} acceptance` })
const rowCodes = (container) =>
  within(container).getAllByRole('listitem').map((li) => li.querySelector('.ex-village-id').textContent)

beforeEach(() => {
  vi.clearAllMocks()
  auth.role = 'Coordinator'
  serve(record())
})

describe('the header', () => {
  it('shows the site ID and one status badge, with no in-page breadcrumb (it is in the header)', async () => {
    await draw()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'W4318' })).toBeInTheDocument()
    expect(screen.getByText('Acceptance in progress')).toHaveClass('ex-badge', 'is-progress')
  })

  it('opens My Work on the site, and offers File letter to a filing role', async () => {
    await draw()
    expect(screen.getByRole('link', { name: /Open in My Work/ })).toHaveAttribute('href', '/my-work?q=W4318')
    expect(screen.getByRole('link', { name: /File letter/ })).toHaveAttribute('href', '/my-work?tab=all&q=W4318')
  })

  it('offers no File letter to a role that does not file', async () => {
    auth.role = 'Viewer'
    await draw()
    expect(screen.queryByRole('link', { name: /File letter/ })).toBeNull()
  })

  it('says acceptance is done in green when every village is approved', async () => {
    serve(record({ status: { step: 'acceptance', state: 'done' } }))
    await draw()
    expect(screen.getByText('Acceptance done')).toHaveClass('is-done')
  })
})

describe('General information', () => {
  it('shows all seven rows, Gregorian dates and Persian text isolated', async () => {
    await draw()
    const card = screen.getByRole('region', { name: 'General information' })
    const terms = within(card).getAllByRole('term').map((t) => t.textContent)
    expect(terms).toEqual([
      'On air date', 'DT date', 'Site contractor', 'DT contractor', 'Requested technology', 'Province', 'Target villages',
    ])
    expect(within(card).getByText('2 Sept 2026')).toBeInTheDocument()
    expect(within(card).getByText('30 Sept 2026')).toBeInTheDocument()
    expect(within(card).getByText('سازه گستر')).toHaveAttribute('lang', 'fa')
    expect(within(card).getByText('3G')).toBeInTheDocument()
    expect(card.querySelector('[data-field="villages"] dd')).toHaveTextContent('3')
  })

  it('shows "—" for every missing value', async () => {
    const r = record()
    r.general = { ...r.general, on_air_date: null, site_contractor: null, requested_technology: [], province: null }
    serve(r)
    await draw()
    const card = screen.getByRole('region', { name: 'General information' })
    for (const field of ['on_air', 'site_contractor', 'technology', 'province']) {
      expect(card.querySelector(`[data-field="${field}"] dd`)).toHaveTextContent('—')
    }
  })
})

describe('Journey', () => {
  it('renders the five steps in order, On air first, with their aging pills', async () => {
    await draw()
    const steps = within(screen.getByRole('list', { name: 'Journey' })).getAllByRole('listitem')
    expect(steps[0].querySelector('[data-icon]')).toHaveAttribute('data-icon', 'cell-tower')
    expect(steps.map((s) => s.getAttribute('aria-label'))).toEqual([
      'On air: done, 2 Sept 2026',
      'Health check: done, 9 Sept 2026, 7 days after the previous step',
      'Assigned: done, 16 Sept 2026, 7 days after the previous step',
      'DT done: done, 30 Sept 2026, 14 days after the previous step',
      'Acceptance: in progress, 14 days so far',
    ])
    expect([...document.querySelectorAll('.ex-step-pill')].map((p) => p.textContent)).toEqual([
      '+7 d', '+7 d', '+14 d', '+14 d so far',
    ])
    expect(document.querySelector('.ex-step.is-in_progress .ex-step-date')).toHaveTextContent('In progress')
  })

  it('shows "No date" and a dash where CPM carried no date, never a negative pill', async () => {
    const r = record()
    r.journey.steps = r.journey.steps.map((s, i) => (i < 4 ? { ...s, date: null, gap_days: null } : { ...s, gap_days: null }))
    r.journey.aging = { total_days: null, current_step_days: null, longest_step: null, oldest_pending: null }
    serve(r)
    await draw()
    expect(screen.getAllByText('No date')).toHaveLength(4)
    const pills = [...document.querySelectorAll('.ex-step-pill')].map((p) => p.textContent)
    expect(pills).toEqual(['—', '—', '—', '—'])
    expect(pills.join('')).not.toMatch(/-\d/)
    expect(document.querySelector('[data-tile="total"] .ex-aging-value')).toHaveTextContent('—')
  })

  it('renders the aging tiles, Oldest pending only while something is pending', async () => {
    await draw()
    const aging = screen.getByRole('list', { name: 'Aging' })
    expect(within(aging).getAllByRole('listitem')).toHaveLength(4)
    expect(within(aging).getByText('42 d')).toBeInTheDocument()
    // The journey starts on air (UEP-11a Part C): total aging counts from there.
    expect(document.querySelector('[data-tile="total"] .ex-aging-context')).toHaveTextContent('since on air')
    expect(within(aging).getByText('Assigned to DT done')).toBeInTheDocument()
    expect(within(aging).getByText('CRA, 2 villages')).toBeInTheDocument()
  })

  it('hides Oldest pending when nothing is pending', async () => {
    const r = record()
    r.journey.aging.oldest_pending = null
    serve(r)
    await draw()
    expect(within(screen.getByRole('list', { name: 'Aging' })).getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('Acceptance by village', () => {
  it('shows up to six villages as two panels, rows in the same order in both', async () => {
    await draw()
    expect(rowCodes(panel('ICT'))).toEqual(['V10002', 'V10003', 'V10001'])
    expect(rowCodes(panel('CRA'))).toEqual(rowCodes(panel('ICT')))
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('heads each panel with ICT or CRA and the three counts, words beside the numbers', async () => {
    await draw()
    const head = panel('ICT').querySelector('.ex-authority-head')
    expect(within(head).getByText('ICT')).toHaveClass('ex-authority')
    expect([...head.querySelectorAll('.ex-count')].map((c) => c.textContent)).toEqual(['Approved1', 'Pending1', 'Rejected1'])
  })

  it('carries each status as a word with its mark, and the dated line under it', async () => {
    await draw()
    const ict = panel('ICT')
    expect(within(ict).getByText('Rejected', { selector: '.ex-mark-word *, .ex-mark-word' }).closest('.ex-mark')).toHaveClass('is-rejected')
    expect(within(ict).getByText('2 Oct 2026, not re-filed yet')).toBeInTheDocument()
    expect(within(ict).getByText('Re-filed', { selector: '.ex-mark-chip' })).toBeInTheDocument()
    expect(within(ict).getByText('4 Oct 2026, took 4 days')).toBeInTheDocument()
    expect(within(panel('CRA')).getByText('Not filed yet')).toBeInTheDocument()
  })

  it('filters to the open villages with the All / Open tabs', async () => {
    const user = userEvent.setup()
    await draw()
    const tabs = screen.getByRole('tablist', { name: 'Villages' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['All 3', 'Open 2'])
    await user.click(within(tabs).getByRole('tab', { name: /Open/ }))
    expect(within(tabs).getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true')
    expect(rowCodes(panel('ICT'))).toEqual(['V10002', 'V10003'])
    fireEvent.keyDown(tabs, { key: 'ArrowLeft' })
    expect(rowCodes(panel('ICT'))).toHaveLength(3)
  })

  it('switches to one scrolling table above six villages', async () => {
    serve(record({ villages: manyVillages(10) }))
    await draw()
    const scroller = screen.getByRole('region', { name: /Villages, ICT and CRA status/ })
    expect(scroller).toHaveAttribute('tabindex', '0')
    const table = within(scroller).getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.getAttribute('aria-label') || h.textContent)).toEqual([
      'Village', 'ICT status', 'CRA status',
    ])
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    // Longest wait first.
    expect(within(table).getAllByRole('rowheader')[0]).toHaveTextContent('V20009')
  })

  it('highlights, scrolls to and focuses the ?village= row', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    await draw('/explorer/sites/7?village=V10003')
    const row = panel('ICT').querySelector('[data-village="V10003"]')
    expect(row).toHaveClass('is-highlight')
    expect(row).toHaveFocus()
    expect(scrolled).toHaveBeenCalled()
    expect(panel('CRA').querySelectorAll('.is-highlight')).toHaveLength(1)
  })

  it('says when acceptance has not started, and when the site has no hadaf villages', async () => {
    serve(record({ acceptance_started: false }))
    await draw()
    expect(screen.getByText('Acceptance starts when the site is on air and drive-tested.')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('says when the site has no hadaf villages', async () => {
    serve(record({ villages: [] }))
    await draw()
    expect(screen.getByText('No hadaf villages on this site.')).toBeInTheDocument()
  })

  it('keeps every date on the page Gregorian', async () => {
    serve(record({ villages: [village('V1', side('approved', { decided_date: '2026-10-06' }), side('approved', { decided_date: '2026-01-15' }))] }))
    await draw()
    expect(screen.getByText('6 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('15 Jan 2026')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/[۰-۹]|\d{4}\/\d{2}\/\d{2}|\d{4}-\d{2}-\d{2}/)
  })
})

describe('states', () => {
  it('draws skeletons while loading', async () => {
    api.get.mockImplementation(() => new Promise(() => {}))
    await draw()
    expect(document.querySelectorAll('.ex-skel-value')).toHaveLength(7)
    expect(screen.getByRole('region', { name: 'Journey' })).toHaveAttribute('aria-busy', 'true')
  })

  it('says it could not load each card, and retries', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } })
    await draw()
    expect(screen.getByText("Couldn't load general information.")).toBeInTheDocument()
    expect(screen.getByText("Couldn't load the journey.")).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])
    await act(async () => {})
    expect(screen.getByRole('heading', { level: 1, name: 'W4318' })).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load the journey.")).toBeNull()
  })

  it('says a site it may not see was not found', async () => {
    api.get.mockRejectedValue({ response: { status: 404 } })
    await draw()
    expect(screen.getByRole('status')).toHaveTextContent('This site was not found, or it is not one you can see.')
  })
})

describe('Take action', () => {
  it('is not offered when the user has nothing to do on the site', async () => {
    auth.role = 'Viewer'
    await draw()
    expect(screen.queryByRole('button', { name: /Take action/ })).toBeNull()
  })

  it('opens the drive-test review form in a drawer, and it still submits', async () => {
    const user = userEvent.setup()
    serve(record({ workflow: { current_stage: 'DT Submitted', active_drive_test_id: 3, dt_submission_date: '2026-09-30' } }))
    api.post.mockResolvedValue({ data: {} })
    await draw()
    await user.click(screen.getByRole('button', { name: /Take action/ }))
    const drawer = screen.getByRole('dialog', { name: 'Take action' })
    await user.click(within(drawer).getByRole('button', { name: /Approve/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, approve' }))
    expect(api.post).toHaveBeenCalledWith('/drive-tests/3/coordinator-review', { decision: 'Approved', comment: null })
  })

  it('assigns a site awaiting assignment', async () => {
    const user = userEvent.setup()
    serve(record({ workflow: { current_stage: 'Ready for Assignment', active_drive_test_id: null, dt_submission_date: null } }))
    api.post.mockResolvedValue({ data: {} })
    await draw()
    await user.click(screen.getByRole('button', { name: /Take action/ }))
    await user.selectOptions(await screen.findByLabelText('Contractor'), '5')
    await user.click(screen.getByRole('button', { name: 'Assign for drive test' }))
    expect(api.post).toHaveBeenCalledWith('/work-items/7/assignment', { assignment_type: 'official', contractor_id: 5 })
  })

  it('lets a contractor submit the drive test, or return the site', async () => {
    const user = userEvent.setup()
    auth.role = 'Contractor'
    serve(record({ workflow: { current_stage: 'Assigned', active_drive_test_id: null, dt_submission_date: null } }))
    api.post.mockResolvedValue({ data: { drive_test_id: 9 } })
    await draw()
    await user.click(screen.getByRole('button', { name: /Take action/ }))
    let drawer = screen.getByRole('dialog', { name: 'Take action' })
    await user.click(within(drawer).getByRole('button', { name: 'Submit for review' }))
    expect(api.post).toHaveBeenCalledWith('/work-items/7/drive-test', { execution_date: expect.any(String) })

    await user.click(screen.getByRole('button', { name: /Take action/ }))
    drawer = screen.getByRole('dialog', { name: 'Take action' })
    await user.click(within(drawer).getByRole('button', { name: /Can't proceed with this site/ }))
    await user.type(within(drawer).getByPlaceholderText(/can't be drive-tested/), 'Access road is closed')
    await user.click(within(drawer).getByRole('button', { name: 'Return to coordinator' }))
    await user.click(screen.getByRole('button', { name: 'Yes, return it' }))
    expect(api.post).toHaveBeenCalledWith('/work-items/7/return-to-coordinator', { reason: 'Access road is closed' })
  })
})
