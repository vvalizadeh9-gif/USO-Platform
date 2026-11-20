// Submissions' words and colours, kept apart from the components so they are
// tested on their own. No green anywhere: nothing here is an approval.
import { toLatinDigits } from '../../lib/persianDigits'
import { shamsiDayLabel } from '../../lib/shamsi'

/** Side panel rows, in order: id, label, Carbon icon, tile colour token. */
export const REASONS = [
  { id: 'all', label: 'All', icon: 'list--checked', tile: '--uep-accent' },
  { id: 'new_dt', label: 'New DT site', icon: 'data--check', tile: '--uep-app-drive-test' },
  { id: 'missed', label: 'Missed', icon: 'search--locate', tile: '--uep-app-data' },
  { id: 'became_target', label: 'Became هدف', icon: 'upgrade', tile: '--uep-app-acceptance' },
  { id: 'resend', label: 'Re-send', icon: 'renew', tile: '--uep-app-monthly-plan' },
]

export const VIEWS = ['ready', 'batches', 'follow-up']

/** ?view= → one of VIEWS, Ready by default. */
export function viewFrom(search) {
  const view = new URLSearchParams(search).get('view')
  return VIEWS.includes(view) ? view : 'ready'
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A batch's status tag: label and tone (neutral | accent | danger). */
export function batchStatus(status) {
  return {
    draft: { label: 'Draft', tone: 'neutral' },
    sent: { label: 'Sent', tone: 'accent' },
    follow_up: { label: 'Follow up', tone: 'danger' },
    closed: { label: 'Closed', tone: 'neutral' },
  }[status] || { label: status, tone: 'neutral' }
}

/** A village's Mojri state on a sent batch: dot tone and words. */
export function mojriState(state) {
  return {
    in_mojri: { tone: 'accent', label: 'In Mojri' },
    waiting: { tone: 'pending', label: 'Waiting for Mojri' },
    follow_up: { tone: 'danger', label: 'Follow up' },
    resent: { tone: 'neutral', label: 'Sent again' },
  }[state] || null
}

/** The coordinator list's status words (UEP-21 §4.8). */
export function villageStatus(row) {
  switch (row.status) {
    case 'in_draft': return { tone: 'neutral', label: `In draft #${row.batch_number}` }
    case 'ready': return { tone: 'accent', label: 'Ready' }
    case 'waiting': return {
      tone: 'pending',
      label: row.outside_uep ? 'Sent outside UEP · waiting Mojri' : `Sent #${row.batch_number} · waiting Mojri`,
    }
    case 'in_mojri': return { tone: 'accent', label: 'In Mojri' }
    case 'follow_up': return { tone: 'danger', label: `Follow up · ${plural(row.days, 'day')}` }
    default: return { tone: 'neutral', label: row.status }
  }
}

/** Segment widths (percent strings) for In Mojri / Waiting / Follow up. */
export function splitWidths(split) {
  if (!split) return null
  const total = split.in_mojri + split.waiting + split.follow_up
  if (!total) return { inMojri: '0%', waiting: '0%', followUp: '0%', pct: 0 }
  const pct = (n) => `${(n / total) * 100}%`
  return {
    inMojri: pct(split.in_mojri),
    waiting: pct(split.waiting),
    followUp: pct(split.follow_up),
    pct: Math.round((split.in_mojri / total) * 100),
  }
}

/** The cycle bar: percent of the cycle gone, and its words. */
export function cycleText(cycle) {
  if (!cycle || cycle.day == null) return { pct: 0, due: 'No batch sent yet', tone: null }
  const pct = Math.max(0, Math.min(100, Math.round((cycle.day / cycle.days) * 100)))
  const due = cycle.due_in < 0 ? `Overdue ${plural(-cycle.due_in, 'day')}` : `Due in ${plural(cycle.due_in, 'day')}`
  const tone = cycle.due_in < 0 ? 'danger' : cycle.due_in <= 3 ? 'pending' : null
  return { pct, due, tone }
}

/** "1405/08/28" (Latin digits) for a Gregorian ISO day: the Shamsi picker's
 * value. Display-side only; the server does the conversion that counts. */
export const shamsiInput = (iso) => (iso ? toLatinDigits(shamsiDayLabel(`${iso}T12:00:00Z`) || '') : '')
