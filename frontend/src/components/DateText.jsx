import { DATE_RULE } from '../lib/dateRule'
import { formatGregorian, fromIso } from '../lib/dates'
import { toPersianDigits } from '../lib/persianDigits'
import { periodLabel, shamsiDayLabel } from '../lib/shamsi'

const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Tehran' })

/** A calendar day or a moment as a Date, or null. */
function toDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const day = fromIso(value)
  if (day) return day
  const moment = new Date(value)
  return Number.isNaN(moment.getTime()) ? null : moment
}

/** "2 Sept 2026" (or "Friday 16 October 2026" when `long`), or null. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests
export function gregorianText(value, { long = false } = {}) {
  const d = toDate(value)
  if (!d) return null
  if (long) return LONG.format(d).replace(',', '')
  return typeof value === 'string' && fromIso(value) ? formatGregorian(value) : SHORT.format(d)
}

/** "۱۴۰۵/۰۷/۱۳", or null. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests
export function shamsiText(value) {
  const d = toDate(value)
  return d ? shamsiDayLabel(d) : null
}

/** Shamsi output, always isolated right-to-left in Vazirmatn, so it can never
 * come out reversed inside an English line ("1405 مهر"). */
export function Shamsi({ children, title, className = '', 'data-testid': testId }) {
  return (
    <bdi dir="rtl" lang="fa" className={`uep-shamsi ${className}`.trim()} title={title} data-testid={testId}>
      {children}
    </bdi>
  )
}

/**
 * A day date by the date rule. `calendar="shamsi"` for the Shamsi screens
 * (monthly plan). The other calendar is always on hover.
 */
export default function DateText({ value, calendar = DATE_RULE.dayCalendar, long = false, fallback = '—', className }) {
  const greg = gregorianText(value, { long })
  const sham = shamsiText(value)
  if (!greg && !sham) return fallback
  if (calendar === 'shamsi' && sham) {
    return <Shamsi title={gregorianText(value) ?? undefined} className={className}>{sham}</Shamsi>
  }
  return (
    <time dateTime={typeof value === 'string' ? value : undefined} title={sham ?? undefined} className={className}>
      {greg}
    </time>
  )
}

/** "مهر ۱۴۰۵": a Shamsi month, wholly in Persian digits. */
export function MonthText({ year, month, className }) {
  const label = periodLabel(year, month)
  if (!label) return null
  return <Shamsi className={className}>{toPersianDigits(label)}</Shamsi>
}
