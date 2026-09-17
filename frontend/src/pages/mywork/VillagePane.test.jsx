// The village pane: two authorities, stacked.
//
// ICT and CRA are two separate letters from two separate offices, and the
// screen used to show one form for both with a segmented control beside its
// heading deciding which authority it was filing — a control that only
// rendered when both authorities happened to be open. What is worth asserting
// here is what replaced it:
//
//   * both authorities are on the screen at once, each with its own block;
//   * the one someone is waiting on is on top and open;
//   * a closed block opens, because that is how the letter number that was
//     accepted gets read back;
//   * a block's submit posts its own authority and only its own;
//   * the reason a round came back sits inside the block whose fields answer
//     it, not in a panel shared by both.
//
// The business rules themselves (which technologies are offered, what a
// rejection does to the village) are the server's and are asserted there.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))

const api = (await import('../../api/client')).default
const VillagePane = (await import('./VillagePane')).default

/** Shaped from app/schemas: AcceptanceVillageRow. */
const village = (over = {}) => ({
  village_id: 12,
  village_code: 'V-12',
  village_name: 'Chah Mahi',
  site_code: 'TB-4471',
  work_item_id: 3,
  province_name: 'Kerman',
  requested_technologies: ['3G', '4G'],
  ict_verdict: 'Pending',
  cra_verdict: 'Pending',
  verdict: 'Pending',
  ict_status: 'NotFiled',
  cra_status: 'NotFiled',
  village_status: 'Open',
  site_status: 'Open',
  bucket: 'ready',
  waiting_days: null,
  pending_authorities: [],
  returned_authorities: [],
  can_submit: ['ICT', 'CRA'],
  ...over,
})

/** Shaped from app/schemas: AcceptanceSubmissionOut. */
const submission = (over = {}) => ({
  id: 501,
  village_id: 12,
  authority: 'CRA',
  round_no: 1,
  letter_number: '1404/ص/4471',
  letter_date: null,
  letter_date_shamsi: '1404/05/29',
  source: 'Single',
  review_status: 'Returned',
  submitted_by_name: 'Sara',
  submitted_at: '2025-08-20T09:00:00Z',
  reviewed_by_name: 'Coordinator',
  reviewed_at: '2025-08-21T09:00:00Z',
  review_comment: 'Illegible scan',
  technologies: [
    { technology: '3G', claimed_status: 'Approved', comment: null },
    { technology: '4G', claimed_status: 'Approved', comment: null },
  ],
  evidence: [],
  ...over,
})

