// How a pipeline site list is ordered (UEP-06 §4.1).
//
// Longest waiting first. "Sort by province" keeps a province's sites together
// instead: provinces ordered by their longest wait, then sites by wait inside
// each. A site whose wait is unknown sorts last, never guessed into first place.

const wait = (row) => (row.days_waiting ?? -1)

export function byWait(a, b) {
  return wait(b) - wait(a)
}

/** @template {{ province?: string|null, days_waiting?: number|null }} T
 * @param {T[]} rows @param {boolean} byProvince @returns {T[]} */
export function orderSites(rows, byProvince) {
  const sorted = [...rows].sort(byWait)
  if (!byProvince) return sorted
  const longest = new Map()
  for (const row of sorted) {
    const key = row.province || ''
    if (!longest.has(key)) longest.set(key, wait(row))
  }
  return sorted.sort(
    (a, b) =>
      longest.get(b.province || '') - longest.get(a.province || '') ||
      (a.province || '').localeCompare(b.province || '') ||
      byWait(a, b),
  )
}

/** Whole days past an SLA count as late; an unknown wait never does. */
export function isLate(days, slaDays) {
  return days != null && slaDays != null && days > slaDays
}
