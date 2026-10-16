// Steps 3 and 6 (UEP-06 §5): HC review and DT review.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }))
const api = (await import('../../api/client')).default
const HcReviewStep = (await import('./HcReviewStep')).default
const DtReviewStep = (await import('./DtReviewStep')).default
const { WorkProvider } = await import('../../components/work/WorkContext')
const { ToastProvider } = await import('../../context/ToastContext')
const { STEPS } = await import('../../lib/pipelineSteps')
const { clearActionLog } = await import('../../lib/actionLog')

const result = (id, code, overall, over = {}) => ({
  task_id: id, work_item_id: id, site_code: code, site_type: 'Greenfield', overall_result: overall,
  problem_category: null, problem_categories: [], round_no: 1, requested_technologies: ['4G'],
  reviewed: false, assignment_code: 'HC-1', contractor_name: 'پارس تل', completed_at: null, days_waiting: 2,
  technologies: [{ technology: '4G', result: overall === 'Ready' ? 'Normal' : 'NotNormal', reason_category: null, comment: overall === 'Ready' ? null : 'برق ندارد' }],
  ...over,
})
const RESULTS = [result(1, 'KRM-1', 'Ready'), result(2, 'KRM-2', 'NotReady'), result(3, 'KRM-3', 'Ready')]

const submission = (id, code, files = 1, days = 4) => ({
  drive_test_id: id, work_item_id: id, site_code: code, site_type: 'Rooftop', province: 'یزد',
  contractor_name: 'آریا موج', execution_date: '2026-10-01', submitted_at: '2026-10-05T08:00:00Z', days_waiting: days,
  report_link: null,
  evidence: Array.from({ length: files }, (_, i) => ({ id: id * 10 + i, original_filename: `r${i}.pdf`, content_type: 'application/pdf', size_bytes: 2048, uploaded_at: null })),
})
const SUBMISSIONS = [submission(11, 'YZD-1'), submission(12, 'YZD-2', 0), submission(13, 'YZD-3')]

beforeEach(() => {
  vi.clearAllMocks()
  clearActionLog()
  api.get.mockImplementation((url) => {
    if (url === '/hc/results') return Promise.resolve({ data: RESULTS })
    if (url === '/hc/queues/dt-review') return Promise.resolve({ data: SUBMISSIONS })
    if (url === '/reference/problem-categories') return Promise.resolve({ data: [{ name: 'Temp Power' }] })
    return Promise.resolve({ data: [] })
  })
})

async function draw(Step, key) {
  render(
    <MemoryRouter>
      <ToastProvider>
        <WorkProvider>
          <Step step={STEPS.find((s) => s.key === key)} figures={{ count: 3, late: 0, sla_days: 14 }} panelProps={{}} />
        </WorkProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
  await act(async () => {})
}

describe('HC review', () => {
  it('shows Ready with a cobalt dot, never green', async () => {
    await draw(HcReviewStep, 'hc3')
    const ready = screen.getAllByText('Ready', { selector: '.uw-result' })
    expect(ready[0]).toHaveClass('is-ready')
    expect(screen.getByText('Not ready', { selector: '.uw-result' })).toHaveClass('is-not-ready')
    expect(document.querySelector('.uw-result.is-ready i')).toBeInTheDocument()
  })

  it('confirms exactly the Ready sites with Confirm all, undoably', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: { confirmed: 2, batch_id: 41 } })
    await draw(HcReviewStep, 'hc3')
    await user.click(screen.getByRole('button', { name: 'Confirm all 2 Ready' }))
    expect(api.post).toHaveBeenCalledWith('/hc/results/confirm', { task_ids: [1, 3] })
    // The step alone has no on-screen notice; the page's live region says it.
    await waitFor(() => expect(screen.getByTestId('work-live')).toHaveTextContent('✓ 2 sites confirmed ready.'))
  })

  it('opens a failed row by default, and the chevron says so', async () => {
    await draw(HcReviewStep, 'hc3')
    const toggle = screen.getByRole('button', { name: /per-technology results of KRM-2/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls'))).toHaveTextContent('برق ندارد')
  })

  it('routes a Not ready site only after the Problematic confirmation', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: {} })
    await draw(HcReviewStep, 'hc3')
    const pick = screen.getByRole('button', { name: 'Temp Power' })
    expect(pick).toHaveAttribute('aria-pressed', 'false')
    await user.click(pick)
    expect(pick).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Route' }))
    expect(screen.getByText('Mark this site Problematic?')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Yes, mark Problematic' }))
    expect(api.post).toHaveBeenCalledWith('/hc/tasks/2/review', { problem_categories: ['Temp Power'] })
  })
})

