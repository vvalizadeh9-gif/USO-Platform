/**
 * The Acceptance Dashboard's view model: pure functions of the two payloads
 * the page reads (GET /acceptance/overview and GET /acceptance/progress).
 * No React and no fetching, so each rule here is tested on its own.
 *
 * Nothing here invents a number. A figure with no source is left out, a plan
 * that does not exist is `null` all the way to the screen, and the only
 * arithmetic is shares, paces and what is left -- each of them spelled out in
 * the functions below, and none of them a calendar calculation: the day of
 * the month and its length are the server's (`progress.today`).
 */

// ------------------------------------------------------------------ streams
/** The page's three tabs, in order. `key` is the tab and the payload key. */
export const STREAMS = [
  { key: 'village', label: 'Village', noun: 'village', title: 'Villages fully accepted against plan' },
  { key: 'ict', label: 'ICT', noun: 'ICT', title: 'ICT approvals against plan', authority: 'ICT' },
  { key: 'cra', label: 'CRA', noun: 'CRA', title: 'CRA approvals against plan', authority: 'CRA' },
]
const BY_KEY = Object.fromEntries(STREAMS.map((s) => [s.key, s]))

/** A stream by its tab key; Village for anything else. */
export function streamOf(key) {
  return BY_KEY[key] ?? STREAMS[0]
}

// --------------------------------------------------------------- formatting
/** 2,880 -- or a dash for a figure that does not exist. */
export function fmt(value) {
  return value == null ? '—' : Number(value).toLocaleString('en-US')
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

/** What the Contractor PIP is called for this reader. */
export function contractorPlanLabel(isContractor) {
  return isContractor ? 'Your PIP' : 'Contractor PIP'
}

// ---------------------------------------------------------------------- KPIs
/** The KPI band for one tab, from the overview payload.
 *
 * Each card: `key`, `title`, `icon` (a name the band maps to an icon), the
 * `figure`, its `context` line, the `bar` (share 0-100 and a colour token),
 * and the `drill` that opens the villages behind the figure. The ICT and CRA
 * Remaining card also carries two `tiles` -- Rejected and Waiting for
 * feedback -- which partition it.
 */
export function buildKpis(overview, streamKey) {
  const { kpis, analysis } = overview
  const onair = kpis.total_onair_villages ?? 0
  const dtDone = kpis.total_dt_done_villages ?? 0
  const shareOfDt = (n) => pct1(n, dtDone)

  const common = [
    {
      key: 'onair',
      title: 'Villages on air',
      icon: 'onair',
      figure: onair,
      // No "+N this month": the server has no month-on-month on-air figure,
      // and this page does not make one up.
      context: null,
      bar: { share: onair ? 100 : 0, color: 'var(--dt-muted)' },
      drill: { metric: 'onair', label: 'Villages on air' },
    },
    {
      key: 'dt_done',
      title: 'Drive test done',
      icon: 'dt_done',
      figure: dtDone,
      context: withOf(pct1(dtDone, onair), 'on air'),
      bar: { share: share(dtDone, onair), color: 'var(--accent)' },
      drill: { metric: 'dt_done', label: 'Drive test done villages' },
    },
  ]

  if (streamKey === 'village') {
    const accepted = analysis.villages_both_approved ?? 0
    const remaining = Math.max(0, dtDone - accepted)
    return [
      ...common,
      {
        key: 'approved',
        title: 'Fully accepted',
        icon: 'approved',
        figure: accepted,
        context: withOf(shareOfDt(accepted), 'DT done'),
        bar: { share: share(accepted, dtDone), color: 'var(--accent)' },
        drill: { metric: 'approved', label: 'Fully accepted villages' },
      },
      {
        key: 'remaining',
        title: 'Remaining',
        icon: 'remaining',
        figure: remaining,
        context: withOf(shareOfDt(remaining), 'DT done'),
        bar: { share: share(remaining, dtDone), color: 'var(--dt-pending-bar)' },
        drill: { metric: 'remaining', label: 'Remaining villages' },
      },
    ]
  }

  const { authority } = streamOf(streamKey)
  const a = streamKey
  const approved = kpis[`total_${a}_approval`] ?? 0
  const remaining = kpis[`total_${a}_remained`] ?? 0
  const rejected = kpis[`total_${a}_rejected`] ?? 0
  const pending = kpis[`total_${a}_pending`] ?? 0
  return [
    ...common,
    {
      key: 'approved',
      title: `${authority} approved`,
      icon: 'approved',
      figure: approved,
      context: withOf(shareOfDt(approved), 'DT done'),
      bar: { share: share(approved, dtDone), color: `var(--${a})` },
      drill: { metric: 'approved', authority, label: `${authority} approved villages` },
    },
    {
      key: 'remaining',
      title: 'Remaining',
      icon: 'remaining',
      figure: remaining,
      context: withOf(shareOfDt(remaining), 'DT done'),
      bar: { share: share(remaining, dtDone), color: 'var(--dt-pending-bar)' },
      drill: { metric: 'remaining', authority, label: `${authority} remaining villages` },
      tiles: [
        {
          key: 'rejected',
          title: 'Rejected',
          figure: rejected,
          context: withOf(wholePct(rejected, remaining), 'remaining'),
          dot: 'var(--danger-ink)',
          drill: { metric: 'rejected', authority, label: `${authority} rejected villages` },
        },
        {
          key: 'pending',
          title: 'Waiting for feedback',
          figure: pending,
          context: withOf(wholePct(pending, remaining), 'remaining'),
          dot: 'var(--pending-ink)',
          drill: { metric: 'remained', authority, label: `villages waiting for ${authority}` },
        },
      ],
    },
  ]
}

const share = (part, whole) => (whole ? Math.min(100, (100 * part) / whole) : 0)
const wholePct = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : null)
const withOf = (percent, of) => (percent == null ? null : `${percent} of ${of}`)

