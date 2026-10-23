/**
 * What the Monthly Plan pages make of the PM queue (usePlanBoard). Pure
 * functions of those responses, so the count on the rail and the lists on the
 * Plans page come from one place and cannot disagree.
 */

import { toPersianDigits } from '../../lib/persianDigits'
import { periodLabel } from '../../lib/shamsi'
import { STREAMS } from './streams'

export { STREAMS }

const rowsOf = (queues, stream) => queues?.[stream]?.rows ?? []

/**
 * Decisions waiting on the PM: plans Submitted for the Plans tab's month,
 * counted per stream, plus revision requests pending on the running month.
 */
export function countWaiting(board) {
  if (board?.state !== 'ready') return 0
  let n = 0
  for (const stream of STREAMS) {
    n += rowsOf(board.planning, stream).filter((r) => r.status === 'Submitted').length
    n += rowsOf(board.running, stream).filter((r) => r.status === 'RevisionRequested').length
  }
  return n
}

/**
 * One stream's plan status as the Plans tab reads it: `waiting` on the PM,
 * `returned` to the contractor, `approved` (a pending or returned revision
 * leaves the approved number in force), or `none` -- no plan, or a Draft
 * nobody but the contractor has seen.
 */
export function streamState(status) {
  switch (status) {
    case 'Submitted':
      return 'waiting'
    case 'Returned':
      return 'returned'
    case 'Approved':
    case 'RevisionRequested':
    case 'RevisionReturned':
      return 'approved'
    default:
      return 'none'
  }
}

const SHARED_STATES = ['waiting', 'returned', 'approved']

/** One contractor's cell for one stream. */
function cellFor(stream, row, runningRow) {
  const state = streamState(row?.status)
  const number =
    state === 'approved' ? (row.in_force_count ?? row.committed_count) : (row?.committed_count ?? null)
  // The queue's assignment is the running month's, from the DT scorecard;
  // Acceptance has no assignment.
  const held = stream === 'DT' ? (row?.assignment ?? null) : null
  return {
    planId: row?.plan_id ?? null,
    state,
    number,
    lastMonth: row?.previous_month_committed ?? null,
    runningPip: runningRow?.in_force_count ?? null,
    held,
    aboveHeld: state !== 'none' && number != null && held != null && number > held,
    isLate: Boolean(row?.is_late),
  }
}

/** The word (and whether it is the settled green) under a contractor's circle. */
function standing(cells) {
  const states = STREAMS.map((s) => cells[s].state)
  const count = (state) => states.filter((s) => s === state).length
  const shared = states.some((s) => SHARED_STATES.includes(s))
  if (!shared) return { shared, word: 'Not shared', done: false, group: 3 }
  const waiting = count('waiting')
  const returned = count('returned') > 0
  // Rows sort by this: anything waiting on the PM, then returned, then the rest.
  const group = waiting ? 0 : returned ? 1 : 2
  if (count('approved') === STREAMS.length) return { shared, word: 'Approved', done: true, group }
  if (waiting === STREAMS.length) return { shared, word: 'Waiting', done: false, group }
  if (waiting) return { shared, word: `${waiting} waiting`, done: false, group }
  if (returned) return { shared, word: 'Returned', done: false, group }
  // Some streams approved, the rest not handed in yet.
  return { shared, word: `${count('approved')} approved`, done: false, group }
}

const byName = (a, b) => a.name.localeCompare(b.name)

/**
 * Everything the Plans tab draws, from usePlanBoard's `ready` state.
 *
 * * `contractors` -- every contractor the queue lists, alphabetical, with one
 *   cell per stream and the word under their circle.
 * * `shared` (waiting first, then returned, then approved; alphabetical in
 *   each) and `notShared` (alphabetical).
 * * `totals` -- per stream, the sum of the shared plans' current numbers. A
 *   contractor who has not shared a stream adds nothing to it.
 * * `revisions` -- requests pending on the running month, per stream.
 * * `waiting` -- the same count as the tab badge.
 */
