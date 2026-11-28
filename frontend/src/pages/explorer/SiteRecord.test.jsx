// Explorer's site record page (UEP-28 Part B).
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { manyVillages, record } from './fixtures'
import { pickOption } from '../../test/pickOption'

const auth = vi.hoisted(() => ({ role: 'Coordinator' }))
vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: auth.role } } }) }))

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
    // The badge is the open step, the same one the ribbon shows in progress.
    expect(screen.getByText('Awaiting submission to ICT')).toHaveClass('ex-badge', 'is-progress')
  })

  it('opens My Work on the site, and offers File letter to a filing role', async () => {
    await draw()
    expect(screen.getByRole('link', { name: /Open in My Work/ })).toHaveAttribute('href', '/my-work?q=W4318')
    expect(screen.getByRole('link', { name: /File letter/ })).toHaveAttribute('href', '/my-work?q=W4318')
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

describe('the site passport', () => {
  const passport = () => screen.getByRole('region', { name: 'Site passport' })

  it('shows Province, Target villages, Site type and technology, Contractors, in that order', async () => {
    await draw()
    const titles = within(passport()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent.replace(/\d+$/, '').trim())
    expect(titles).toEqual(['Province', 'Target villages', 'Site type', 'Technology', 'Contractors'])
    expect(within(passport()).getByRole('heading', { name: 'Province' })).toHaveClass('uw-sr-only')
    expect(passport().querySelectorAll('.exp-title')).toHaveLength(4)
    expect(within(passport()).getByText('کرمان')).toHaveAttribute('lang', 'fa')
    expect(within(passport()).getByRole('img', { name: 'Map of Iran, کرمان highlighted' })).toBeInTheDocument()
    expect(within(passport()).getByText('New site')).toBeInTheDocument()
    expect(within(passport()).getByText('New site').tagName).toBe('SPAN')
    expect(within(passport()).getByText('New site')).toHaveClass('exp-value')
    expect(within(passport()).getByRole('group', { name: 'Requested technology: 3G, 4G' })).toBeInTheDocument()
    expect(within(passport()).getByText('3G')).toHaveClass('exp-tech')
    expect(within(passport()).getByText('Site contractor')).toBeInTheDocument()
    expect(within(passport()).getByText('آریا موج')).toBeInTheDocument()
  })

  it('has no CRA region, no avatars, and no on-air or DT date', async () => {
    await draw()
    const card = passport()
    expect(card.textContent).not.toMatch(/region/i)
    expect(card.querySelector('.ava, .ex-field-tile')).toBeNull()
    expect(card.textContent).not.toMatch(/On air|DT date/)
  })

  it('shows only the requested technologies, as tiles, with no signal bars', async () => {
    const r = record()
    r.general = { ...r.general, requested_technology: ['4G'] }
    serve(r)
    await draw()
    const tiles = [...passport().querySelectorAll('.exp-tech')].map((t) => t.textContent)
    expect(tiles).toEqual(['4G'])
    expect(within(passport()).queryByText('2G')).toBeNull()
    expect(within(passport()).queryByText('3G')).toBeNull()
    expect(passport().querySelector('.exp-bars')).toBeNull()
  })

  it('draws a tower tile for the site contractor and a car tile for the DT contractor', async () => {
    await draw()
    const rows = [...passport().querySelectorAll('.exp-contractor')]
    expect(rows.map((row) => row.querySelector('.exp-contractor-tile svg').dataset.icon)).toEqual(['cell-tower', 'car'])
    expect(rows.map((row) => row.querySelector('.exp-role').textContent)).toEqual(['Site contractor', 'DT contractor'])
  })

  it.each([
    [2, 'History · 2 changes'],
    [1, 'History · 1 change'],
    [0, 'History'],
  ])('names History with %i changes in words', async (n, name) => {
    serve(record({ village_history: record().village_history.slice(0, n) }))
    await draw()
    const button = within(passport()).getByRole('button', { name })
    expect(button).toHaveTextContent(name)
    expect(button.querySelector('b')).toBeNull()
  })

  it('says "Not assigned" for a missing contractor and "—" for a missing province', async () => {
    const r = record()
    r.general = { ...r.general, dt_contractor: null, province: null, requested_technology: [] }
    serve(r)
    await draw()
    expect(within(passport()).getByText('Not assigned')).toBeInTheDocument()
    expect(within(passport()).getByText('Not assigned').closest('.exp-contractor').querySelector('[data-icon="car"]')).not.toBeNull()
    expect(within(passport()).getByText('—', { selector: '.exp-none' })).toBeInTheDocument()
    expect(within(passport()).queryByText('Province', { ignore: '.uw-sr-only' })).toBeNull()
    expect(within(passport()).getByRole('img', { name: 'Map of Iran' })).toBeInTheDocument()
  })

  it('highlights a village row from its chip, and clears it on a second click', async () => {
    const user = userEvent.setup()
    await draw()
    const chip = within(passport()).getByRole('button', { name: /V10002/ })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('tr[data-village="V10002"]')).toHaveClass('is-highlight')
    await user.click(chip)
    expect(document.querySelector('tr.is-highlight')).toBeNull()
  })

  it('disables the chips until acceptance has started', async () => {
    serve(record({ acceptance_started: false }))
    await draw()
    expect(within(passport()).getByRole('button', { name: /V10001/ })).toBeDisabled()
  })
})

describe('the journey', () => {
  it('shows total aging since the health check and the oldest pending side, nothing else', async () => {
    await draw()
    const stats = document.querySelector('.exj-stats')
    expect(within(stats).getAllByRole('term').map((t) => t.textContent)).toEqual(['Total aging', 'Oldest pending'])
    expect(stats).toHaveTextContent('Total aging35dayssince health check')
    expect(stats).toHaveTextContent('Oldest pending14daysCRA · 2 villages')
    expect(document.body.textContent).not.toMatch(/Longest step|In current step/)
  })

  it('says "health check not done" without a total, and hides Oldest pending when nothing waits', async () => {
    const r = record()
    r.journey = {
      ...r.journey,
      aging: { total_days: null, oldest_pending: null },
      steps: r.journey.steps.map((s) => (s.key === 'on_air' ? s : { ...s, state: s.key === 'health_check' ? 'in_progress' : 'upcoming', date: null })),
    }
    serve(r)
    await draw()
    const stats = document.querySelector('.exj-stats')
    expect(stats).toHaveTextContent('Total aging—health check not done')
    expect(stats).not.toHaveTextContent('Oldest pending')
  })

  it('names every step, its date or days so far, and both lanes on the ribbon', async () => {
    await draw()
    expect(screen.getByRole('img', { name: /^On air 2 Sept 2026; Health check 9 Sept 2026;/ })).toHaveAccessibleName(
      'On air 2 Sept 2026; Health check 9 Sept 2026; Assigned 16 Sept 2026; DT done 30 Sept 2026; '
      + 'Sent to ICT in progress, 14 days so far; Acceptance not yet; ICT 1 of 3 approved; CRA 1 of 3 approved',
    )
  })

  it('draws real proportions, the fork lanes and Today at the measured width', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100)
    await draw()
    const ribbon = document.querySelector('.exr')
    expect(ribbon.querySelectorAll('.exr-lane')).toHaveLength(2)
    expect(ribbon.querySelector('.exr-today')).not.toBeNull()
    expect([...ribbon.querySelectorAll('.exr-dur')].map((d) => d.textContent)).toEqual(['7 d', '7 d', '14 d', expect.stringMatching(/ d so far$/)])
    expect(ribbon.querySelector('.exr-ms.is-big .exr-ms-date')).toHaveTextContent('2 Sept 2026')
    width.mockRestore()
  })

  it('links the batch the site went to ICT HQ in', async () => {
    const r = record()
    r.journey.sent_to_ict = [{ batch_number: 12, outside_uep: false, sent_at: '2026-10-06', villages: 3, mtn: null, ict: null, cra: null, in_mojri_since: null, in_mojri: 0 }]
    serve(r)
    await draw()
    expect(screen.getByRole('link', { name: 'Sent to ICT in batch #12' })).toHaveAttribute('href', '/submissions/batches/12')
  })
})

