// UEP Home's wording rules, kept apart from the components so they are tested
// on their own.

import { joinMeta } from '../../lib/joinMeta'
import { formatNumber } from '../../lib/numbers'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/** The owner part of a meta line: "5 contractors" (a count, never names). */
export function ownersText(ticket) {
  const n = ticket.owners_total || 0
  if (!n || !ticket.owner_type) return null
  const one = ticket.owner_type.replace(/s$/, '')
  return plural(n, one, ticket.owner_type)
}

/** "Oldest 21 days"; null when no clock has started. */
export function oldestText(ticket) {
  if (ticket.oldest_days === null || ticket.oldest_days === undefined) return null
  return `Oldest ${plural(ticket.oldest_days, 'day', 'days')}`
}

/** The meta line after the late part: "Oldest 21 days · 5 contractors". */
export function metaText(ticket) {
  return joinMeta(oldestText(ticket), ownersText(ticket))
}

/** Submissions' two Home rows (UEP-21 §5.8) say their own meta line.
 * Returns null for every other row. `tone` is 'pending' at 3 days or fewer,
 * 'danger' once the cycle is overdue. */
export function submissionMeta(ticket) {
  const meta = ticket.submission
  if (!meta) return null
  if (ticket.queue_key === 'ict_mojri_follow_up') {
    return { late: ticket.count, text: meta.oldest_days != null ? `Oldest ${plural(meta.oldest_days, 'day', 'days')}` : null }
  }
  const due = meta.due_in
  let dueText = null
  let tone = null
  if (due != null) {
    dueText = due < 0 ? `Batch #${meta.next_number} overdue ${plural(-due, 'day', 'days')}` : `Batch #${meta.next_number} due in ${plural(due, 'day', 'days')}`
    tone = due < 0 ? 'danger' : due <= 3 ? 'pending' : null
  }
  return { due: dueText, tone, text: plural(meta.sites, 'site', 'sites') }
}

/** Acceptance case rows (UEP-22 §5.7): "{n} over SLA" and "{n} no comment",
 * from the Filing inbox's own counts. Null for every other row. */
export function caseMeta(ticket) {
  const meta = ticket.acceptance
  if (!meta) return null
  return {
    overSla: meta.over_sla > 0 ? `${meta.over_sla} over SLA` : null,
    noComment: meta.no_comment > 0 ? `${meta.no_comment} no comment` : null,
  }
}

/** "Saturday, 10 October 2026", in the viewer's own time zone. */
export function englishDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** Good morning (05–11), afternoon (12–17), evening otherwise; local time. */
export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "14:05", local time. */
export function clock(date) {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

// ---------------------------------------------------------------------------
// UEP-27: To do, Waiting on others, and the lists behind every number
// ---------------------------------------------------------------------------

/** Home's four statuses, in bar order. `cls` names the swatch class. */
export const STATUSES = Object.freeze([
  { key: 'late', label: 'Late', cls: 'hs-late' },
  { key: 'due_soon', label: 'Due in 1 week', cls: 'hs-due' },
  { key: 'on_time', label: 'On time', cls: 'hs-on-time' },
  { key: 'no_date', label: 'No date', cls: 'hs-no-date' },
])

/** The group an item with no province or contractor falls into (the server's words). */
export const NO_GROUP = Object.freeze({ province: 'No province', contractor: 'No contractor' })

/** The work-card filter for the Waiting on others figure. */
export const WAITING = 'waiting'

export const statusLabel = (key) => (key === WAITING ? 'Waiting on others' : STATUSES.find((s) => s.key === key)?.label ?? key)
export const statusClass = (key) => (key === WAITING ? 'hs-waiting' : STATUSES.find((s) => s.key === key)?.cls ?? '')

/** The To do bar's parts from GET /me/home totals; zero parts left out. */
export function todoParts(totals) {
  return STATUSES.map((s) => ({ ...s, count: totals?.[`todo_${s.key}`] || 0 })).filter((p) => p.count > 0)
}

/** The legend: every status, except No date when there is none. */
export function legendParts(totals) {
  return STATUSES.map((s) => ({ ...s, count: totals?.[`todo_${s.key}`] || 0 }))
    .filter((p) => p.key !== 'no_date' || p.count > 0)
}

/** One queue row's status strip: its own four parts, zero parts left out. */
export function ticketParts(ticket) {
  return STATUSES.map((s) => ({ ...s, count: ticket[s.key] || 0 })).filter((p) => p.count > 0)
}

/** What a row's number says with `filter` on: that part of the row. The
 * status filters are the To do bar's, so a row someone else holds shows 0;
 * Waiting on others shows those rows whole. */
export function rowCount(ticket, filter) {
  if (!filter) return ticket.count
  if (filter === WAITING) return ticket.holder === 'others' ? ticket.count : 0
  return ticket.holder === 'self' ? ticket[filter] || 0 : 0
}

const SINGULAR = { sites: 'site', villages: 'village', fixes: 'fix', plans: 'plan', changes: 'change', days: 'day', items: 'item', lines: 'line' }

/** "1 site", "9 sites": the unit agreeing with its number. */
export function unitFor(n, unit) {
  if (!unit) return ''
  return n === 1 ? SINGULAR[unit] || unit : unit
}

/** A change against a past figure: { text, dir, worse }. `upIsWorse` for
 * To do; Done this week is worse when it falls. */
export function changeOf(delta, { vs = 'vs 7 days ago', upIsWorse = true } = {}) {
  if (delta === null || delta === undefined) return null
  if (delta === 0) return { text: `No change ${vs}`, dir: null, worse: false }
  return {
    text: `${formatNumber(Math.abs(delta))} ${vs}`,
    dir: delta > 0 ? 'up' : 'down',
    worse: upIsWorse ? delta > 0 : delta < 0,
  }
}

/** A badge's count: "1k" style above 999. */
export function compactCount(n) {
  return n > 999 ? `${Math.floor(n / 1000)}k` : formatNumber(n)
}

/** "24 Nov": the footer's CPM date, in the viewer's time zone. */
export function shortDate(value) {
  if (!value) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(value))
}

