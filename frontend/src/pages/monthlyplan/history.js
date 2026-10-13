/**
 * The History table's arithmetic: one stream's twelve months
 * (GET /pip/overview?period=year, the stream's `months[]`) for every
 * contractor or for one.
 *
 * A plan is null when nobody had one, never 0, and a share of a null plan is
 * null: the page shows a dash. The running month is shown but never judged
 * and never totalled; a month still ahead has no figures.
 */

const sumOrNull = (values) => {
  const present = values.filter((v) => v != null)
  return present.length ? present.reduce((a, b) => a + b, 0) : null
}

/** Delivered as a whole percentage of `of`, or null when there is nothing to be a share of. */
export function percentOf(delivered, of) {
  if (!of || delivered == null) return null
  return Math.round((100 * delivered) / of)
}

/**
 * A closed month's verdict on delivered against plan: `met` (100% or more),
 * `near` (80-99%), `below` (under 80%), or null with no plan. Decided on the
 * exact share, not the rounded one: 79.6% is below 80%.
 */
export function resultOf(delivered, plan) {
  if (!plan || delivered == null) return null
  const share = delivered / plan
  if (share >= 1) return 'met'
  if (share >= 0.8) return 'near'
  return 'below'
}

/**
 * `{ rows, totals }` for the table. `contractorId` null is every contractor
 * (with the Internal PIP); a number is that contractor's own row set.
 *
 * Each row: `{ month, name, future, running, plan, internal, delivered,
 * pctPlan, pctInternal, result }`. `totals` is the completed months only.
 */
export function historyTable(months, contractorId = null) {
  const all = contractorId == null
  const rows = (months ?? []).map((m) => {
    const base = { month: m.shamsi_month, name: m.shamsi_month_name, future: m.is_future, running: m.is_running }
    if (m.is_future) return base
    const own = all ? null : m.contractors.find((c) => c.id === contractorId)
    const plan = all ? m.plan : (own?.plan ?? null)
    const delivered = all ? (m.delivered ?? 0) : (own?.delivered ?? 0)
    const internal = all ? (m.internal ?? null) : null
    return {
      ...base,
      plan,
      internal,
      delivered,
      pctPlan: percentOf(delivered, plan),
      pctInternal: percentOf(delivered, internal),
      result: m.is_running ? 'running' : resultOf(delivered, plan),
    }
  })

  const closed = rows.filter((r) => !r.future && !r.running)
  const plan = sumOrNull(closed.map((r) => r.plan))
  const internal = sumOrNull(closed.map((r) => r.internal))
  const delivered = closed.reduce((sum, r) => sum + r.delivered, 0)
  return {
    rows,
    totals: {
      plan,
      internal,
      delivered,
      pctPlan: percentOf(delivered, plan),
      pctInternal: percentOf(delivered, internal),
    },
  }
}

/** Every contractor the year's months name, alphabetical: the Contractor select. */
export function contractorsOf(months) {
  const byId = new Map()
  for (const m of months ?? []) {
    for (const c of m.contractors ?? []) if (!byId.has(c.id)) byId.set(c.id, c.name || '')
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}
