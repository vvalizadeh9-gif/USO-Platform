// The Acceptance Dashboard: what the province table says, and where its
// figures go when they are clicked.
//
// This page makes one promise that is easy to break and hard to notice: every
// number opens the list it counted. Two ways it was broken, both asserted
// here:
//
//   * the authority figures are *verdicts* and linked at the queue's *status*,
//     which is a different question and silently dropped every village
//     somebody had already re-filed;
//   * "Open" on a Needs-attention row carried the authority but not the
//     province, so a row about Kerman opened every province.
//
// The province table itself is the second subject: two lines per province,
// counts then the same counts aged, with refused and unanswered split apart
// because rejected is a subset of outstanding and cannot be a second bar
// beside it.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }))

const navigate = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate,
}))

const api = (await import('../../api/client')).default
const AcceptanceDashboard = (await import('./AcceptanceDashboard')).default

const bands = (over = {}) => ({ lt_warn: 0, warn: 0, critical: 0, unknown: 0, ...over })

/** Shaped from app/schemas: ProvinceAcceptanceRow. */
const province = (over = {}) => ({
  name: 'Kerman',
  province_id: 7,
  total: 120,
  total_villages: 140,
  ict_approved: 88,
  ict_rejected: 9,
  ict_pending: 23,
  ict_remained: 32,
  ict_approved_pct: 73.3,
  ict_remained_pct: 26.7,
  cra_approved: 74,
  cra_rejected: 4,
  cra_pending: 42,
  cra_remained: 46,
  cra_approved_pct: 61.7,
  cra_remained_pct: 38.3,
  ict_oldest_days: 12,
  cra_oldest_days: 30,
  ict_oldest_age_days: 310,
  cra_oldest_age_days: 240,
  ict_age_buckets: bands({ warn: 23, critical: 9 }),
  cra_age_buckets: bands({ warn: 42, critical: 4 }),
  ict_rejected_age_buckets: bands({ critical: 9 }),
  ict_pending_age_buckets: bands({ warn: 23 }),
  cra_rejected_age_buckets: bands({ critical: 4 }),
  cra_pending_age_buckets: bands({ warn: 42 }),
  ict_rejected_oldest_age_days: 310,
  ict_pending_oldest_age_days: 96,
  cra_rejected_oldest_age_days: 240,
  cra_pending_oldest_age_days: 180,
  ...over,
})

const overview = (over = {}) => ({
  kpis: {
    total_dt_done_villages: 120,
    total_ict_approval: 88, total_ict_remained: 32,
    total_ict_rejected: 9, total_ict_pending: 23,
    total_cra_approval: 74, total_cra_remained: 46,
    total_cra_rejected: 4, total_cra_pending: 42,
  },
  analysis: {
    sites_ict_full: 10, sites_cra_full: 8, sites_ict_and_cra_full: 6,
    sites_ict_not_cra: 4, sites_cra_not_ict: 2,
    villages_ict_not_cra: 18, villages_cra_not_ict: 5,
    villages_both_approved: 70, villages_accepted: 70,
    villages_needs_attention: 13, villages_in_review: 23, villages_not_filed: 14,
  },
  provinces: [province()],
  ...over,
})

const page = () =>
  render(
    <MemoryRouter>
      <AcceptanceDashboard />
    </MemoryRouter>
  )

/** The query string of the single navigation this click caused. */
const went = () => {
  expect(navigate).toHaveBeenCalledTimes(1)
  return new URLSearchParams(navigate.mock.calls[0][0].split('?')[1])
}

/** Opens the tab and hands back its table, once the overview has gone. */
const openProvinceTab = async (user) => {
  await screen.findByText('Total villages')
  await user.click(screen.getByRole('button', { name: /Province Status/ }))
  await screen.findByText('Province status')
  return waitFor(() => {
    const table = document.querySelector('table.grouped')
    expect(table).not.toBeNull()
    return table
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // The filter bar's three reference lookups share this mock with
  // /acceptance/overview — give them an empty list each rather than the
  // overview payload, which is not an array and would break their .map().
  api.get.mockImplementation((url) =>
    Promise.resolve({ data: url === '/acceptance/overview' ? overview() : [] })
  )
})

describe('an authority figure', () => {
  it('opens the villages with that verdict, not that queue status', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')

    await user.click(screen.getByRole('button', { name: /ICT rejected: 9 villages/i }))

    const params = went()
    // The dashboard counts verdicts. status=Rejected is the queue's question
    // and loses every refusal that has already been re-filed.
    expect(params.get('ict_verdict')).toBe('Rejected')
    expect(params.get('status')).toBeNull()
    expect(params.get('bucket')).toBe('all')
  })

  it('sends the headline approved figure to the same list as its cell', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')

    // Two of them, deliberately: the 32px headline and the Approved cell are
    // the same figure, so they say the same thing and go the same place.
    const both = screen.getAllByRole('button', { name: /CRA approved: 74 villages/i })
    expect(both).toHaveLength(2)
    await user.click(both[0])
    expect(went().get('cra_verdict')).toBe('Approved')
  })
})

