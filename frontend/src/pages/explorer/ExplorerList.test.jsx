// Explorer's list (UEP-28 Part A): the title row and its count pill, search
// and filter pills; sortable headers kept in the URL; rows with the Stage
// cell and the matched village under them; inline villages; continuous
// scroll; keyboard; the bulk bar. No footer.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { FILTER_OPTIONS, siteVillages, sitesPage } from './fixtures'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => globalThis.withSeededAccess({ user: { role: { name: 'PM' } } }) }))
vi.mock('../../shell/HomeData', () => ({ useHomeData: () => ({ data: null, error: null }) }))

const api = (await import('../../api/client')).default
const ExplorerList = (await import('./ExplorerList')).default
const { forgetList } = await import('./listModel')
const { ToastProvider } = await import('../../context/ToastContext')

// IntersectionObserver, driven by the test: `reachEnd()` says the sentinel is in view.
let observed = []
class FakeObserver {
  constructor(callback) { this.callback = callback }
  observe() { observed.push(this) }
  disconnect() { observed = observed.filter((o) => o !== this) }
}
const reachEnd = () => act(async () => observed.forEach((o) => o.callback([{ isIntersecting: true }])))

// Vitest runs from frontend/ and serves CSS imports empty, so read the file.
const css = readFileSync('src/styles/explorer.css', 'utf8')

const listCalls = () => api.get.mock.calls.filter(([url]) => url === '/explorer/sites')

beforeEach(() => {
  vi.clearAllMocks()
  forgetList()
  observed = []
  window.IntersectionObserver = FakeObserver
  api.get.mockImplementation((url, config) => {
    const p = config?.params || {}
    if (url === '/explorer/sites') return Promise.resolve({ data: sitesPage({ total: 120, limit: p.limit, cursor: p.cursor, q: p.q }) })
    if (url === '/explorer/sites/filters') return Promise.resolve({ data: FILTER_OPTIONS })
    if (/\/explorer\/sites\/\d+\/villages$/.test(url)) return Promise.resolve({ data: siteVillages(3) })
    if (url === '/explorer/sites/export') return Promise.resolve({ data: new Blob(['x']) })
    return Promise.resolve({ data: [] })
  })
})
afterEach(() => {
  delete window.IntersectionObserver
})

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}

function RecordStub() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Back to list</button>
}

async function draw(path = '/explorer') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/explorer" element={<ExplorerList />} />
          <Route path="/explorer/sites/:id" element={<RecordStub />} />
        </Routes>
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

const where = () => screen.getByTestId('where').textContent
const table = () => screen.getByRole('table', { name: 'Sites' })
const bodyRows = () => within(table()).getAllByRole('row').filter((r) => r.classList.contains('exl-site-row'))
const header = (name) => within(table()).getByRole('button', { name })
const pill = () => document.querySelector('.exl-count')

