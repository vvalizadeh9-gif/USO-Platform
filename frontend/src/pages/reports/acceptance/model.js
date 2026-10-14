/**
 * The Acceptance Dashboard's view model: pure functions of the two payloads
 * the page reads (GET /acceptance/overview and GET /acceptance/progress?year=).
 * No React and no fetching, so each rule here is tested on its own.
 *
 * Nothing here invents a number. A figure with no source is left out, a plan
 * that does not exist is `null` all the way to the screen, and the only
 * arithmetic is shares, paces and what is left -- each of them spelled out in
 * the functions below, and none of them a calendar calculation: the day of
 * the month and its length are the server's (`progress.today`).
 *
 * THE REFERENCE PLAN. The chart's "% of plan", the year plan track and the
 * PIP card's "to date" line read one plan: the Internal PIP when this reader
 * may see it, else the Contractor PIP ("Your PIP" for a contractor). A reader
 * who is not shown the Internal PIP is never measured against it.
 */

import { formatNumber } from '../../../lib/numbers'

// ------------------------------------------------------------------ streams
/** The page's three tabs, in order. `key` is the tab and the payload key. */
export const STREAMS = [
  { key: 'village', label: 'Fully accepted', noun: 'village', title: 'Fully accepted against plan' },
  { key: 'ict', label: 'ICT', noun: 'ICT', title: 'ICT approvals against plan', authority: 'ICT', dot: 'var(--uep-ict)' },
  { key: 'cra', label: 'CRA', noun: 'CRA', title: 'CRA approvals against plan', authority: 'CRA', dot: 'var(--uep-cra)' },
]
const BY_KEY = Object.fromEntries(STREAMS.map((s) => [s.key, s]))

/** A stream by its tab key; Fully accepted for anything else. */
export function streamOf(key) {
  return BY_KEY[key] ?? STREAMS[0]
}

// --------------------------------------------------------------- formatting
/** 2,880 -- or a dash for a figure that does not exist. */
export function fmt(value) {
  return formatNumber(value)
}

