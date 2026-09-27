// Coverage map: what it draws, and what it must never draw.
//
//   * one shape per province on the ICT map (31) and one per CRA region on the
//     CRA map (9) -- never CRA per province;
//   * the join to the API is the province's Persian name, so every figure lands
//     on its own province;
//   * a low-sample shape is hatched, not coloured;
//   * every shape carries its number; clicking a province or a region shows
//     the same figures the server sent;
//   * a non-PM sees the map with only their own provinces coloured.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BANDS, approvalRate, bandOf, regionDrift, reportOrder } from './coverageMap'
import iranMap from './iranMap.json'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const api = (await import('../../api/client')).default
const CoverageMap = (await import('./CoverageMap')).default

const fig = (stopped, reached) => ({
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  low_sample: reached < 10,
})

// One row per province in the map asset, which carries the directory's
// region for each. ICT approval 80% everywhere, CRA 50%, unless a test says.
function payload(over = {}) {
  const provinces = Object.entries(iranMap.provinces).map(([key, shape]) => ({
    key,
    name: shape.en,
    attribution: 'owned',
    region: shape.region,
    villages: 120,
    ict: fig(20, 100),
    cra: fig(40, 80),
  }))
  const regions = Object.keys(iranMap.regions).map((name) => {
    const members = provinces.filter((p) => p.region === name)
    const sum = (stretch, counter) => members.reduce((s, m) => s + m[stretch][counter], 0)
    return {
      name,
      attribution: 'owned',
      provinces: members.map((m) => m.key),
      villages: members.length * 120,
      ict: fig(sum('ict', 'stopped'), sum('ict', 'reached')),
      cra: fig(sum('cra', 'stopped'), sum('cra', 'reached')),
    }
  })
  return {
    scoped: false,
    lens_label: null,
    key: null,
    last_cpm_import: null,
    low_sample_threshold: 10,
    provinces,
    regions,
    total: { villages: 31 * 120, ict: fig(620, 3100), cra: fig(1240, 2480) },
    ...over,
  }
}

const QOM = 'قم'
const ISFAHAN = 'اصفهان'

function serve(body) {
  api.get.mockImplementation((url) =>
    url === '/gaps/map'
      ? Promise.resolve({ data: body })
      : Promise.reject(new Error(`unexpected ${url}`))
  )
}

const shapes = (map) =>
  screen.getByTestId(`cov-map-${map}`).querySelectorAll('[data-shape]')
const shape = (map, id) =>
  screen.getByTestId(`cov-map-${map}`).querySelector(`[data-shape="${id}"]`)

async function draw(body = payload()) {
  serve(body)
  render(<CoverageMap />)
  await screen.findByTestId('cov-map-ict')
}

beforeEach(() => {
  api.get.mockReset()
})

describe('the shapes', () => {
  it('draws 31 provinces on the ICT map and 9 regions on the CRA map', async () => {
    await draw()
    expect(shapes('ict')).toHaveLength(31)
    expect(shapes('cra')).toHaveLength(9)
    expect([...shapes('cra')].map((n) => n.dataset.shape).sort()).toEqual([
      'Azar',
      'Central',
      'North',
      'North East',
      'North West',
      'South',
      'South East',
      'South West',
      'West',
    ])
  })

  it('puts each figure on its own province, joined by the Persian name', async () => {
    const body = payload()
    body.provinces.find((p) => p.key === ISFAHAN).ict = fig(90, 100) // 10% approved
    await draw(body)
    expect(shape('ict', ISFAHAN).getAttribute('aria-label')).toBe(
      'Isfahan — ICT approval 10.0%: 10 of 100 approved, 90 stopped'
    )
    expect(shape('ict', ISFAHAN).querySelector('path').getAttribute('fill')).toBe(BANDS[0].fill)
    expect(shape('ict', QOM).querySelector('path').getAttribute('fill')).toBe(BANDS[4].fill)
  })

  it('prints every shape’s name and rate on the map', async () => {
    await draw()
    const ict = within(screen.getByTestId('cov-map-ict'))
    expect(ict.getByText('Isfahan')).toBeInTheDocument()
    expect(ict.getAllByText('80%')).toHaveLength(31)
    const cra = within(screen.getByTestId('cov-map-cra'))
    expect(cra.getAllByText('50%')).toHaveLength(9)
  })
})

