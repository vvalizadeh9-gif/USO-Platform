/**
 * The History page's arithmetic: one stream's twelve months
 * (GET /pip/overview?period=year, the stream's `months[]`) for one contractor.
 *
 * A plan is null when nobody had one, never 0, and a share of a null plan is
 * null: the page shows a dash. The running month is shown but never judged
 * and never totalled; a month still ahead has no figures.
 */

/** Delivered as a whole percentage of `of`, or null when there is nothing to be a share of. */
export function percentOf(delivered, of) {
  if (!of || delivered == null) return null
  return Math.round((100 * delivered) / of)
}

/** Every contractor the year's months name, alphabetical: the Contractor select. */
export function contractorsOf(months) {
  const byId = new Map()
  for (const m of months ?? []) {
    for (const c of m.contractors ?? []) if (!byId.has(c.id)) byId.set(c.id, c.name || '')
  }
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// The History page (UEP-18): PIP, actual delivery and assignment per
// contractor across one Shamsi year, for both streams.
// ---------------------------------------------------------------------------

/**
 * The History page's year read: GET /pip/overview for the two streams it
 * shows, so the server computes neither ICT, CRA nor the attention list.
 */
export function historyParams(year) {
  return { period: 'year', year, month: 1, streams: 'dt,acceptance' }
}

/** Below this share of PIP a contractor is "behind" and shown red. */
export const BEHIND_PERCENT = 85

/** "+5", "−3" or "±0": a signed difference with a real minus sign. */
export function signedNumber(n) {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '±0'
}

/** The twelve Shamsi months in three letters, for the chart and table columns. */
const SHORT_MONTHS = ['فرو', 'ارد', 'خرد', 'تیر', 'مرد', 'شهر', 'مهر', 'آبا', 'آذر', 'دی', 'بهم', 'اسف']

/** "فرو" for 1: a Shamsi month short enough for twelve columns. */
export function shortMonthName(month) {
  return SHORT_MONTHS[Number(month) - 1] ?? String(month ?? '')
}

/**
 * One contractor's year for one stream: twelve months of
 * `{ month, running, future, pip, actual, assigned, gap, pct }` and the year's
 * `total` over the completed months.
 *
 * `months` is the stream's `months[]` from GET /pip/overview?period=year.
 * `assignedBy` is `{ [month]: number }` for DT (the scorecard's `available`
 * for this contractor), or null: Acceptance has no assignment. A closed month
 * with no plan has a null `pip`, never 0, and no gap or percentage. The
 * running month is shown but never judged or totalled; a month ahead has no
 * actual, but keeps the PIP when one is already approved for it.
 */
export function contractorYear(months, contractorId, assignedBy = null) {
  const rows = (months ?? []).map((m) => {
    const own = m.contractors?.find((c) => c.id === contractorId)
    const running = Boolean(m.is_running)
    const future = Boolean(m.is_future)
    const pip = own?.plan ?? null
    const actual = future ? null : (own?.delivered ?? 0)
    const closed = !future && !running
    return {
      month: m.shamsi_month,
      running,
      future,
      pip,
      actual,
      assigned: assignedBy && !future ? (assignedBy[m.shamsi_month] ?? null) : null,
      gap: closed && pip != null ? actual - pip : null,
      pct: closed ? percentOf(actual, pip) : null,
    }
  })
  const judged = rows.filter((r) => !r.future && !r.running && r.pip != null)
  const pip = judged.length ? judged.reduce((s, r) => s + r.pip, 0) : null
  const actual = judged.reduce((s, r) => s + r.actual, 0)
  return {
    rows,
    total: { pip, actual, gap: pip == null ? null : actual - pip, pct: percentOf(actual, pip) },
  }
}

/**
 * The left list: every contractor the year names with the year's share of PIP
 * delivered for each stream (`{ dt, acceptance }` keyed like `streams`), worst
 * first by the lower of the two. A contractor with no share sorts last.
 */
export function worstFirst(streams) {
  const people = new Map()
  for (const [key, months] of Object.entries(streams)) {
    for (const { id, name } of contractorsOf(months)) {
      const entry = people.get(id) ?? { id, name, pct: {} }
      entry.pct[key] = contractorYear(months, id).total.pct
      people.set(id, entry)
    }
  }
  const low = (p) => {
    const present = Object.values(p.pct).filter((v) => v != null)
    return present.length ? Math.min(...present) : Infinity
  }
  return [...people.values()].sort((a, b) => (low(a) === low(b) ? a.name.localeCompare(b.name) : low(a) - low(b)))
}
