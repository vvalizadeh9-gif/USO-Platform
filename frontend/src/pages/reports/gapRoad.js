// Gap & Performance: the arithmetic the page does in the browser.
//
// Everything here is derived from one `/gaps/road` response and nothing else.
// That is the point of the live checksum: the page recomputes the total from
// the rows it is about to draw, prints the sum in full, and says so out loud.
// A country figure that disagrees with the list under it is the exact bug that
// shipped in the design preview of this page -- 2,570 at the top, an owner list
// adding to 445 underneath -- and it reached a person because nothing on the
// screen ever added the rows up.
//
// Kept out of the component so each rule can be tested on its own.

/** Where the Pareto line goes: the cumulative share it marks. */
export const PARETO_AT = 80

/**
 * How many addends the checksum spells out before it starts abbreviating.
 *
 * Twelve provinces or contractors can be added up by eye on one wrapped line.
 * Fifty cannot, and a line nobody reads is not a check. Past this the sentence
 * spells out the first ten and folds the rest into one figure, which is still
 * an addition a reader can verify.
 */
export const MAX_ADDENDS = 12
const KEPT_ADDENDS = 10

/**
 * The owner rows with their share of the gap, their running total and the
 * Pareto flag, in the order they will be drawn.
 *
 * Two different bases, and mixing them up is the whole risk:
 *
 * `shareOfGap` divides by the **country** stopped, because "% of gap" answers
 * "how much of the national gap is this owner's". Down a PM's full list those
 * shares sum to 100%.
 *
 * `cumulative` divides by the **visible** rows' total, because the Pareto line
 * answers "how many of the owners in front of me account for most of what I
 * can see". For a PM the two bases are the same number; for a scoped role the
 * list is one row and only the second question has an answer.
 */
export function decorate(owners, countryStopped) {
  const visible = owners.reduce((sum, owner) => sum + owner.stopped, 0)
  let running = 0
  let crossed = false
  return owners.map((owner) => {
    running += owner.stopped
    const cumulative = visible ? (running * 100) / visible : null
    // The marker goes after the first row that takes the running total to 80%,
    // so that row is inside the group rather than the first one outside it.
    const pareto = !crossed && cumulative != null && cumulative >= PARETO_AT && owner.stopped > 0
    if (pareto) crossed = true
    return {
      ...owner,
      shareOfGap: countryStopped ? (owner.stopped * 100) / countryStopped : null,
      cumulative,
      pareto,
    }
  })
}

/** The widest bar on the list, so the bars are drawn to a common scale. */
export function barScale(rows) {
  return rows.reduce((most, row) => Math.max(most, row.stopped), 0)
}

/**
 * The sentence under the list: the rows added up, in full, against the country
 * total they are supposed to make.
 *
 * `ok` is false when they disagree. The page then says so loudly rather than
 * printing a sum that does not balance and hoping somebody notices.
 */
export function checksum(rows, stretch, { plural, scoped }) {
  const total = rows.reduce((sum, row) => sum + row.stopped, 0)
  const country = stretch.country.stopped
  const before = `stopped before ${stretchShort(stretch)}`

  if (scoped) {
    const share = country ? ((total * 100) / country).toFixed(1) : null
    return {
      ok: true,
      scoped: true,
      text:
        `Your ${rows.length === 1 ? 'row is' : 'rows are'} ${fmt(total)} of the ` +
        `${fmt(country)} ${before} nationally` +
        (share == null ? '.' : ` — ${share}% of the national gap.`),
    }
  }

  return {
    ok: total === country,
    scoped: false,
    text:
      `${plural} below sum to the ${fmt(country)} ${before}: ` +
      `${addends(rows)} = ${fmt(total)}.` +
      (total === country
        ? ''
        : ` That does not match the ${fmt(country)} country total — ` +
          `a difference of ${fmt(country - total)}. One of the two is wrong; ` +
          'do not act on this page until it is.'),
  }
}

/**
 * A stretch named the way a sentence about it reads: "stopped before CRA",
 * not "stopped before CRA approval".
 */
export function stretchShort(stretch) {
  return stretch.label.replace(/ approval$/, '')
}

/** "290 + 240 + 180 + 230", abbreviated once a list gets long. */
function addends(rows) {
  const counts = rows.map((row) => row.stopped)
  if (counts.length <= MAX_ADDENDS) return counts.map(fmt).join(' + ')
  const shown = counts.slice(0, KEPT_ADDENDS)
  const rest = counts.slice(KEPT_ADDENDS)
  const restTotal = rest.reduce((sum, count) => sum + count, 0)
  return `${shown.map(fmt).join(' + ')} + ${fmt(restTotal)} (${rest.length} more)`
}

/**
 * One sentence explaining the two figures on the list, using the numbers in
 * the top row of the view the reader is looking at.
 *
 * Worked from real data rather than written as a legend, because "% of gap" and
 * "own rate" are two different fractions of two different things and a reader
 * who conflates them draws the opposite conclusion about who to call.
 */
export function workedExample(rows, stretch, { scoped } = {}) {
  const top = rows[0]
  if (!top || top.reached === 0) return null
  const rate = top.rate == null ? null : `${top.rate.toFixed(1)}%`
  const share = top.shareOfGap == null ? null : `${top.shareOfGap.toFixed(1)}%`
  const sentence =
    `${top.name} is stopped on ${fmt(top.stopped)} of the ${fmt(top.reached)} ` +
    `villages that reached ${lower(stretch.start)}` +
    (rate ? `, an own rate of ${rate}` : '') +
    (share
      ? `. Those ${fmt(top.stopped)} are ${share} of the ` +
        `${fmt(stretch.country.stopped)} stopped ${scoped ? 'nationally' : 'in total'} ` +
        `on this stretch — its “% of gap”.`
      : '.')
  return sentence
}

/**
 * Mid-sentence casing that leaves an acronym alone: "Drive test done" becomes
 * "drive test done", "ICT approved" stays "ICT approved".
 */
function lower(text) {
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

function fmt(value) {
  return value == null ? '—' : value.toLocaleString('en-US')
}

/** The rate as the page always states it: the percentage and its fraction. */
export function rateFraction(row) {
  return `${fmt(row.stopped)} of ${fmt(row.reached)} reached`
}

/** How a row that belongs to nobody is explained where it is drawn. */
export const ATTRIBUTION_NOTES = {
  unknown_province: 'No province — the CPM province cell matched none of the 31',
  unmapped: 'No current owner in the province mapping',
  unassigned: 'No DT SC contractor on the work item',
}
