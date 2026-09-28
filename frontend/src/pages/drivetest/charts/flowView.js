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
 * The chart labels its axis at every `step` from `floor` to `ceiling`, and
 * the card's note says where the scale starts too ("the scale starts at N,
 * not zero"); a truncated scale is only honest if it says where it starts.
 * It never goes below zero.
 */
export function fitScale(values) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.12, hi * 0.02, 1)
  const step = niceStep((hi - lo + 2 * pad) / 4)
  const floor = Math.max(0, Math.floor((lo - pad) / step) * step)
  const ceiling = Math.max(floor + step, Math.ceil((hi + pad) / step) * step)
  return { floor, ceiling, step }
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
 * DERIVED FROM THE POINTS THE CHART IS ALREADY DRAWING, not recomputed from
 * the payload, which is what makes the row under the plot reconcile to the lines
 * above it rather than merely agree with them most of the time. The sum of
 * these is exactly `last.gap - first.gap`, because each one is the step
 * between two consecutive gap values and the sum telescopes. `points` starts
 * with the balance the view opened on, so there is one entry per month.
 *
 * Negative is good news, so a negative number is green -- the convention the
 * Pending card's month-over-month chip already uses.
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

/** Every month since Farvardin 1404, as running totals from the opening
 * balance. What any scope the payload cannot serve falls back to. */
export const CUMULATIVE = 'cumulative'

/** The chart's default view: the last twelve months, as a window onto the
 * same running totals -- not a count restarted twelve months ago. */
export const LAST_12 = 'last12'
const LAST_12_MONTHS = 12

/** Where a scope's window starts and ends in `data.months` (end exclusive),
 * and whether it is the cumulative view. */
function windowOf(data, scope, years) {
  if (scope === LAST_12) {
    return { selected: LAST_12, first: Math.max(0, data.months.length - LAST_12_MONTHS), end: data.months.length }
  }
  if (years.includes(scope)) {
    const first = data.months.findIndex((m) => m.year === scope)
    return { selected: scope, first, end: first + data.months.filter((m) => m.year === scope).length }
  }
  return { selected: CUMULATIVE, first: 0, end: data.months.length }
}

/** Everything one view of the chart draws from.
 *
 * `scope` is `LAST_12`, `CUMULATIVE` or a Shamsi year. Cumulative -- also
 * what anything else falls back to: a year the payload does not have --
 * draws every month the payload covers, Farvardin 1404 to now. A year draws
 * one column per month of that year: twelve for a finished year, Farvardin
 * to now for the current one. Last 12 draws the twelve most recent months
 * (all of them, when there are fewer).
 *
 * THE LINES CARRY THE RUNNING TOTAL; THEY DO NOT RESET. In every view each
 * point is the programme's real running total at that month's end, carried
 * from the opening balance on 1 Farvardin 1404 through every month before
 * it, so the last point is the KPI cards' figure and the gap is always the
 * real backlog. A year view is a window onto the same lines, not a count
 * restarted at zero: the view that once did that drew a year that finished
 * more drive tests than it brought on air as "coverage 295%" and a negative
 * gap. What each month itself did is under its column and in the hover card.
 *
 * `points[0]` is the balance the view opened on -- not drawn, but it is what
 * the first month's change in the gap is measured from -- and `points[1..]`
 * are the months, in the same order as `months`.
 *
 * The scale is fitted to BOTH lines, so neither can leave the plot whichever
 * of the two is higher.
 */
export function flowView(data, scope = LAST_12) {
  const years = flowYears(data)
  const { selected, first, end } = windowOf(data, scope, years)
  const cumulative = selected === CUMULATIVE
  // A window that can cross a year change marks where each year starts; a
  // single year does not need to.
  const yearMarks = !years.includes(selected)
  const all = cumulativePoints(data)
  // all[i + 1] is the running total after data.months[i], so all[first] is
  // where the view opened.
  const points = all.slice(first, end + 1)
  const months = data.months.slice(first, end)
  const { floor, ceiling, step } = fitScale(points.slice(1).flatMap((p) => [p.onAir, p.dtDone]))
  const ticks = Array.from({ length: Math.round((ceiling - floor) / step) + 1 }, (_, i) => floor + i * step)
  // Both sides, not just on-air: the bug this count exists to disclose showed
  // up on the DT-done side. The larger of the two rather than their sum,
  // because a site can be missing both dates and be counted on both sides.
  const notPlaced = Math.max(data.not_placed?.on_air ?? 0, data.not_placed?.dt_done ?? 0)
  return { years, selected, cumulative, yearMarks, points, months, floor, ceiling, ticks, notPlaced }
}

/** The view in words, for the chart's accessible name and the info note. */
export function flowViewName({ selected }) {
  if (selected === CUMULATIVE) return 'every month since Farvardin 1404'
  if (selected === LAST_12) return 'the last 12 months'
  return String(selected)
}

/** The notes behind the card's info icon, for the view on screen. */
export function flowNotes(data, scope = LAST_12) {
  const view = flowView(data, scope)
  const { floor, notPlaced } = view
  const notes = [
    'Sites on air against drive tests done, and what each month did to the backlog.',
    `${view.cumulative ? 'Showing every month since Farvardin 1404.' : `Showing ${flowViewName(view)}, month by month.`} ` +
      'The lines are the programme’s running totals, carried ' +
      'from the opening balance on 1 Farvardin 1404, so the gap is the real backlog at each ' +
      'month’s end.' +
      (floor > 0 ? ` The scale starts at ${count(floor)}, not zero.` : ''),
    'Under each month is its change in the gap: sites on air that month minus drive tests ' +
      'finished. Green shrank the backlog, brick grew it. Hover or focus a month for its figures.',
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
