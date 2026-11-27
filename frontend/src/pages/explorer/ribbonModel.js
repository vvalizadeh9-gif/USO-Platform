/**
 * The journey ribbon's geometry (UEP-28 §B4), as plain numbers so it can be
 * tested without a browser. JourneyRibbon draws what this returns.
 *
 * - Finished steps sit on a real time scale: a segment's length is its days,
 *   with a minimum width so labels never collide (the first is wider: its
 *   label is left-aligned). A step with no day count gets the minimum.
 * - The step in progress runs from the last finished step to Today.
 * - From DT done, acceptance runs as two lanes, ICT and CRA, each filled by
 *   its approved share; Sent to ICT is a pin on the ICT lane.
 * - Steps still to come are a dashed tail of hollow dots.
 */
import { daysBetween as daysBack, formatGregorian } from '../../lib/dates'
import { STEP_META, dayCount } from './explorerModel'

export const RIBBON = Object.freeze({
  y: 46,            // the main line
  track: 8,         // its thickness
  padLeft: 28,
  padRight: 28,
  laneOffset: 15,   // each lane's distance from the main line
  laneCurve: 36,    // how far the fork bends before it runs straight
  laneLabel: 184,   // room after the lanes for "ICT 2 of 3 approved"
  laneLabelDone: 236,
  minFirst: 164,
  minStep: 124,
  minFork: 190,
  tailStep: 96,
  sentLabelGap: 130, // Sent to ICT's label from the fork, clear of DT done's
})

const MAIN_KEYS = ['on_air', 'health_check', 'assigned', 'dt_done']

/** Whole days from `a` to `b` (ISO dates); null when either is missing or it runs backwards. */
export function daysBetween(a, b) {
  const days = daysBack(b, a)
  return days != null && days >= 0 ? days : null
}

/**
 * Widths for segments of `days`, filling `room`: proportional to the days,
 * but never under each one's minimum. When even the minimums do not fit,
 * they shrink together.
 */
export function allocate(days, mins, room) {
  const total = mins.reduce((a, b) => a + b, 0)
  const floor = total > room ? mins.map((m) => (m * room) / total) : mins
  const fixed = new Set()
  let widths = days.map(() => 0)
  for (let pass = 0; pass <= days.length; pass += 1) {
    const free = days.map((_, i) => i).filter((i) => !fixed.has(i))
    const rest = room - [...fixed].reduce((a, i) => a + floor[i], 0)
    const sum = free.reduce((a, i) => a + (days[i] || 0), 0)
    widths = days.map((d, i) => (fixed.has(i) ? floor[i] : sum ? ((d || 0) / sum) * rest : rest / free.length))
    const under = free.filter((i) => widths[i] < floor[i])
    if (under.length === 0) break
    under.forEach((i) => fixed.add(i))
  }
  return widths.map((w, i) => (fixed.has(i) ? floor[i] : w))
}

/** The segments before the tail: finished steps, then the open step or the fork. */
function segments(steps, fork, end) {
  const out = []
  for (let i = 1; i < MAIN_KEYS.length; i += 1) {
    if (steps[i].state === 'done') out.push({ index: i, kind: 'done', days: steps[i].gap_days })
    else if (steps[i].state === 'in_progress') out.push({ index: i, kind: 'open', days: steps[i].gap_days })
  }
  if (fork) out.push({ index: 4, kind: 'fork', days: daysBetween(steps[3].date, end) })
  return out
}

function tailKeys(steps, fork) {
  if (fork) return []
  const upcoming = steps.filter((s) => s.state === 'upcoming' && s.key !== 'acceptance').map((s) => s.key)
  return [...upcoming, 'acceptance']
}

const milestoneDate = (step) => (step.state === 'done' ? formatGregorian(step.date) || '—' : 'Not yet')

