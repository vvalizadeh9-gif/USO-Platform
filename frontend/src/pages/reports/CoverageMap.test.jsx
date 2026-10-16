// Coverage map: what it draws, and what it must never draw.
//
//   * one map at a time: 31 provinces on the ICT map, 9 CRA regions on the CRA
//     map -- never CRA per province;
//   * the join to the API is the province's Persian name, so every figure lands
//     on its own province;
//   * a low-sample shape is hatched, not coloured;
//   * the detail panel is empty until a click, shows the shape's own figures,
//     and clears on a second click, ✕, Esc or a map switch;
//   * every village count in the panel is an export of exactly those villages;
//   * a non-PM sees the map with only their own shapes coloured.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BANDS, approvalRate, bandOf, detailBand, regionDrift } from './coverageMap'
import iranMap from './iranMap.json'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../../lib/download', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}))

const api = (await import('../../api/client')).default
const CoverageMap = (await import('./CoverageMap.jsx')).default

const fig = (stopped, reached) => ({
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  low_sample: reached < 10,
  sites: { approved: Math.round((reached - stopped) / 3), reached: Math.round(reached / 3) },
})

const f = (sites, villages) => ({ sites, villages })

/** A detail block: ICT 285 of 403 villages approved, CRA 201 of 403. */
function detail() {
  return {
    delivery: { assigned: f(150, 480), on_air: f(140, 450), dt: f(130, 403) },
    ict: { approved: f(90, 285), pending: f(40, 118) },
    cra: { approved: f(60, 201), pending: f(70, 202) },
  }
}

