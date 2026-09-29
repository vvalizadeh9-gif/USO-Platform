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
import { BANDS, approvalRate, bandOf, detailBand, detailRows, regionDrift } from './coverageMap'
import iranMap from './iranMap.json'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../../lib/download', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}))

const api = (await import('../../api/client')).default
const CoverageMap = (await import('./CoverageMap')).default

const fig = (stopped, reached) => ({
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  low_sample: reached < 10,
})

const stretch = (approved, base, pending, remained) => ({ approved, base, pending, remained })

/** A detail block: ICT 285 of 403 approved, CRA 201 of 403, with owners. */
function detail(over = {}) {
  const owners = {
    coordinator: [
      { name: 'V. Hashemi', attribution: 'owned', ict: stretch(200, 280, 80, 20), cra: stretch(150, 280, 130, 30) },
      { name: 'R. Karimi', attribution: 'owned', ict: stretch(85, 123, 38, 10), cra: stretch(51, 123, 72, 12) },
    ],
    contractor: [
      { name: 'پیشرو فن', attribution: 'owned', ict: stretch(285, 400, 115, 30), cra: stretch(200, 400, 200, 42) },
      { name: 'Unassigned', attribution: 'unassigned', ict: stretch(0, 3, 3, 0), cra: stretch(1, 3, 2, 0) },
    ],
    rm: [{ name: 'Allahyar', attribution: 'owned', ict: stretch(285, 403, 118, 30), cra: stretch(201, 403, 202, 42) }],
  }
  return { ict: stretch(285, 403, 118, 30), cra: stretch(201, 403, 202, 42), owners, ...over }
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
    const provinceRows = members.map((m, i) => ({
      name: m.name,
      key: m.key,
      attribution: 'owned',
      ict: stretch(100, 150, 50, 5),
      cra: stretch(30 + i * 20, 150, 120 - i * 20, 10),
    }))
    return {
      name,
      attribution: 'owned',
      provinces: members.map((m) => m.key),
      managers: ['Allahyar', 'Nobakht'],
      villages: members.length * 120,
      ict: fig(sum('ict', 'stopped'), sum('ict', 'reached')),
      cra: fig(sum('cra', 'stopped'), sum('cra', 'reached')),
      detail: detail({ owners: { ...detail().owners, province: provinceRows } }),
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
const toCra = () => userEvent.click(screen.getByRole('button', { name: 'CRA approval · by region' }))
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
    await toCra()
    expect(within(screen.getByTestId('cov-map-cra')).getAllByText('50%')).toHaveLength(9)
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

  it('carries the OpenStreetMap attribution', async () => {
    await draw()
    expect(screen.getByText(/© OpenStreetMap contributors/)).toHaveTextContent('ODbL')
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

  it('shows a province: its region, RM and three figures', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    const detailPanel = panel()
    expect(detailPanel).toHaveAccessibleName('Isfahan detail')
    expect(detailPanel).toHaveTextContent('Central region · RM Allahyar')
    expect(detailPanel).toHaveTextContent('70.7%') // 285 of 403
    expect(within(detailPanel).getByText('70–85%')).toBeInTheDocument()
    expect(detailPanel).toHaveTextContent('285 of 403 drive-tested')
    expect(shape('ict', ISFAHAN)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('cov-outline')).toBeInTheDocument()
  })

  it('makes every village count in it an export of exactly those villages', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    const detailPanel = panel()
    const labels = within(detailPanel)
      .getAllByRole('button', { name: /^Export/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Export 285 villages (ICT approved · Isfahan) to Excel',
      'Export 118 villages (ICT pending · Isfahan) to Excel',
      'Export 30 villages (ICT remained · Isfahan) to Excel',
      'Export 80 villages (ICT pending · Isfahan · Coordinator V. Hashemi) to Excel',
      'Export 38 villages (ICT pending · Isfahan · Coordinator R. Karimi) to Excel',
    ])
    await userEvent.click(within(detailPanel).getByRole('button', { name: /Coordinator V. Hashemi/ }))
    expect(api.get).toHaveBeenCalledWith('/gaps/villages.xlsx', {
      params: { gap: 'pending_ict', lens: 'coordinator', key: 'V. Hashemi', scope: `province:${ISFAHAN}` },
      responseType: 'blob',
    })
  })

  it('lists by the ICT lenses, with each row over its own base', async () => {
    await draw()
    await userEvent.click(shape('ict', ISFAHAN))
    const lenses = within(panel()).getByRole('group', { name: 'List by' })
    expect(within(lenses).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Coordinator', 'Contractor', 'Regional manager',
    ])
    expect(panel()).toHaveTextContent('V. Hashemi80of 280 · 29%')
    await userEvent.click(within(lenses).getByRole('button', { name: 'Contractor' }))
    expect(within(panel()).getByText('Unassigned')).toHaveClass('is-unowned')
  })

  it('lists a CRA region by province, weakest CRA approval first, with its band', async () => {
    await draw()
    await toCra()
    await userEvent.click(shape('cra', 'North'))
    const detailPanel = panel()
    expect(detailPanel).toHaveTextContent('4 provinces · RM Allahyar, Nobakht')
    const lenses = within(detailPanel).getByRole('group', { name: 'List by' })
    expect(within(lenses).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Province', 'Coordinator', 'Contractor', 'Regional manager',
    ])
    const rows = within(detailPanel).getAllByRole('listitem')
    // 30/150 = 20%, 50/150, 70/150, 90/150: weakest first.
    expect(rows[0]).toHaveTextContent('20.0%')
    expect(rows.at(-1)).toHaveTextContent('60.0%')
    expect(rows[0].querySelector('.cov-pill').style.background).not.toBe('')
    await userEvent.click(within(rows[0]).getByRole('button', { name: /^Export/ }))
    expect(api.get.mock.calls.at(-1)[1].params).toMatchObject({
      gap: 'pending_cra',
      lens: 'province',
      scope: 'region:North',
    })
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
    expect(screen.getByText('Select a province on the map')).toBeInTheDocument()
  })

  it('selects with the keyboard too', async () => {
    await draw()
    shape('ict', QOM).focus()
    await userEvent.keyboard('{Enter}')
    expect(panel()).toHaveAccessibleName('Qom detail')
  })
})

describe('detail arithmetic', () => {
  it('sorts most pending first, and the CRA province list weakest first', () => {
    const d = payload().regions[0].detail
    expect(detailRows(d, 'ict', 'coordinator').map((r) => r.name)).toEqual(['V. Hashemi', 'R. Karimi'])
    const provinces = detailRows(d, 'cra', 'province')
    const rates = provinces.map((r) => r.rate)
    expect(rates).toEqual([...rates].sort((a, b) => a - b))
  })

  it('does not band a detail figure under the low-sample threshold', () => {
    expect(detailBand(stretch(5, 9, 4, 0), 10)).toBeNull()
    expect(detailBand(stretch(90, 100, 10, 0), 10).label).toBe('85%+')
    expect(detailBand(stretch(0, 0, 0, 0), 10)).toBeNull()
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
