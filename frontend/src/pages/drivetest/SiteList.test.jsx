// The drill-through site list.
//
// What matters here is that the page and the URL say the same thing. Every
// filter lives in the query string, the pills are rendered from what the
// server reports it applied, and the export asks for exactly the list on
// screen. A page that showed a filter the server had not applied would be the
// same failure this whole feature exists to prevent, one level up: something
// that looks right and is not.
//
// The suite runs with reduced motion on (see src/test/setup.js).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn() },
}))

const mockAuth = vi.hoisted(() => ({ current: null }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth.current,
}))

const api = (await import('../../api/client')).default
const SiteList = (await import('./SiteList')).default
const { ToastProvider } = await import('../../context/ToastContext')

const PROVINCES = [
  { id: 7, name: 'Kerman' },
  { id: 9, name: 'Yazd' },
]
const CONTRACTORS = [
  { id: 1, name: 'Alfa Drive Tests' },
  { id: 2, name: 'Beta Surveys' },
]
const CATEGORIES = [{ id: 1, name: 'Temp Power' }, { id: 2, name: 'MS Responsibility' }]

/** One row, shaped from app/schemas.DriveTestSiteRow. */
const row = (over = {}) => ({
  work_item_id: 11,
  site_code: 'K-0001',
  villages: 'روستای الف',
  province: 'Kerman',
  contractor: 'Alfa Drive Tests',
  bucket: 'Problematic',
  current_stage: 'Ready for Assignment',
  launch_date: '1404/03/01',
  days_since_launch: 210,
  age_band: '6–12 months',
  problem_categories: ['Temp Power'],
  fix_owners: ['CPG Power'],
  oldest_open_fix_days: 29,
  max_days_late: 7,
  hc_round: 2,
  dt_execution_date: null,
  dt_approved_at: null,
  dt_evidence_count: 0,
  ...over,
})

// The band and stage vocabularies ride on the response, because that is
// where the screen now reads them from -- see the note beside `ageBands` in
// SiteList. A fixture that left them out would be testing a payload the
// endpoint never sends.
const AGE_BANDS = [
  { key: 'lte_1w', label: 'Up to 1 week' },
  { key: 'w1_2', label: '1\u20132 weeks' },
  { key: 'w2_3', label: '2\u20133 weeks' },
  { key: 'w3_1m', label: '3 weeks \u2013 1 month' },
  { key: 'm1_2', label: '1\u20132 months' },
  { key: 'gt_2m', label: 'More than 2 months' },
  { key: 'no_assignment_date', label: 'Not assigned yet' },
]

const payload = (over = {}) => ({
  total: 2,
  rows: [row(), row({ work_item_id: 12, site_code: 'K-0002', oldest_open_fix_days: null })],
  filters_applied: { bucket: 'problematic' },
  generated_at: new Date().toISOString(),
  age_bands: AGE_BANDS,
  ongoing_stages: [
    { key: 'Assigned', label: 'Assigned' },
    { key: 'Other', label: 'Other' },
  ],
  ...over,
})

/** The last call made to the site-list endpoint, as `[url, config]`. */
function lastCall(url) {
  return [...api.get.mock.calls].reverse().find((call) => call[0] === url)
}

/** The endpoints this screen reads.
 *
 * `exportFails` replaces the export's answer with a rejection, so a test can
 * exercise the failure path without also having to restate every reference
 * list the filter bar needs to render.
 */