export function buildBoard(board) {
  const entries = new Map()
  for (const stream of STREAMS) {
    for (const row of rowsOf(board.planning, stream)) {
      const entry = entries.get(row.contractor_id) ?? { id: row.contractor_id, name: row.contractor_name, rows: {} }
      entry.rows[stream] = row
      entries.set(row.contractor_id, entry)
    }
  }
  const runningRow = (stream, id) => rowsOf(board.running, stream).find((r) => r.contractor_id === id)

  const contractors = [...entries.values()]
    .map(({ id, name, rows }) => {
      const cells = Object.fromEntries(STREAMS.map((s) => [s, cellFor(s, rows[s], runningRow(s, id))]))
      return { id, name, cells, ...standing(cells) }
    })
    .sort(byName)

  const shared = contractors
    .filter((c) => c.shared)
    .sort((a, b) => a.group - b.group || byName(a, b))
  const totals = Object.fromEntries(
    STREAMS.map((s) => [
      s,
      shared.reduce((sum, c) => (SHARED_STATES.includes(c.cells[s].state) ? sum + (c.cells[s].number ?? 0) : sum), 0),
    ]),
  )
  const revisions = STREAMS.flatMap((stream) =>
    rowsOf(board.running, stream)
      .filter((r) => r.status === 'RevisionRequested')
      .map((r) => ({
        planId: r.plan_id,
        contractorId: r.contractor_id,
        name: r.contractor_name,
        stream,
        from: r.in_force_count ?? null,
        to: r.committed_count,
        reason: r.revision_reason,
        comment: r.revision_comment,
      })),
  ).sort(byName)

  return {
    contractors,
    shared,
    notShared: contractors.filter((c) => !c.shared),
    totals,
    revisions,
    waiting: countWaiting(board),
  }
}

/** The first two letters of a name, for its circle. */
export function initials(name) {
  return Array.from((name || '').replace(/\s+/g, '')).slice(0, 2).join('')
}

/** "مهر ۱۴۰۵": a Shamsi month as the page shows it, Persian digits. */
export function monthLabel(period) {
  return period ? toPersianDigits(periodLabel(period.year, period.month)) : ''
}

// ---------------------------------------------------------------------------
// The Plans page (UEP-18): DT delivery and Acceptance, decided in place.
// ---------------------------------------------------------------------------

/** The two streams the PM decides on the Plans page, in order. */
export const BAND_STREAMS = ['DT', 'ACCEPTANCE']

/** Streams decided through the existing drawer instead. */
export const OTHER_STREAMS = ['ICT', 'CRA']

/** A stream as the Plans, History and Internal PIP pages title it. */
export const BAND_TITLE = { DT: 'DT delivery', ACCEPTANCE: 'Acceptance', ICT: 'ICT', CRA: 'CRA' }

/**
 * One stream of one contractor, as the Plans page reads it.
 *
 * * `waiting` -- Submitted, the PM owes a decision. `asked` is the number
 *   handed in.
 * * `approved` -- Approved (or a revision pending/returned on top of an
 *   approved plan: the number in force stands). `number` is the plan in force
 *   and `asked` is what was asked when the PM changed it, else the same.
 * * `notFiled` -- nothing, a Draft, or a Returned plan. A returned plan is
 *   not "submitted" (audit finding A2): the contractor owes a new one.
 */
export function planCell(row) {
  const status = row?.status ?? null
  const state =
    status === 'Submitted'
      ? 'waiting'
      : status === 'Approved' || status === 'RevisionRequested' || status === 'RevisionReturned'
        ? 'approved'
        : 'notFiled'
  const number =
    state === 'approved' ? (row.in_force_count ?? row.committed_count ?? null) : state === 'waiting' ? row.committed_count : null
  return {
    planId: row?.plan_id ?? null,
    state,
    status,
    number,
    asked: state === 'waiting' ? number : state === 'approved' ? (row.asked_count ?? number) : null,
    changedFrom: state === 'approved' && status === 'Approved' ? (row.asked_count ?? null) : null,
    comment: state === 'approved' ? (row.decision_comment ?? null) : null,
    submittedAt: row?.submitted_at ?? null,
    isLate: Boolean(row?.is_late),
  }
}

