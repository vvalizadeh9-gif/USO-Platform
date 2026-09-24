// Gap & Performance: what the page shows, and what it must never show.
//
// Four promises are asserted here because all four fail quietly:
//
//   * the checksum is printed on every load, with the addition spelled out —
//     it is the only thing on the screen that would have caught the country
//     figure disagreeing with the list under it;
//   * a rate never appears without the fraction it came from;
//   * a non-PM gets no lens picker and no equality claim, because their one row
//     cannot sum to the country total;
//   * the two stretches that read the Mojri tracker say "not recorded yet"
//     rather than reporting a gap they have no data for.
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
const GapRoad = (await import('./GapRoad')).default

const owner = (name, stopped, reached, over = {}) => ({
  name,
  attribution: 'owned',
  villages: reached,
  stopped,
  reached,
  rate: reached ? Math.round((stopped * 1000) / reached) / 10 : null,
  ...over,
})

// 290 + 240 + 230 + 180 = 940.
const ICT_OWNERS = [
  owner('Amir', 290, 400),
  owner('Zohreh', 240, 500),
  owner('Hossein', 230, 300),
  owner('Farid', 180, 250),
]

const payload = (over = {}) => ({
  lens: 'coordinator',
  lens_label: 'PSO Coordinator',
  lens_plural: 'Coordinators',
  selectable: true,
  scoped: false,
  key: null,
  lenses: [
    { key: 'rm', label: 'Regional Manager' },
    { key: 'coordinator', label: 'PSO Coordinator' },
    { key: 'contractor', label: 'Contractor' },
    { key: 'region', label: 'CRA Region' },
    { key: 'province', label: 'Province' },
  ],
  last_cpm_import: '2026-09-01T09:30:00Z',
  country_villages: 4200,
  stretches: [
    {
      key: 'ict',
      label: 'ICT approval',
      start: 'Drive test done',
      end: 'ICT approved',
      available: true,
      pending: null,
      country: { stopped: 940, reached: 1450, rate: 64.8 },
      owners: ICT_OWNERS,
    },
    {
      key: 'cra',
      label: 'CRA approval',
      start: 'ICT approved',
      end: 'CRA approved',
      available: true,
      pending: null,
      country: { stopped: 310, reached: 510, rate: 60.8 },
      owners: [owner('Zohreh', 200, 300), owner('Amir', 110, 210)],
    },
    {
      key: 'tracker',
      label: 'Mojri tracker registration',
      start: 'CRA approved',
      end: "Registered in Mojri's tracker",
      available: false,
      pending: 'Waiting on the Mojri tracker reconciliation',
      country: { stopped: 0, reached: 0, rate: null },
      owners: [],
    },
    {
      key: 'dep',
      label: 'Depreciation',
      start: "Registered in Mojri's tracker",
      end: 'Depreciated',
      available: false,
      pending: 'Waiting on the Mojri tracker reconciliation',
      country: { stopped: 0, reached: 0, rate: null },
      owners: [],
    },
  ],
  data_quality: {
    cra_approved_without_ict: 0,
    villages_without_province: 0,
    villages_without_contractor: 0,
    unmapped_provinces: [],
  },
  ...over,
})

