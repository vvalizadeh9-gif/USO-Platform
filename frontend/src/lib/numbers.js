// How a quantity is written everywhere in the interface: Latin digits with a
// comma between thousands (1,000 and 2,500,000). One function so that two
// figures on the same screen cannot disagree about it.
//
// Quantities only. Years (1405), site codes and ids are not quantities and
// must never pass through here: "1,405" is not a year.

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/**
 * A number with thousands separators. Anything that is not a finite number
 * (a label, a dash, a node) is returned as it is, so a component whose
 * `value` may be either can format it unconditionally; null and undefined
 * become `fallback`.
 */
export function formatNumber(value, fallback = '—') {
  if (value == null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) return value
  return GROUPED.format(value)
}
