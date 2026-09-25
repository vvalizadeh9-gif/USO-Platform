// The arithmetic behind "Where this is going", apart from the drawing.
//
// A module of its own because two places read it: the chart, and the card's
// info note, which states where the chart's scale starts and how many sites
// sit in its opening balance. Both must get those figures from one place, not
// work them out twice.

import { count } from '../format'

/** A step that reads as round -- 1, 2, 2.5 or 5 times a power of ten --
 * close to `raw`. */
function niceStep(raw) {
  if (raw <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= raw) return step * magnitude
  }
  return 10 * magnitude
}

/** The vertical scale for the values on screen: their range plus a margin,
 * rounded out to a round step.
 *
 * FITTED TO WHAT IS DRAWN. It used to round the programme's values to a
 * coarse magnitude -- a floor of 1,000 and a ceiling of 4,000 around lines
 * that ran from ~1,800 to ~3,083 -- so the two lines, which are the whole
 * chart, used about 40% of its height, and zooming in to one year would have
 * given each month more width and no more height. Fitted, the lines fill most
 * of the plot in every view.
 *
 * The chart draws no axis, so the floor is stated in the card's note ("the
 * scale starts at N, not zero"); a truncated scale is only honest if it says
 * where it starts. It never goes below zero.
 */
export function fitScale(values) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.12, hi * 0.02, 1)
  const step = niceStep((hi - lo + 2 * pad) / 4)
  const floor = Math.max(0, Math.floor((lo - pad) / step) * step)
  const ceiling = Math.max(floor + step, Math.ceil((hi + pad) / step) * step)
  return { floor, ceiling }
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

/** Everything one view of the chart draws from.
 *
 * `scope` is 'all' or a Shamsi year. EVERY SCOPE IS THE SAME LEDGER, ZOOMED.
 * A single year is a window onto the running totals, not a count restarted
 * at zero: its first point is the balance the year opened with, and every
 * figure after it is the real running total, so the gap is always the real
 * backlog and coverage can never pass 100%. The view this replaces restarted
 * both counts at zero for a year, which drew a year that finished more drive
 * tests than it brought on air as "coverage 295%" and a negative gap.
 *
 * What that view could say that this one would otherwise not -- how much the
 * year itself put on air and drive-tested -- is `yearActivity`, the sums of
 * the year's own months.
 */
export function flowView(data, scope = 'all') {
  const years = flowYears(data)
  const selected = years.includes(scope) ? scope : 'all'
  const all = cumulativePoints(data)
  let points = all
  let months = data.months
  let yearActivity = null
  if (selected !== 'all') {
    const first = data.months.findIndex((m) => m.year === selected)
    const inYear = data.months.filter((m) => m.year === selected).length
    // all[i] is the balance before month i, so the year's window opens on
    // the balance it inherited and closes on its last month.
    points = all.slice(first, first + inYear + 1)
    months = data.months.slice(first, first + inYear)
    yearActivity = {
      onAired: months.reduce((sum, m) => sum + m.on_aired, 0),
      dtDone: months.reduce((sum, m) => sum + m.dt_done, 0),
    }
  }
  const { floor, ceiling } = fitScale(points.flatMap((p) => [p.onAir, p.dtDone]))
  // Both sides, not just on-air: the bug this count exists to disclose showed
  // up on the DT-done side. The larger of the two rather than their sum,
  // because a site can be missing both dates and be counted on both sides.
  const notPlaced = Math.max(data.not_placed?.on_air ?? 0, data.not_placed?.dt_done ?? 0)
  return { years, selected, isAll: selected === 'all', points, months, floor, ceiling, notPlaced, yearActivity }
}

/** The notes behind the card's info icon, for the view on screen. */
export function flowNotes(data, scope = 'all') {
  const { selected, isAll, floor, notPlaced } = flowView(data, scope)
  const notes = [
    'Sites on air against drive tests done, and what each month did to the backlog.',
    (isAll
      ? 'The running total starts from the opening balance on 1 Farvardin 1404.'
      : `Showing ${selected} only. These are the programme’s real running totals, ` +
        `carrying everything before ${selected}, so the gap is the real backlog at each ` +
        'month’s end.') + (floor > 0 ? ` The scale starts at ${count(floor)}, not zero.` : ''),
    'The pills under the months are what each one did to the backlog — sites on air that ' +
      'month minus drive tests finished — so they add up to the movement in the gap across ' +
      'the chart. Green shrank it, red grew it.',
  ]
  if (notPlaced > 0) {
    notes.push(
      `${count(notPlaced)} ${notPlaced === 1 ? 'site has' : 'sites have'} no date ` +
        `to place ${notPlaced === 1 ? 'it' : 'them'} on the timeline, so ` +
        `${notPlaced === 1 ? 'it sits' : 'they sit'} in the opening balance, and so in every ` +
        'running total after it.',
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