/** The detail request the pane makes, and the limits SubmitBody asks for. */
function serve(detail) {
  api.get.mockImplementation((url) => {
    if (url === '/acceptance/limits') {
      return Promise.resolve({
        data: { accepted_extensions: ['pdf', 'jpg'], max_file_mb: 10 },
      })
    }
    if (url === '/acceptance/villages/12') return Promise.resolve({ data: detail })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

const pane = (props = {}) =>
  render(
    <VillagePane
      villageId={12}
      canReview={false}
      onDone={vi.fn()}
      onSkip={vi.fn()}
      onError={vi.fn()}
      {...props}
    />
  )

const blockFor = (authority) =>
  screen.getByText(authority, { selector: '.role' }).closest('.auth-block')

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({ data: { id: 900 } })
})

describe('VillagePane', () => {
  it('shows both authorities, each with its office and its status', async () => {
    serve({ village: village({ ict_status: 'NotFiled', cra_status: 'Approved' }), submissions: [] })
    pane()

    await screen.findByText('Chah Mahi')

    const ict = blockFor('ICT')
    expect(within(ict).getByText('Province office')).toBeInTheDocument()
    expect(within(ict).getByText('Not filed', { selector: '.pill' })).toBeInTheDocument()

    const cra = blockFor('CRA')
    expect(within(cra).getByText('Region office')).toBeInTheDocument()
    // The status pill, not the Approved tile inside the form.
    expect(within(cra).getByText('Approved', { selector: '.pill' })).toBeInTheDocument()
  })

  it('puts a returned CRA above a not-filed ICT', async () => {
    serve({
      village: village({ ict_status: 'NotFiled', cra_status: 'Returned' }),
      submissions: [submission()],
    })
    pane()

    await screen.findByText('Chah Mahi')

    const blocks = document.querySelectorAll('.auth-block .role')
    expect([...blocks].map((n) => n.textContent)).toEqual(['CRA', 'ICT'])
  })

  it('keeps ICT first when neither authority outranks the other', async () => {
    serve({ village: village(), submissions: [] })
    pane()

    await screen.findByText('Chah Mahi')

    const blocks = document.querySelectorAll('.auth-block .role')
    expect([...blocks].map((n) => n.textContent)).toEqual(['ICT', 'CRA'])
  })

  it('opens the block that can be acted on and leaves the other closed', async () => {
    serve({
      village: village({ ict_status: 'Approved', can_submit: ['CRA'] }),
      submissions: [],
    })
    pane()

    await screen.findByText('Chah Mahi')

    expect(within(blockFor('CRA')).getByRole('button', { expanded: true })).toBeInTheDocument()
    expect(within(blockFor('ICT')).getByRole('button', { expanded: false })).toBeInTheDocument()
    // The open one is the one with a form in it.
    expect(within(blockFor('CRA')).getByRole('button', { name: 'Submit CRA' })).toBeInTheDocument()
    expect(within(blockFor('ICT')).queryByRole('button', { name: /^Submit/ })).toBeNull()
  })

  it('opens a closed block when its header is clicked', async () => {
    const user = userEvent.setup()
    serve({
      village: village({ ict_status: 'Approved', can_submit: ['CRA'] }),
      submissions: [
        submission({ id: 400, authority: 'ICT', review_status: 'Validated', letter_number: 'ICT-77' }),
      ],
    })
    pane()

    await screen.findByText('Chah Mahi')

    const ict = blockFor('ICT')
    await user.click(within(ict).getByRole('button', { expanded: false }))

    expect(within(ict).getByRole('button', { expanded: true })).toBeInTheDocument()
    // A closed approved block is how someone checks which letter was accepted.
    expect(within(ict).getAllByText('ICT-77').length).toBeGreaterThan(0)
  })

  it('submits one authority per call, from its own block', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    serve({ village: village(), submissions: [] })
    pane({ onDone })

    await screen.findByText('Chah Mahi')

    const ict = blockFor('ICT')
    await user.type(within(ict).getByLabelText('Letter number'), 'ICT-1')
    await user.click(within(ict).getByRole('button', { name: 'Submit ICT' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())

    const posts = api.post.mock.calls.filter(
      ([url]) => url === '/acceptance/villages/12/submissions'
    )
    expect(posts).toHaveLength(1)
    expect(posts[0][1]).toMatchObject({ authority: 'ICT', letter_number: 'ICT-1' })
  })

  it('puts the return reason inside the block it is about', async () => {
    serve({
      village: village({ cra_status: 'Returned' }),
      submissions: [submission()],
    })
    pane()

    await screen.findByText('Chah Mahi')

    const cra = blockFor('CRA')
    expect(within(cra).getByText(/Illegible scan/)).toBeInTheDocument()
    expect(within(blockFor('ICT')).queryByText(/Illegible scan/)).toBeNull()
  })

  it('gives a reviewer the same blocks, with the validation inside one', async () => {
    serve({
      village: village({ ict_status: 'Pending', cra_status: 'NotFiled', can_submit: [] }),
      submissions: [
        submission({ id: 700, authority: 'ICT', review_status: 'Pending', review_comment: null }),
      ],
    })
    pane({ canReview: true })

    await screen.findByText('Chah Mahi')

    // One screen, both jobs: the same two blocks, the waiting one open with
    // the reviewer's decision in it rather than a submit form.
    const ict = blockFor('ICT')
    expect(within(ict).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(ict).queryByRole('button', { name: /^Submit/ })).toBeNull()
    expect(within(blockFor('CRA')).getByRole('button', { expanded: false })).toBeInTheDocument()
  })

  it('says there is nothing to file when neither authority is open', async () => {
    serve({
      village: village({
        ict_status: 'Approved',
        cra_status: 'Pending',
        can_submit: [],
        village_status: 'Partial',
      }),
      submissions: [],
    })
    pane()

    await screen.findByText('Chah Mahi')

    expect(screen.getByText(/Nothing to file for this village/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2)
  })
})
