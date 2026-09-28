/**
 * What the Plans tab makes of the PM queue (usePlanBoard). Pure functions of
 * the GET /pip/queue responses, so the counts on the tab badge and on the tab
 * itself come from one place and cannot disagree.
 */

export const STREAMS = ['DT', 'ACCEPTANCE']

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
  // One stream approved, the other not handed in yet.
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