function serve(body = payload(), { exportFails = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/drive-test/sites') return Promise.resolve({ data: body })
    if (url === '/reference/provinces') return Promise.resolve({ data: PROVINCES })
    if (url === '/reference/contractors') return Promise.resolve({ data: CONTRACTORS })
    if (url === '/reference/problem-categories') return Promise.resolve({ data: CATEGORIES })
    if (url === '/drive-test/sites/export') {
      return exportFails
        ? Promise.reject(exportFails)
        : Promise.resolve({ data: new Blob(['x']) })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

/** A failed export, shaped the way axios delivers one for a blob request. */
const exportRejection = (status, detail) => ({
  response: {
    status,
    data: new Blob([detail == null ? '' : JSON.stringify({ detail })], {
      type: 'application/json',
    }),
  },
})

const STAFF = { id: 1, username: 'pm', role: { name: 'PM' } }
const CONTRACTOR = { id: 2, username: 'alfa', role: { name: 'Contractor' }, contractor_id: 1 }

function draw(path = '/drive-test/sites?bucket=problematic', user = STAFF) {
  mockAuth.current = { user }
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <SiteList />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom implements neither, and the export handler calls both.
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

describe('what the page is a list of', () => {
  it('names the figure in words, with the count that was clicked', async () => {
    serve(payload({ total: 64, filters_applied: { bucket: 'problematic', category: 'Temp Power' } }))
    draw('/drive-test/sites?bucket=problematic&category=Temp%20Power')

    expect(
      await screen.findByRole('heading', { name: '64 problematic sites · Temp Power' }),
    ).toBeInTheDocument()
  })

  it('says how much of the list is on screen', async () => {
    serve(payload({ total: 412 }))
    draw()

    expect(await screen.findByText('Showing 1–2 of 412')).toBeInTheDocument()
  })

  it('reads every filter out of the URL and asks the endpoint for exactly that', async () => {
    serve()
    draw(
      '/drive-test/sites?bucket=ongoing&age_band=m1_2&province_id=7&contractor_id=1&sort=-days_since_launch',
    )

    await screen.findByText('K-0001')
    expect(lastCall('/drive-test/sites')[1].params).toEqual({
      bucket: 'ongoing',
      age_band: 'm1_2',
      province_id: '7',
      contractor_id: '1',
      sort: '-days_since_launch',
      limit: 100,
      offset: 0,
    })
  })

  it('shows a pill per applied filter, named in words', async () => {
    serve(
      payload({
        filters_applied: {
          bucket: 'ongoing',
          age_band: 'm1_2',
          province_id: '7',
          contractor_id: '1',
        },
      }),
    )
    draw('/drive-test/sites?bucket=ongoing&age_band=m1_2&province_id=7&contractor_id=1')

    const pills = await screen.findByLabelText('Active filters')
    // The names come from the reference lists, not from the raw ids.
    expect(within(pills).getByText(/1–2 months/)).toBeInTheDocument()
    expect(within(pills).getByText(/Kerman/)).toBeInTheDocument()
    expect(within(pills).getByText(/Alfa Drive Tests/)).toBeInTheDocument()
    // The figure itself is not a pill: it is what the page is, not a filter
    // on it, and removing it would leave a list of nothing in particular.
    expect(within(pills).queryByText(/ongoing/)).not.toBeInTheDocument()
  })

  it('removes a filter from the URL when its pill is dismissed', async () => {
    serve(
      payload({ filters_applied: { bucket: 'ongoing', province_id: '7' } }),
    )
    draw('/drive-test/sites?bucket=ongoing&province_id=7')

    await screen.findByLabelText('Active filters')
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Kerman' }))

    await waitFor(() =>
      expect(lastCall('/drive-test/sites')[1].params).toEqual({
        bucket: 'ongoing',
        limit: 100,
        offset: 0,
      }),
    )
  })
})

describe('the filter bar', () => {
  it('offers only the filters that apply to the figure', async () => {
    serve(payload({ filters_applied: { bucket: 'ongoing' } }))
    draw('/drive-test/sites?bucket=ongoing')

    await screen.findByText('K-0001')
    expect(screen.getByLabelText('Waiting')).toBeInTheDocument()
    expect(screen.getByLabelText('Stage')).toBeInTheDocument()
    // An age band on a problematic list would answer a question that figure
    // never asked, so it is not offered there — and the endpoint refuses it.
    expect(screen.queryByLabelText('Category')).not.toBeInTheDocument()
  })

  it('offers the problematic filters on a problematic list, and no others', async () => {
    serve()
    draw('/drive-test/sites?bucket=problematic')

    await screen.findByText('K-0001')
    expect(screen.getByLabelText('Category')).toBeInTheDocument()
    // The age filter is offered here too, on the problematic clock -- and it
    // is named for that clock rather than borrowing the ongoing one's word,
    // because a blocked site is not a queued one.
    expect(screen.getByLabelText('Stuck for')).toBeInTheDocument()
    expect(screen.queryByLabelText('Waiting')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Stage')).not.toBeInTheDocument()
  })

  it('drops the filters that do not travel when the figure changes', async () => {
    serve()
    draw('/drive-test/sites?bucket=problematic&category=Temp%20Power')

    await screen.findByText('K-0001')
    await userEvent.selectOptions(screen.getByLabelText('Figure'), 'ongoing')

    await waitFor(() =>
      expect(lastCall('/drive-test/sites')[1].params).toEqual({
        bucket: 'ongoing',
        limit: 100,
        offset: 0,
      }),
    )
  })

  it('shows a contractor no list of other companies', async () => {
    // A contractor is forced to their own company by the endpoint; naming the
    // others in a dropdown would hand them a list of their competitors.
    serve()
    draw('/drive-test/sites?bucket=problematic', CONTRACTOR)

    await screen.findByText('K-0001')
    expect(screen.queryByLabelText('Contractor')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalledWith('/reference/contractors')
  })
})

describe('the table', () => {
  it('shows an absent value as a dash, never a zero', async () => {
    serve()
    draw()

    const row = (await screen.findByText('K-0002')).closest('tr')
    // No in-app fix to date from, and no evidence: both are dashes.
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('explains an empty oldest-open-fix cell rather than leaving it bare', async () => {
    serve()
    draw()

    const row = (await screen.findByText('K-0002')).closest('tr')
    const cell = within(row)
      .getAllByText('—')
      .map((node) => node.closest('td'))
      .find((td) => td.title?.startsWith('Flagged by CPM import'))
    expect(cell).toBeTruthy()
  })

  it('says what the oldest-open-fix column measures', async () => {
    serve()
    draw()

    const header = await screen.findByRole('button', { name: 'Oldest open fix' })
    expect(header).toHaveAttribute(
      'title',
      'Days since the current fix opened. A re-routed fix restarts its clock.',
    )
  })

  it('sorts by a whitelisted column, and turns the sort round on a second click', async () => {
    serve()
    draw()

    await screen.findByText('K-0001')
    await userEvent.click(screen.getByRole('button', { name: 'Days since launch' }))
    await waitFor(() =>
      expect(lastCall('/drive-test/sites')[1].params.sort).toBe('days_since_launch'),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Days since launch' }))
    await waitFor(() =>
      expect(lastCall('/drive-test/sites')[1].params.sort).toBe('-days_since_launch'),
    )
  })

  it('opens the site history from a site code, and the work item from the row', async () => {
    serve()
    draw()

    const cell = await screen.findByText('K-0001')
    expect(cell.tagName).toBe('BUTTON')

    const link = screen.getByRole('link', { name: 'Open work item K-0001' })
    expect(link).toHaveAttribute('href', '/work-items/11')
  })
})

describe('the export', () => {
  it('asks for the list on screen, with the same filters and no pagination', async () => {
    serve()
    draw('/drive-test/sites?bucket=problematic&category=Temp%20Power&province_id=7')

    await screen.findByText('K-0001')
    await userEvent.click(screen.getByRole('button', { name: /Export this list/ }))

    await waitFor(() => expect(lastCall('/drive-test/sites/export')).toBeTruthy())
    const [, config] = lastCall('/drive-test/sites/export')
    expect(config.params).toEqual({
      bucket: 'problematic',
      category: 'Temp Power',
      province_id: '7',
    })
    expect(config.responseType).toBe('blob')
  })

  it('tells the reader why the export failed, not just that it did', async () => {
    // `responseType: 'blob'` applies to the failure too, so the reason the
    // server gave arrives as a Blob and every `data.detail` reads undefined.
    // This used to render one sentence -- "Could not generate the file.
    // Please try again." -- for a row-cap refusal, a timeout and a server
    // fault alike, which tells the reader nothing and tells whoever they
    // report it to even less.
    serve(payload(), {
      exportFails: exportRejection(400, 'The Sites sheet would hold 40000 rows'),
    })
    draw('/drive-test/sites?bucket=problematic')

    await screen.findByText('K-0001')
    await userEvent.click(screen.getByRole('button', { name: /Export this list/ }))

    expect(await screen.findByText(/would hold 40000 rows/)).toBeInTheDocument()
    expect(screen.getByText(/400/)).toBeInTheDocument()
  })

  it('names a missing endpoint rather than blaming the reader', async () => {
    // The usual cause of a 404 here is a backend older than this page, which
    // is nobody's fault and not fixed by trying again.
    serve(payload(), { exportFails: exportRejection(404) })
    draw('/drive-test/sites?bucket=problematic')

    await screen.findByText('K-0001')
    await userEvent.click(screen.getByRole('button', { name: /Export this list/ }))

    expect(
      await screen.findByText(/not available on the server this page is talking to/),
    ).toBeInTheDocument()
  })
})

describe('when there is nothing to show', () => {
  it('says the filters matched nothing rather than drawing an empty table', async () => {
    serve(payload({ total: 0, rows: [] }))
    draw()

    expect(await screen.findByText('No sites match these filters')).toBeInTheDocument()
  })

  it('shows the reason a refused filter was refused', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/drive-test/sites') {
        return Promise.reject({
          response: { status: 422, data: { detail: 'age_band applies to the ongoing bucket only' } },
        })
      }
      return Promise.resolve({ data: [] })
    })
    draw('/drive-test/sites?bucket=problematic&age_band=m1_2')

    expect(
      await screen.findByText('age_band applies to the ongoing bucket only'),
    ).toBeInTheDocument()
  })
})
