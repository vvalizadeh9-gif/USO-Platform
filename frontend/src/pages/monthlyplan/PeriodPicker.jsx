import {
  FIRST_SHAMSI_YEAR,
  LAST_SHAMSI_YEAR,
  SHAMSI_MONTHS,
} from '../../lib/shamsi'

const YEARS = Array.from(
  { length: LAST_SHAMSI_YEAR - FIRST_SHAMSI_YEAR + 1 },
  (_, i) => FIRST_SHAMSI_YEAR + i,
)

/**
 * Which Shamsi month the screen is about.
 *
 * Two selects rather than arrows: a plan is filed for a named month, and the
 * PM chasing a month that closed in autumn should not have to click back to
 * it. Same three-select language as ShamsiDate, minus the day — the plan is
 * about a month, and there is no day to pick.
 */
export default function PeriodPicker({ period, onChange, disabled }) {
  const set = (part, raw) => {
    const next = Number(raw)
    if (!next) return
    onChange({ year: period?.year ?? 0, month: period?.month ?? 0, [part]: next })
  }

  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <select
        className="input"
        style={{ flex: '0 1 96px', minWidth: 82 }}
        aria-label="Year"
        disabled={disabled}
        value={period?.year || ''}
        onChange={(e) => set('year', e.target.value)}
      >
        <option value="">Year</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <select
        className="input"
        style={{ flex: '0 1 140px', minWidth: 112 }}
        aria-label="Month"
        disabled={disabled}
        value={period?.month || ''}
        onChange={(e) => set('month', e.target.value)}
      >
        <option value="">Month</option>
        {SHAMSI_MONTHS.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
    </div>
  )
}