/** The Mojri tracker row (a reminder): its days, and whether it is late. */
export function mojriRow(ticket) {
  const days = ticket.mojri?.age_days ?? 0
  const stale = Boolean(ticket.mojri?.stale)
  return { days, stale, text: stale ? `upload is ${plural(days, 'day', 'days')} old` : 'Days since last upload' }
}

/** Every ticket on Home's cards, in card order. */
export const allTickets = (data) => (data?.groups || []).flatMap((g) => g.tickets)

/** The rows a card shows, split as the card draws them: the viewer's own
 * (with any reminder after them) and, under their own label, Waiting on others. */
export function cardSections(tickets) {
  const live = tickets.filter((t) => t.count > 0)
  return {
    mine: [...live.filter((t) => t.holder === 'self'), ...live.filter((t) => t.holder === 'reminder')],
    theirs: live.filter((t) => t.holder === 'others'),
  }
}

/** Summary lines for a set of tickets: the panel's rows. */
export function summaryLines(tickets) {
  return tickets.filter((t) => t.count > 0).map((t) => ({
    key: t.queue_key, label: t.short_label, count: t.count, late: t.late, unit: t.unit, ticket: t,
  }))
}

/** A list item's age bar: { width (% of the track), tick (% where the SLA
 * falls), text }. The track spans twice the SLA, so the tick sits at its
 * middle; an item with no SLA fills against itself. */
export function ageBar(item) {
  if (item.status === 'no_date') return { width: 100, tick: null }
  if (item.age_days == null) return { width: 0, tick: null }
  if (!item.sla_days) return { width: Math.min(100, item.age_days * 4), tick: null }
  const span = item.sla_days * 2
  return { width: Math.min(100, (item.age_days / span) * 100), tick: 50 }
}

/** The order Home's lists use, for the client-side Done list. */
export function groupByDay(items, now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long' })
  const key = (d) => new Date(d).toDateString()
  const today = key(now)
  const groups = []
  for (const item of items) {
    const k = key(item.closed_at)
    let g = groups.find((x) => x.key === k)
    if (!g) {
      g = { key: k, label: k === today ? 'Today' : fmt.format(new Date(item.closed_at)), items: [] }
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
}

/** The queue page with the panel's filter and search, for "Open in {app}". */
export function openUrl(url, { status, q } = {}) {
  const [path, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  if (status && status !== 'all') params.set('status', status)
  if (q && q.trim()) params.set('q', q.trim())
  const text = params.toString()
  return text ? `${path}?${text}` : path
}
