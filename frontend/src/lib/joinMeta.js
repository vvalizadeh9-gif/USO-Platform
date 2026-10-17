/**
 * Join the parts of a meta line with " · ", only between parts that have
 * something in them: ['224 late', null, '6 owners'] → '224 late · 6 owners'.
 * A line never ends (or starts) on a dot (UEP-13 §3.4).
 */
export function joinMeta(...parts) {
  return parts.flat().filter((p) => p !== null && p !== undefined && p !== false && p !== '').join(' · ')
}

/** The same rule for React nodes: separators only between present parts. */
export function metaParts(...parts) {
  return parts.flat().filter((p) => p !== null && p !== undefined && p !== false && p !== '')
}