// One row per province in the map asset, which carries the directory's
// region for each. ICT approval 80% everywhere, CRA 50%, unless a test says.
function payload(over = {}) {
  const provinces = Object.entries(iranMap.provinces).map(([key, shape]) => ({
    key,
    name: shape.en,
    attribution: 'owned',
    region: shape.region,
    managers: ['Allahyar'],
    villages: 120,
    ict: fig(20, 100),
    cra: fig(40, 80),
    detail: detail(),
  }))
  const regions = Object.keys(iranMap.regions).map((name) => {
    const members = provinces.filter((p) => p.region === name)
    const sum = (s, counter) => members.reduce((acc, m) => acc + m[s][counter], 0)
    return {
      name,
      attribution: 'owned',
      provinces: members.map((m) => m.key),
      managers: ['Allahyar', 'Nobakht'],
      villages: members.length * 120,
      ict: fig(sum('ict', 'stopped'), sum('ict', 'reached')),
      cra: fig(sum('cra', 'stopped'), sum('cra', 'reached')),
      detail: detail(),
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
  api.get.mockImplementation((url) => {
    if (url === '/gaps/map') return Promise.resolve({ data: body })
    if (url === '/gaps/villages.xlsx') return Promise.resolve({ data: new Blob(['x']), headers: {} })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

const shapes = (map) => screen.getByTestId(`cov-map-${map}`).querySelectorAll('[data-shape]')
const shape = (map, id) =>
  screen.getByTestId(`cov-map-${map}`).querySelector(`[data-shape="${id}"]`)
// The old map fades out before the new one is drawn.
const toCra = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'CRA approval · by region' }))
  await screen.findByTestId('cov-map-cra')
}
const panel = () => screen.getByRole('region', { name: /detail$/ })

async function draw(body = payload()) {
  serve(body)
  render(<CoverageMap />)
  await screen.findByTestId('cov-map-ict')
}

beforeEach(() => {
  api.get.mockReset()
})

describe('the map switch', () => {
  it('shows one map at a time, ICT by province first', async () => {
    await draw()
    const group = screen.getByRole('group', { name: 'Map' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'ICT approval · by province',
      'CRA approval · by region',
    ])
    expect(shapes('ict')).toHaveLength(31)
    expect(screen.queryByTestId('cov-map-cra')).not.toBeInTheDocument()

    await toCra()
    expect(screen.queryByTestId('cov-map-ict')).not.toBeInTheDocument()
    expect([...shapes('cra')].map((n) => n.dataset.shape).sort()).toEqual([
      'Azar', 'Central', 'North', 'North East', 'North West', 'South', 'South East', 'South West', 'West',
    ])
  })
})

describe('the shapes', () => {
  it('puts each figure on its own province, joined by the Persian name', async () => {
    const body = payload()
    body.provinces.find((p) => p.key === ISFAHAN).ict = fig(90, 100) // 10% approved
    await draw(body)
    expect(shape('ict', ISFAHAN).getAttribute('aria-label')).toBe(
      'Isfahan · 10% ICT approved, 10 of 100 villages, 3 of 33 sites'
    )
    expect(shape('ict', ISFAHAN).querySelector('path').getAttribute('fill')).toBe(BANDS[0].fill)
    expect(shape('ict', QOM).querySelector('path').getAttribute('fill')).toBe(BANDS[4].fill)
  })

  it('prints every shape’s name and rate on the map', async () => {
    await draw()
    const ict = within(screen.getByTestId('cov-map-ict'))
    expect(ict.getByText('Isfahan')).toBeInTheDocument()
    expect(ict.getAllByText('80%')).toHaveLength(31)
    await toCra()
    expect(within(screen.getByTestId('cov-map-cra')).getAllByText('50%')).toHaveLength(9)
  })
})

describe('colour', () => {
  it('hatches a low-sample province', async () => {
    const body = payload()
    body.provinces.find((p) => p.key === QOM).ict = fig(0, 3)
    await draw(body)
    expect(shape('ict', QOM).dataset.state).toBe('hatched')
    expect(shape('ict', QOM).querySelector('path').getAttribute('fill')).toBe('url(#cov-hatch)')
    expect(shape('ict', ISFAHAN).dataset.state).toBe('coloured')
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

  it('has no caption under the map; the legend shares the switch row', async () => {
    await draw()
    expect(document.querySelector('.cov-caption')).toBeNull()
    expect(screen.queryByText(/OpenStreetMap/)).not.toBeInTheDocument()
    const head = document.querySelector('.cov-map-head')
    expect(within(head).getByRole('group', { name: 'Map' })).toBeInTheDocument()
    expect(within(head).getByRole('list', { name: 'Approval rate bands' })).toBeInTheDocument()
  })
})

describe('the detail panel', () => {
  it('is empty until a click', async () => {
    await draw()
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /detail$/ })).not.toBeInTheDocument()
    await toCra()
    expect(screen.getByText('Select a CRA region on the map')).toBeInTheDocument()
  })

  it('shows a province: delivery, ICT and CRA, each in sites and villages', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    const detailPanel = panel()
    expect(detailPanel).toHaveAccessibleName('Isfahan detail')
    expect(within(detailPanel).getByText('Central region')).toBeInTheDocument()
    for (const name of ['Delivery', 'ICT', 'CRA']) {
      const group = within(detailPanel).getByRole('region', { name })
      expect(within(group).getByText('Sites')).toBeInTheDocument()
      expect(within(group).getByText('Villages')).toBeInTheDocument()
    }
    const row = (group, label) =>
      within(within(detailPanel).getByRole('region', { name: group })).getByText(label).closest('.cov-fig')
    expect(row('Delivery', 'Total assigned')).toHaveTextContent('Total assigned150480')
    expect(row('Delivery', 'Total drive test')).toHaveTextContent('130403')
    expect(row('ICT', 'Approved')).toHaveTextContent('Approved90285')
    expect(row('CRA', 'Pending')).toHaveTextContent('Pending70202')
    expect(within(detailPanel).getByText('70.7%')).toBeInTheDocument() // 285 of 403
    expect(shape('ict', ISFAHAN)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cov-outline')).toBeInTheDocument()
  })

  it('no longer lists owners', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    expect(within(panel()).queryByRole('group', { name: 'List by' })).not.toBeInTheDocument()
    expect(within(panel()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('makes the ICT and CRA village counts exports; sites are plain', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    const labels = within(panel())
      .getAllByRole('button', { name: /^Export/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Export 285 villages (ICT approved · Isfahan) to Excel',
      'Export 118 villages (ICT pending · Isfahan) to Excel',
      'Export 201 villages (CRA approved · Isfahan) to Excel',
      'Export 202 villages (CRA pending · Isfahan) to Excel',
    ])
    await userEvent.click(within(panel()).getByRole('button', { name: /ICT pending/ }))
    expect(api.get).toHaveBeenCalledWith('/gaps/villages.xlsx', {
      params: { gap: 'pending_ict', scope: `province:${ISFAHAN}` },
      responseType: 'blob',
    })
  })

  it('shows a CRA region with its province count', async () => {
    await draw()
    await toCra()
    await userEvent.click(shape('cra', 'North'))
    expect(within(panel()).getByText('4 provinces')).toBeInTheDocument()
  })

  it('carries sites and villages in the tooltip', async () => {
    await draw()
    await userEvent.hover(shape('ict', ISFAHAN))
    const tip = screen.getByTestId('cov-tip')
    expect(tip).toHaveTextContent('Isfahan · 80% ICT approved')
    expect(tip).toHaveTextContent('80 of 100 villages')
    expect(tip).toHaveTextContent('27 of 33 sites')
    expect(shape('ict', ISFAHAN).querySelector('title')).toBeNull()
  })

  it('clears on a second click on the same shape', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    await userEvent.click(shape('ict', ISFAHAN))
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()
    expect(screen.queryByTestId('cov-outline')).not.toBeInTheDocument()
  })

  it('clears on ✕ and on Esc', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()

    await userEvent.click(shape('ict', QOM))
    expect(panel()).toHaveAccessibleName('Qom detail')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()
  })

  it('clears when the map is switched', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    await toCra()
    expect(screen.getByText('Select a CRA region on the map')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'ICT approval · by province' }))
    expect(await screen.findByText('Select a province on the map')).toBeInTheDocument()
  })

  it('selects with the keyboard too', async () => {
    await draw()
    shape('ict', QOM).focus()
    await userEvent.keyboard('{Enter}')
    expect(panel()).toHaveAccessibleName('Qom detail')
  })
})

describe('detail arithmetic', () => {
  it('does not band a detail figure under the low-sample threshold', () => {
    const stage = (approved, pending) => ({ approved: f(1, approved), pending: f(1, pending) })
    expect(detailBand(stage(5, 4), 10)).toBeNull()
    expect(detailBand(stage(90, 10), 10).label).toBe('85%+')
    expect(detailBand(stage(0, 0), 10)).toBeNull()
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
    await userEvent.click(shape('ict', QOM))
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()
    await toCra()
    expect(shape('cra', 'North').dataset.state).toBe('outside')
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
