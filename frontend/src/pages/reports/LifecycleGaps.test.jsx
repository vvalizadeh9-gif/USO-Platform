// Lifecycle Gaps: what the Gaps tab shows, and what it must never show.
//
// Asserted here because each fails quietly:
//
//   * six columns with the API's counts, ICT left and CRA right in every block;
//   * who is behind a gap only on click, in a panel that closes by click,
//     close button or Esc;
//   * the panel's checksum on every open, loud when the rows do not add up;
//   * lens tabs for PM only;
//   * no Mojri figure until Mojri has been imported.
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
const LifecycleGaps = (await import('./LifecycleGaps')).default

const row = (name, count, base, attribution = 'owned') => ({ name, count, base, attribution })

// 900 + 700 + 442 = 2,042.
const PENDING_ICT_ROWS = [row('تهران', 900, 2000), row('کرمان', 700, 1500), row('Unknown province', 442, 1312, 'unknown_province')]

const LENSES = [
  { key: 'rm', label: 'Regional Manager' },
  { key: 'coordinator', label: 'PSO Coordinator' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'region', label: 'CRA Region' },
  { key: 'province', label: 'Province' },
]

const payload = (over = {}) => ({
  last_cpm_import: '2026-09-01T09:30:00Z',
  last_mojri_import: '2026-09-12T08:00:00Z',
  scoped: false,
  lens: 'province',
  key: null,
  lenses: LENSES,
  totals: { eligible: 4812, ict_approved: 2770, cra_approved: 2555 },
  gaps: {
    pending_ict: { count: 2042, base: 4812 },
    pending_cra: { count: 2257, base: 4812 },
    ict_remained: { count: 395, base: 2555 },
    cra_remained: { count: 0, base: 2770 },
    ict_missing_in_mojri: { count: 980, base: 2770, in_tracker: 1790, needs_look: 40 },
    cra_missing_in_mojri: { count: 760, base: 2555, in_tracker: 1795, needs_look: 20 },
  },
  rows: {
    pending_ict: PENDING_ICT_ROWS,
    pending_cra: [row('تهران', 2257, 4812)],
    ict_remained: [row('تهران', 395, 2555)],
    cra_remained: [row('تهران', 0, 2770)],
    ict_missing_in_mojri: [row('تهران', 980, 2770)],
    cra_missing_in_mojri: [row('تهران', 760, 2555)],
  },
  data_quality: { villages_without_province: 0, unmapped_provinces: [] },
  ...over,
})