describe('acceptance by village', () => {
  const rows = () => [...document.querySelectorAll('.exa-table tbody tr')].map((tr) => tr.dataset.village)

  it('is one table for 1, 3 and 15 villages, worst first, with no aging', async () => {
    for (const villages of [manyVillages(1), undefined, manyVillages(15)]) {
      serve(record(villages ? { villages } : {}))
      const { unmount } = render(<div />)
      await draw()
      expect(document.querySelectorAll('.exa-table')).toHaveLength(1)
      expect(document.querySelector('.ex-panels')).toBeNull()
      expect(document.querySelector('.exa-table').textContent).not.toMatch(/waiting|took| d\b|days/)
      unmount()
      document.body.innerHTML = ''
    }
  })

  it('orders rejected, then pending, then approved, then village code', async () => {
    await draw()
    expect(rows()).toEqual(['V10002', 'V10003', 'V10001'])
  })

  it('heads ICT and CRA with their counts', async () => {
    await draw()
    const ict = screen.getByRole('columnheader', { name: 'ICT status' })
    expect(ict).toHaveTextContent('ICT1 approved1 pending1 rejected')
    expect(within(ict).getByText('ICT')).toHaveClass('ex-auth')
  })

  it('reads each status as a word, a mark and a dated line', async () => {
    await draw()
    const row = document.querySelector('tr[data-village="V10002"]')
    expect(row).toHaveTextContent('ICT: Rejected2 Oct 2026, not re-filed yet')
    expect(row).toHaveTextContent('CRA: PendingFiled 7 Oct 2026')
    expect(document.querySelector('tr[data-village="V10003"]')).toHaveTextContent('ICT: PendingRe-filedRe-filed 10 Oct 2026')
    expect(document.querySelector('tr[data-village="V10003"]')).toHaveTextContent('Not filed yet')
  })

  it('filters to the open villages', async () => {
    const user = userEvent.setup()
    await draw()
    await user.click(screen.getByRole('tab', { name: /Open/ }))
    expect(rows()).toEqual(['V10002', 'V10003'])
  })

  it('highlights the ?village= row', async () => {
    await draw('/explorer/sites/7?village=V10003')
    expect(document.querySelector('tr[data-village="V10003"]')).toHaveClass('is-highlight')
  })

  it('says when acceptance has not started yet', async () => {
    serve(record({ acceptance_started: false }))
    await draw()
    expect(screen.getByText('Acceptance starts when drive test is done.')).toBeInTheDocument()
  })
})

