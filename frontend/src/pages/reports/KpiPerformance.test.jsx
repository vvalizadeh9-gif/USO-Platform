// KPI & Performance: what the page shows each role, and what it must not.
//
// Three promises are asserted here because all three fail quietly:
//
//   * a low-sample province is shown, reads "not compared", and sits last —
//     it is the row most likely to be dropped by a well-meaning filter;
//   * a contractor gets no lens row and no contractor comparison, only the
//     banner naming their DT SC;
//   * the country average is labelled as weighted wherever it appears, so a
//     reader never takes it for the mean of the rows above it.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const authUser = vi.hoisted(() => ({ current: { role: { name: 'PM' } } }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current }),
}))

const api = (await import('../../api/client')).default
const KpiPerformance = (await import('./KpiPerformance')).default

const cell = (pct, delta, over = {}) => ({
  count: 10,
  pct,
  delta,
  lower_is_better: false,
  ...over,
})

const province = (over = {}) => ({
  province: 'Ardabil',
  province_fa: 'اردبیل',
  cra_region: 'Azar',
  villages: 40,
  dt_done_villages: 30,
  low_sample: false,
  on_air: cell(90, 5),
  dt_done: cell(75, -2),
  ict_approved: cell(80, 3.5),
  ict_rejected: cell(4, -1, { lower_is_better: true }),
  cra_approved: cell(60, -8),
  cra_rejected: cell(2, -3, { lower_is_better: true }),
  ...over,
})

const payload = (over = {}) => ({
  lens: 'rm',
  key: 'Pirayesh',
  selectable: true,
  scope: { provinces: 3, cra_regions: 2, chip: '3 provinces · 2 CRA regions', province_names: [] },
  last_cpm_import: '2026-09-01T09:30:00Z',
  work_items: {
    total: 100, on_air: 70, dt_done: 50, remain_on_air: 30, remain_dt: 50,
    on_air_pct: 70, dt_done_pct: 50, country_on_air_pct: 65, country_dt_done_pct: 55,
  },
  villages: {
    total: 200, on_air: 150, dt_done: 120, ict_approved: 90, ict_rejected: 6,
    cra_approved: 60, cra_rejected: 3, remain_on_air: 50, remain_dt: 80,
    ict_remained: 110, cra_remained: 140,
    on_air_pct: 75, dt_done_pct: 60, ict_approved_pct: 75, cra_approved_pct: 50,
    country_on_air_pct: 70, country_dt_done_pct: 62,
    country_ict_approved_pct: 70, country_cra_approved_pct: 55,
  },
  country: { villages: 900 },
  provinces: [
    province(),
    province({
      province: 'Zanjan',
      province_fa: 'زنجان',
      cra_region: 'North West',
      villages: 4,
      dt_done_villages: 0,
      low_sample: true,
      ict_approved: cell(null, null),
    }),
  ],
  country_row: {
    province: 'Country average',
    province_fa: null,
    cra_region: null,
    villages: 900,
    dt_done_villages: 700,
    low_sample: false,
    on_air: cell(70, 0), dt_done: cell(62, 0),
    ict_approved: cell(70, 0), ict_rejected: cell(5, 0, { lower_is_better: true }),
    cra_approved: cell(55, 0), cra_rejected: cell(4, 0, { lower_is_better: true }),
  },
  low_sample_threshold: 10,
  ...over,
})

function mockApi({ lenses, summary, contractors } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/kpi/lenses') {
      return Promise.resolve({
        data: lenses ?? { selectable: true, options: { rm: ['Pirayesh', 'Rouhi'], coordinator: ['Hossein'], contractor: [], region: ['Azar'] } },
      })
    }
    if (url === '/kpi/summary') return Promise.resolve({ data: summary ?? payload() })
    if (url === '/kpi/contractors') {
      return Promise.resolve({
        data: contractors ?? {
          mode: 'ict', key: 'Hossein', selectable: true, last_cpm_import: null,
          rows: [{ contractor: 'DT-Alpha', villages: 50, approved: 40, remained: 10, pct: 80 }],
          total: { contractor: 'Total', villages: 50, approved: 40, remained: 10, pct: 80 },
        },
      })
    }
    return Promise.resolve({ data: {} })
  })
}

const show = () =>
  render(
    <MemoryRouter>
      <KpiPerformance />
    </MemoryRouter>
  )

