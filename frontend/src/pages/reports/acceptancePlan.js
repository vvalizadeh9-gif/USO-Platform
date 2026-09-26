// Data-only helpers behind the Acceptance Dashboard's plan-and-trend
// widgets. Nothing here touches the DOM or the network — it only shapes what
// /acceptance/trends hands back into the month-keyed series the charts read.

/** "1405-6" — a Shamsi (year, month) pair as a map key. */
export function monthKey(year, month) {
  return `${year}-${month}`
}

/**
 * One row per month /acceptance/trends returned, keyed by Shamsi month, each
 * carrying that month's ICT/CRA/fully-accepted pace and its plan:
 *
 * - `target` / `target_monthly` — the plan line. MTN's internal target for
 *   staff; one contractor's approved Acceptance PIP for a contractor, or for
 *   staff filtered to one. `target` is its running total.
 * - `pip` / `pip_monthly` — the contractors' approved Acceptance PIPs (every
 *   contractor's summed, or the one contractor's). `pip` is the running total.
 *
 * Every plan figure is the server's, never derived here; a month with none is
 * `null`, not 0.
 */
export function mergeMonthlySeries(trendMonths) {
  return (trendMonths || []).map((m) => ({
    key: monthKey(m.shamsi_year, m.shamsi_month),
    label: m.label,
    shamsi_year: m.shamsi_year,
    shamsi_month: m.shamsi_month,
    target: m.target_count,
    target_monthly: m.target_monthly ?? null,
    pip: m.pip_cumulative ?? null,
    pip_monthly: m.pip_monthly ?? null,
    ict_new: m.ict_new,
    cra_new: m.cra_new,
    fully_accepted_new: m.fully_accepted_new,
    ict_cumulative: m.ict_cumulative,
    cra_cumulative: m.cra_cumulative,
    fully_accepted_cumulative: m.fully_accepted_cumulative,
  }))
}

/** The delta arrow's tone: up is green (more villages targeted), down is red. */
export function planDeltaTone(delta) {
  if (delta == null || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}