function mock({ lenses, road }) {
  api.get.mockImplementation((url) => {
    if (url === '/kpi/lenses') return Promise.resolve({ data: lenses })
    if (url === '/gaps/road') return Promise.resolve({ data: road })
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

function draw() {
  return render(
    <MemoryRouter>
      <GapRoad />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser.current = { role: { name: 'PM' } }
})

describe('the road', () => {
  beforeEach(() => {
    mock({ lenses: { selectable: true, options: {} }, road: payload() })
  })

  it('draws all four barriers, in the order a village passes them', async () => {
    draw()
    const barriers = await screen.findAllByRole('button', { name: /stopped of/ })
    expect(barriers).toHaveLength(4)
    expect(barriers[0]).toHaveAccessibleName(/ICT approval/)
    expect(barriers[1]).toHaveAccessibleName(/CRA approval/)
    expect(barriers[2]).toHaveAccessibleName(/Mojri tracker/)
    expect(barriers[3]).toHaveAccessibleName(/Depreciation/)
  })

  it('starts on the first barrier and says which one is selected', async () => {
    draw()
    const barriers = await screen.findAllByRole('button', { name: /stopped of/ })
    expect(barriers[0]).toHaveAttribute('aria-pressed', 'true')
    expect(barriers[1]).toHaveAttribute('aria-pressed', 'false')
    expect(await screen.findByText(/Stopped before ICT/)).toBeInTheDocument()
  })

  it('swaps the list when another barrier is clicked', async () => {
    draw()
    const barriers = await screen.findAllByRole('button', { name: /CRA approval/ })
    await userEvent.click(barriers[0])

    expect(await screen.findByText(/Stopped before CRA/)).toBeInTheDocument()
    // The CRA stretch has two owners; the ICT one had four.
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      'Zohreh',
      'Amir',
    ])
    // Switching stretch does not re-fetch: one lens, one request.
    expect(api.get.mock.calls.filter(([url]) => url === '/gaps/road')).toHaveLength(1)
  })
})

describe('the owner list', () => {
  beforeEach(() => {
    mock({ lenses: { selectable: true, options: {} }, road: payload() })
  })

  it('prints the checksum, addition and all, on every load', async () => {
    draw()
    const checksum = await screen.findByTestId('gap-checksum')
    expect(checksum).toHaveTextContent(
      'Coordinators below sum to the 940 stopped before ICT: 290 + 240 + 230 + 180 = 940.'
    )
    expect(checksum.className).not.toContain('bad')
  })

  it('shouts when the rows do not make the country figure', async () => {
    // The bug this page exists to catch: a country total that disagrees with
    // the list under it.
    const broken = payload()
    broken.stretches[0].country = { stopped: 2570, reached: 3000, rate: 85.7 }
    mock({ lenses: { selectable: true, options: {} }, road: broken })
    draw()

    const checksum = await screen.findByTestId('gap-checksum')
    expect(checksum.className).toContain('bad')
    expect(checksum).toHaveTextContent(/does not match the 2,570 country total/)
    expect(checksum).toHaveTextContent(/difference of 1,630/)
  })

  it('shows every rate with the fraction it came from', async () => {
    draw()
    const row = await screen.findByRole('row', { name: /Amir/ })
    expect(row).toHaveTextContent('72.5%')
    expect(row).toHaveTextContent('290 of 400 reached')
  })

  it('shows each owner’s share of the national gap', async () => {
    draw()
    const row = await screen.findByRole('row', { name: /Amir/ })
    // 290 / 940
    expect(row).toHaveTextContent('30.9%')
  })

  it('draws the Pareto line after the row that crosses 80%', async () => {
    draw()
    expect(
      await screen.findByText(/80% of this gap sits in the 3 rows above this line/)
    ).toBeInTheDocument()
  })

  it('works the two fractions through in a sentence, from the top row', async () => {
    draw()
    expect(
      await screen.findByText(/Amir is stopped on 290 of the 400 villages/)
    ).toBeInTheDocument()
  })
})

describe('the lens picker', () => {
  it('is PM’s, sits above the list, and re-asks the server for each lens', async () => {
    mock({ lenses: { selectable: true, options: {} }, road: payload() })
    draw()

    const group = await screen.findByRole('group', { name: 'Lens' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([
      'Regional Manager',
      'PSO Coordinator',
      'Contractor',
      'CRA Region',
      'Province',
    ])

    await userEvent.click(within(group).getByRole('button', { name: 'Province' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/road', {
        params: { lens: 'province' },
      })
    )
  })

  it('does not render for a role the server confines to its own scope', async () => {
    authUser.current = { role: { name: 'Coordinator' } }
    const scoped = payload({
      selectable: false,
      scoped: true,
      key: 'Hossein',
      stretches: payload().stretches.map((stretch) =>
        stretch.key === 'ict'
          ? { ...stretch, owners: [owner('Hossein', 230, 300)] }
          : { ...stretch, owners: [] }
      ),
    })
    mock({
      lenses: { selectable: false, lens: 'coordinator', key: 'Hossein', options: {} },
      road: scoped,
    })
    draw()

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/road', {
        params: { lens: 'coordinator' },
      })
    )
    expect(screen.queryByRole('group', { name: 'Lens' })).not.toBeInTheDocument()
    expect(await screen.findByText(/Showing your own scope only/)).toBeInTheDocument()

    // One row cannot sum to the country total, so the page does not pretend it
    // does — and the country figure is still shown beside it.
    const checksum = screen.getByTestId('gap-checksum')
    expect(checksum).toHaveTextContent(
      'Your row is 230 of the 940 stopped before ICT nationally — 24.5% of the national gap.'
    )
    expect(checksum).not.toHaveTextContent('=')
  })
})

describe('what the page will not hide', () => {
  it('names the two stretches that have no data yet instead of counting them', async () => {
    mock({ lenses: { selectable: true, options: {} }, road: payload() })
    draw()

    const tracker = (await screen.findAllByRole('button', { name: /Mojri tracker/ }))[0]
    await userEvent.click(tracker)

    expect(await screen.findByText('Not recorded yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Waiting on the Mojri tracker reconciliation/)
    ).toBeInTheDocument()
    expect(screen.queryByTestId('gap-checksum')).not.toBeInTheDocument()
  })

  it('flags villages the road cannot attribute, and the CRA-before-ICT case', async () => {
    mock({
      lenses: { selectable: true, options: {} },
      road: payload({
        data_quality: {
          cra_approved_without_ict: 37,
          villages_without_province: 12,
          villages_without_contractor: 4,
          unmapped_provinces: ['Ilam'],
        },
        stretches: payload().stretches.map((stretch) =>
          stretch.key === 'ict'
            ? {
                ...stretch,
                country: { stopped: 1000, reached: 1450, rate: 69 },
                owners: [
                  ...ICT_OWNERS,
                  owner('Unknown province', 60, 80, {
                    attribution: 'unknown_province',
                  }),
                ],
              }
            : stretch
        ),
      }),
    })
    draw()

    expect(
      await screen.findByText(/37 village\(s\) are CRA-approved with no ICT approval/)
    ).toBeInTheDocument()
    expect(screen.getByText(/12 village\(s\) have no province/)).toBeInTheDocument()
    expect(
      screen.getByText(/No current owner in the province mapping for: Ilam/)
    ).toBeInTheDocument()

    // The unowned villages are a row of their own, carrying why, and they are
    // part of the sum — which is what keeps the checksum balancing.
    const row = screen.getByRole('row', { name: /Unknown province/ })
    expect(row).toHaveTextContent(/CPM province cell matched none of the 31/)
    expect(screen.getByTestId('gap-checksum')).toHaveTextContent('= 1,000.')
  })

  it('says what went wrong rather than drawing an empty road', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/kpi/lenses') return Promise.resolve({ data: { selectable: true, options: {} } })
      return Promise.reject({ response: { data: { detail: 'Not your scope' } } })
    })
    draw()
    expect(await screen.findByText('Not your scope')).toBeInTheDocument()
  })
})
