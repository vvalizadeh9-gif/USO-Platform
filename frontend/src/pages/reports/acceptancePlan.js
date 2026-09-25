// Data-only helpers behind the Acceptance Dashboard's plan-and-trend
// widgets. Nothing here touches the DOM or the network — it only shapes
// what /acceptance/trends and /drivetest/trend hand back into the one
// month-keyed series the charts read.
//
// The two endpoints are read separately (see AcceptanceDashboard.jsx) and
// merged here defensively: /drivetest/trend reads a different table than
// /acceptance/trends (the monthly snapshot ledger, not live work items) and
// is not guaranteed to return the same months, in the same order, or even
// the same count. Every lookup below is by (shamsi_year, shamsi_month), never
// by array position.

/** "1405-6" — a Shamsi (year, month) pair as a map key. */
export function monthKey(year, month) {
  return `${year}-${month}`
}

/**
 * One row per month in `trendMonths` (the window /acceptance/trends opened
 * on), each carrying that month's ICT/CRA/fully-accepted pace and plan
 * target as-is, plus the drive-test "added villages" figure looked up from
 * `dtMonths` by month key.
 *
 * `added_cumulative` is /drivetest/trend's own running total for that month
 * (`dt_done`), not re-derived here. `added_new` is the month-over-month step
 * between two *consecutive, both-present* cumulative readings — left `null`
 * across any gap (an uncaptured month, or a month missing from the window)
 * rather than guessed, the same rule TrendPoint itself documents for a gap.
 */
export function mergeMonthlySeries(trendMonths, dtMonths) {
  const dtByKey = new Map(
    (dtMonths || []).map((p) => [monthKey(p.shamsi_year, p.shamsi_month), p])
  )
  let prevAdded = null
  return (trendMonths || []).map((m) => {
    const dt = dtByKey.get(monthKey(m.shamsi_year, m.shamsi_month))
    const addedCumulative = dt?.dt_done ?? null
    const addedNew =
      addedCumulative != null && prevAdded != null ? addedCumulative - prevAdded : null
    if (addedCumulative != null) prevAdded = addedCumulative
    return {
      key: monthKey(m.shamsi_year, m.shamsi_month),
      label: m.label,
      shamsi_year: m.shamsi_year,
      shamsi_month: m.shamsi_month,
      target: m.target_count,
      ict_new: m.ict_new,
      cra_new: m.cra_new,
      fully_accepted_new: m.fully_accepted_new,
      ict_cumulative: m.ict_cumulative,
      cra_cumulative: m.cra_cumulative,
      fully_accepted_cumulative: m.fully_accepted_cumulative,
      added_cumulative: addedCumulative,
      added_new: addedNew,
    }
  })
}

/** The delta arrow's tone: up is green (more villages targeted), down is red. */
export function planDeltaTone(delta) {
  if (delta == null || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}
