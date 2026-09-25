// The scale What moved is drawn on. A module of its own because two places
// read it -- the waterfall, and the card's note that states where the scale
// starts -- and they must not each work the floor out for themselves.

/** The levels the month moved between, and the scale drawn over them.
 *
 * The scale covers those levels, not zero. A backlog of a thousand moving by
 * a hundred is the ordinary case here, and on a zero-based axis those
 * movements are a few pixels at the top of two near-identical full-height
 * bars — the one thing the card exists to show, drawn too small to see.
 * Truncating an axis is how charts mislead, so the floor is stated in the
 * card's note rather than left to be assumed as zero.
 */
export function flowScale(flows) {
  const opening = flows.opening_remaining
  const closing = flows.closing_remaining
  const afterArrivals = opening + flows.new_onair
  const levels = [opening, afterArrivals, closing]
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max((hi - lo) * 0.35, 1)
  const floor = Math.max(0, Math.round(lo - pad))
  const ceiling = Math.round(hi + pad)
  return { floor, ceiling, span: Math.max(ceiling - floor, 1), afterArrivals }
}