function mock({ lenses = { selectable: true, options: {} }, overview = payload() } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/kpi/lenses') return Promise.resolve({ data: lenses })
    if (url === '/gaps/overview') return Promise.resolve({ data: overview })
    // The map has its own tests; here it only has to be asked for.
    if (url === '/gaps/map') return new Promise(() => {})
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

function draw() {
  return render(
    <MemoryRouter>
      <LifecycleGaps />
    </MemoryRouter>
  )
}

const columns = () => screen.findAllByRole('button', { name: /villages$|no Mojri import yet$/ })

beforeEach(() => {
  vi.clearAllMocks()
  authUser.current = { role: { name: 'PM' } }
})

describe('the first screen', () => {
  it('draws six columns with the API counts, ICT left and CRA right in every block', async () => {
    mock()
    draw()
    const cols = await columns()
    expect(cols.map((col) => col.getAttribute('aria-label'))).toEqual([
      'ICT pending: 2,042 villages',
      'CRA pending: 2,257 villages',
      'ICT remained: 395 villages',
      'CRA remained: 0 villages',
      'ICT missing in Mojri: 980 villages',
      'CRA missing in Mojri: 760 villages',
    ])
    for (const title of ['Pending approval', 'One approved, other remained', 'Mojri tracker vs MTN']) {
      const block = screen.getByRole('heading', { name: title }).closest('section')
      const labels = within(block).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
      expect(labels[0]).toMatch(/^ICT /)
      expect(labels[1]).toMatch(/^CRA /)
    }
  })

  it('shows the total and the captions, and no owner rows until a click', async () => {
    mock()
    draw()
    await columns()
    expect(screen.getByText('4,812')).toBeInTheDocument()
    expect(screen.getByText('villages with drive test done')).toBeInTheDocument()
    expect(screen.getByText('42% of 4,812')).toBeInTheDocument()
    expect(screen.getByText('Mojri has 1,790 of 2,770')).toBeInTheDocument()
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Lens' })).not.toBeInTheDocument()
  })

  it('keeps a zero gap as a zero-height column with its "0"', async () => {
    mock()
    draw()
    const zero = (await columns())[3]
    expect(zero).toHaveTextContent('0')
    expect(zero.querySelector('.gap-col-bar').style.height).toBe('0%')
  })

  it('scales every column against the largest thing drawn', async () => {
    mock()
    draw()
    const cols = await columns()
    // The largest bar or base on the card is CRA remained's base, 2,770.
    expect(cols[3].querySelector('.gap-col-base').style.height).toBe('100%')
    // 2,257 / 2,770 of the plot.
    expect(parseFloat(cols[1].querySelector('.gap-col-bar').style.height)).toBeCloseTo(81.48, 1)
  })

  it('shows the Mojri block empty, not guessed, before any Mojri import', async () => {
    mock({ overview: payload({ last_mojri_import: null }) })
    draw()
    const cols = await columns()
    expect(cols[4]).toBeDisabled()
    expect(cols[4]).toHaveAccessibleName('ICT missing in Mojri: no Mojri import yet')
    expect(cols[4].querySelector('.gap-col-bar')).toBeNull()
    expect(screen.getAllByText('No Mojri import yet')).toHaveLength(2)
  })
})

describe('the details panel', () => {
  it('opens for the gap that was clicked, and swaps on another click', async () => {
    mock()
    draw()
    const cols = await columns()
    await userEvent.click(cols[0])
    expect(cols[0]).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.getByRole('complementary', { name: 'Details: Pending ICT approval' })
    expect(panel).toHaveTextContent('2,042 villages · 42.4% of 4,812 drive-tested')
    expect(within(panel).getByText('تهران')).toBeInTheDocument()
    expect(panel).toHaveTextContent('own rate 45% · 900 of 2,000')
    expect(panel).toHaveTextContent('44.1% of gap')

    await userEvent.click(cols[5])
    expect(cols[0]).toHaveAttribute('aria-pressed', 'false')
    const mojri = screen.getByRole('complementary', { name: /missing in Mojri/ })
    expect(mojri).toHaveTextContent(/Mojri import: 12 Sept? 2026/)
  })

  it('closes on a second click, on the close button and on Esc', async () => {
    mock()
    draw()
    const cols = await columns()

    await userEvent.click(cols[0])
    await userEvent.click(cols[0])
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    await userEvent.click(cols[1])
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()

    await userEvent.click(cols[2])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('prints the checksum with a tick when the rows add up', async () => {
    mock()
    draw()
    await userEvent.click((await columns())[0])
    const check = screen.getByTestId('gap-checksum')
    expect(check).toHaveTextContent('All 3 provinces add up to 2,042 ✓')
    expect(check.className).not.toContain('bad')
  })

  it('says so loudly when the rows do not add up', async () => {
    const broken = payload()
    broken.gaps.pending_ict = { count: 2570, base: 4812 }
    mock({ overview: broken })
    draw()
    await userEvent.click((await columns())[0])
    const check = screen.getByTestId('gap-checksum')
    expect(check.className).toContain('bad')
    expect(check).toHaveTextContent('not the 2,570 total')
    expect(check).toHaveTextContent('difference of 528')
  })

  it('gives PM the lens tabs, and re-asks the server for each lens', async () => {
    mock()
    draw()
    await userEvent.click((await columns())[0])
    const group = screen.getByRole('group', { name: 'Lens' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Province',
      'RM',
      'Coordinator',
      'Contractor',
      'CRA Region',
    ])
    await userEvent.click(within(group).getByRole('button', { name: 'Coordinator' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/overview', { params: { lens: 'coordinator' } })
    )
  })

  it('gives a non-PM no lens tabs, only their own row', async () => {
    authUser.current = { role: { name: 'Coordinator' } }
    const own = payload({
      scoped: true,
      lens: 'coordinator',
      key: 'Hossein',
      lenses: [{ key: 'coordinator', label: 'PSO Coordinator' }],
      gaps: { ...payload().gaps, pending_ict: { count: 230, base: 300 } },
      rows: { ...payload().rows, pending_ict: [row('Hossein', 230, 300)] },
    })
    mock({ lenses: { selectable: false, lens: 'coordinator', key: 'Hossein', options: {} }, overview: own })
    draw()

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/overview', { params: { lens: 'coordinator' } })
    )
    await userEvent.click((await columns())[0])
    expect(screen.queryByRole('group', { name: 'Lens' })).not.toBeInTheDocument()
    expect(screen.getByTestId('gap-checksum')).toHaveTextContent('The 1 coordinator adds up to 230 ✓')
  })
})

describe('around the chart', () => {
  it('puts data-quality notes behind the warning button', async () => {
    mock({
      overview: payload({
        data_quality: { villages_without_province: 12, unmapped_provinces: [] },
      }),
    })
    draw()
    const button = await screen.findByRole('button', { name: '1 data note' })
    expect(screen.queryByText(/12 village\(s\) have no province/)).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/12 village\(s\) have no province/)).toBeInTheDocument()
  })

  it('has no data-note button when there is nothing to note', async () => {
    mock()
    draw()
    await columns()
    expect(screen.queryByRole('button', { name: /data note/ })).not.toBeInTheDocument()
  })

  it('says what went wrong rather than drawing an empty chart', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/kpi/lenses') return Promise.resolve({ data: { selectable: true, options: {} } })
      return Promise.reject({ response: { data: { detail: 'Not your scope' } } })
    })
    draw()
    expect(await screen.findByText('Not your scope')).toBeInTheDocument()
  })

  it('opens the coverage map on its own tab', async () => {
    mock()
    draw()
    await columns()
    expect(screen.getByRole('tab', { name: 'Gaps' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Coverage map' }))
    expect(api.get).toHaveBeenCalledWith('/gaps/map')
    expect(screen.queryByText('Where villages are stuck')).not.toBeInTheDocument()
  })
})
