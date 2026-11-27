/**
 * Explorer's words and order (UEP-11, redesigned in UEP-28), shared by the
 * list and the record page and kept apart from the components so they can be
 * tested on their own.
 *
 * Every number arrives from GET /explorer/sites/{id}: day counts, statuses and
 * the step states are the server's. This module only turns them into labels,
 * decides the row order, and says which of the old workflow forms apply.
 */
import { formatGregorian } from '../../lib/dates'
import { canReview } from '../../lib/roles'

export const STEP_META = Object.freeze({
  on_air: { label: 'On air', short: 'On air', waiting: 'Awaiting on air' },
  health_check: { label: 'Health check', short: 'Health check', waiting: 'Health check in progress' },
  assigned: { label: 'Assigned', short: 'Assignment', waiting: 'Awaiting assignment' },
  dt_done: { label: 'DT done', short: 'Drive test', waiting: 'Drive test in progress' },
  // UEP-21: the DT-done letter to ICT HQ (Acceptance › Submissions).
  sent_to_ict: { label: 'Sent to ICT', short: 'Sent to ICT', waiting: 'Awaiting submission to ICT' },
  acceptance: { label: 'Acceptance', short: 'Acceptance', waiting: 'Acceptance in progress' },
})

/** The list's stages in lifecycle order (GET /explorer/sites `stage`). */
export const STAGES = Object.freeze([...Object.keys(STEP_META), 'done'])
const STEP_COUNT = STAGES.length - 1

export const SIDE_META = Object.freeze({
  approved: { label: 'Approved', icon: 'checkmark' },
  pending: { label: 'Pending', icon: 'time' },
  rejected: { label: 'Rejected', icon: 'close' },
})

const AUTHORITY_KEYS = ['ict', 'cra']

/** "1 day" / "4 days". */
export const dayCount = (n) => `${n} ${n === 1 ? 'day' : 'days'}`

/** The one badge beside the site ID. */
export function siteBadge(status) {
  if (status.state === 'done') return { label: 'Acceptance done', tone: 'done' }
  return { label: STEP_META[status.step].waiting, tone: 'progress' }
}

/**
 * The list's Stage cell (UEP-28 §A4): the open step's short name, days in it,
 * late or not, how much of the mini bar is filled, and one sentence for
 * assistive technology ("Drive test, 14 days, over SLA").
 */
export function stageCell(row) {
  const index = STAGES.indexOf(row.stage)
  if (index < 0) return null
  if (row.stage === 'done') {
    return { done: true, label: 'Accepted', filled: 1, open: 0, days: null, late: false, name: 'Accepted' }
  }
  const label = STEP_META[row.stage].short
  const days = row.stage_days
  const parts = [label, days != null ? dayCount(days) : null, row.stage_late ? 'over SLA' : null]
  return {
    done: false,
    label,
    filled: index / STEP_COUNT,
    open: 1 / STEP_COUNT,
    days,
    late: Boolean(row.stage_late),
    name: parts.filter(Boolean).join(', '),
  }
}

/** The line under a side's status word: dates only, never an age
 * (UEP-28 §B5). Null when there is nothing dated to say. */
export function sideLine(side) {
  const filed = formatGregorian(side.filed_date)
  const decided = formatGregorian(side.decided_date)
  switch (side.phase) {
    case 'decided':
      return decided || null
    case 'rejected':
      return decided ? `${decided}, not re-filed yet` : null
    case 'with_authority':
    case 'with_coordinator':
      if (!filed) return null
      return side.refiled ? `Re-filed ${filed}` : `Filed ${filed}`
    case 'returned':
      return decided ? `Returned ${decided}` : null
    case 'not_filed':
      return 'Not filed yet'
    default:
      return null
  }
}

/** The history panel's status line for one CPM village change (UEP-28 §B6). */
export function decisionLine(event) {
  const by = event.decided_by ? ` by ${event.decided_by}` : ''
  const on = formatGregorian(event.decided_at)
  const when = on ? ` on ${on}` : ''
  switch (event.status) {
    case 'applied':
      return `Applied${by}${when}`
    case 'ignored':
      return `Ignored${by}${when}${event.kind === 'removed' ? ' · still on this site' : ''}`
    case 'pending':
      return 'Waiting for the PM'
    default:
      return 'Archived'
  }
}

/** The small tag beside a pending word: a re-filed or returned side. */
export function sideChip(side) {
  if (side.phase === 'returned') return 'Returned'
  if (side.refiled) return 'Re-filed'
  return null
}

export const isFullyApproved = (village) =>
  village.ict.status === 'approved' && village.cra.status === 'approved'

const SIDE_RANK = { rejected: 0, pending: 1, approved: 2 }
const worstSide = (village) => Math.min(...AUTHORITY_KEYS.map((a) => SIDE_RANK[village[a].status]))

/** Table order (UEP-28 §B5): rejected, then pending, then approved -- the
 * worse of the two sides decides -- then village code. */
export function orderVillages(villages) {
  return [...villages].sort(
    (a, b) => worstSide(a) - worstSide(b) || String(a.code ?? '').localeCompare(String(b.code ?? '')),
  )
}

/** "Open": a village not yet fully approved. */
export const openVillages = (villages) => villages.filter((v) => !isFullyApproved(v))

/** The forms the old work-item page offered, gated exactly as it gated them,
 * except assignment: offered only where the list offers it too (a site
 * awaiting an assignment), since the server refuses it everywhere else. */
export const ASSIGNABLE_STAGES = new Set(['Ready for Assignment', 'Returned by Contractor'])

export function workflowActions(user, workflow) {
  const role = user?.role?.name
  const stage = workflow?.current_stage
  const staff = canReview(user)
  return {
    assign: staff && ASSIGNABLE_STAGES.has(stage),
    submitDt: ['PM', 'Contractor'].includes(role) && stage === 'Assigned',
    returnToCoordinator: role === 'Contractor' && stage === 'Assigned',
    review: staff && stage === 'DT Submitted' && Boolean(workflow?.active_drive_test_id),
  }
}

export const hasAnyAction = (actions) => Object.values(actions).some(Boolean)
