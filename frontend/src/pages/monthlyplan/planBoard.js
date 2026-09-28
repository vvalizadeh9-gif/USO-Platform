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