/**
 * Everything the Plans page lists, from usePlanBoard's `ready` state.
 *
 * * `groups` -- `decision` (a stream waiting; oldest waiting first), `notFiled`
 *   (a stream missing) and `decided` (both approved), each alphabetical after
 *   its own order.
 * * `revisions` -- requests pending on the running month, any stream.
 * * `other` -- ICT/CRA plans waiting for the planning month, one per stream.
 */
export function buildPlans(board) {
  const entries = new Map()
  for (const stream of BAND_STREAMS) {
    for (const row of rowsOf(board.planning, stream)) {
      const entry = entries.get(row.contractor_id) ?? { id: row.contractor_id, name: row.contractor_name, rows: {} }
      entry.rows[stream] = row
      entries.set(row.contractor_id, entry)
    }
  }
  const contractors = [...entries.values()].map(({ id, name, rows }) => {
    const cells = Object.fromEntries(BAND_STREAMS.map((s) => [s, planCell(rows[s])]))
    const waiting = BAND_STREAMS.filter((s) => cells[s].state === 'waiting')
    const since = waiting.map((s) => cells[s].submittedAt).filter(Boolean).sort()[0] ?? null
    const group = waiting.length ? 'decision' : BAND_STREAMS.some((s) => cells[s].state === 'notFiled') ? 'notFiled' : 'decided'
    return { id, name, cells, group, since }
  })
  const byOldest = (a, b) => (a.since && b.since ? a.since.localeCompare(b.since) : 0) || byName(a, b)
  const inGroup = (g) => contractors.filter((c) => c.group === g).sort(g === 'decision' ? byOldest : byName)

  const other = OTHER_STREAMS.flatMap((stream) =>
    rowsOf(board.planning, stream)
      .filter((r) => r.status === 'Submitted')
      .map((r) => ({ key: `${stream}-${r.contractor_id}`, contractorId: r.contractor_id, name: r.contractor_name, stream, planId: r.plan_id })),
  ).sort(byName)

  return {
    contractors,
    groups: { decision: inGroup('decision'), notFiled: inGroup('notFiled'), decided: inGroup('decided') },
    revisions: buildBoard(board).revisions,
    other,
  }
}

/** The button's words: what pressing it does to the number. */
export function decisionLabel(asked, value) {
  if (value === asked) return `Confirm ${value}`
  return `${value < asked ? 'Decrease' : 'Increase'} to ${value}`
}

/** The number the PM has settled on for a waiting cell: their stepper, else what was asked. */
export const decidedValue = (cell, decisions) => decisions?.[cell.planId]?.value ?? cell.asked

/** Whether a waiting cell's decision differs from what was asked. */
export const isChanged = (cell, decisions) => cell.state === 'waiting' && decidedValue(cell, decisions) !== cell.asked

/**
 * The KPI bar for one stream. A contractor counts as submitted when the stream
 * has a plan Submitted, Approved or under revision; a Returned plan does not.
 *
 * `asked` sums what was asked, `after` what stands once the waiting plans are
 * decided at the stepper values, and `approved`/`waiting` split `after` for
 * the bar. `toCover` is the Internal PIP less `after` (null with no target).
 */
export function streamKpi(plans, stream, decisions, internal) {
  const cells = plans.contractors.map((c) => c.cells[stream])
  const submitted = cells.filter((c) => c.state !== 'notFiled')
  const approved = submitted.filter((c) => c.state === 'approved').reduce((n, c) => n + (c.number ?? 0), 0)
  const waiting = submitted.filter((c) => c.state === 'waiting').reduce((n, c) => n + (decidedValue(c, decisions) ?? 0), 0)
  const asked = submitted.reduce((n, c) => n + (c.asked ?? 0), 0)
  const after = approved + waiting
  return {
    dots: cells.map((c) => c.state !== 'notFiled'),
    submitted: submitted.length,
    total: cells.length,
    asked,
    after,
    change: after - asked,
    approved,
    waiting,
    internal: internal ?? null,
    toCover: internal == null ? null : internal - after,
  }
}