/** The layout for a record at `width` pixels. */
export function layoutRibbon({ steps, lanes, today, acceptanceStarted }, width) {
  const R = RIBBON
  const done = steps[steps.length - 1].state === 'done'
  const fork = Boolean(acceptanceStarted) && steps[3].state === 'done'
  const end = done ? steps[5].date : today
  const segs = steps[0].state === 'done' ? segments(steps, fork, end) : []
  const tail = tailKeys(steps, fork).filter((k) => k !== 'on_air' || steps[0].state !== 'done')
  const padRight = fork ? (done ? R.laneLabelDone : R.laneLabel) : R.padRight
  const tailWidth = tail.length ? tail.length * R.tailStep + 20 : 0
  const room = Math.max(0, width - R.padLeft - padRight - tailWidth)
  const mins = segs.map((s, i) => (s.kind === 'fork' ? R.minFork : i === 0 ? R.minFirst : R.minStep))
  const widths = allocate(segs.map((s) => s.days), mins, room)

  const xs = [R.padLeft]
  widths.forEach((w) => xs.push(xs[xs.length - 1] + w))
  const lastX = xs[xs.length - 1]
  const forkStart = fork ? xs[segs.length - 1] : null
  const openSeg = segs.find((s) => s.kind === 'open')
  const mainEnd = fork ? forkStart : openSeg ? xs[segs.indexOf(openSeg)] : lastX

  const milestones = []
  if (steps[0].state === 'done') {
    milestones.push(milestone(steps[0], R.padLeft, true, true))
  }
  segs.forEach((s, k) => {
    if (s.kind === 'done') milestones.push(milestone(steps[s.index], xs[k + 1], s.index === 3, false))
  })

  return {
    width,
    done,
    fork,
    track: segs.length ? { x0: R.padLeft, x1: mainEnd } : null,
    cuts: segs.slice(1).filter((s) => s.kind === 'done').map((s) => xs[segs.indexOf(s)]),
    open: openSeg ? { x0: xs[segs.indexOf(openSeg)], x1: lastX } : null,
    durations: durations(segs, xs),
    milestones,
    today: !done && (openSeg || fork) ? lastX : null,
    lanes: fork ? forkLanes(steps, lanes, forkStart, lastX, end) : null,
    tail: tailLayout(tail, steps[0].state === 'done' ? lastX : R.padLeft - R.tailStep / 2 - 6),
  }
}

function milestone(step, x, big, first) {
  return { key: step.key, x, name: STEP_META[step.key].label, date: milestoneDate(step), big, first, future: false }
}

function durations(segs, xs) {
  return segs.map((s, k) => {
    const x = (xs[k] + xs[k + 1]) / 2
    if (s.days == null) return null
    if (s.kind === 'done') return { x, text: `${s.days} d`, open: false, fork: false }
    return { x, text: `${s.days} d so far`, open: true, fork: s.kind === 'fork' }
  }).filter(Boolean)
}

function forkLanes(steps, lanes, a, b, end) {
  const R = RIBBON
  const curve = Math.min(R.laneCurve, (b - a) * 0.3)
  const start = a + curve
  const sent = steps[4]
  const sentDays = daysBetween(steps[3].date, sent.date)
  const forkDays = daysBetween(steps[3].date, end)
  const span = b - start
  // Sent to ICT on the same time scale as the fork, never inside its bend.
  const sentAt = sent.state === 'done' && sentDays != null && forkDays
    ? Math.max(start, a + Math.min(1, sentDays / forkDays) * (b - a))
    : start
  return {
    a,
    start,
    b,
    // Its label never sits on DT done's, which is centred on the fork.
    sent: { x: sentAt, labelX: Math.max(sentAt, a + R.sentLabelGap), done: sent.state === 'done', date: milestoneDate(sent) },
    authorities: ['ict', 'cra'].map((key, i) => {
      const lane = lanes?.[key] || { approved: 0, total: 0, done_on: null }
      const share = lane.total ? lane.approved / lane.total : 0
      return {
        key,
        y: R.y + (i === 0 ? -R.laneOffset : R.laneOffset),
        fillX: start + span * share,
        approved: lane.approved,
        total: lane.total,
        all: lane.total > 0 && lane.approved === lane.total,
        doneOn: formatGregorian(lane.done_on),
      }
    }),
  }
}

function tailLayout(keys, from) {
  if (!keys.length) return null
  const R = RIBBON
  return {
    x0: from + 6,
    x1: from + 16 + keys.length * R.tailStep,
    dots: keys.map((key, k) => ({
      key,
      x: from + 16 + R.tailStep / 2 + k * R.tailStep,
      name: STEP_META[key].label,
      date: key === 'acceptance' ? 'ICT · CRA' : 'Not yet',
    })),
  }
}

/** The ribbon's accessible name: every step with its date or "in progress,
 * N days so far", then each lane's status. */
export function ribbonSummary({ steps, lanes, acceptanceStarted }) {
  const parts = steps.map((s) => {
    const name = STEP_META[s.key].label
    if (s.state === 'done') return `${name} ${formatGregorian(s.date) || 'done, no date'}`
    if (s.state === 'in_progress') {
      return s.gap_days != null ? `${name} in progress, ${dayCount(s.gap_days)} so far` : `${name} in progress`
    }
    return `${name} not yet`
  })
  if (acceptanceStarted && lanes) {
    for (const key of ['ict', 'cra']) {
      const lane = lanes[key]
      const all = lane.total > 0 && lane.approved === lane.total
      parts.push(`${key.toUpperCase()} ${all ? `all approved${lane.done_on ? `, ${formatGregorian(lane.done_on)}` : ''}` : `${lane.approved} of ${lane.total} approved`}`)
    }
  }
  return parts.join('; ')
}
