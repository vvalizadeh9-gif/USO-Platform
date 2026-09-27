// Coverage map: what it draws, and what it must never draw.
//
//   * one shape per province on the ICT map and one per CRA region on the CRA
//     map -- 31 and 9 for the whole country, never CRA per province;
//   * a low-sample shape is hatched and takes no part in the colour bands;
//   * every shape's numbers are text, on hover and on click, and they are the
//     numbers the server sent;
//   * a non-PM is told the map is their own sites only.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approvalRate, bands, borderPath, bandOf } from './coverageMap'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const api = (await import('../../api/client')).default
const CoverageMap = (await import('./CoverageMap')).default

// The 31, as province_directory.py groups them into the nine CRA regions.
const DIRECTORY = {
  Azar: ['Ardabil', 'East Azerbaijan', 'West Azerbaijan'],
  Central: ['Chaharmahal & Bakhtiari', 'Isfahan', 'Markazi', 'Qom', 'Yazd'],
  North: ['Alborz', 'Mazandaran', 'Semnan', 'Tehran'],
  'North East': ['Golestan', 'North Khorasan', 'Razavi Khorasan', 'South Khorasan'],
  'North West': ['Gilan', 'Qazvin', 'Zanjan'],
  South: ['Bushehr', 'Fars', 'Kohgiluyeh & Boyer-Ahmad'],
  'South East': ['Hormozgan', 'Kerman', 'Sistan & Baluchestan'],
  'South West': ['Ilam', 'Khuzestan', 'Lorestan'],
  West: ['Hamadan', 'Kermanshah', 'Kurdistan'],
}

const row = (name, stopped, reached, over = {}) => ({
  name,
  attribution: 'owned',
  villages: reached,
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  low_sample: reached < 10,
  ...over,
})

// Every province gets two hexes side by side; provinces sit in a column per
// region, so each region's hexes touch.
function country() {
  const cells = []
  const provinces = []
  const regions = []
  Object.entries(DIRECTORY).forEach(([region, names], column) => {
    const members = []
    names.forEach((name, index) => {
      cells.push({ q: column * 3, r: index, province: name, region, sites: 4 })
      cells.push({ q: column * 3 + 1, r: index, province: name, region, sites: 4 })
      // Approval rises steadily down the list: 50% up to 80%.
      const reached = 100
      const stopped = 50 - provinces.length
      provinces.push(row(name, stopped, reached))
      members.push(row(name, stopped, reached))
    })
    const stopped = members.reduce((s, m) => s + m.stopped, 0)
    const reached = members.reduce((s, m) => s + m.reached, 0)
    regions.push({ ...row(region, stopped, reached), members })
  })
  return { cells, provinces, regions }
}

const payload = (over = {}) => {
  const { cells, provinces, regions } = country()
  return {
    scoped: false,
    lens_label: null,
    key: null,
    last_cpm_import: '2026-09-01T09:30:00Z',
    low_sample_threshold: 10,
    ict: { label: 'ICT approval', provinces },
    cra: { label: 'CRA approval', regions },
    cells,
    data_quality: {
      sites_without_location: 0,
      provinces_without_shape: [],
      regions_without_shape: [],
    },
    ...over,
  }
}

