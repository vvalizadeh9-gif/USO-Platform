// The Health Check pool.
//
// The figure at the top of this screen is the one the programme is managed
// against: every on-air site whose drive test is not Done. It used to be
// something narrower wearing that label — sites already inside a check, ones
// waiting on a PM's triage, ones with an open fix and (until this change)
// every site whose CPM drive-test status read Ongoing were all dropped, so a
// Coordinator reading "112 in the pool" was being told how many they could
// assign that minute.
//
// So the tests here are about the difference between those two questions:
// the count is the quantity, the rows say what state each site is in, and
// only the ones that can actually be assigned can be selected.
//
// The suite runs with reduced motion on (see src/test/setup.js).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const api = (await import('../../api/client')).default
const HcBasketTab = (await import('./HcBasketTab')).default
const { ToastProvider } = await import('../../context/ToastContext')

/** One pool row, shaped from app/schemas.HcBasketItem. */
const row = (over = {}) => ({
  work_item_id: 1,
  site_code: 'KRM-0001',
  site_type: 'Greenfield',
  province: 'Kerman',
  requested_technologies: ['2G', '4G'],
  round_no: 1,
  returning_reason: null,
  hc_state: 'New',
  assignable: true,
  dt_status: null,
  waiting_since: null,
  days_waiting: 12,
  ...over,
})

const POOL = [
  row({ work_item_id: 1, site_code: 'KRM-0001' }),
  // An Ongoing drive test no longer takes a site out of the pool: only a
  // Done one does.
  row({ work_item_id: 2, site_code: 'KRM-0002', dt_status: 'Ongoing' }),
  row({
    work_item_id: 3,
    site_code: 'KRM-0003',
    dt_status: 'Problematic',
    hc_state: 'Fix in progress',
    assignable: false,
  }),
  row({
    work_item_id: 4,
    site_code: 'KRM-0004',
    hc_state: 'In health check',
    assignable: false,
    round_no: 2,
  }),
]

function serve(pool = POOL) {
  api.get.mockImplementation((url) => {
    if (url === '/hc/basket') return Promise.resolve({ data: pool })
    if (url === '/reference/contractors')
      return Promise.resolve({ data: [{ id: 1, name: 'Alfa Drive Tests' }] })
    return Promise.resolve({ data: [] })
  })
}

const draw = (props = {}) =>
  render(
    <ToastProvider>
      <HcBasketTab {...props} />
    </ToastProvider>,
  )

const rowFor = (code) => screen.getByText(code).closest('tr')

beforeEach(() => {
  vi.clearAllMocks()
  serve()
})

describe('the pool figure', () => {
  it('counts every site in the pool, not just the assignable ones', async () => {
    const onCountChange = vi.fn()
    draw({ onCountChange })

    await screen.findByText('KRM-0001')
    expect(onCountChange).toHaveBeenCalledWith(4)
    // A neutral count chip beside the title, not a red badge.
    const chip = screen.getByRole('heading', { name: /Health Check Pool/ }).querySelector('.count-chip')
    expect(chip).toHaveTextContent('4')
    // And says what it counts, beside the subset that can be acted on.
    expect(
      screen.getByText(/on-air sites without a completed drive test/),
    ).toHaveTextContent('2 ready to assign')
  })

  it('keeps a site whose drive test is Ongoing', async () => {
    draw()

    await screen.findByText('KRM-0002')
    expect(within(rowFor('KRM-0002')).getByText('Ongoing')).toBeInTheDocument()
  })

  it('says a drive test nobody has started rather than leaving the cell blank', async () => {
    draw()

    await screen.findByText('KRM-0001')
    expect(within(rowFor('KRM-0001')).getByText('Not started')).toBeInTheDocument()
  })
})

