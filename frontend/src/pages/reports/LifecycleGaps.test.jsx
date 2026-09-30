// Lifecycle Gaps: what the Gaps tab shows, and what it must never show.
//
// Asserted here because each fails quietly:
//
//   * six tiles with the API's counts, ICT left and CRA right in every card;
//   * clean first: nothing but the six numbers until a tile is clicked;
//   * who is holding a gap in a drawer that closes on ✕, Esc or the scrim,
//     with the tile selected while it is open;
//   * the drawer's checksum on every open, loud when the rows do not add up;
//   * the Group-by control for PM only;
//   * no Mojri figure until Mojri has been imported.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))
vi.mock('../../lib/download', async (importOriginal) => ({
  ...(await importOriginal()),
  saveBlob: vi.fn(),
}))

const authUser = vi.hoisted(() => ({ current: { role: { name: 'PM' } } }))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current }),
}))

const api = (await import('../../api/client')).default
const LifecycleGaps = (await import('./LifecycleGaps')).default

const row = (name, count, base, attribution = 'owned', extra = {}) => ({
  name,
  count,
  base,
  attribution,
  ...extra,
})

// 900 + 700 + 442 = 2,042.
const PENDING_ICT_ROWS = [
  row('V. Hashemi', 900, 2000, 'owned', { managers: ['Allahyar'] }),
  row('R. Karimi', 700, 1500, 'owned', { managers: ['Nobakht', 'Rouhi'] }),
  row('Unknown province', 442, 1312, 'unknown_province', { managers: [] }),
]

const payload = (over = {}) => ({
  last_cpm_import: '2026-09-01T09:30:00Z',
  last_mojri_import: '2026-09-12T08:00:00Z',
  scoped: false,
  lens: 'coordinator',
  key: null,
  lenses: [],
  // The Mojri bases are every approved village, drive test done or not: wider
  // than the drive-tested approved counts card 2 uses.
  totals: {
    eligible: 4812, ict_approved: 2770, cra_approved: 2555,
    ict_approved_all: 3070, cra_approved_all: 2855,
  },
  gaps: {
    pending_ict: { count: 2042, base: 4812 },
    pending_cra: { count: 2257, base: 4812 },
    ict_remained: { count: 395, base: 2555 },
    cra_remained: { count: 0, base: 2770 },
    ict_missing_in_mojri: { count: 1280, base: 3070, in_tracker: 1790, needs_look: 40 },
    cra_missing_in_mojri: { count: 1060, base: 2855, in_tracker: 1795, needs_look: 20 },
  },
  rows: {
    pending_ict: PENDING_ICT_ROWS,
    pending_cra: [row('V. Hashemi', 2257, 4812)],
    ict_remained: [row('V. Hashemi', 395, 2555)],
    cra_remained: [row('V. Hashemi', 0, 2770)],
    ict_missing_in_mojri: [row('V. Hashemi', 1280, 3070)],
    cra_missing_in_mojri: [row('V. Hashemi', 1060, 2855)],
  },
  data_quality: { villages_without_province: 0, unmapped_provinces: [] },
  ...over,
})

