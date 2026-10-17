// UEP Home's wording rules, kept apart from the components so they are tested
// on their own.

import { joinMeta } from '../../lib/joinMeta'
import { formatNumber } from '../../lib/numbers'

/** For which KPIs a rise is bad. Done today is the one where a fall is. */
const UP_IS_BAD = { pending: true, overdue: true, dueSoon: true, done: false }

/** "↑ 13 vs last week", "↓ 3 vs last week", "No change"; null without a figure. */
export function deltaText(delta) {
  if (delta === null || delta === undefined) return null
  if (delta === 0) return 'No change'
  return `${delta > 0 ? '↑' : '↓'} ${formatNumber(Math.abs(delta))} vs last week`
}

/** 'bad' only when the change goes the wrong way for this KPI; never 'good'. */
export function deltaTone(kpi, delta) {
  if (!delta) return 'neutral'
  const bad = UP_IS_BAD[kpi] ? delta > 0 : delta < 0
  return bad ? 'bad' : 'neutral'
}

/** Today less seven days ago in a series that ends today; null without both. */
export function weekDelta(series) {
  if (!series || series.length < 8) return null
  const now = series[series.length - 1]
  const then = series[series.length - 8]
  return now === null || now === undefined || then === null || then === undefined ? null : now - then
}

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