function serve(body) {
  api.get.mockImplementation((url) => {
    if (url === '/gaps/map') return Promise.resolve({ data: body })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

const shapes = (id) =>
  screen.getByTestId(`gap-map-${id}`).querySelectorAll('[data-shape]')

const shape = (id, name) =>
  screen.getByTestId(`gap-map-${id}`).querySelector(`[data-shape="${name}"]`)

beforeEach(() => {
  api.get.mockReset()
})

describe('the shapes', () => {
  it('draws 31 provinces on the ICT map and 9 regions on the CRA map', async () => {
    serve(payload())
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')
    expect(shapes('ict')).toHaveLength(31)
    expect(shapes('cra')).toHaveLength(9)

    const regions = [...shapes('cra')].map((node) => node.dataset.shape).sort()
    expect(regions).toEqual(Object.keys(DIRECTORY).sort())
  })

  it('resolves every province to a shape, none silently dropped', async () => {
    serve(payload())
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')
    for (const name of Object.values(DIRECTORY).flat()) {
      expect(shape('ict', name), name).not.toBeNull()
    }
  })

  it('names a province it cannot draw instead of leaving a hole', async () => {
    const body = payload()
    body.cells = body.cells.filter((cell) => cell.province !== 'Qom')
    body.data_quality.provinces_without_shape = ['Qom']
    body.data_quality.sites_without_location = 3
    serve(body)
    render(<CoverageMap />)
    const note = await screen.findByTestId('gap-map-offmap')
    expect(note).toHaveTextContent('No located site, so no shape: Qom.')
    expect(note).toHaveTextContent('3 site(s) have no CPM coordinates')
    expect(shapes('ict')).toHaveLength(30)
  })
})

describe('colour', () => {
  it('hatches a low-sample shape and leaves it out of the bands', async () => {
    const body = payload()
    // Qom: three villages, all approved -- 100%, and meaningless.
    const qom = body.ict.provinces.find((p) => p.name === 'Qom')
    Object.assign(qom, row('Qom', 0, 3))
    serve(body)
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')

    expect(shape('ict', 'Qom').dataset.hatched).toBe('true')
    expect(shape('ict', 'Tehran').dataset.hatched).toBe('false')

    // Without Qom the best province is 80% approved, so the scale tops out at
    // 80 -- a 100% low-sample row would have stretched it to 100.
    const legend = screen.getAllByTestId('gap-legend-band').map((n) => n.textContent)
    expect(legend.at(-1)).toMatch(/–80%$/)
    expect(screen.getByText(/Fewer than 10 reached — not compared/)).toBeInTheDocument()
  })

  it('uses one set of bands for both maps', () => {
    const scale = bands([row('A', 50, 100), row('B', 10, 100), row('Tiny', 0, 2)])
    expect(scale.lo).toBe(50)
    expect(scale.hi).toBe(90)
    expect(bandOf(50, scale)).toBe(0)
    expect(bandOf(90, scale)).toBe(4)
    expect(bands([row('Tiny', 0, 2)])).toBeNull()
  })

  it('works approval from the counts, not from the rounded rate', () => {
    expect(approvalRate(row('A', 1, 3))).toBeCloseTo(66.667, 2)
    expect(approvalRate(row('Empty', 0, 0))).toBeNull()
  })
})

describe('the numbers behind every shape', () => {
  it('prints name, stopped, reached and rate as text on hover', async () => {
    serve(payload())
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')
    fireEvent.mouseEnter(shape('ict', 'Tehran'))
    const readout = screen.getByTestId('gap-map-ict').querySelector('.gap-map-readout')
    const tehran = payload().ict.provinces.find((p) => p.name === 'Tehran')
    expect(readout).toHaveTextContent(
      `Tehran — ICT approval ${approvalRate(tehran).toFixed(1)}% · ${tehran.stopped} stopped of ${tehran.reached} reached`
    )
  })

  it('opens a province with the same figures the server sent', async () => {
    const body = payload()
    body.ict.provinces = body.ict.provinces.map((p) =>
      p.name === 'Ardabil' ? row('Ardabil', 4, 6) : p
    )
    serve(body)
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')
    await userEvent.click(shape('ict', 'Ardabil'))

    const detail = screen.getByRole('region', { name: 'Ardabil detail' })
    expect(detail).toHaveTextContent('Azar region')
    expect(detail).toHaveTextContent('2 of 6 approved')
    expect(detail).toHaveTextContent('4 of 6 reached')
    expect(detail).toHaveTextContent('66.7%')
    expect(detail).toHaveTextContent('Fewer than 10 villages reached this stretch')
  })

  it('opens a region with its provinces broken out on the owner-list row', async () => {
    serve(payload())
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-cra')
    await userEvent.click(shape('cra', 'North'))

    const detail = screen.getByRole('region', { name: 'North region detail' })
    const table = within(detail).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: '% of region' })).toBeInTheDocument()
    const names = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.textContent)
    expect(names.sort()).toEqual([...DIRECTORY.North].sort())

    // Clicking again closes it.
    await userEvent.click(shape('cra', 'North'))
    expect(screen.queryByRole('region', { name: 'North region detail' })).toBeNull()
  })
})

describe('scope', () => {
  it("tells a non-PM the map is their own sites only", async () => {
    const body = payload({ scoped: true, lens_label: 'PSO Coordinator', key: 'Hossein' })
    body.cells = body.cells.filter((cell) => cell.province === 'Ardabil')
    body.ict.provinces = body.ict.provinces.filter((p) => p.name === 'Ardabil')
    body.cra.regions = body.cra.regions.filter((r) => r.name === 'Azar')
    serve(body)
    render(<CoverageMap />)
    await screen.findByTestId('gap-map-ict')
    expect(screen.getByText(/Showing your own sites only/)).toHaveTextContent('Hossein')
    expect(shapes('ict')).toHaveLength(1)
    expect(shapes('cra')).toHaveLength(1)
  })

  it('shows the server refusal rather than an empty map', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'You do not have permission' } } })
    render(<CoverageMap />)
    await waitFor(() => expect(screen.getByText('You do not have permission')).toBeInTheDocument())
  })
})

describe('borders', () => {
  it('draws no edge between two hexes of the same shape', () => {
    const edges = (d) => (d.match(/M/g) || []).length
    const pair = [
      { q: 0, r: 0, k: 'A' },
      { q: 1, r: 0, k: 'A' },
    ]
    expect(edges(borderPath(pair, (c) => c.k))).toBe(10)
    const split = [
      { q: 0, r: 0, k: 'A' },
      { q: 1, r: 0, k: 'B' },
    ]
    expect(edges(borderPath(split, (c) => c.k))).toBe(12)
  })
})
