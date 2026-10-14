// How a quantity is written on screen: with a thousands separator.
//
// 1000 is "1,000" and 2500000 is "2,500,000", everywhere a count, a total or a
// figure is shown. Latin digits and a comma, whatever the browser's language,
// so a reader on a Persian-locale machine sees the same figure as everyone else
// and a screenshot of one page agrees with the next.
//
// This is for *quantities*. Identifiers are not quantities and must never come
// through here: a Shamsi year (1405), a site code, a letter number and a phone
// number are labels that happen to be made of digits.

const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })

/** What a missing or non-numeric value reads as. */
export const NO_VALUE = '—'

/**
 * `value` written with thousands separators.
 *
 * Accepts a number or a numeric string (the API sends some counts as text).
 * Anything else -- null, undefined, '', NaN, Infinity -- reads as `fallback`
 * rather than "NaN", so a figure that has not loaded never shows as a number.
 *
 * @param {number | string | null | undefined} value
 * @param {object} [options]
 * @param {string} [options.fallback]   Shown when there is no number.
 * @param {number} [options.maximumFractionDigits]  Default 3, as `toLocaleString`.
 */
export function formatNumber(value, { fallback = NO_VALUE, maximumFractionDigits } = {}) {
  if (value === null || value === undefined || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (maximumFractionDigits === undefined) return GROUPED.format(n)
  return n.toLocaleString('en-US', { maximumFractionDigits })
}

/** A count with its noun: "1 site", "1,204 sites". */
export function formatCount(n, one, many = `${one}s`) {
  return `${formatNumber(n, { fallback: '0' })} ${n === 1 ? one : many}`
}
