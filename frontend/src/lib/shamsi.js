/**
 * The Shamsi (Jalali) facts the interface needs on its own.
 *
 * The platform's rule is that one calendar implementation converts dates, and
 * it is the server's (core/jalali.py) — two implementations that must agree
 * is a bug waiting to happen, and it is why ShamsiDate is three selects rather
 * than a calendar widget. Nothing here breaks that rule: no date entered by a
 * user and no date coming back from the server is converted in the browser.
 *
 * What is here is the month *names*, which are a list rather than a
 * conversion, and today's Shamsi month, which the screens that are organised
 * by month need in order to open on the right one. That single conversion is
 * asked of the platform's own Intl, not of a date library, and it decides a
 * default the user can change — never a value that is stored.
 */

// Shamsi month names in order, index 0 = month 1. The same list as
// core/jalali.SHAMSI_MONTHS; a name that disagreed would be a label, not a
// permission, and the server's name is what a response carries.
export const SHAMSI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

// Wide enough for historical letters and a few years of planning ahead.
export const FIRST_SHAMSI_YEAR = 1398
export const LAST_SHAMSI_YEAR = 1415

/** The Shamsi month name for 1..12, or the number itself if it is neither. */
export function shamsiMonthName(month) {
  return SHAMSI_MONTHS[Number(month) - 1] || String(month ?? '')
}

/** "مرداد 1405" — a period as a person reads it. */
export function periodLabel(year, month) {
  if (!year || !month) return ''
  return `${shamsiMonthName(month)} ${year}`
}

/**
 * Today's Shamsi year and month, or null if this browser cannot say.
 *
 * In the reader's own timezone, for the same reason todayIso() is (see
 * lib/dates.js): these are calendar days, and "today in UTC" names yesterday
 * in Tehran for three and a half hours every night.
 *
 * Returns null rather than a guess when the result is not a plausible Shamsi
 * year — which is what a runtime without the Persian calendar produces, a
 * Gregorian year wearing a Shamsi label. A null opens the month selector on
 * nothing and asks; a wrong default silently files against the wrong month.
 */
export function currentShamsiPeriod(now = new Date()) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', {
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now)
  } catch {
    return null
  }
  const value = (type) => Number(parts.find((p) => p.type === type)?.value)
  const year = value('year')
  const month = value('month')
  if (!(year >= FIRST_SHAMSI_YEAR && year <= LAST_SHAMSI_YEAR)) return null
  if (!(month >= 1 && month <= 12)) return null
  return { year, month }
}

/** The Shamsi period immediately before this one. Mirrors jalali.previous_period. */
export function previousPeriod(year, month) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}