function mock({ lenses = { selectable: true, options: {} }, overview = payload() } = {}) {
  api.get.mockImplementation((url, config) => {
    if (url === '/kpi/lenses') return Promise.resolve({ data: lenses })
    if (url === '/gaps/overview') {
      const lens = config?.params?.lens
      return Promise.resolve({ data: { ...overview, lens: lens ?? overview.lens } })
    }
    if (url === '/gaps/villages.xlsx') return Promise.resolve({ data: new Blob(['x']), headers: {} })
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

const tiles = async () => {
  await screen.findAllByTestId('waffle-tile')
  return screen.getAllByRole('button', { name: /see who is holding it$|no Mojri import yet$/ })
}

beforeEach(() => {
  vi.clearAllMocks()
  authUser.current = { role: { name: 'PM' } }
})

describe('the first screen', () => {
  it('draws six tiles with the API counts, ICT left and CRA right in every card', async () => {
    mock()
    draw()
    const hits = await tiles()
    expect(hits.map((hit) => hit.getAttribute('aria-label'))).toEqual([
      'ICT Pending: 2,042 villages — see who is holding it',
      'CRA Pending: 2,257 villages — see who is holding it',
      'ICT Pending: 395 villages — see who is holding it',
      'CRA Pending: 0 villages — see who is holding it',
      'ICT Not in Mojri: 1,280 villages — see who is holding it',
      'CRA Not in Mojri: 1,060 villages — see who is holding it',
    ])
    for (const title of ['Pending approval', 'One approved, other pending', 'ICT vs CRA vs Mojri tracker']) {
      const card = screen.getByRole('heading', { name: title }).closest('section')
      const chips = within(card).getAllByText(/^(ICT|CRA)$/).map((chip) => chip.textContent)
      expect(chips).toEqual(['ICT', 'CRA'])
    }
  })

  it('shows the share of the base and what one square stands for', async () => {
    mock()
    draw()
    await tiles()
    const shares = screen.getAllByTestId('waffle-share').map((line) => line.textContent)
    expect(shares[0]).toBe('42% of 4,812 drive-tested')
    expect(shares[2]).toBe('15% of 2,555 CRA-approved')
    expect(screen.getAllByText('1 square ≈ 48 villages')).toHaveLength(2)
    // Each tile has its own base: 2,555, 2,770, 3,070 and 2,855 once each.
    expect(screen.getAllByText('1 square ≈ 26 villages')).toHaveLength(1)
    expect(screen.getAllByText('1 square ≈ 28 villages')).toHaveLength(1)
    expect(screen.getAllByText('1 square ≈ 31 villages')).toHaveLength(1)
    expect(screen.getAllByText('1 square ≈ 29 villages')).toHaveLength(1)
    expect(shares[4]).toBe('42% of 3,070 approved in UEP')
  })

  it('fills round(100 × gap ÷ base) squares of each waffle', async () => {
    mock()
    draw()
    await tiles()
    const grids = document.querySelectorAll('.waffle-tile-grid')
    expect(grids[0].querySelectorAll('i')).toHaveLength(100)
    expect(grids[0].querySelectorAll('i.on')).toHaveLength(42)
    expect(grids[3].querySelectorAll('i.on')).toHaveLength(0)
    expect(grids[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows nothing but the six numbers until a click', async () => {
    mock()
    draw()
    await tiles()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Group by' })).not.toBeInTheDocument()
    expect(screen.queryByText('V. Hashemi')).not.toBeInTheDocument()
  })

  it('splits each Mojri figure into in Mojri, needs a look and missing', async () => {
    mock()
    draw()
    await tiles()
    const lines = screen.getAllByTestId('waffle-breakdown').map((line) => line.textContent)
    // Only the two Mojri tiles carry it; the figure is needs-a-look + missing.
    expect(lines).toEqual([
      'In Mojri 1,790 · Needs a look 40 · Missing 1,240',
      'In Mojri 1,795 · Needs a look 20 · Missing 1,040',
    ])
  })

  it('shows the Mojri tiles empty, not guessed, before any Mojri import', async () => {
    mock({ overview: payload({ last_mojri_import: null }) })
    draw()
    const hits = await tiles()
    expect(hits[4]).toHaveAccessibleName('ICT Not in Mojri: no Mojri import yet')
    const tile = hits[4].closest('[data-testid="waffle-tile"]')
    expect(tile.querySelector('.waffle[data-empty]')).not.toBeNull()
    expect(within(tile).getByText('—')).toBeInTheDocument()
    expect(within(tile).getByText('No Mojri import yet')).toBeInTheDocument()
    expect(tile).toHaveTextContent('3,070 approved in UEP')
    expect(screen.queryByTestId('waffle-breakdown')).not.toBeInTheDocument()
  })
})

describe('the drawer', () => {
  it('opens on a tile click, selects the tile, and lists every row', async () => {
    mock()
    draw()
    const hits = await tiles()
    await userEvent.click(hits[0])
    const drawer = screen.getByRole('dialog', { name: 'ICT Pending ICT approval' })
    expect(hits[0]).toHaveAttribute('aria-expanded', 'true')
    expect(hits[0].closest('[data-testid="waffle-tile"]')).toHaveAttribute('data-selected', 'true')
    expect(within(drawer).getByText('Pending approval')).toBeInTheDocument()
    expect(drawer).toHaveTextContent('42.4% of 4,812 drive-tested')
    expect(drawer).toHaveTextContent('3 coordinators hold these 2,042 villages · most pending first')
    expect(within(drawer).getAllByRole('row')).toHaveLength(4) // header + three rows
    expect(within(drawer).getByText('RM Allahyar')).toBeInTheDocument()
    expect(within(drawer).getByText('RM Nobakht, Rouhi')).toBeInTheDocument()
    expect(within(drawer).getByText('Unknown province')).toBeInTheDocument()
    expect(drawer).toHaveTextContent('44.1%')
  })

  it('moves focus to Close, and back to the tile on close', async () => {
    mock()
    draw()
    const hits = await tiles()
    await userEvent.click(hits[1])
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(hits[1]).toHaveFocus()
    expect(hits[1].closest('[data-testid="waffle-tile"]')).not.toHaveAttribute('data-selected')
  })

  it('closes on Esc and on a click on the scrim', async () => {
    mock()
    draw()
    const hits = await tiles()
    await userEvent.click(hits[2])
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(hits[3])
    await userEvent.click(screen.getByTestId('gap-drawer-scrim'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('prints the checksum with a tick when the rows add up', async () => {
    mock()
    draw()
    await userEvent.click((await tiles())[0])
    const check = screen.getByTestId('gap-checksum')
    expect(check).toHaveTextContent('Adds up to 2,042 ✓')
    expect(check.className).not.toContain('bad')
    expect(screen.getByText('Share of gap = their pending ÷ 2,042')).toBeInTheDocument()
  })

  it('says so loudly when the rows do not add up', async () => {
    const broken = payload()
    broken.gaps.pending_ict = { count: 2570, base: 4812 }
    mock({ overview: broken })
    draw()
    await userEvent.click((await tiles())[0])
    const check = screen.getByTestId('gap-checksum')
    expect(check.className).toContain('bad')
    expect(check).toHaveTextContent('not 2,570')
    expect(check).toHaveTextContent('difference of 528')
    expect(check).not.toHaveTextContent('✓')
  })

  it('gives PM the five Group-by options, and re-asks the server for each', async () => {
    mock()
    draw()
    await userEvent.click((await tiles())[0])
    const group = screen.getByRole('group', { name: 'Group by' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Coordinator',
      'Contractor',
      'Province',
      'CRA region',
      'Regional manager',
    ])
    await userEvent.click(within(group).getByRole('button', { name: 'Contractor' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/overview', { params: { lens: 'contractor' } })
    )
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toHaveTextContent('3 contractors hold these')
    )
  })

  it('gives a non-PM no Group-by control, only their own row', async () => {
    authUser.current = { role: { name: 'Coordinator' } }
    const own = payload({
      scoped: true,
      lens: 'coordinator',
      key: 'Hossein',
      gaps: { ...payload().gaps, pending_ict: { count: 230, base: 300 } },
      rows: { ...payload().rows, pending_ict: [row('Hossein', 230, 300)] },
    })
    mock({ lenses: { selectable: false, lens: 'coordinator', key: 'Hossein', options: {} }, overview: own })
    draw()

    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/gaps/overview', { params: { lens: 'coordinator' } })
    )
    await userEvent.click((await tiles())[0])
    expect(screen.queryByRole('group', { name: 'Group by' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('1 coordinator holds these 230 villages')
    expect(screen.getByTestId('gap-checksum')).toHaveTextContent('Adds up to 230 ✓')
  })

  it('replaces the list with an empty state for a Mojri gap before any import', async () => {
    mock({ overview: payload({ last_mojri_import: null }) })
    draw()
    await userEvent.click((await tiles())[5])
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByRole('group', { name: 'Group by' })).toBeInTheDocument()
    expect(within(drawer).queryByRole('table')).not.toBeInTheDocument()
    expect(drawer).toHaveTextContent('Nothing to compare yet.')
    expect(drawer).toHaveTextContent(
      'the villages approved in UEP but missing in Mojri are listed here by coordinator.'
    )
  })
})

describe('export behind every number', () => {
  const exported = () => api.get.mock.calls.filter(([url]) => url === '/gaps/villages.xlsx')

  it('exports a tile figure without opening the drawer', async () => {
    mock()
    draw()
    await tiles()
    await userEvent.click(
      screen.getByRole('button', { name: 'Export 2,257 villages (CRA pending) to Excel' })
    )
    expect(exported()).toEqual([
      ['/gaps/villages.xlsx', { params: { gap: 'pending_cra' }, responseType: 'blob' }],
    ])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Exported 2,257 villages')).toBeInTheDocument()
  })

  it("exports the Mojri tiles' approved-in-UEP counts before any import", async () => {
    mock({ overview: payload({ last_mojri_import: null }) })
    draw()
    await tiles()
    await userEvent.click(
      screen.getByRole('button', { name: 'Export 3,070 villages (ICT approved in UEP) to Excel' })
    )
    expect(exported()[0][1].params).toEqual({ gap: 'ict_approved_all' })
  })

  it('exports the drawer hero and each drawer row by its owner', async () => {
    mock()
    draw()
    await userEvent.click((await tiles())[0])
    const drawer = screen.getByRole('dialog')
    await userEvent.click(
      within(drawer).getByRole('button', { name: 'Export 2,042 villages (ICT pending) to Excel' })
    )
    await userEvent.click(
      within(drawer).getByRole('button', {
        name: 'Export 900 villages (ICT pending · Coordinator V. Hashemi) to Excel',
      })
    )
    await userEvent.click(
      within(drawer).getByRole('button', {
        name: 'Export 442 villages (ICT pending · Coordinator Unknown province) to Excel',
      })
    )
    expect(exported().map(([, config]) => config.params)).toEqual([
      { gap: 'pending_ict' },
      { gap: 'pending_ict', lens: 'coordinator', key: 'V. Hashemi' },
      { gap: 'pending_ict', lens: 'coordinator', key: 'Unknown province' },
    ])
    // Still open: an export is not a close.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('never makes a percentage exportable', async () => {
    mock()
    draw()
    await userEvent.click((await tiles())[0])
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '')
    expect(labels.filter((label) => label.startsWith('Export')).every((l) => /villages?\b/.test(l))).toBe(true)
    expect(screen.queryByRole('button', { name: /%/ })).not.toBeInTheDocument()
  })
})

describe('around the tiles', () => {
  it('heads the page with the PageBar: eyebrow, title, total and the two tabs', async () => {
    mock()
    draw()
    await tiles()
    const bar = document.querySelector('.page-bar')
    expect(within(bar).getByRole('heading', { level: 1, name: 'Lifecycle Gaps' })).toBeInTheDocument()
    expect(within(bar).getByText('Performance')).toBeInTheDocument()
    expect(within(bar).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Gaps', 'Coverage map'])
    expect(within(bar).getByTestId('gap-total')).toHaveTextContent('4,812 villages with drive test done')
  })

  it('draws the one legend line', async () => {
    mock()
    draw()
    await tiles()
    expect(screen.getByText('Counted from (100 squares = the base)')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Select a tile to see who is holding it · select a number to export its villages to Excel'
      )
    ).toBeInTheDocument()
  })

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
    await tiles()
    expect(screen.queryByRole('button', { name: /data note/ })).not.toBeInTheDocument()
  })

  it('says what went wrong rather than drawing empty tiles', async () => {
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
    await tiles()
    expect(screen.getByRole('tab', { name: 'Gaps' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Coverage map' }))
    expect(api.get).toHaveBeenCalledWith('/gaps/map')
    expect(screen.queryByText('Pending approval')).not.toBeInTheDocument()
  })
})