/** A share with one decimal under 100 ("70.4%"), whole at and above it. */
export function pct1(part, whole) {
  if (!whole) return null
  const value = (100 * part) / whole
  return value >= 100 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`
}

/** A signed count: +8, −20 (a true minus sign), 0. */
export function signed(value) {
  if (value > 0) return `+${fmt(value)}`
  if (value < 0) return `−${fmt(-value)}`
  return '0'
}

/** Persian digits, for a Farsi label: ۱۴۰۵. */
export function faDigits(value) {
  return Number(value).toLocaleString('fa-IR', { useGrouping: false })
}

/** "1405-07": the address form of a month (?month=). */
export function monthKey(month) {
  return `${month.shamsi_year}-${String(month.shamsi_month).padStart(2, '0')}`
}

/** "مهر ۱۴۰۵": a month as a header names it. */
export function monthName(month) {
  return `${month.label} ${faDigits(month.shamsi_year)}`
}

/** What the Contractor PIP is called for this reader. */
export function contractorPlanLabel(isContractor) {
  return isContractor ? 'Your PIP' : 'Contractor PIP'
}

// ---------------------------------------------------------------------- KPIs
/** The KPI strip for one tab: four equal tiles, from the overview payload.
 *
 * Each tile: `key`, `title`, the `figure` and the `drill` that opens the
 * villages behind it, exactly one `line` under it, and its `visual` -- a
 * `meter` (share 0-100) or a `stack` of parts, or none.
 *
 * `thisMonth` is the running month's approvals for the stream (from
 * /progress); the "+n this month" clause is left out while it is null.
 */
export function buildKpis(overview, streamKey, { thisMonth = null } = {}) {
  const { kpis, analysis } = overview
  const onair = kpis.total_onair_villages ?? 0
  const dtDone = kpis.total_dt_done_villages ?? 0
  const stream = streamOf(streamKey)
  const { authority } = stream

  let approved
  let remaining
  let rejected
  let waiting
  if (streamKey === 'village') {
    approved = analysis.villages_both_approved ?? 0
    remaining = Math.max(0, dtDone - approved)
    rejected = analysis.villages_rejected ?? 0
    waiting = analysis.villages_remained ?? 0
  } else {
    approved = kpis[`total_${streamKey}_approval`] ?? 0
    remaining = kpis[`total_${streamKey}_remained`] ?? 0
    rejected = kpis[`total_${streamKey}_rejected`] ?? 0
    waiting = kpis[`total_${streamKey}_pending`] ?? 0
  }
  const shareOfDt = pct1(approved, dtDone)
  const approvedLine = [
    thisMonth != null && `+${fmt(thisMonth)} this month`,
    shareOfDt != null && `${shareOfDt} of DT done`,
  ].filter(Boolean)

  return [
    {
      key: 'onair',
      title: 'Villages on air',
      figure: onair,
      drill: { metric: 'onair', label: 'Villages on air' },
      line: [{ text: `${fmt(Math.max(0, onair - dtDone))} awaiting drive test` }],
      visual: null,
    },
    {
      key: 'dt_done',
      title: 'Drive test done',
      figure: dtDone,
      drill: { metric: 'dt_done', label: 'Drive test done villages' },
      line: pct1(dtDone, onair) == null ? [] : [{ text: `${pct1(dtDone, onair)} of on air` }],
      visual: { meter: share(dtDone, onair) },
    },
    {
      key: 'approved',
      title: authority ? `${authority} approved` : 'Fully accepted',
      figure: approved,
      drill: authority
        ? { metric: 'approved', authority, label: `${authority} approved villages` }
        : { metric: 'approved', label: 'Fully accepted villages' },
      line: approvedLine.length ? [{ text: approvedLine.join(' · ') }] : [],
      visual: { meter: share(approved, dtDone) },
    },
    {
      key: 'remaining',
      title: 'Remaining',
      figure: remaining,
      drill: { metric: 'remaining', authority, label: authority ? `${authority} remaining villages` : 'Remaining villages' },
      // Two figures, each its own drill-through: refusals someone must fix,
      // and waits someone must chase. They partition Remaining.
      line: [
        {
          figure: rejected,
          text: 'rejected',
          tone: 'danger',
          drill: { metric: 'rejected', authority, label: authority ? `${authority} rejected villages` : 'Rejected villages' },
        },
        {
          figure: waiting,
          text: 'waiting',
          tone: 'pending',
          drill: {
            metric: 'remained',
            authority,
            label: authority ? `villages waiting for ${authority}` : 'Villages waiting for feedback',
          },
        },
      ],
      visual: {
        stack: [
          { key: 'rejected', share: share(rejected, rejected + waiting), color: 'var(--uep-status-danger-dot)' },
          { key: 'waiting', share: share(waiting, rejected + waiting), color: 'var(--uep-status-pending-dot)' },
        ],
        label: `${fmt(rejected)} rejected, ${fmt(waiting)} waiting for feedback`,
      },
    },
  ]
}

const share = (part, whole) => (whole ? Math.min(100, (100 * part) / whole) : 0)

// ----------------------------------------------------------- the pace maths
// d = today's day of the month (inclusive), D = the month's length, act =
// approved this month. The PIP card's words are built from these.

/** What an even pace would have delivered by today. */
export function dueToday(plan, d, D) {
  return Math.round((plan * d) / D)
}

/** Ahead (+) or behind (−): against due-by-today in the running month, the
 * whole plan in a closed one. */
export function pace(act, plan, { isCurrent, d, D }) {
  return act - (isCurrent ? dueToday(plan, d, D) : plan)
}

/** What is left to deliver; never negative. */
export function left(plan, act) {
  return Math.max(plan - act, 0)
}

/** Days after today in the month. */
export function daysLeft(d, D) {
  return D - d
}

/** What has to be delivered per remaining day; a last day counts as one. */
export function perDay(remaining, days) {
  return Math.ceil(remaining / Math.max(days, 1))
}

/** The true share delivered, which may exceed 100. */
export function pctOf(act, plan) {
  return Math.round((act / plan) * 100)
}

// ------------------------------------------------------------------- plans
/**
 * One month's plans for a stream, as this reader may see them. The server
 * already nulls what is withheld -- every plan when the page is narrowed to a
 * province, the Internal PIP for a contractor -- and this holds it here too,
 * so the screen can never show a plan the payload says is not available.
 */
export function visiblePlans(progress, row) {
  const available = progress?.plans_available !== false
  const internal = available && progress?.internal_visible !== false
  return {
    internal: internal ? row.internal_plan ?? null : null,
    internalCumulative: internal ? row.internal_plan_cumulative ?? null : null,
    contractor: available ? row.contractor_plan ?? null : null,
    contractorCumulative: available ? row.contractor_plan_cumulative ?? null : null,
  }
}

/** The reference plan's name for this reader (see the header). */
export function referencePlanLabel(progress, { isContractor = false } = {}) {
  return progress?.internal_visible !== false ? 'Internal PIP' : contractorPlanLabel(isContractor)
}

function reference(progress, plans) {
  return progress?.internal_visible !== false
    ? { plan: plans.internal, cumulative: plans.internalCumulative }
    : { plan: plans.contractor, cumulative: plans.contractorCumulative }
}

/** Where today sits in a month: { d, D } from the server's `today`. */
function clockOf(month, today) {
  const isCurrent = Boolean(month.is_current)
  const D = isCurrent ? today.days_in_month : month.days_in_month
  return { isCurrent, d: isCurrent ? today.day : D, D }
}

// ------------------------------------------------------------ month choice
/** The months a reader can open: every one that has started. */
export function selectableKeys(progress) {
  return (progress?.months ?? []).filter((m) => !m.is_future).map(monthKey)
}

/** ?month= when it can be opened, else the running month, else the year's
 * last month that has started (Esfand of a past year); null when none has. */
export function selectedMonth(progress, requested) {
  const keys = selectableKeys(progress)
  if (keys.includes(requested)) return requested
  const current = progress?.months?.find((m) => m.is_current)
  if (current) return monthKey(current)
  return keys[keys.length - 1] ?? null
}

// ------------------------------------------------------------- the PIP card
/** The PIP card's numbers for one month of one stream; null when the month
 * is not in the payload (or has not started).
 *
 * `plans` is one row per plan the reader may see -- Internal PIP, then the
 * Contractor PIP -- each with `act` "of" `plan`, its share, the bar and
 * the one line under it. `toDate` is the running totals at the month's end
 * against the reference plan's.
 */
export function monthView(progress, streamKey, key, { isContractor = false } = {}) {
  const month = (progress?.months ?? []).find((m) => monthKey(m) === key)
  if (!month || month.is_future) return null
  const row = month[streamKey]
  const clock = clockOf(month, progress.today)
  const visible = visiblePlans(progress, row)

  const rows = []
  if (progress.internal_visible !== false) {
    rows.push({ kind: 'internal', label: 'Internal PIP', plan: visible.internal })
  }
  rows.push({ kind: 'contractor', label: contractorPlanLabel(isContractor), plan: visible.contractor })

  const ref = reference(progress, visible)
  return {
    key,
    name: monthName(month),
    isCurrent: clock.isCurrent,
    approved: row.approved,
    status: clock.isCurrent ? `Day ${progress.today.day} of ${progress.today.days_in_month}` : 'Closed',
    plans: rows.map((p) => planRow(p, row.approved, clock)),
    toDate: toDateLine(row.approved_cumulative, ref.cumulative, referencePlanLabel(progress, { isContractor })),
  }
}

function planRow({ kind, label, plan }, act, clock) {
  if (plan == null) return { kind, label, plan: null, act, noPlan: true, line: [{ text: 'No plan set' }] }
  const p = pace(act, plan, clock)
  const remaining = left(plan, act)
  return {
    kind,
    label,
    plan,
    act,
    noPlan: false,
    pct: plan > 0 ? pctOf(act, plan) : null,
    bar: plan > 0 ? Math.min(100, (100 * act) / plan) : 100,
    today: clock.isCurrent ? (100 * clock.d) / clock.D : null,
    line: clock.isCurrent ? runningLine(p, remaining, daysLeft(clock.d, clock.D)) : closedLine(p),
  }
}

function runningLine(behind, remaining, days) {
  if (remaining === 0) return [{ text: 'Plan met' }]
  const parts = []
  if (behind < 0) parts.push({ text: `${fmt(-behind)} behind pace`, tone: 'danger', strong: true })
  parts.push({ text: `${fmt(remaining)} to go, about ${fmt(perDay(remaining, days))} a day` })
  return parts
}

function closedLine(result) {
  if (result < 0) return [{ text: `${signed(result)} short of plan`, tone: 'danger' }]
  if (result > 0) return [{ text: `${signed(result)} above plan` }]
  return [{ text: 'Exactly on plan' }]
}

function toDateLine(approved, plan, planLabel) {
  const gap = plan == null ? null : approved - plan
  return {
    approved,
    plan,
    planLabel: `${planLabel} to date`,
    gap:
      gap == null
        ? null
        : gap < 0
          ? { text: `${fmt(-gap)} behind`, tone: 'danger' }
          : gap > 0
            ? { text: `${fmt(gap)} ahead` }
            : { text: 'On plan' },
  }
}

// -------------------------------------------------------------------- chart
/** Everything the year chart draws for one stream.
 *
 * `points` are the year's twelve months, Farvardin to Esfand: `approved`
 * (null for a month that has not started), `internal` and `contractor` (the
 * plans, null where there is none), and `under`, the line under the month's
 * name -- "{p}%" of the reference plan for a closed month, "so far" for the
 * running one, "plan" for a future one. `legend` lists only what is drawn.
 */
export function chartSeries(progress, streamKey, { isContractor = false } = {}) {
  const months = progress?.months ?? []
  const points = months.map((m) => {
    const row = m[streamKey]
    const plans = visiblePlans(progress, row)
    const ref = reference(progress, plans).plan
    const isFuture = Boolean(m.is_future)
    const isCurrent = Boolean(m.is_current)
    const pct = !isFuture && !isCurrent && ref ? pctOf(row.approved, ref) : null
    return {
      key: monthKey(m),
      label: m.label,
      name: monthName(m),
      year: m.shamsi_year,
      isCurrent,
      isFuture,
      approved: isFuture ? null : row.approved,
      internal: plans.internal,
      contractor: plans.contractor,
      ref,
      pct,
      under: isFuture
        ? { text: 'plan' }
        : isCurrent
          ? { text: 'so far' }
          : pct == null
            ? null
            : { text: `${pct}%`, tone: pct < 100 ? 'danger' : undefined },
    }
  })
  const hasInternal = points.some((p) => p.internal != null)
  const hasContractor = points.some((p) => p.contractor != null)
  const max = Math.max(1, ...points.flatMap((p) => [p.approved ?? 0, p.internal ?? 0, p.contractor ?? 0]))

  const legend = [{ key: 'approved', label: 'Approved' }]
  if (hasInternal) legend.push({ key: 'internal', label: 'Internal PIP' })
  if (hasContractor) legend.push({ key: 'contractor', label: contractorPlanLabel(isContractor) })
  if (points.some((p) => p.isCurrent)) legend.push({ key: 'current', label: 'In progress' })
  if (points.some((p) => p.isFuture)) legend.push({ key: 'planned', label: 'Planned' })

  const today = progress?.today
  const currentIndex = points.findIndex((p) => p.isCurrent)
  return {
    points,
    max,
    legend,
    refLabel: referencePlanLabel(progress, { isContractor }),
    planLabel: contractorPlanLabel(isContractor),
    caption: planCaption(progress, streamKey, hasInternal || hasContractor),
    // Where today is inside the running month's column, 0-1.
    today: currentIndex >= 0 && today ? { index: currentIndex, at: today.day / today.days_in_month } : null,
  }
}

function planCaption(progress, streamKey, hasPlan) {
  if (hasPlan) return null
  if (progress && progress.plans_available === false) {
    return 'Plans are set for the whole programme, not per province.'
  }
  const { noun } = streamOf(streamKey)
  return `No ${noun} plan set for this year.`
}

/** One month's figures for the readout beside the key: the month, then
 * Approved and the plans for a month that has started ("{p}% of plan" once it
 * has closed), or "Upcoming" and the plans for one that has not. */
export function readout(series, index) {
  const p = series.points[index]
  if (!p) return null
  const figures = []
  if (!p.isFuture) figures.push({ key: 'approved', label: 'Approved', value: p.approved })
  if (p.internal != null) figures.push({ key: 'internal', label: 'Internal PIP', value: p.internal })
  if (p.contractor != null) figures.push({ key: 'contractor', label: series.planLabel, value: p.contractor })
  return {
    name: p.name,
    note: p.isFuture ? 'Upcoming' : p.isCurrent ? 'so far' : null,
    figures,
    pct: p.pct == null ? null : { text: `${p.pct}% of ${series.refLabel}`, tone: p.pct < 100 ? 'danger' : undefined },
  }
}

/** The year plan track: the year's approvals over the year's whole reference
 * plan, with -- in the running year -- what an even pace would have
 * delivered by today. Null when the year has no plan to read against.
 */
export function yearTrack(progress, streamKey) {
  const months = progress?.months ?? []
  let plan = 0
  let planned = false
  let approved = 0
  let due = 0
  let running = false
  for (const m of months) {
    const ref = reference(progress, visiblePlans(progress, m[streamKey])).plan
    if (ref != null) {
      plan += ref
      planned = true
    }
    if (m.is_future) continue
    approved += m[streamKey].approved ?? 0
    if (m.is_current) {
      running = true
      if (ref != null) due += dueToday(ref, progress.today.day, progress.today.days_in_month)
    } else if (ref != null) {
      due += ref
    }
  }
  if (!planned || plan === 0) return null
  const against = running ? due : plan
  const pct = against > 0 ? pctOf(approved, against) : null
  return {
    approved,
    plan,
    fill: Math.min(100, (100 * approved) / plan),
    due: running ? { value: due, at: Math.min(100, (100 * due) / plan) } : null,
    pct: pct == null ? null : { text: running ? `${pct}% of due` : `${pct}% of plan`, tone: pct < 100 ? 'danger' : undefined },
  }
}

/** The chart's accessible summary: the stream, the year, and each month's
 * approvals against its reference plan where there is one. */
export function chartSummary(series, streamKey, year) {
  const { title } = streamOf(streamKey)
  const parts = series.points.map((p) => {
    const plan = p.ref != null ? ` against a plan of ${fmt(p.ref)}` : ''
    if (p.isFuture) return `${p.label}: ${p.ref != null ? `planned ${fmt(p.ref)}` : 'no plan'}`
    return `${p.label}: ${fmt(p.approved)} approved${plan}${p.isCurrent ? ' so far' : ''}`
  })
  return `${title}, ${year}. ${parts.join('; ')}.`
}

/** Four quiet gridlines: a "nice" top and three steps under it, as tight
 * to the data as a round step allows. */
export function axisTicks(max) {
  const raw = Math.max(max, 1) / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = NICE.map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude
  return [1, 2, 3, 4].map((i) => Number((i * step).toPrecision(12)))
}
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]