// ------------------------------------------------------------- the ring maths
// d = today's day of the month (inclusive), D = the month's length, act =
// approved this month. The same rules the panel's words are built from.

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

/** How much of the ring the arc covers, 0-1: capped at a full circle. */
export function arcFraction(act, plan) {
  return plan > 0 ? Math.min(act / plan, 1) : act > 0 ? 1 : 0
}

/** Where the due-by-today tick sits on the ring, in degrees from 12 o'clock. */
export function tickAngle(d, D) {
  return (d / D) * 360
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

// ---------------------------------------------------------------- one month
/** The panel's numbers for one month of one stream.
 *
 * `today` is `progress.today`. Returns null when the month is not in the
 * payload.
 */
export function monthView(progress, streamKey, key, today = progress?.today, { isContractor = false } = {}) {
  const months = progress?.months ?? []
  const month = months.find((m) => monthKey(m) === key)
  if (!month) return null
  const row = month[streamKey]
  const isCurrent = Boolean(month.is_current)
  const D = isCurrent ? today.days_in_month : month.days_in_month
  const d = isCurrent ? today.day : D
  const clock = { isCurrent, d, D }

  const visible = visiblePlans(progress, row)
  const plans = []
  if (progress.internal_visible) {
    plans.push({ kind: 'internal', label: 'Internal PIP', swatch: 'dashed', plan: visible.internal })
  }
  plans.push({ kind: 'contractor', label: contractorPlanLabel(isContractor), swatch: 'dotted', plan: visible.contractor })

  const rings = plans.map((p) => ring(p, row.approved, clock))
  return {
    key,
    label: month.label,
    year: month.shamsi_year,
    isCurrent,
    approved: row.approved,
    approvedToDate: row.approved_cumulative,
    status: isCurrent
      ? { text: `Day ${today.day} of ${today.days_in_month}`, tone: 'accent' }
      : { text: 'Closed', tone: 'neutral' },
    rings,
    finish: finishBox(rings, clock),
  }
}

function ring({ kind, label, swatch, plan }, act, clock) {
  if (plan == null) {
    return { kind, label, swatch, plan: null, act, noPlan: true }
  }
  const p = pace(act, plan, clock)
  return {
    kind,
    label,
    swatch,
    plan,
    act,
    noPlan: false,
    pct: plan > 0 ? pctOf(act, plan) : null,
    arc: arcFraction(act, plan),
    tick: clock.isCurrent ? tickAngle(clock.d, clock.D) : null,
    pace: pacePill(p, clock.isCurrent),
    left: left(plan, act),
    result: p,
  }
}

function pacePill(value, isCurrent) {
  const against = isCurrent ? 'vs due today' : 'vs plan'
  if (value === 0) return { text: isCurrent ? 'On pace' : 'On plan', tone: 'success' }
  return { text: `${signed(value)} ${against}`, tone: value > 0 ? 'success' : 'danger' }
}

/** "To finish on plan (N days left)" for the running month, "Month result"
 * for a closed one: one column per ring. */
function finishBox(rings, clock) {
  if (!clock.isCurrent) {
    return { title: 'Month result', columns: rings.map(resultColumn) }
  }
  const days = daysLeft(clock.d, clock.D)
  return {
    title: `To finish on plan (${days} ${days === 1 ? 'day' : 'days'} left)`,
    columns: rings.map((r) => toGoColumn(r, days)),
  }
}

function toGoColumn(r, days) {
  if (r.noPlan) return { kind: r.kind, figure: '—', line: 'no plan set' }
  if (r.left === 0) return { kind: r.kind, figure: 'Plan met', line: 'nothing left to do' }
  return { kind: r.kind, figure: `${fmt(r.left)} more`, line: `about ${fmt(perDay(r.left, days))} a day` }
}

function resultColumn(r) {
  if (r.noPlan) return { kind: r.kind, figure: '—', line: 'no plan set' }
  if (r.result > 0) return { kind: r.kind, figure: signed(r.result), line: 'above plan' }
  if (r.result < 0) return { kind: r.kind, figure: signed(r.result), line: 'short of plan' }
  return { kind: r.kind, figure: 'Met', line: 'exactly on plan' }
}

// -------------------------------------------------------------------- chart
/** Everything the progress chart draws for one stream and mode.
 *
 * `points` are the months, oldest first: `value` (approved, or approved to
 * date), `internal` and `contractor` (the plan, monthly or to date; null
 * where there is none), and in Monthly mode the attainment pill. `legend`
 * lists only the series that exist; `caption` explains a chart with no plan.
 */
export function chartSeries(progress, streamKey, mode, { isContractor = false } = {}) {
  const cumulative = mode === 'cumulative'
  const months = progress?.months ?? []
  const points = months.map((m) => {
    const row = m[streamKey]
    const plans = visiblePlans(progress, row)
    const internal = cumulative ? plans.internalCumulative : plans.internal
    const contractor = cumulative ? plans.contractorCumulative : plans.contractor
    return {
      key: monthKey(m),
      label: m.label,
      year: m.shamsi_year,
      isCurrent: Boolean(m.is_current),
      value: cumulative ? row.approved_cumulative : row.approved,
      internal,
      contractor,
      attainment: cumulative ? null : attainment(row.approved, plans.internal, m.is_current),
    }
  })
  const hasInternal = points.some((p) => p.internal != null)
  const hasContractor = points.some((p) => p.contractor != null)
  const max = Math.max(1, ...points.flatMap((p) => [p.value, p.internal ?? 0, p.contractor ?? 0]))

  const legend = [{ key: 'approved', label: cumulative ? 'Approved to date' : 'Approved' }]
  if (hasInternal) legend.push({ key: 'internal', label: 'Internal PIP' })
  if (hasContractor) legend.push({ key: 'contractor', label: contractorPlanLabel(isContractor) })
  if (!cumulative && points.some((p) => p.isCurrent)) legend.push({ key: 'current', label: 'Month in progress' })

  return {
    points,
    max,
    hasInternal,
    hasContractor,
    legend,
    caption: planCaption(progress, streamKey, hasInternal || hasContractor),
    callout: cumulative ? cumulativeCallout(points) : null,
  }
}

function attainment(approved, internalPlan, isCurrent) {
  if (internalPlan == null) return null
  if (internalPlan === 0) return null
  // The running month is not judged yet: its pill says so instead.
  if (isCurrent) return { text: 'so far', tone: 'neutral' }
  const value = Math.round((100 * approved) / internalPlan)
  return { text: `${value}%`, tone: value >= 100 ? 'success' : 'danger' }
}

function planCaption(progress, streamKey, hasPlan) {
  if (hasPlan) return null
  if (progress && progress.plans_available === false) {
    return 'Plans are set for the whole programme, not per province.'
  }
  const { noun } = streamOf(streamKey)
  return `No ${noun} plan set yet. A PM sets it on Monthly Plan.`
}

/** The one callout on the cumulative chart: at the last closed month, how far
 * approved-to-date is from the Internal PIP to date. */
function cumulativeCallout(points) {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]
    if (p.isCurrent) continue
    if (p.internal == null) return null
    const gap = p.value - p.internal
    return {
      index: i,
      gap,
      text: gap < 0 ? `${fmt(-gap)} behind internal PIP` : `${fmt(gap)} ahead of internal PIP`,
    }
  }
  return null
}

/** The chart's accessible summary: the stream, the window, and each month's
 * approvals against its Internal PIP where there is one. */
export function chartSummary(series, streamKey, mode) {
  const { label } = streamOf(streamKey)
  const what = streamKey === 'village' ? 'Villages fully accepted' : `${label} approvals`
  const unit = mode === 'cumulative' ? 'to date' : 'in'
  const parts = series.points.map((p) => {
    const plan = p.internal != null ? ` against an internal plan of ${fmt(p.internal)}` : ''
    return `${fmt(p.value)} ${unit} ${p.label}${plan}`
  })
  return `${what}, last ${series.points.length} months: ${parts.join('; ')}.`
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