beforeEach(() => {
  vi.clearAllMocks()
  authUser.current = { role: { name: 'PM' } }
})

describe('the heatmap', () => {
  it('shows a low-sample province, uncoloured, last, and says why', async () => {
    mockApi()
    show()

    const zanjan = await screen.findByRole('row', { name: /Zanjan/ })
    expect(within(zanjan).getAllByText('not compared').length).toBe(6)

    const rows = screen.getAllByRole('row')
    const names = rows.map((row) => row.textContent)
    const zanjanAt = names.findIndex((text) => text.includes('Zanjan'))
    const ardabilAt = names.findIndex((text) => text.includes('Ardabil'))
    const countryAt = names.findIndex((text) => text.includes('Country average'))
    expect(ardabilAt).toBeLessThan(zanjanAt)
    expect(zanjanAt).toBeLessThan(countryAt)
  })

  it('names the threshold rather than leaving the grey rows unexplained', async () => {
    mockApi()
    show()
    expect(
      await screen.findByText(/Fewer than 10 DT-done villages/)
    ).toBeInTheDocument()
  })

  it('ends on the country average and says the benchmark is weighted', async () => {
    mockApi()
    show()
    expect(await screen.findByRole('row', { name: /Country average/ })).toBeInTheDocument()
    expect(screen.getByText(/Country average \(weighted\)/)).toBeInTheDocument()
  })
})

describe('the funnels', () => {
  it('says which base the acceptance bars used', async () => {
    mockApi()
    show()
    // ICT and CRA divide by DT-done villages, not by the scope. Without the
    // label a reader compares 75% approved with 60% DT done and concludes
    // something that is not true.
    const labels = await screen.findAllByText(/of DT done/)
    expect(labels.length).toBe(2)
  })

  it('shows what remains beside every stage that has a remainder', async () => {
    mockApi()
    show()
    expect(await screen.findByText('30 remain')).toBeInTheDocument()
    expect(screen.getByText('110 remain')).toBeInTheDocument()
  })
})

describe('the lens row', () => {
  it('lets a PM switch lens and person', async () => {
    mockApi()
    show()

    await screen.findByRole('button', { name: 'PSO Coordinator' })
    await userEvent.click(screen.getByRole('button', { name: 'PSO Coordinator' }))

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/kpi/summary', {
        params: { lens: 'coordinator', key: 'Hossein' },
      })
    })
  })

  it('gives a contractor a fixed chip and a banner, not a lens control', async () => {
    authUser.current = { role: { name: 'Contractor' } }
    mockApi({
      lenses: { selectable: false, options: { contractor: ['DT-Alpha'] }, lens: 'contractor', key: 'DT-Alpha' },
      summary: payload({ lens: 'contractor', key: 'DT-Alpha', selectable: false }),
    })
    show()

    expect(await screen.findByText(/Showing only your sites/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'CRA Region' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('never asks for the contractor table outside the coordinator lens', async () => {
    mockApi()
    show()
    await screen.findByRole('row', { name: /Ardabil/ })
    expect(api.get).not.toHaveBeenCalledWith('/kpi/contractors', expect.anything())
  })
})

describe('the contractors section', () => {
  it('appears under the coordinator lens with a total row', async () => {
    authUser.current = { role: { name: 'Coordinator' } }
    mockApi({
      lenses: { selectable: false, options: { coordinator: ['Hossein'] }, lens: 'coordinator', key: 'Hossein' },
      summary: payload({ lens: 'coordinator', key: 'Hossein', selectable: false }),
    })
    show()

    expect(await screen.findByRole('row', { name: /DT-Alpha/ })).toBeInTheDocument()
    const total = screen.getByRole('row', { name: /^Total/ })
    expect(within(total).getByText('50')).toBeInTheDocument()
  })
})

describe('when something goes wrong', () => {
  it('shows the server own explanation rather than a generic failure', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/kpi/lenses') {
        return Promise.resolve({ data: { selectable: false, options: { rm: ['Pirayesh'] }, lens: 'rm', key: 'Pirayesh' } })
      }
      return Promise.reject({
        response: { status: 403, data: { detail: 'This account is not linked to a name in the province mapping.' } },
      })
    })
    show()
    expect(
      await screen.findByText(/not linked to a name in the province mapping/)
    ).toBeInTheDocument()
  })
})