describe('Explorer list: the page', () => {
  it('has a title with the count pill, one card, and none of the old controls', async () => {
    await draw()
    expect(screen.getByRole('heading', { level: 1, name: 'Explorer' })).toBeInTheDocument()
    expect(pill()).toHaveTextContent('120 sites')
    expect(pill()).toHaveAttribute('aria-live', 'polite')
    expect(document.querySelector('.uep-page-header')).toBeNull()
    expect(document.querySelector('.exl-app-tile')).not.toBeNull()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^sort$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument()
  })

  it('shows the columns in order, 50 rows, and no footer', async () => {
    await draw()
    const heads = within(table()).getAllByRole('columnheader').map((h) => h.textContent.trim())
    expect(heads).toEqual(['', 'Site', 'Province', 'Villages', 'Technology', 'DT contractor', 'Stage', 'Open'])
    expect(table()).toHaveAttribute('aria-rowcount', '121')
    expect(bodyRows()).toHaveLength(50)
    expect(document.querySelector('.exl-footer')).toBeNull()
  })

  it('renders a row: link and type tag, Persian province, villages pill, technology, contractor, stage', async () => {
    await draw()
    const row = bodyRows()[0]
    expect(within(row).getByRole('link', { name: 'W4001' })).toHaveAttribute('href', '/explorer/sites/1')
    expect(row.querySelector('.exl-type-tag')).toHaveTextContent('New')
    expect(bodyRows()[3].querySelector('.exl-type-tag')).toHaveTextContent('Add tech')
    expect(row.querySelector('bdi[lang="fa"]')).toHaveTextContent('تهران')
    expect([...row.querySelectorAll('.exl-tech')].map((t) => t.textContent)).toEqual(['4G'])
    expect(within(row).getByRole('button', { name: 'Show 1 village of W4001' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(bodyRows()[6]).getByText('Not assigned')).toBeInTheDocument()
    // No villages: a dash, not a button.
    expect(within(bodyRows()[4]).queryByRole('button', { name: /villages? of/ })).toBeNull()
    expect(row.querySelector('[data-icon]:not(.exl-chev-cell *):not(.exl-villages-pill *)')).toBeNull()
  })

  it('reads the Stage cell: step, days, red with a mark only over the SLA, Accepted when done', async () => {
    await draw()
    const stage = (i) => bodyRows()[i].querySelector('.exl-stage')
    expect(stage(0)).toHaveAccessibleName('Assignment, 1 day')
    expect(stage(0).querySelector('.exl-stage-days')).not.toHaveClass('is-late')
    expect(stage(37)).toHaveAccessibleName('Drive test, 18 days, over SLA')
    expect(stage(37).querySelector('.exl-stage-days')).toHaveClass('is-late')
    expect(stage(37).querySelector('[data-icon="warning--alt"]')).not.toBeNull()
    expect(stage(4)).toHaveAccessibleName('Accepted')
    expect(stage(4).querySelector('.exl-stage-days')).toBeNull()
    expect(stage(2)).toHaveAccessibleName('Sent to ICT, 3 days')
    expect(stage(2).querySelector('.exl-stage-done').style.width).toBe(`${(4 / 6) * 100}%`)
  })
})

describe('Explorer list: sorting', () => {
  it('sorts by a header, toggles direction, and keeps it in the URL', async () => {
    await draw()
    expect(header('Site').closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(header('Province'))
    expect(where()).toBe('/explorer?sort=province')
    expect(header('Province').closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'ascending')
    expect(header('Site').closest('[role="columnheader"]')).not.toHaveAttribute('aria-sort')
    await userEvent.click(header('Province'))
    expect(where()).toBe('/explorer?sort=province&dir=desc')
    expect(listCalls().at(-1)[1].params).toMatchObject({ sort: 'province', dir: 'desc' })
  })

  it('opens with the sort a link carried', async () => {
    await draw('/explorer?sort=villages&dir=desc')
    expect(header('Villages').closest('[role="columnheader"]')).toHaveAttribute('aria-sort', 'descending')
    expect(listCalls()[0][1].params).toMatchObject({ sort: 'villages', dir: 'desc' })
  })
})

describe('Explorer list: filters and search', () => {
  it('filters with a pill: one click opens it, one click chooses, and the pill shows the value', async () => {
    await draw()
    const pills = screen.getByRole('group', { name: 'Filters' })
    expect(within(pills).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Province', 'Site type', 'Technology', 'DT contractor',
    ])
    await userEvent.click(within(pills).getByRole('button', { name: 'Province' }))
    expect(screen.getByRole('searchbox', { name: 'Search provinces' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'تهران' }))
    expect(where()).toBe('/explorer?province=2')
    expect(within(pills).getAllByRole('button')[0]).toHaveTextContent('Provinceتهران')
    expect(pill()).toHaveTextContent('of 120 sites')
    expect(pill()).toHaveClass('is-filtered')
  })

  it('removes a filter with its ×, and clears them all', async () => {
    await draw('/explorer?type=New+Site&tech=4G')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Site type filter' }))
    expect(where()).toBe('/explorer?tech=4G')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(where()).toBe('/explorer')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
  })

  it('narrows the Province menu by its search box, and closes on Escape', async () => {
    await draw()
    const province = within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name: 'Province' })
    await userEvent.click(province)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search provinces' }), 'فار')
    expect(within(screen.getByRole('group', { name: 'Province values' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['فارس'])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Province values' })).toBeNull()
    expect(province).toHaveFocus()
  })

  it('focuses the search with / from anywhere on the page', async () => {
    await draw()
    expect(document.querySelector('.exl-slash')).toHaveTextContent('/')
    await userEvent.keyboard('/')
    expect(screen.getByRole('searchbox', { name: /find a site/i })).toHaveFocus()
  })

  it('searches after typing stops, marks the match, and says "matching"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await draw()
      const box = screen.getByRole('searchbox', { name: /find a site/i })
      fireEvent.change(box, { target: { value: 'w401' } })
      expect(where()).toBe('/explorer')
      await act(async () => vi.advanceTimersByTime(260))
      expect(where()).toBe('/explorer?q=w401')
      await act(async () => {})
      expect(bodyRows()).toHaveLength(10)
      expect(bodyRows()[0].querySelector('mark')).toHaveTextContent('W401')
      expect(pill()).toHaveTextContent('10 of 120 sites')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the search with Escape', async () => {
    await draw('/explorer?q=W40')
    const box = screen.getByRole('searchbox', { name: /find a site/i })
    expect(box).toHaveValue('W40')
    box.focus()
    await userEvent.keyboard('{Escape}')
    expect(box).toHaveValue('')
    expect(where()).toBe('/explorer')
  })

  it('clears the search with ×', async () => {
    await draw('/explorer?q=W40')
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('searchbox', { name: /find a site/i })).toHaveValue('')
    expect(where()).toBe('/explorer')
  })

  it('shows the empty state, and Clear search and filters resets the view', async () => {
    await draw('/explorer?q=nothing&tech=4G')
    expect(screen.getByText('No sites match')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(where()).toBe('/explorer')
  })

  it('shows the error state with Retry', async () => {
    api.get.mockImplementationOnce(() => Promise.reject(new Error('down')))
    await draw()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load sites.")
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(bodyRows()).toHaveLength(50)
  })

  it('reads the header search’s old links as filters', async () => {
    await draw('/explorer?province_id=3&contractor_id=5')
    expect(where()).toBe('/explorer?province=3&dt_contractor=5')
  })
})

describe('Explorer list: rows', () => {
  it('opens the record from the row; the checkbox and the villages pill do not', async () => {
    await draw()
    const row = bodyRows()[1]
    await userEvent.click(within(row).getByRole('checkbox', { name: 'Select W4002' }))
    await userEvent.click(within(row).getByRole('button', { name: /villages of W4002/ }))
    expect(where()).toBe('/explorer')
    await userEvent.click(within(row).getByRole('link', { name: 'W4002' }))
    expect(where()).toBe('/explorer/sites/2')
  })

  it('opens one row’s villages at a time, loaded on demand', async () => {
    await draw()
    const pill = within(bodyRows()[1]).getByRole('button', { name: 'Show 2 villages of W4002' })
    await userEvent.click(pill)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
    const strip = screen.getByRole('list', { name: 'Target villages of W4002' })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3)
    expect(api.get).toHaveBeenCalledWith('/explorer/sites/2/villages')
    await userEvent.click(within(bodyRows()[2]).getByRole('button', { name: /villages of W4003/ }))
    expect(screen.queryByRole('list', { name: 'Target villages of W4002' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Target villages of W4003' })).toBeInTheDocument()
  })

  it('shows the matched village under its row, with Open record landing on it', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/explorer/sites') {
        const page = sitesPage({ total: 3 })
        page.items[1].village_match = { code: 'V10002', name: 'روستای 2', more: 2 }
        return Promise.resolve({ data: page })
      }
      if (url.endsWith('/villages')) return Promise.resolve({ data: siteVillages(3) })
      return Promise.resolve({ data: FILTER_OPTIONS })
    })
    await draw('/explorer?q=V10002')
    const row = bodyRows()[1]
    expect(within(row).getByRole('link', { name: 'W4002' })).toHaveAttribute('href', '/explorer/sites/2?village=V10002')
    const line = document.querySelector('.exl-match')
    expect(line).toHaveTextContent('Villageروستای 2V10002+2Open record')
    expect(line.querySelector('mark')).toHaveTextContent('V10002')
    expect(within(line).getByRole('link', { name: /Open record of W4002/ })).toHaveAttribute('href', '/explorer/sites/2?village=V10002')
    expect(document.querySelectorAll('.exl-match')).toHaveLength(1)
    // Opening the villages strip replaces the line, and marks the village there.
    await userEvent.click(within(row).getByRole('button', { name: /villages of W4002/ }))
    expect(document.querySelector('.exl-match')).toBeNull()
    expect(document.querySelector('.exv.is-match')).toHaveTextContent('V10002')
  })

  it('moves between rows with ↑ and ↓; Enter opens', async () => {
    await draw()
    const links = bodyRows().slice(0, 3).map((r) => within(r).getByRole('link'))
    links[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(links[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{ArrowUp}')
    expect(links[1]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(where()).toBe('/explorer/sites/2')
  })
})

describe('Explorer list: continuous scroll and coming back', () => {
  it('loads the next page when the end comes into view', async () => {
    await draw()
    await reachEnd()
    expect(listCalls().at(-1)[1].params).toMatchObject({ cursor: '50', limit: 50 })
    expect(bodyRows()).toHaveLength(100)
    await reachEnd()
    await reachEnd()
    expect(bodyRows()).toHaveLength(120)
    expect(listCalls()).toHaveLength(3)
  })

  it('comes back from a record to the same rows and scroll offset, without fetching again', async () => {
    await draw()
    await reachEnd()
    const body = document.querySelector('.exl-body')
    body.scrollTop = 900
    fireEvent.scroll(body)
    await userEvent.click(within(bodyRows()[60]).getByRole('link'))
    expect(where()).toBe('/explorer/sites/61')
    const before = listCalls().length
    await userEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await act(async () => {})
    expect(bodyRows()).toHaveLength(100)
    expect(listCalls()).toHaveLength(before)
    expect(document.querySelector('.exl-body').scrollTop).toBe(900)
  })
})

describe('Explorer list: selection', () => {
  it('selects the loaded rows, then exports or copies them from the bulk bar', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    window.URL.createObjectURL = vi.fn(() => 'blob:x')
    window.URL.revokeObjectURL = vi.fn()
    await draw()
    expect(screen.queryByRole('region', { name: 'Selected sites' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all loaded sites' }))
    const bar = screen.getByRole('region', { name: 'Selected sites' })
    expect(bar).toHaveTextContent('50 selected')
    expect(bodyRows()[0]).toHaveClass('is-selected')

    await userEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }))
    await userEvent.click(within(bodyRows()[0]).getByRole('checkbox'))
    await userEvent.click(within(bodyRows()[2]).getByRole('checkbox'))
    const bar2 = screen.getByRole('region', { name: 'Selected sites' })
    await userEvent.click(within(bar2).getByRole('button', { name: 'Copy IDs' }))
    expect(writeText).toHaveBeenCalledWith('W4001\nW4003')
    await userEvent.click(within(bar2).getByRole('button', { name: 'Export' }))
    const exportCall = api.get.mock.calls.find(([url]) => url === '/explorer/sites/export')
    expect(exportCall[1].params).toMatchObject({ ids: [1, 3], sort: 'site', dir: 'asc' })
  })

  it('exports the current view from the page Export button', async () => {
    window.URL.createObjectURL = vi.fn(() => 'blob:x')
    window.URL.revokeObjectURL = vi.fn()
    await draw('/explorer?q=W40&sort=stage')
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    const exportCall = api.get.mock.calls.find(([url]) => url === '/explorer/sites/export')
    expect(exportCall[1].params).toEqual({ q: 'W40', sort: 'stage', dir: 'asc' })
  })
})

describe('Explorer list: motion', () => {
  it('rises the first 20 rows of a new result in, staggered', async () => {
    await draw()
    const rows = bodyRows()
    expect(rows[0]).toHaveClass('is-rising')
    expect(rows[19]).toHaveClass('is-rising')
    expect(rows[19].style.getPropertyValue('--exl-i')).toBe('19')
    expect(rows[20]).not.toHaveClass('is-rising')
  })

  it('turns every animation off under reduced motion, on the list and the record', () => {
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toContain(':is(.ex-page, .exl-page, .exh) *')
    expect(reduce).toContain('animation: none !important')
    expect(css).toContain("html[data-uep-motion='reduce'] :is(.ex-page, .exl-page, .exh) * { animation: none !important; transition: none !important; }")
  })
})
