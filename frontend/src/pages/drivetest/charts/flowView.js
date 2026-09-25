// The arithmetic behind "Where this is going", apart from the drawing.
//
// A module of its own because two places read it: the chart, and the card's
// info note, which states where the chart's scale starts and how many sites
// sit in its opening balance. Both must get those figures from one place, not
// work them out twice. Everything here is moved unchanged from FlowChart.jsx;
// `flowView` and `flowNotes` are the only additions, and they only assemble
// what the functions below already compute.

import { count } from '../format'

/** A rounded ceiling for an axis, so the plot has a readable amount of
 * headroom above its highest point. */
export function niceMax(value) {
  if (value <= 0) return 10
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
  for (const step of steps) {
    const candidate = step * magnitude
    if (candidate >= value) return candidate
  }
  return 10 * magnitude
}

/** A round floor visibly below the minimum, for an axis that does not open
 * at zero. Picks the largest "nice" number that still sits under 85% of the
 * minimum, so the reader always has a labelled step between the floor and
 * the lowest point actually drawn. */
export function niceFloorBelow(value) {
  if (value <= 0) return 0
  const target = value * 0.85
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)))
  for (const step of [10, 5, 2.5, 2, 1]) {
    const candidate = step * magnitude
    if (candidate <= target) return candidate
  }
  return magnitude / 10
}

/** Running totals from the opening balance, one point per month plus the
 * start, Farvardin 1404 to now.
 *
 * `not_placed` IS PART OF THE OPENING BALANCE HERE. The backend hands back
 * three things -- an opening balance, one entry per month, and a not-placed
 * bucket for sites it could not put in any Shamsi month -- and the KPI cards
 * above this chart count all three. A series built from `opening + months`
 * alone therefore ends below the card it sits under, and the four tiles,
 * which read the last point of this series, disagree with it: the same sites
 * missing from DT done and so added to the gap. The backend's own parity
 * test spells the identity out -- `opening + sum(months) + not_placed` is the
 * KPI figure -- and this is where the third term was missing.
 *
 * The opening balance is the only placement that does not invent a month for
 * them: an undated site belongs to no month, and the position the chart opens
 * with is exactly the part of the total that predates the timeline. Per-month
 * values stay untouched, so the net-change strip is unaffected -- the opening
 * and closing gaps both shift by the same amount, and the steps between them
 * are what the strip draws.
 */
export function cumulativePoints(data) {
  let onAir = data.opening.on_air + (data.not_placed?.on_air ?? 0)
  let dtDone = data.opening.dt_done + (data.not_placed?.dt_done ?? 0)
  const points = [{ year: null, month: null, onAir, dtDone, gap: onAir - dtDone, isOpen: false }]
  for (const m of data.months) {
    onAir += m.on_aired
    dtDone += m.dt_done
    points.push({ year: m.year, month: m.month, onAir, dtDone, gap: onAir - dtDone, isOpen: m.is_open })
  }
  return points
}

/** Running totals restarting at zero for one Shamsi year.
 *
 * No `not_placed` here, deliberately. This tab counts one year's activity and
 * opens at zero by design, so its tiles already differ from the KPI cards on
 * purpose; a site with no date belongs to no year either, and folding it in
 * would attribute it to whichever year happened to be selected.
 */
export function yearPoints(data, year) {
  const months = data.months.filter((m) => m.year === year)
  let onAir = 0
  let dtDone = 0
  const points = [{ year, month: null, onAir, dtDone, gap: 0, isOpen: false }]
  for (const m of months) {
    onAir += m.on_aired
    dtDone += m.dt_done
    points.push({ year: m.year, month: m.month, onAir, dtDone, gap: onAir - dtDone, isOpen: m.is_open })
  }
  return points
}

/** What each month did to the backlog, one entry per month drawn.
 *
 * The change in pending over the month: sites that went on air minus drive
 * tests finished. Negative means the backlog shrank.
 *
 * DERIVED FROM THE POINTS THE CHART IS ALREADY DRAWING, not fetched again
 * and not recomputed from the payload, which is what makes the strip
 * reconcile to the lines above it rather than merely agree with them most of
 * the time. The sum of these is exactly `last.gap - first.gap`, because each
 * one is the step between two consecutive gap values and the sum telescopes.
 * That identity is what the parity test asserts, and it is the reason this
 * takes `points` rather than `data.months`: a strip built from the payload
 * would keep summing correctly while the chart beside it drew a filtered
 * year, and be wrong in the one view where it looked right.
 *
 * The sign convention is the one the Gap tile above already uses -- see its
 * `DeltaChip direction="down"`. A falling gap is good news, so a negative
 * number here is green. The two would be read together and must not disagree
 * about which way is which.
 */
