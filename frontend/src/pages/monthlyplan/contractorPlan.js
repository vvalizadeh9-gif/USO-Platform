// The rules the contractor's Monthly Plan screen reads a plan by. Kept apart
// from the components so the screen, its Updates strip and the tests all
// decide a plan's state in one place.

// What the server accepts (services/monthly_plan.MAX_COMMITTED_COUNT). Checked
// here so a typo is refused where it was typed; the server refuses it anyway.
export const MAX_COMMITTED = 10000

// The states the contractor still owns. Anything else is read-only, and the
// server refuses an edit to it.
export const EDITABLE = ['Draft', 'Returned', 'Reopened']

// The states in which the PM's comment is the first thing to read.
export const ANSWERING = ['Returned', 'Reopened']

/** The two plans a contractor files every month, in the order they are read.
 * Same accents as the PM screen (streams.js). */
export const CONTRACTOR_STREAMS = [
  { key: 'DT', name: 'DT', title: 'DT Delivery', unit: 'drive tests', accent: '#1F5E8C', hasAssignment: true },
  { key: 'ACCEPTANCE', name: 'Acceptance', title: 'Acceptance', unit: 'villages fully accepted', accent: '#6B4FA0', hasAssignment: false },
]

/** Why a contractor may ask for an approved number to change. Same values as
 * the server's REVISION_REASONS; OTHER needs a comment. */
export const REASONS = [
  { value: 'SITES_BLOCKED', label: 'Sites blocked' },
  { value: 'SCOPE_CHANGE', label: 'Scope change' },
  { value: 'PERMITS', label: 'Permits' },
  { value: 'OTHER', label: 'Other' },
]

/** The typed number, or null for "nothing typed", or undefined if it is not one. */
export function parseCount(text) {
  const raw = (text ?? '').trim()
  if (raw === '') return null
  if (!/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return value > MAX_COMMITTED ? undefined : value
}

/**
 * Which of the screen's plan states one stream's month is in.
 *
 *   edit      no plan, Draft, Returned or Reopened -- the number input
 *   missed    never handed in, and the deadline has passed
 *   waiting   Submitted, with the PM
 *   pending   a revision is with the PM; the approved number still counts
 *   revisable Approved, the revision window open, nothing pending
 *   final     Approved and no longer revisable
 *
 * A Returned or Reopened plan stays editable after the deadline: the PM sent
 * it back to be answered.
 */
export function planState(planning) {
  const status = planning.status
  if ((status == null || status === 'Draft') && planning.deadline_passed) return 'missed'
  if (status == null || EDITABLE.includes(status)) return 'edit'
  if (status === 'Submitted') return 'waiting'
  if (status === 'RevisionRequested') return 'pending'
  if (planning.revision_open && planning.in_force_count != null) return 'revisable'
  return 'final'
}

/** Delivered against the server's straight-line target for today, or null
 * without a PIP. ``diff`` is positive ahead, negative behind. */
export function pace(month) {
  const expected = month?.expected_by_today
  if (expected == null) return null
  return { expected, diff: month.delivered - expected }
}

/** A server date, "1405/07/01", as "1 مهر". */
export function shortShamsi(text, monthNames) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text || '')
  if (!m) return text || ''
  return `${Number(m[3])} ${monthNames[Number(m[2]) - 1]}`
}
