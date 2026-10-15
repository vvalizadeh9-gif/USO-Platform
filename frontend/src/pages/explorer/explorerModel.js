/**
 * The Explorer record page's words and order (UEP-11 §B3–B5), kept apart from
 * the components so they can be tested on their own.
 *
 * Every number arrives from GET /explorer/sites/{id}: day counts, statuses and
 * the step states are the server's. This module only turns them into labels,
 * decides the row order, and says which of the old workflow forms apply.
 */
import { formatGregorian } from '../../lib/dates'
import { canReview } from '../../lib/roles'

/** Up to this many villages, ICT and CRA sit side by side; above, one table. */
export const PANEL_MAX = 6
/** Up to this many, panel rows are 62px; above it, 50px so six fit. */
export const ROOMY_MAX = 3

export const STEP_META = Object.freeze({
  on_air: { label: 'On air', phrase: 'on air', icon: 'cell-tower', waiting: 'Awaiting on air' },
  health_check: { label: 'Health check', phrase: 'health check', icon: 'connection-signal', badge: true, waiting: 'Health check in progress' },
  assigned: { label: 'Assigned', phrase: 'assignment', icon: 'task--complete', waiting: 'Awaiting assignment' },
  dt_done: { label: 'DT done', phrase: 'DT done', icon: 'car', waiting: 'Drive test in progress' },
  acceptance: { label: 'Acceptance', phrase: 'acceptance', icon: 'certificate--check', waiting: 'Acceptance in progress' },
})

/**
 * One icon and one hue per site field, shared by the record page's General
 * information tiles and the list's column icons (UEP-11a §B4), so a field
 * looks the same wherever it appears.
 */
export const FIELD_ICONS = Object.freeze({
  on_air: { icon: 'cell-tower', hue: '--uep-field-on-air' },
  dt_date: { icon: 'car', hue: '--uep-field-dt-date' },
  site_contractor: { icon: 'tools', hue: '--uep-field-site-contractor' },
  dt_contractor: { icon: 'portfolio', hue: '--uep-field-dt-contractor' },
  technology: { icon: 'connection-signal', hue: '--uep-field-technology' },
  province: { icon: 'location', hue: '--uep-field-province' },
  villages: { icon: 'building', hue: '--uep-field-villages' },
})

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

/** The pill between a step and the one before it. Never negative: the
 * server sends null for a gap it cannot or will not measure. */
export function pillText(step) {
  if (step.gap_days == null) return '—'
  return step.state === 'in_progress' ? `+${step.gap_days} d so far` : `+${step.gap_days} d`
}

/** What a step shows under its name. */
export function stepDateText(step) {
  if (step.state === 'in_progress') return 'In progress'
  if (step.state === 'upcoming') return 'Not yet'
  return formatGregorian(step.date) || 'No date'
}

/** The step's accessible name: name, state and date in one sentence. */
export function stepAccessibleName(step) {
  const name = STEP_META[step.key].label
  if (step.state === 'in_progress') {
    const since = step.gap_days != null ? `, ${dayCount(step.gap_days)} so far` : ''
    return `${name}: in progress${since}`
  }
  if (step.state === 'upcoming') return `${name}: not yet reached`
  const date = formatGregorian(step.date)
  const gap = step.gap_days != null ? `, ${dayCount(step.gap_days)} after the previous step` : ''
  return `${name}: done, ${date || 'no date'}${gap}`
}

/** The line under a side's status word, or null when there is nothing dated
 * to say (data without dates shows the word only). */
export function sideLine(side, authority) {
  const filed = formatGregorian(side.filed_date)
  const decided = formatGregorian(side.decided_date)
  const waiting = side.days != null ? `, waiting ${dayCount(side.days)}` : ''
  switch (side.phase) {
    case 'decided':
      if (!decided) return null
      return side.days != null ? `${decided}, took ${dayCount(side.days)}` : decided
    case 'rejected':
      return decided ? `${decided}, not re-filed yet` : null
    case 'with_authority':
      if (!filed) return null
      return side.refiled ? `Re-filed ${filed}${waiting}` : `With ${authority} since ${filed}${waiting}`
    case 'with_coordinator':
      if (!filed) return null
      return side.refiled ? `Re-filed ${filed}${waiting}` : `Answer filed ${filed}, with coordinator`
    case 'returned':
      return decided ? `Returned ${decided}, needs a new letter` : null
    case 'not_filed':
      return 'Not filed yet'
    default:
      return null
  }
}

/** The small chip beside a pending word: a re-filed or returned side. */
export function sideChip(side) {
  if (side.phase === 'returned') return 'Returned'
  if (side.refiled) return 'Re-filed'
  return null
}

export const isFullyApproved = (village) =>
  village.ict.status === 'approved' && village.cra.status === 'approved'

const pendingSides = (village) => AUTHORITY_KEYS.filter((a) => village[a].status === 'pending')

const longestWait = (village) =>
  Math.max(-1, ...pendingSides(village).map((a) => village[a].days ?? -1))

const group = (village) => {
  if (AUTHORITY_KEYS.some((a) => village[a].status === 'rejected')) return 0
  return isFullyApproved(village) ? 2 : 1
}

/**
 * Rows in one order for both panels, so a village sits on the same line in
 * ICT and CRA: any rejection first, then by how many sides are pending, then
 * by the longest wait, fully approved last. Ties keep the village ID order.
 */
export function orderVillages(villages) {
  return [...villages].sort(
    (a, b) =>
      group(a) - group(b) ||
      pendingSides(b).length - pendingSides(a).length ||
      longestWait(b) - longestWait(a) ||
      String(a.code ?? '').localeCompare(String(b.code ?? '')),
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
