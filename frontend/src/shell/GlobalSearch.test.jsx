import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import api from '../api/client'
import { appsFor } from './appRegistry'
import GlobalSearch, { matchPages, resultGroups } from './GlobalSearch'
import { GROUP_LOOK } from './searchLook'

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }))

const EMPTY = { sites: [], villages: [], provinces: [], contractors: [], people: [] }

function Where() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

function renderSearch(role = 'PM') {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <GlobalSearch apps={appsFor(role)} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('matchPages', () => {
  it('finds a page by its label and every page of an app by the app name', () => {
    const apps = appsFor('PM')
    expect(matchPages(apps, 'checks').map((p) => p.label)).toEqual(['Checks'])
    expect(matchPages(apps, 'monthly').map((p) => p.label)).toEqual(['Approvals', 'Plans', 'History', 'Internal PIP'])
    expect(matchPages(apps, '  ')).toEqual([])
  })

  it('offers only the pages this role may open', () => {
    expect(matchPages(appsFor('Contractor'), 'audit')).toEqual([])
    expect(matchPages(appsFor('Admin'), 'audit').map((p) => p.to)).toEqual(['/admin?tab=audit'])
  })
})

describe('resultGroups', () => {
  it('turns each kind of result into a link to its own screen', () => {
    const groups = resultGroups([], {
      sites: [{ id: 7, site_code: 'TEH-001', province: 'تهران', stage: 'Perm On Air' }],
      villages: [{ work_item_id: 7, village_name: 'Alpha', village_code: 'V1', site_code: 'TEH-001' }],
      provinces: [{ id: 3, name: 'تهران' }],
      contractors: [{ id: 4, name: 'Towers Co' }],
      people: [{ id: 9, full_name: 'Sara Finder', username: 's.finder', role: 'PM' }],
    })
    expect(groups.map((g) => g.id)).toEqual(['sites', 'villages', 'provinces', 'contractors', 'people'])
    expect(groups.map((g) => g.items[0].to)).toEqual([
      '/explorer/sites/7',
      '/explorer/sites/7?village=V1',
      '/explorer?province=3',
      '/explorer?dt_contractor=4',
      '/admin?tab=users&search=s.finder',
    ])
  })

  it('opens a village result on its site with the village highlighted, by ID or name', () => {
    const [villages] = resultGroups([], {
      ...EMPTY,
      villages: [
        { work_item_id: 7, village_name: 'Alpha', village_code: 'V10232', site_code: 'TEH-001' },
        { work_item_id: 8, village_name: 'Beta', village_code: null, site_code: 'TEH-002' },
      ],
    })
    expect(villages.items.map((i) => i.to)).toEqual(['/explorer/sites/7?village=V10232', '/explorer/sites/8'])
  })

  it('leaves out empty groups', () => {
    expect(resultGroups([], EMPTY)).toEqual([])
  })
})

describe('GlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.get.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('lists apps and pages from the first character, before asking the server', () => {
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'h' } })

    expect(screen.getByRole('option', { name: /HC check/ })).toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('asks GET /search from two characters and opens the chosen site', async () => {
    api.get.mockResolvedValue({ data: { ...EMPTY, sites: [{ id: 7, site_code: 'TEH-001', province: null, stage: null }] } })
    renderSearch()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'teh' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(api.get).toHaveBeenCalledWith('/search', { params: { q: 'teh' } })
    fireEvent.click(screen.getByRole('option', { name: /TEH-001/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/explorer/sites/7')
  })

  it('moves through results with the arrow keys and opens one with Enter', async () => {
    api.get.mockResolvedValue({ data: EMPTY })
    renderSearch()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'assign' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option', { name: /Assign/ })[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.submit(input.closest('form'))
    expect(screen.getByTestId('where')).toHaveTextContent('/drive-test?tab=assign')
  })

  it('always offers the full site list for the term', async () => {
    api.get.mockResolvedValue({ data: EMPTY })
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zz9' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    fireEvent.click(screen.getByRole('option', { name: /Search all sites for “zz9”/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/explorer?q=zz9')
  })

  it('says so when nothing matches', async () => {
    api.get.mockResolvedValue({ data: EMPTY })
    renderSearch('Admin')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zz9' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches “zz9”.')
  })

  it('Escape clears the text first, then leaves the field', () => {
    renderSearch()
    const input = screen.getByRole('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'h' } })
    expect(input).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-expanded', 'false')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).not.toHaveFocus()
  })

  it('tells screen readers it is searching while the server answers', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'teh' } })

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Searching…')
    expect(status.querySelector('.sr-only')).toHaveTextContent('Searching…')
  })

  it('keeps the panel in the page, inert and hidden, while it leaves', () => {
    const { container } = renderSearch()
    const panel = container.querySelector('.uep-search-panel')
    expect(panel).toHaveAttribute('data-state', 'hidden')
    expect(panel).toHaveAttribute('inert')
    expect(panel).toHaveAttribute('aria-hidden', 'true')

    const input = screen.getByRole('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'h' } })
    expect(panel).toHaveAttribute('data-state', 'showing')
    expect(panel).not.toHaveAttribute('inert')

    fireEvent.keyDown(input, { key: 'Escape' })
    // Same node, still holding the rows it showed, while it animates out.
    expect(container.querySelector('.uep-search-panel')).toBe(panel)
    expect(panel).toHaveAttribute('data-state', 'hidden')
    expect(panel).toHaveAttribute('inert')
    expect(panel.querySelector('[role="option"]')).not.toBeNull()
  })

  it('bolds the matched text and isolates Persian parts in <bdi>', async () => {
    api.get.mockResolvedValue({
      data: { ...EMPTY, sites: [{ id: 7, site_code: 'TEH-001', province: 'کرمان', stage: 'Acceptance' }] },
    })
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'teh' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    const option = screen.getByRole('option', { name: /TEH-001/ })
    expect(option.querySelector('.uep-search-option-label b')).toHaveTextContent('TEH')
    const persian = option.querySelector('bdi[lang="fa"]')
    expect(persian).toHaveTextContent('کرمان')
    expect([...option.querySelectorAll('.uep-search-option-meta bdi')].map((b) => b.textContent)).toEqual([
      'کرمان',
      'Acceptance',
    ])
  })

  it('draws each group with its own icon', async () => {
    api.get.mockResolvedValue({
      data: {
        sites: [{ id: 7, site_code: 'TEH-001', province: null, stage: null }],
        villages: [{ work_item_id: 7, village_name: 'Tehran-e Now', village_code: 'V1', site_code: 'TEH-001' }],
        provinces: [{ id: 3, name: 'Tehran' }],
        contractors: [{ id: 4, name: 'Teh Towers' }],
        people: [],
      },
    })
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'teh' } })
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    const icon = (name) => screen.getByRole('option', { name }).querySelector('.uep-search-tile svg').dataset.icon
    expect(icon(/^TEH-001/)).toBe('cell-tower')
    expect(icon(/Tehran-e Now/)).toBe('home')
    expect(icon(/^Tehran,/)).toBe('location')
    expect(icon(/Teh Towers/)).toBe('enterprise')
    expect(icon(/Search all sites/)).toBe('search')
  })
})

describe('GROUP_LOOK', () => {
  it('maps every group to its Carbon icon', () => {
    expect(Object.fromEntries(Object.entries(GROUP_LOOK).map(([k, v]) => [k, v.icon]))).toEqual({
      pages: 'document',
      sites: 'cell-tower',
      villages: 'home',
      provinces: 'location',
      contractors: 'enterprise',
      people: 'user',
      all: 'search',
    })
  })
})