describe('village history', () => {
  it('opens from History, traps focus, closes on Esc and gives focus back', async () => {
    const user = userEvent.setup()
    await draw()
    const trigger = screen.getByRole('button', { name: /History/ })
    expect(trigger).toHaveTextContent('2')
    await user.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'Villages' })
    expect(panel).toHaveTextContent('W4318 · 3 target villages')
    expect(within(panel).getByText('Village removed')).toBeInTheDocument()
    expect(within(panel).getByText('Ignored by Sara Ahmadi on 19 Nov 2026 · still on this site')).toBeInTheDocument()
    expect(within(panel).getByText('Applied by Sara Ahmadi on 2 Oct 2026')).toBeInTheDocument()
    expect(panel.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Villages' })).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('exports the history to Excel', async () => {
    const user = userEvent.setup()
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x')
    globalThis.URL.revokeObjectURL = vi.fn()
    await draw()
    await user.click(screen.getByRole('button', { name: /History/ }))
    api.get.mockResolvedValueOnce({ data: new Blob(['x']) })
    await user.click(screen.getByRole('button', { name: /Export to Excel/ }))
    expect(api.get).toHaveBeenCalledWith('/explorer/sites/7/villages/export', { responseType: 'blob' })
  })
})

describe('states', () => {
  it('draws skeletons at final size while loading', async () => {
    api.get.mockImplementation(() => new Promise(() => {}))
    await draw()
    expect(document.querySelector('.exp-skel-map')).not.toBeNull()
    expect(document.querySelector('.exj-skel-ribbon')).not.toBeNull()
    expect(screen.getByRole('region', { name: 'Journey' })).toHaveAttribute('aria-busy', 'true')
  })

  it('says it could not load each card, and retries', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } })
    await draw()
    expect(screen.getByText("Couldn't load the site passport.")).toBeInTheDocument()
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
    await pickOption(await screen.findByLabelText('Contractor'), '5')
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
    // UEP-24 F3: the report goes with the submission, so it needs a file.
    expect(within(drawer).getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    await user.upload(drawer.querySelector('input[type="file"]'), new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' }))
    await user.click(within(drawer).getByRole('button', { name: 'Submit for review' }))
    expect(api.post).toHaveBeenCalledWith('/work-items/7/drive-test/upload', expect.any(FormData), expect.anything())

    await user.click(screen.getByRole('button', { name: /Take action/ }))
    drawer = screen.getByRole('dialog', { name: 'Take action' })
    await user.click(within(drawer).getByRole('button', { name: /Can't proceed with this site/ }))
    await user.type(within(drawer).getByPlaceholderText(/can't be drive-tested/), 'Access road is closed')
    await user.click(within(drawer).getByRole('button', { name: 'Return to coordinator' }))
    await user.click(screen.getByRole('button', { name: 'Yes, return it' }))
    expect(api.post).toHaveBeenCalledWith('/work-items/7/return-to-coordinator', { reason: 'Access road is closed' })
  })
})