describe('what can be assigned', () => {
  it('will not select a site that is already inside a health check', async () => {
    const user = userEvent.setup()
    draw()

    await screen.findByText('KRM-0004')
    const box = within(rowFor('KRM-0004')).getByRole('checkbox')
    expect(box).toBeDisabled()

    await user.click(rowFor('KRM-0004'))
    expect(box).not.toBeChecked()
  })

  it('selects only the assignable rows when selecting everything', async () => {
    const user = userEvent.setup()
    draw()

    await screen.findByText('KRM-0001')
    const [selectAll] = screen.getAllByRole('checkbox')
    await user.click(selectAll)

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Assign' })).toHaveTextContent('2 sites selected'),
    )
  })

  it('names the state of every site it will not let you assign', async () => {
    draw()

    await screen.findByText('KRM-0003')
    expect(within(rowFor('KRM-0003')).getByText('Fix in progress')).toBeInTheDocument()
    expect(within(rowFor('KRM-0004')).getByText('In health check')).toBeInTheDocument()
  })

  it('draws a capped number of rows while still counting the whole pool', async () => {
    // The pool is a programme quantity: on a full import it is every on-air
    // site in the country whose drive test is not Done. The figure is all of
    // them; the table draws the first 200 and says how many it folded.
    const many = Array.from({ length: 250 }, (_, i) =>
      row({ work_item_id: 100 + i, site_code: `BULK-${i}` }),
    )
    const onCountChange = vi.fn()
    serve(many)
    draw({ onCountChange })

    await screen.findByText('BULK-0')
    expect(onCountChange).toHaveBeenCalledWith(250)
    expect(screen.queryByText('BULK-199')).toBeInTheDocument()
    expect(screen.queryByText('BULK-200')).not.toBeInTheDocument()

    expect(screen.getByText('200 of 250 loaded')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Load 50 more' }))
    expect(await screen.findByText('BULK-249')).toBeInTheDocument()
    expect(screen.getByText('250 of 250 loaded')).toBeInTheDocument()
  })

  it('still names the round a returning site is coming back for', async () => {
    serve([
      row({
        work_item_id: 5,
        site_code: 'KRM-0005',
        hc_state: 'Ready for re-check',
        round_no: 2,
        returning_reason: 'Temp Power fixed',
      }),
    ])
    draw()

    await screen.findByText('KRM-0005')
    expect(within(rowFor('KRM-0005')).getByText('Temp Power fixed')).toBeInTheDocument()
    expect(within(rowFor('KRM-0005')).getByRole('checkbox')).toBeEnabled()
  })
})

describe('the state filter', () => {
  it('counts each state and narrows the table to one', async () => {
    const user = userEvent.setup()
    draw()

    await screen.findByText('KRM-0001')
    const filter = screen.getByRole('group', { name: 'Pool state' })
    const labels = within(filter).getAllByRole('button').map((b) => b.textContent)
    expect(labels).toEqual([
      'All 4',
      'Ready to assign 2',
      'In health check 1',
      'Awaiting triage 0',
      'Fix in progress 1',
      'Passed 0',
    ])
    await user.click(within(filter).getByRole('button', { name: /In health check/ }))
    expect(screen.getByText('KRM-0004')).toBeInTheDocument()
    expect(screen.queryByText('KRM-0001')).not.toBeInTheDocument()
  })

  it('draws the drive-test status as a pill with its word', async () => {
    draw()
    await screen.findByText('KRM-0001')
    expect(within(rowFor('KRM-0002')).getByText('Ongoing')).toHaveClass('pill', 'pill-violet')
    expect(within(rowFor('KRM-0003')).getByText('Problematic')).toHaveClass('pill', 'pill-red')
    expect(within(rowFor('KRM-0001')).getByText('Not started')).toHaveClass('pill', 'pill-dim')
  })

  it('reads waiting on the pool\'s month scale', async () => {
    serve([row({ days_waiting: 30 }), row({ work_item_id: 2, site_code: 'KRM-0002', days_waiting: 45 })])
    draw()
    await screen.findByText('KRM-0001')
    expect(within(rowFor('KRM-0001')).getByText('30 days')).toHaveClass('pill-dim')
    expect(within(rowFor('KRM-0002')).getByText('45 days')).toHaveClass('pill-amber')
  })
})

describe('assigning from the dock', () => {
  it('names the pick on the button, and posts the ticked sites to it', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { code: 'HC-9' } })
    draw()

    await screen.findByText('KRM-0001')
    const dock = screen.getByRole('region', { name: 'Assign' })
    expect(within(dock).getByRole('button', { name: 'Assign health check' })).toBeDisabled()

    await user.click(within(rowFor('KRM-0001')).getByRole('checkbox'))
    await user.click(within(dock).getByRole('radio', { name: /Alfa Drive Tests/ }))
    const go = within(dock).getByRole('button', { name: 'Assign health check to Alfa Drive Tests' })
    expect(go).toBeEnabled()
    await user.click(go)
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/hc/assignments', { contractor_id: 1, work_item_ids: [1] }),
    )
  })
})
