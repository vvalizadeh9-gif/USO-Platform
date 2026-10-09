// UEP Home's greeting and its date line. Both read the clock in Tehran, where
// the programme runs, whatever the browser's own time zone is; the day the
// greeting names is the same day the server's "today" counts.

const TZ = 'Asia/Tehran'

function parts(date, options) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...options })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
}

/** "Good morning" (05:00-11:59), "Good afternoon" (12:00-17:59), else "Good evening". */
export function greetingFor(date = new Date()) {
  const hour = Number(parts(date, { hour: 'numeric', hourCycle: 'h23' }).hour)
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** "Friday, 9 October 2026" -- the Gregorian date, in Tehran. */
export function gregorianLabel(date = new Date()) {
  const p = parts(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`
}

/** "12:24" -- a time of day, in Tehran. */
export function clockLabel(date) {
  const p = parts(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${p.hour}:${p.minute}`
}

const DAY = 24 * 60 * 60 * 1000

/** Whole days from `iso` to now, never negative. */
export function daysSince(iso, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY))
}

/** Whole days from now to `iso`; negative once it has passed. */
export function daysUntil(iso, now = Date.now()) {
  return Math.ceil((new Date(iso).getTime() - now) / DAY)
}
