/**
 * What the Monthly Plan tabs make of the PM queue (usePlanBoard) and of the
 * running month's GET /pip/overview. Pure functions of those responses, so
 * the count on the Approvals badge and the cards under it come from one place
 * and cannot disagree.
 */

import { toPersianDigits } from '../../lib/persianDigits'
import { periodLabel } from '../../lib/shamsi'
import { STREAMS, streamMeta } from './streams'

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

/**
 * One contractor's running month for one stream, from the running month's
 * GET /pip/overview: `{ pip, delivered, behind }`, where `behind` is how far
 * delivered is under an even pace through the month (null when on or ahead
 * of it, or with no plan). Null when the overview has no row for them.
 */
export function runningFigures(running, stream, contractorId) {
  const row = running?.[streamMeta(stream).key]?.rows?.find((r) => r.contractor_id === contractorId)
  if (!row) return null
  return {
    pip: row.pip ?? null,
    delivered: row.delivered ?? 0,
    behind: row.pace_diff != null && row.pace_diff < 0 ? -row.pace_diff : null,
  }
}

/** The latest of some ISO timestamps, or null. */
function latest(values) {
  return values.filter(Boolean).sort().at(-1) ?? null
}

/**
 * The Approvals tab, from usePlanBoard's `ready` state and the running
 * month's overview (which may still be loading: then nothing is "behind").
 *
 * * `cards` -- one per contractor with a plan waiting on the PM for the
 *   planning month (`kind: 'plan'`), then one per contractor with a revision
 *   request pending on the running month (`kind: 'revision'`). Each carries
 *   one block per waiting stream, in stream order, with the plan id it is
 *   decided through. A red line is only ever a number: `above` (DT: the
 *   number exceeds the sites held) and `behind` (the running month is under
 *   pace), each null when not true.
 * * `decided` -- contractors who shared and have nothing left waiting:
 *   `Sent back` when any stream was returned, otherwise `Approved`.
 */
export function buildApprovals(board, running) {
  const view = buildBoard(board)
  const above = (stream, number, held) =>
    stream === 'DT' && number != null && held != null && number > held ? number - held : null
  const behind = (stream, id) => runningFigures(running, stream, id)?.behind ?? null

  const planCards = view.contractors
    .filter((c) => STREAMS.some((s) => c.cells[s].state === 'waiting'))
    .map((c) => {
      const streams = STREAMS.filter((s) => c.cells[s].state === 'waiting')
      return {
        key: `plan-${c.id}`,
        kind: 'plan',
        id: c.id,
        name: c.name,
        submittedAt: latest(streams.map((s) => rowsOf(board.planning, s).find((r) => r.contractor_id === c.id)?.submitted_at)),
        blocks: streams.map((stream) => {
          const cell = c.cells[stream]
          return {
            stream,
            planId: cell.planId,
            number: cell.number,
            compare: cell.lastMonth,
            above: above(stream, cell.number, cell.held),
            behind: behind(stream, c.id),
          }
        }),
      }
    })

  const revisionsById = new Map()
  for (const stream of STREAMS) {
    for (const r of rowsOf(board.running, stream)) {
      if (r.status !== 'RevisionRequested') continue
      const card = revisionsById.get(r.contractor_id) ?? {
        key: `revision-${r.contractor_id}`,
        kind: 'revision',
        id: r.contractor_id,
        name: r.contractor_name,
        submittedAt: null,
        blocks: [],
      }
      card.submittedAt = latest([card.submittedAt, r.submitted_at])
      card.blocks.push({
        stream,
        planId: r.plan_id,
        number: r.committed_count,
        compare: r.in_force_count ?? null,
        reason: r.revision_reason,
        above: above(stream, r.committed_count, r.assignment ?? null),
        behind: behind(stream, r.contractor_id),
      })
      revisionsById.set(r.contractor_id, card)
    }
  }
  const revisionCards = [...revisionsById.values()].sort(byName)
  const pending = new Set([...planCards, ...revisionCards].map((c) => c.id))

  const decided = view.shared
    .filter((c) => !pending.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      state: STREAMS.some((s) => c.cells[s].state === 'returned') ? 'returned' : 'approved',
    }))

  return { cards: [...planCards, ...revisionCards], decided, waiting: view.waiting }
}