describe('DT review', () => {
  it('opens the first submission in the panel; Files reads 1 file or a grey No report', async () => {
    await draw(DtReviewStep, 'dt6')
    expect(screen.getByRole('heading', { level: 2, name: 'YZD-1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'YZD-1' })).toHaveAttribute('aria-current', 'true')
    expect(within(screen.getByText('YZD-1').closest('tr')).getByText('1 file')).toBeInTheDocument()
    expect(within(screen.getByText('YZD-2').closest('tr')).getByText('No report')).toHaveClass('uw-chip-neutral')
  })

  it('lists the longest waiting first, and says so', async () => {
    api.get.mockImplementation((url) =>
      Promise.resolve({
        data:
          url === '/hc/queues/dt-review'
            ? [submission(21, 'A-0', 1, 0), submission(22, 'A-16', 1, 16), submission(23, 'A-5', 1, 5)]
            : [],
      }),
    )
    await draw(DtReviewStep, 'dt6')
    const ids = screen.getAllByRole('button', { name: /^A-/ }).map((b) => b.textContent)
    expect(ids).toEqual(['A-16', 'A-5', 'A-0'])
    expect(screen.getByText('Sorted: longest waiting first')).toBeInTheDocument()
  })

  it('keeps Approve disabled without a report until the outside check is ticked', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: {} })
    await draw(DtReviewStep, 'dt6')
    await user.click(screen.getByRole('button', { name: 'YZD-2' }))
    const approve = screen.getByRole('button', { name: /Approve/ })
    expect(approve).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'I checked the report outside UEP' }))
    expect(approve).toBeEnabled()
    await user.click(approve)
    await user.click(screen.getByRole('button', { name: 'Yes, approve' }))
    expect(api.post).toHaveBeenCalledWith('/drive-tests/12/coordinator-review', {
      decision: 'Approved',
      comment: null,
      report_checked_outside: true,
    })
  })

  it('moves with J and K only while focus is in the list', async () => {
    await draw(DtReviewStep, 'dt6')
    const first = screen.getByRole('button', { name: 'YZD-1' })
    first.focus()
    fireEvent.keyDown(first, { key: 'j' })
    expect(screen.getByRole('heading', { level: 2, name: 'YZD-2' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement, { key: 'k' })
    expect(screen.getByRole('heading', { level: 2, name: 'YZD-1' })).toBeInTheDocument()
    // From the comment box, J is a letter.
    const box = screen.getByRole('textbox', { name: 'Comment for the contractor' })
    fireEvent.keyDown(box, { key: 'j' })
    fireEvent.keyDown(document.body, { key: 'j' })
    expect(screen.getByRole('heading', { level: 2, name: 'YZD-1' })).toBeInTheDocument()
  })

  it('keeps Send back disabled until the comment has three characters', async () => {
    const user = userEvent.setup()
    await draw(DtReviewStep, 'dt6')
    const send = screen.getByRole('button', { name: 'Send back' })
    expect(send).toHaveAttribute('aria-disabled', 'true')
    expect(send).toHaveAccessibleDescription('To send back, add a comment of at least 3 characters.')
    await user.click(send)
    expect(screen.queryByText('Send this drive test back?')).toBeNull()
    await user.type(screen.getByRole('textbox', { name: 'Comment for the contractor' }), 'ab')
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Comment for the contractor' }), 'c')
    expect(send).not.toHaveAttribute('aria-disabled')
  })

  it('opens the next submission after approving', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({ data: {} })
    await draw(DtReviewStep, 'dt6')
    await user.click(screen.getByRole('button', { name: /Approve/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, approve' }))
    expect(api.post).toHaveBeenCalledWith('/drive-tests/11/coordinator-review', { decision: 'Approved', comment: null })
    expect(await screen.findByRole('heading', { level: 2, name: 'YZD-2' })).toBeInTheDocument()
  })
})