describe('colour', () => {
  it('hatches a low-sample province and says what the hatch means', async () => {
    const body = payload()
    body.provinces.find((p) => p.key === QOM).ict = fig(0, 3)
    await draw(body)
    expect(shape('ict', QOM).dataset.state).toBe('hatched')
    expect(shape('ict', QOM).querySelector('path').getAttribute('fill')).toBe('url(#cov-hatch)')
    expect(shape('ict', ISFAHAN).dataset.state).toBe('coloured')
    expect(screen.getByText(/Hatched = fewer than 10 reached, not compared/)).toBeInTheDocument()
  })

  it('uses six fixed bands', () => {
    const at = (approved) => bandOf(fig(100 - approved, 100)).label
    expect(at(10)).toBe('< 25%')
    expect(at(25)).toBe('25–40%')
    expect(at(54)).toBe('40–55%')
    expect(at(55)).toBe('55–70%')
    expect(at(84)).toBe('70–85%')
    expect(at(100)).toBe('85%+')
    expect(bandOf(fig(0, 0))).toBeNull()
    expect(bandOf(fig(0, 9))).toBeNull()
  })

  it('works approval from the counts, not from the rounded rate', () => {
    expect(approvalRate(fig(1, 3))).toBeCloseTo(66.667, 2)
    expect(approvalRate(fig(0, 0))).toBeNull()
  })
})

describe('clicking', () => {
  it('opens a province with the figures the server sent', async () => {
    const body = payload()
    const isfahan = body.provinces.find((p) => p.key === ISFAHAN)
    isfahan.ict = fig(90, 221)
    isfahan.cra = fig(60, 131)
    await draw(body)
    expect(screen.getByText('Click any province to see its numbers here.')).toBeInTheDocument()

    await userEvent.click(shape('ict', ISFAHAN))
    const detail = screen.getByRole('region', { name: 'Isfahan detail' })
    expect(detail).toHaveTextContent('Central region')
    expect(detail).toHaveTextContent('Drive test done221')
    expect(detail).toHaveTextContent('59.3%131 of 221')
    expect(detail).toHaveTextContent('Stopped before ICT90')
    expect(detail).toHaveTextContent('54.2%71 of 131 ICT-approved')
  })

  it('opens a region’s provinces in the report', async () => {
    await draw()
    expect(screen.queryByRole('rowheader', { name: 'Tehran' })).toBeNull()
    await userEvent.click(shape('cra', 'North'))
    for (const name of ['Alborz', 'Mazandaran', 'Semnan', 'Tehran']) {
      expect(screen.getByRole('rowheader', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('the region report', () => {
  it('lists the worst CRA region first and totals every region', async () => {
    const body = payload()
    body.regions.find((r) => r.name === 'South West').cra = fig(80, 100) // 20%
    await draw(body)
    const table = screen.getByRole('table')
    const first = within(table).getAllByRole('row')[1]
    expect(first).toHaveTextContent('South West')
    expect(within(table).getByRole('rowheader', { name: 'All 9 regions' })).toBeInTheDocument()
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('All 9 regions313,100')
  })

  it('keeps regions nobody owns at the bottom, named', () => {
    const rows = reportOrder([
      { name: 'Unknown province', attribution: 'unknown_province', cra: fig(0, 5) },
      { name: 'North', attribution: 'owned', cra: fig(50, 100) },
      { name: 'Azar', attribution: 'owned', cra: fig(70, 100) },
    ])
    expect(rows.map((r) => r.name)).toEqual(['Azar', 'North', 'Unknown province'])
  })

  it('carries the OpenStreetMap attribution on the page', async () => {
    await draw()
    expect(screen.getByText(/© OpenStreetMap contributors/)).toHaveTextContent('ODbL')
  })
})

describe('scope and drift', () => {
  it('colours only a non-PM’s own provinces and greys the rest', async () => {
    const body = payload({ scoped: true, lens_label: 'PSO Coordinator', key: 'Hossein' })
    body.provinces = body.provinces.filter((p) => p.key === ISFAHAN)
    body.regions = body.regions.filter((r) => r.name === 'Central')
    await draw(body)
    expect(screen.getByText(/Showing your own scope only/)).toHaveTextContent('Hossein')
    expect(shape('ict', ISFAHAN).dataset.state).toBe('coloured')
    expect(shape('ict', QOM).dataset.state).toBe('outside')
    expect(shape('cra', 'North').dataset.state).toBe('outside')
    expect(screen.getByRole('rowheader', { name: 'Your total' })).toBeInTheDocument()
  })

  it('says so when the mapping has moved a province to another region', async () => {
    const body = payload()
    body.provinces.find((p) => p.key === QOM).region = 'North'
    await draw(body)
    expect(screen.getByTestId('cov-drift')).toHaveTextContent('Qom to North')
    expect(regionDrift(payload().provinces, iranMap)).toEqual([])
  })

  it('shows the server refusal rather than an empty map', async () => {
    api.get.mockRejectedValue({ response: { data: { detail: 'You do not have permission' } } })
    render(<CoverageMap />)
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument()
  })
})
