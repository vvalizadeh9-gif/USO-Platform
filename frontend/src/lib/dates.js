/**
 * Gregorian date helpers, kept away from the widget that uses them so the
 * arithmetic can be tested on its own.
 *
 * Everything here speaks ISO (YYYY-MM-DD) and local time. The pairing matters:
 * the app's dates are calendar days, not instants, and the two ways of getting
 * a calendar day out of a Date disagree by up to a day either side of
 * midnight depending on the reader's offset.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const pad = (n) => String(n).padStart(2, '0')

/** Render a Date as YYYY-MM-DD in the reader's own timezone. */
export function toIso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Today, where the reader is standing.
 *
 * Not `new Date().toISOString().slice(0, 10)`, which is today in UTC. Tehran
 * is UTC+03:30, so between midnight and 03:30 that expression names yesterday
 * -- and it was the default for the drive-test execution date, which is a
 * field where being one day out is the whole problem.
 */
export function todayIso() {
  return toIso(new Date())
}

/**
 * Parse YYYY-MM-DD into a local Date, or null.
 *
 * Round-trips the components rather than trusting the constructor, which
 * rolls 2026-02-31 forward to 3 March instead of refusing it.
 */
export function fromIso(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!m) return null
  const [, y, mo, d] = m.map(Number)
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null
  }
  return date
}

/** "8 September 2026" — the long form, for confirming what was picked. */
export function formatLong(value) {
  const d = fromIso(value)
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : ''
}

/** Whole days from `from` to `to`, both ISO. Negative when `to` is later. */
export function daysBetween(from, to) {
  const a = fromIso(from)
  const b = fromIso(to)
  if (!a || !b) return null
  return Math.round((a - b) / 86400000)
}

export { MONTHS }

const GREGORIAN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * "6 Oct 2026" from an ISO date: Explorer's one date format (UEP-11 §B8),
 * Gregorian in English digits. Null for nothing or a date that does not exist,
 * so the caller decides what an empty date reads as.
 */
export function formatGregorian(value) {
  const d = fromIso(value)
  return d ? GREGORIAN.format(d) : null
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "17 Oct, 03:00": Gregorian, English, local time (UEP-14 §3). "—" for none. */
export function formatDateTime(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${hh}:${mm}`
}

/** "17 Oct": the date alone. */
export function formatDayMonth(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
}
