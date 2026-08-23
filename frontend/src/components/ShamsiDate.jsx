// A Shamsi (Jalali) date entered as three selects.
//
// Deliberately not a calendar widget and deliberately no date library: the
// browser only ever assembles "1404/05/29" as text, and the single conversion
// to Gregorian happens on the server (core/jalali.py). Two calendar
// implementations that must agree is a bug waiting to happen, and letter dates
// are the field where being one day out matters most.
const MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

// Wide enough for historical letters and a few years ahead.
const FIRST_YEAR = 1398
const LAST_YEAR = 1415

const pad = (n) => String(n).padStart(2, '0')

export function joinShamsi(year, month, day) {
  if (!year || !month || !day) return ''
  return `${year}/${pad(month)}/${pad(day)}`
}

export function splitShamsi(value) {
  const parts = String(value || '').split('/')
  if (parts.length !== 3) return { year: '', month: '', day: '' }
  return { year: parts[0], month: String(Number(parts[1])), day: String(Number(parts[2])) }
}

export default function ShamsiDate({ value, onChange, disabled }) {
  const { year, month, day } = splitShamsi(value)

  function set(part, next) {
    const merged = { year, month, day, [part]: next }
    onChange(joinShamsi(merged.year, merged.month, merged.day))
  }

  // Esfand can have 30 days, and a leap year is not something the browser
  // should be deciding — 31 is offered and the server refuses an impossible
  // date with a message naming the problem.
  const days = Array.from({ length: 31 }, (_, i) => i + 1)

  return (
    <div className="row" style={{ gap: 6 }}>
      <select
        className="input"
        style={{ flex: '0 0 86px' }}
        value={year}
        disabled={disabled}
        onChange={(e) => set('year', e.target.value)}
        aria-label="Year"
      >
        <option value="">Year</option>
        {Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i).map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        className="input"
        style={{ flex: 1, minWidth: 104 }}
        value={month}
        disabled={disabled}
        onChange={(e) => set('month', e.target.value)}
        aria-label="Month"
      >
        <option value="">Month</option>
        {MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>{pad(i + 1)} — {name}</option>
        ))}
      </select>
      <select
        className="input"
        style={{ flex: '0 0 72px' }}
        value={day}
        disabled={disabled}
        onChange={(e) => set('day', e.target.value)}
        aria-label="Day"
      >
        <option value="">Day</option>
        {days.map((d) => (
          <option key={d} value={d}>{pad(d)}</option>
        ))}
      </select>
    </div>
  )
}