describe('the cross tab', () => {
  it('asks for both verdicts at once', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Total villages')

    await user.click(
      screen.getByRole('button', { name: /ICT approved — CRA not: 18 villages/i })
    )
    const params = went()
    expect(params.get('ict_verdict')).toBe('Approved')
    expect(params.get('cra_verdict')).toBe('NotApproved')
  })

  it('leaves the site figures alone, because every list here is villages', async () => {
    page()
    await screen.findByText('Total villages')

    expect(screen.queryByRole('button', { name: /Sites ICT ✓/i })).toBeNull()
  })
})

describe('needs attention', () => {
  it('opens one province, not every province with that authority', async () => {
    const user = userEvent.setup()
    page()
    await screen.findByText('Top outstanding provinces')

    await user.click(
      screen.getByRole('button', { name: /Open Kerman, outstanding with ICT/ })
    )

    const params = went()
    expect(params.get('province_id')).toBe('7')
    expect(params.get('province')).toBe('Kerman')
    // The row's own figure is what is outstanding, which is wider than what
    // is sitting with the office right now.
    expect(params.get('ict_verdict')).toBe('NotApproved')
  })
})

describe('the province table', () => {
  it('shows the funnel and the three verdicts per authority', async () => {
    const user = userEvent.setup()
    page()
    const table = await openProvinceTab(user)

    const counts = table.querySelector('.prov-counts')
    expect(within(counts).getByText('140')).toBeInTheDocument()  // villages
    expect(within(counts).getByText('120')).toBeInTheDocument()  // DT done
    expect(within(counts).getByText('88')).toBeInTheDocument()   // ICT approved
    expect(within(counts).getByText('9')).toBeInTheDocument()    // ICT rejected
    expect(within(counts).getByText('23')).toBeInTheDocument()   // ICT pending
  })

  it('ages refused and unanswered apart, on the line below the counts', async () => {
    const user = userEvent.setup()
    page()
    const table = await openProvinceTab(user)

    const aging = table.querySelector('.prov-aging')
    expect(aging).not.toBeNull()
    // Two halves per authority, four in all — never one bar for rejected
    // beside one for outstanding, which would count a refusal twice.
    expect(aging.querySelectorAll('.age-one')).toHaveLength(4)
    expect(within(aging).getAllByText('Rejected')).toHaveLength(2)
    expect(within(aging).getAllByText('Pending')).toHaveLength(2)
    expect(within(aging).getByText('310d')).toBeInTheDocument()
  })

  it('opens each figure scoped to its own province and verdict', async () => {
    const user = userEvent.setup()
    page()
    const table = await openProvinceTab(user)

    const counts = table.querySelector('.prov-counts')
    await user.click(within(counts).getByRole('button', { name: /CRA pending: 42 villages/i }))

    const params = went()
    expect(params.get('province_id')).toBe('7')
    expect(params.get('cra_verdict')).toBe('Pending')
    expect(params.get('ict_verdict')).toBeNull()
  })

  it('sends an age bar to the same list as the count above it', async () => {
    const user = userEvent.setup()
    page()
    const table = await openProvinceTab(user)

    const aging = table.querySelector('.prov-aging')
    await user.click(within(aging).getByRole('button', { name: /ICT rejected — by age/ }))

    const params = went()
    expect(params.get('ict_verdict')).toBe('Rejected')
    expect(params.get('province_id')).toBe('7')
  })

  it('does not offer a list behind a zero', async () => {
    const user = userEvent.setup()
    const customOverview = overview({
      provinces: [province({ ict_rejected: 0, ict_rejected_age_buckets: bands() })],
    })
    api.get.mockImplementation((url) =>
      Promise.resolve({ data: url === '/acceptance/overview' ? customOverview : [] })
    )
    page()
    const table = await openProvinceTab(user)

    const counts = table.querySelector('.prov-counts')
    expect(within(counts).queryByRole('button', { name: /ICT rejected/i })).toBeNull()
    const aging = table.querySelector('.prov-aging')
    expect(within(aging).queryByRole('button', { name: /ICT rejected — by age/ })).toBeNull()
  })
})
