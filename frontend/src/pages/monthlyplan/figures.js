// The two bits of arithmetic the contractor's screen does for itself.
//
// Both are ways of drawing numbers the server already sent, which is why they
// are here and not in the payload: a percentage computed on both sides of the
// wire is two answers to one question, free to disagree the moment one of them
// is rounded differently.

// The y-axis ends on a multiple of four so that five gridlines land on whole
// numbers of drive tests. A tick at 7.5 sites is not a thing anybody counts.
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000, 2500]

/** The top of the chart's scale, and the gap between its gridlines. */
export function axisScale(highest) {
  const need = Math.max(1, highest)
  const step = STEPS.find((s) => s * 4 >= need) ?? Math.ceil(need / 4)
  return { max: step * 4, step }
}

/** Delivered as a share of PIP, or null when there is no PIP to be a share of.
 *
 * Null rather than zero, and the screen shows a dash for it: a contractor with
 * no approved plan has not achieved 0% of anything.
 */
export function sharePercent(delivered, pip) {
  if (!pip) return null
  return Math.round((delivered / pip) * 100)
}