export function netChanges(points) {
  const out = []
  for (let i = 1; i < points.length; i += 1) out.push(points[i].gap - points[i - 1].gap)
  return out
}

/** Whether the payload has anything at all to draw. An opening balance of
 * zero and every month empty is a brand-new deployment, not a chart. */
export function flowHasActivity(data) {
  if (!data || !data.opening || !Array.isArray(data.months)) return false
  return (
    data.opening.on_air > 0 ||
    data.opening.dt_done > 0 ||
    data.months.some((m) => m.on_aired > 0 || m.dt_done > 0)
  )
}

/** The Shamsi years the payload covers, oldest first. */
export function flowYears(data) {
  return Array.from(new Set(data.months.map((m) => m.year))).sort((a, b) => a - b)
}

/** Everything one view of the chart draws from: its points, the months they
 * cover, and the scale. `tab` is 'cumulative' or 'year'; `year` is the year
 * asked for, falling back to the latest the payload has. */
export function flowView(data, tab, year) {
  const years = flowYears(data)
  const selectedYear = years.includes(year) ? year : years[years.length - 1]
  const isCumulative = tab === 'cumulative'
  const points = isCumulative ? cumulativePoints(data) : yearPoints(data, selectedYear)
  const months = isCumulative ? data.months : data.months.filter((m) => m.year === selectedYear)
  const values = points.flatMap((p) => [p.onAir, p.dtDone])
  const ceiling = niceMax(Math.max(1, ...values))
  const floor = isCumulative ? niceFloorBelow(Math.min(points[0].onAir, points[0].dtDone)) : 0
  // Both sides, not just on-air: the bug this count exists to disclose showed
  // up on the DT-done side. The larger of the two rather than their sum,
  // because a site can be missing both dates and be counted on both sides.
  const notPlaced = Math.max(data.not_placed?.on_air ?? 0, data.not_placed?.dt_done ?? 0)
  return { years, selectedYear, isCumulative, points, months, ceiling, floor, notPlaced }
}

/** The notes that used to sit under the chart, as the sentences the card's
 * info icon shows. Worded as they were; only their place changed. */
export function flowNotes(data, tab, year) {
  const { isCumulative, selectedYear, floor, notPlaced } = flowView(data, tab, year)
  const notes = [
    'Sites on air against drive tests done, and what each month did to the backlog.',
    isCumulative
      ? 'The running total starts from the opening balance on 1 Farvardin 1404.' +
        (floor > 0 ? ` The scale starts at ${count(floor)}, not zero.` : '')
      : `This counts only ${selectedYear}, so its gap differs from the cumulative one.`,
    'The pills under the months are what each one did to the backlog — sites on air that ' +
      'month minus drive tests finished — so they add up to the movement in the gap across ' +
      'the whole chart. Green shrank it, red grew it.',
  ]
  if (notPlaced > 0) {
    notes.push(
      `${count(notPlaced)} ${notPlaced === 1 ? 'site has' : 'sites have'} no date ` +
        `to place ${notPlaced === 1 ? 'it' : 'them'} on the timeline, so ` +
        `${notPlaced === 1 ? 'it sits' : 'they sit'} ` +
        (isCumulative ? 'in the opening balance.' : 'outside this year’s count.'),
    )
  }
  return notes
}

/** Which months get their name under the axis, as a set of indexes.
 *
 * Every `every`th month, because full Persian month names on every step
 * collide. The latest month is named too, since it is "now" -- unless that
 * would put it a single step from the label before it, where the two names
 * would run into each other. Then one of them gives way: the earlier label,
 * unless it is a Farvardin carrying its year underneath (`anchorsYear`), in
 * which case the year stays and the latest month goes unnamed. It is never
 * lost: the readout under the chart opens on it and names it in full.
 */
export function labelledMonths(months, every, anchorsYear) {
  const last = months.length - 1
  const out = new Set()
  if (last < 0) return out
  for (let j = 0; j <= last; j += every) out.add(j)
  if (out.has(last)) return out
  const prev = last - (last % every)
  if (last - prev >= 2) {
    out.add(last)
  } else if (!(anchorsYear && months[prev].month === 1)) {
    out.delete(prev)
    out.add(last)
  }
  return out
}
